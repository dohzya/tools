//! Scopes: child worklogs inside one git repository. `scope.json` of a parent
//! lists its children; a child's points back to its parent.

use crate::ctx::{Ctx, Res, fail};
use crate::path::{basename, dirname, is_absolute, join, resolve};
use worklog_core::error::{Code, WtResult};
use worklog_core::json::J;

/// A scope found by scanning the repository.
#[derive(Debug, Clone)]
pub struct DiscoveredScope {
    /// Path of its worklog directory.
    pub absolute_path: String,
    /// Directory relative to the git root (`.` for the root).
    pub relative_path: String,
    /// Display id.
    pub id: String,
    /// Whether it is the root worklog.
    pub is_parent: bool,
}

/// Directories never scanned for worklogs.
const SKIP_DIRS: [&str; 4] = ["node_modules", "dist", "build", "target"];

/// Reads a `scope.json` in the worklog directory `worklog_path`; `None` when
/// it is missing or corrupted.
pub fn load_scope_config(ctx: &Ctx, worklog_path: &str) -> Option<J> {
    let text = ctx
        .ports
        .fs
        .read_to_string(&join(worklog_path, "scope.json"))
        .ok()??;
    J::parse(&text).ok()
}

/// Writes `scope.json`.
pub fn save_scope_config(ctx: &Ctx, worklog_path: &str, config: &J) -> WtResult<()> {
    ctx.write_raw(&join(worklog_path, "scope.json"), &config.to_pretty())
}

/// `{ "children": [...] }`
pub fn parent_config(children: Vec<J>) -> J {
    J::Obj(vec![("children".into(), J::Arr(children))])
}

/// `{ "parent": "../" }`
pub fn child_config(parent: &str) -> J {
    J::Obj(vec![("parent".into(), J::str(parent))])
}

/// A child entry `{ path, id }` plus optional fields in file order.
pub fn child_entry(path: &str, id: &str) -> J {
    J::Obj(vec![
        ("path".into(), J::str(path)),
        ("id".into(), J::str(id)),
    ])
}

/// Whether the config is a parent one (`"children" in config`).
pub fn is_parent_config(c: &J) -> bool {
    c.get("children").is_some()
}

/// Whether the config has a parent key (`"parent" in config`).
pub fn has_parent_key(c: &J) -> bool {
    c.get("parent").is_some()
}

/// The configured parent path, when truthy.
pub fn parent_of(c: &J) -> Option<String> {
    c.get("parent")
        .and_then(J::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Children entries.
pub fn children_of(c: &J) -> Vec<J> {
    match c.get("children") {
        Some(J::Arr(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// `path` of a child entry.
pub fn entry_path(e: &J) -> String {
    e.get("path")
        .and_then(J::as_str)
        .unwrap_or_default()
        .to_string()
}

/// `id` of a child entry.
pub fn entry_id(e: &J) -> String {
    e.get("id")
        .and_then(J::as_str)
        .unwrap_or_default()
        .to_string()
}

fn scan(
    ctx: &Ctx,
    dir: &str,
    depth: usize,
    max: usize,
    require_index: bool,
    out: &mut Vec<String>,
) {
    if depth >= max {
        return;
    }
    let Ok(entries) = ctx.ports.fs.read_dir(dir) else {
        return;
    };
    // Sorted: `read_dir` order depends on the file system (hash order on ext4,
    // sorted on APFS/NTFS), which made the listing differ between machines.
    let mut entries = entries;
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    for e in entries {
        if e.name.starts_with('.') && e.name != ctx.wl_dir {
            continue;
        }
        if SKIP_DIRS.contains(&e.name.as_str()) {
            continue;
        }
        let full = join(dir, &e.name);
        if e.name == ctx.wl_dir {
            let ok = if require_index {
                ctx.ports.fs.exists(&join(&full, "index.json"))
            } else {
                e.is_dir
            };
            if ok {
                out.push(full);
            }
        } else if e.is_dir {
            scan(ctx, &full, depth + 1, max, require_index, out);
        }
    }
}

/// Scans the repository for worklogs. `require_index` selects the stricter
/// rule of the list/assign code (an `index.json` must exist) over the looser
/// one of the scope commands (any `.worklog` directory).
pub fn discover_scopes(
    ctx: &Ctx,
    git_root: &str,
    depth: usize,
    require_index: bool,
) -> Vec<DiscoveredScope> {
    let mut paths = Vec::new();
    scan(ctx, git_root, 0, depth, require_index, &mut paths);
    let mut ids: Vec<(String, String)> = Vec::new();
    if let Some(root_cfg) = load_scope_config(ctx, &join(git_root, &ctx.wl_dir)) {
        for c in children_of(&root_cfg) {
            ids.push((entry_path(&c), entry_id(&c)));
        }
    }
    let mut scopes = Vec::new();
    for abs in paths {
        let rel = abs.get(git_root.len() + 1..).unwrap_or("").to_string();
        let is_parent = rel == ctx.wl_dir;
        let scope_path = if is_parent {
            String::new()
        } else {
            rel[..rel.len().saturating_sub(ctx.wl_dir.len() + 1)].to_string()
        };
        let default_id = if scope_path.is_empty() {
            "(root)".to_string()
        } else {
            scope_path.clone()
        };
        let custom = ids
            .iter()
            .find(|(p, _)| *p == scope_path)
            .map(|(_, i)| i.clone());
        scopes.push(DiscoveredScope {
            absolute_path: abs,
            relative_path: if scope_path.is_empty() {
                ".".into()
            } else {
                scope_path
            },
            id: custom.unwrap_or(default_id),
            is_parent,
        });
    }
    scopes
}

/// Nearest `.worklog` going up from `cwd`, stopping at `stop_at`.
pub fn find_nearest_worklog(ctx: &Ctx, cwd: &str, stop_at: Option<&str>) -> Option<String> {
    let mut current = cwd.to_string();
    loop {
        let path = join(&current, &ctx.wl_dir);
        if ctx.ports.fs.exists(&path) {
            return Some(path);
        }
        if stop_at == Some(current.as_str()) {
            break;
        }
        let parent = match current.rfind('/') {
            Some(i) => current[..i].to_string(),
            None => String::new(),
        };
        if parent.is_empty() || parent == current {
            break;
        }
        current = parent;
    }
    None
}

/// Worklog path of a scope given by `/`, `.`, a relative path or an id.
pub fn resolve_scope_identifier(
    ctx: &Ctx,
    identifier: &str,
    git_root: &str,
    cwd: &str,
) -> Res<String> {
    if identifier == "/" {
        return Ok(join(git_root, &ctx.wl_dir));
    }
    if identifier == "." {
        return resolve_active_scope(ctx, cwd, None, Some(git_root));
    }
    let scopes = discover_scopes(ctx, git_root, ctx.depth_limit, false);
    if let Some(s) = scopes.iter().find(|s| s.relative_path == identifier) {
        return Ok(s.absolute_path.clone());
    }
    let root_cfg = load_or_create_scope_config(ctx, &join(git_root, &ctx.wl_dir), git_root);
    if is_parent_config(&root_cfg) {
        let matches: Vec<J> = children_of(&root_cfg)
            .into_iter()
            .filter(|c| entry_id(c) == identifier)
            .collect();
        if matches.is_empty() {
            return fail(
                Code::ScopeNotFound,
                format!("Scope not found: {identifier}"),
            );
        }
        if matches.len() > 1 {
            let paths = matches
                .iter()
                .map(entry_path)
                .collect::<Vec<_>>()
                .join(", ");
            return fail(
                Code::ScopeAmbiguous,
                format!("Multiple scopes match '{identifier}': {paths}. Use full path."),
            );
        }
        let child = entry_path(&matches[0]);
        return Ok(if is_absolute(&child) {
            format!("{child}/{}", ctx.wl_dir)
        } else {
            format!("{git_root}/{child}/{}", ctx.wl_dir)
        });
    }
    fail(
        Code::ScopeNotFound,
        format!("Scope not found: {identifier}"),
    )
}

/// `loadOrCreateScopeJson`: the config, or a default one for a missing or
/// corrupted file.
pub fn load_or_create_scope_config(ctx: &Ctx, worklog_path: &str, git_root: &str) -> J {
    if let Some(c) = load_scope_config(ctx, worklog_path) {
        return c;
    }
    let rel = worklog_path.get(git_root.len() + 1..).unwrap_or("");
    if rel == ctx.wl_dir {
        return parent_config(Vec::new());
    }
    let scope_dir = &worklog_path[..worklog_path.len().saturating_sub(ctx.wl_dir.len() + 1)];
    let rel_to_root = scope_dir.get(git_root.len() + 1..).unwrap_or("");
    let depth = rel_to_root.split('/').count();
    child_config(&"../".repeat(depth))
}

/// Worklog of the active scope: `--scope`, else the nearest `.worklog`, else
/// the one at the git root, else the one of `cwd`.
pub fn resolve_active_scope(
    ctx: &Ctx,
    cwd: &str,
    flag_scope: Option<&str>,
    git_root: Option<&str>,
) -> Res<String> {
    if let (Some(flag), Some(root)) = (flag_scope.filter(|s| !s.is_empty()), git_root) {
        return resolve_scope_identifier(ctx, flag, root, cwd);
    }
    if let Some(n) = find_nearest_worklog(ctx, cwd, git_root) {
        return Ok(n);
    }
    if let Some(root) = git_root {
        let w = join(root, &ctx.wl_dir);
        if ctx.ports.fs.exists(&w) {
            return Ok(w);
        }
    }
    Ok(join(cwd, &ctx.wl_dir))
}

/// Whether the worklog at `scope_path` is a child.
pub fn is_child_worklog(ctx: &Ctx, scope_path: &str) -> bool {
    load_scope_config(ctx, scope_path).is_some_and(|c| has_parent_key(&c))
}

/// Directory of the parent of a child worklog.
pub fn parent_scope_dir(ctx: &Ctx, child_path: &str) -> Option<String> {
    let cfg = load_scope_config(ctx, child_path)?;
    let parent = cfg.get("parent").and_then(J::as_str)?;
    Some(resolve(&dirname(child_path), parent))
}

/// Display id of a worklog: `(root)`, a custom id from the root config, or
/// its path relative to the git root.
pub fn scope_id(ctx: &Ctx, worklog_path: &str, git_root: &str) -> String {
    let rel = relative_scope_path(ctx, worklog_path, git_root);
    if rel == "." {
        return "(root)".into();
    }
    if let Some(root_cfg) = load_scope_config(ctx, &join(git_root, &ctx.wl_dir))
        && is_parent_config(&root_cfg)
        && let Some(c) = children_of(&root_cfg)
            .into_iter()
            .find(|c| entry_path(c) == rel)
    {
        return entry_id(&c);
    }
    rel
}

/// Scope directory relative to the git root.
pub fn relative_scope_path(ctx: &Ctx, worklog_path: &str, git_root: &str) -> String {
    if !worklog_path.starts_with(git_root) {
        return basename(worklog_path);
    }
    let rel = worklog_path.get(git_root.len() + 1..).unwrap_or("");
    if rel == ctx.wl_dir {
        return ".".into();
    }
    rel[..rel.len().saturating_sub(ctx.wl_dir.len() + 1)].to_string()
}

/// Own tags plus the tags the parent config gives to this scope.
pub fn effective_tags(
    ctx: &Ctx,
    own: &[String],
    scope_path: &str,
    git_root: Option<&str>,
) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for t in own {
        if !tags.contains(t) {
            tags.push(t.clone());
        }
    }
    if git_root.is_none() {
        return tags;
    }
    let Some(cfg) = load_scope_config(ctx, scope_path) else {
        return tags;
    };
    let mut add = |entry: &J| {
        if let Some(J::Arr(ts)) = entry.get("tags") {
            for t in ts.iter().filter_map(J::as_str) {
                if !tags.contains(&t.to_string()) {
                    tags.push(t.to_string());
                }
            }
        }
    };
    if let Some(parent) = cfg.get("parent").and_then(J::as_str) {
        let parent_path = resolve(&dirname(scope_path), parent);
        if let Some(pcfg) = load_scope_config(ctx, &parent_path) {
            let me = children_of(&pcfg)
                .into_iter()
                .find(|c| resolve(&parent_path, &entry_path(c)) == scope_path);
            if let Some(m) = me {
                add(&m);
            }
        }
    } else if is_parent_config(&cfg) {
        let me = children_of(&cfg)
            .into_iter()
            .find(|c| resolve(scope_path, &entry_path(c)) == scope_path);
        if let Some(m) = me {
            add(&m);
        }
    }
    tags.sort();
    tags
}

/// Fails with `not_in_git_repo` when there is no repository.
pub fn require_git_root(ctx: &Ctx, msg: &str) -> Res<String> {
    match ctx.ports.git.root(&ctx.cwd) {
        Some(r) => Ok(r),
        None => fail(Code::NotInGitRepo, msg),
    }
}
