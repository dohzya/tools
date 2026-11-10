//! Scope commands: list, add, add-parent, rename, delete, assign, export,
//! sync-worktrees.

use super::list::resolve_scope_identifier_list;
use crate::ctx::{Ctx, Res, fail};
use crate::path::{basename, join, relative_path};
use crate::scope::*;
use worklog_core::error::Code;
use worklog_core::index::{Index, matches_tag_pattern, prefix_matches, validate_tag};
use worklog_core::json::J;
use worklog_core::output::*;
use worklog_core::taskfile;
use worklog_core::yaml::Value;

fn root_or_fail(ctx: &Ctx, msg: &str) -> Res<String> {
    require_git_root(ctx, msg)
}

const NOT_GIT: &str = "Not in a git repository. Scopes require git.";

fn wl_len(ctx: &Ctx) -> usize {
    ctx.wl_dir.len() + 1
}

/// `refreshScopeHierarchy`
fn refresh_scope_hierarchy(ctx: &Ctx, git_root: &str, scopes: &[DiscoveredScope]) -> Res<()> {
    let root_scope = scopes.iter().find(|s| s.is_parent);
    let children: Vec<&DiscoveredScope> = scopes.iter().filter(|s| !s.is_parent).collect();
    if let Some(root) = root_scope {
        let existing = load_or_create_scope_config(ctx, &root.absolute_path, git_root);
        let ids: Vec<(String, String)> = children_of(&existing)
            .iter()
            .map(|c| (entry_path(c), entry_id(c)))
            .collect();
        let entries: Vec<J> = children
            .iter()
            .map(|s| {
                let path = if s.relative_path == "." {
                    String::new()
                } else {
                    s.relative_path.clone()
                };
                let default_id = if s.relative_path == "." {
                    "(root)".to_string()
                } else {
                    s.relative_path.clone()
                };
                let id = ids
                    .iter()
                    .find(|(p, _)| *p == path)
                    .map(|(_, i)| i.clone())
                    .unwrap_or(default_id);
                child_entry(&path, &id)
            })
            .collect();
        save_scope_config(ctx, &root.absolute_path, &parent_config(entries))?;
    }
    for c in children {
        let dir = &c.absolute_path[..c.absolute_path.len() - wl_len(ctx)];
        let rel = dir.get(git_root.len() + 1..).unwrap_or("");
        let depth = rel.split('/').filter(|p| !p.is_empty()).count();
        save_scope_config(ctx, &c.absolute_path, &child_config(&"../".repeat(depth)))?;
    }
    Ok(())
}

fn scope_display_path(ctx: &Ctx, rel: &str) -> String {
    if rel == "." {
        format!("{}/", ctx.wl_dir)
    } else {
        format!("{rel}/{}/", ctx.wl_dir)
    }
}

fn list_scopes_from_parent(ctx: &Ctx, parent_wl: &str, active_wl: &str) -> Res<ScopesOutput> {
    let parent_dir = &parent_wl[..parent_wl.len() - wl_len(ctx)];
    let Some(cfg) = load_scope_config(ctx, parent_wl) else {
        return Ok(ScopesOutput { scopes: vec![] });
    };
    if !is_parent_config(&cfg) {
        return Ok(ScopesOutput { scopes: vec![] });
    }
    let mut scopes = vec![ScopeLine {
        id: parent_dir
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or("parent")
            .to_string(),
        path: format!("{}/", ctx.wl_dir),
        is_active: parent_wl == active_wl,
    }];
    for child in children_of(&cfg) {
        let p = entry_path(&child);
        let Ok(child_dir) = ctx.ports.fs.real_path(&join(parent_dir, &p)) else {
            continue;
        };
        let cwl = join(&child_dir, &ctx.wl_dir);
        if !ctx.ports.fs.exists(&cwl) {
            continue;
        }
        scopes.push(ScopeLine {
            id: entry_id(&child),
            path: format!("{p}/{}/", ctx.wl_dir),
            is_active: cwl == active_wl,
        });
    }
    Ok(ScopesOutput { scopes })
}

/// `cmdScopes`
pub fn list(ctx: &mut Ctx, refresh: bool) -> Res<ScopesOutput> {
    let cwd = ctx.cwd.clone();
    let git_root = ctx.ports.git.root(&cwd);
    if let Some(current) = find_nearest_worklog(ctx, &cwd, None)
        && let Some(cfg) = load_scope_config(ctx, &current)
        && let Some(parent) = parent_of(&cfg)
    {
        let child_dir = &current[..current.len() - wl_len(ctx)];
        if let Ok(parent_dir) = ctx.ports.fs.real_path(&join(child_dir, &parent)) {
            let pwl = join(&parent_dir, &ctx.wl_dir);
            if ctx.ports.fs.exists(&pwl)
                && let Ok(out) = list_scopes_from_parent(ctx, &pwl, &current)
            {
                return Ok(out);
            }
        }
    }
    let Some(root) = git_root else {
        return fail(
            Code::NotInGitRepo,
            "Not in a git repository and no parent scope configured.",
        );
    };
    let needs_refresh = refresh
        || !ctx
            .ports
            .fs
            .exists(&join(&join(&root, &ctx.wl_dir), "scope.json"));
    let scopes = discover_scopes(ctx, &root, ctx.depth_limit, false);
    if needs_refresh {
        refresh_scope_hierarchy(ctx, &root, &scopes)?;
    }
    let active = resolve_active_scope(ctx, &cwd, None, Some(&root))?;
    Ok(ScopesOutput {
        scopes: scopes
            .iter()
            .map(|s| ScopeLine {
                id: s.id.clone(),
                path: scope_display_path(ctx, &s.relative_path),
                is_active: s.absolute_path == active,
            })
            .collect(),
    })
}

/// `scopes list [id]`: the list or the detail of one scope.
pub enum ListResult {
    /// All scopes.
    All(ScopesOutput),
    /// One scope.
    One(ScopeDetail),
}

/// `cmdScopesList`
pub fn list_or_detail(ctx: &mut Ctx, refresh: bool, scope_id_arg: Option<&str>) -> Res<ListResult> {
    let Some(scope) = scope_id_arg.filter(|s| !s.is_empty()) else {
        return Ok(ListResult::All(list(ctx, refresh)?));
    };
    let cwd = ctx.cwd.clone();
    let Some(root) = ctx.ports.git.root(&cwd) else {
        return fail(
            Code::NotInGitRepo,
            "Not in a git repository. Scope details require git.",
        );
    };
    let wl = resolve_scope_identifier(ctx, scope, &root, &cwd)?;
    let index = ctx.load_index_from(&wl)?;
    let rel = wl.get(root.len() + 1..).unwrap_or("");
    let path = rel[..rel.len().saturating_sub(wl_len(ctx))].to_string();
    Ok(ListResult::One(ScopeDetail {
        id: scope.to_string(),
        path: if path.is_empty() { ".".into() } else { path },
        task_count: index.ids().len(),
    }))
}

fn empty_worklog(ctx: &Ctx, worklog_path: &str) -> Res<()> {
    ctx.ports
        .fs
        .create_dir_all(&join(worklog_path, "tasks"))
        .or_else(|_| {
            fail(
                Code::IoError,
                format!("Failed to write file: {worklog_path}"),
            )
        })?;
    ctx.save_index_to(worklog_path, &Index::empty())?;
    Ok(())
}

/// `AddScopeUseCase.execute`
pub fn add(
    ctx: &mut Ctx,
    scope_id_arg: &str,
    path: Option<&str>,
    worktree: bool,
    git_ref: Option<&str>,
) -> Res<StatusOutput> {
    let cwd = ctx.cwd.clone();
    let root = root_or_fail(ctx, NOT_GIT)?;
    let path = path.filter(|p| !p.is_empty());
    if path.is_some() && worktree {
        return fail(
            Code::InvalidArgs,
            "Cannot use --path and --worktree together. Choose one.",
        );
    }
    let target_dir;
    let effective_path;
    let mut git_ref_used: Option<String> = None;
    if worktree {
        let gr = git_ref
            .filter(|r| !r.is_empty())
            .unwrap_or(scope_id_arg)
            .to_string();
        let worktrees = ctx
            .ports
            .git
            .worktrees(&cwd)
            .or_else(|e| fail(Code::IoError, format!("Failed to list worktrees: {e}")))?;
        target_dir = match worktrees
            .iter()
            .find(|w| w.branch.as_deref() == Some(gr.as_str()))
        {
            Some(w) => w.path.clone(),
            None => {
                if ctx.ports.git.current_branch(&cwd).as_deref() == Some(gr.as_str()) {
                    root.clone()
                } else {
                    return fail(
                        Code::WorktreeNotFound,
                        format!(
                            "No worktree found for ref: {gr}. Create the worktree first with 'git worktree add'."
                        ),
                    );
                }
            }
        };
        let main = worktrees.iter().find(|w| w.is_main);
        effective_path = match main {
            Some(m) if target_dir.starts_with(&m.path) => {
                let rest = target_dir.get(m.path.len() + 1..).unwrap_or("");
                if rest.is_empty() {
                    ".".to_string()
                } else {
                    rest.to_string()
                }
            }
            _ => target_dir.clone(),
        };
        git_ref_used = Some(gr);
    } else {
        effective_path = path.unwrap_or(scope_id_arg).to_string();
        target_dir = if effective_path.starts_with('/') {
            effective_path.clone()
        } else {
            format!("{root}/{effective_path}")
        };
    }
    let worklog_path = join(&target_dir, &ctx.wl_dir);
    let rel_to_root = target_dir.get(root.len() + 1..).unwrap_or("");
    let depth = rel_to_root.split('/').filter(|p| !p.is_empty()).count();
    let parent_path = "../".repeat(depth);
    let mut already = false;
    if ctx.ports.fs.exists(&worklog_path) {
        let cfg = load_scope_config(ctx, &worklog_path);
        match cfg.as_ref().and_then(parent_of) {
            Some(p) if p == parent_path => already = true,
            Some(_) => {
                return fail(
                    Code::AlreadyHasParent,
                    format!("Scope at {effective_path} already has a parent configured."),
                );
            }
            None => save_scope_config(ctx, &worklog_path, &child_config(&parent_path))?,
        }
    } else {
        empty_worklog(ctx, &worklog_path)?;
        save_scope_config(ctx, &worklog_path, &child_config(&parent_path))?;
    }
    let root_wl = join(&root, &ctx.wl_dir);
    let root_cfg = load_scope_config(ctx, &root_wl);
    let mut children: Vec<J> = Vec::new();
    match &root_cfg {
        Some(c) if is_parent_config(c) => children = children_of(c),
        Some(c) if has_parent_key(c) => {
            return fail(
                Code::InvalidState,
                "Root worklog is configured as a child scope. This is invalid.",
            );
        }
        _ => {}
    }
    let set_type = |entry: &mut J| {
        if worktree {
            entry.set("type", Some(J::str("worktree")));
            entry.set("gitRef", git_ref_used.clone().map(J::Str));
        }
    };
    if let Some(existing) = children
        .iter_mut()
        .find(|c| entry_path(c) == effective_path)
    {
        existing.set("id", Some(J::str(scope_id_arg)));
        set_type(existing);
    } else {
        let mut e = child_entry(&effective_path, scope_id_arg);
        set_type(&mut e);
        children.push(e);
    }
    save_scope_config(ctx, &root_wl, &parent_config(children))?;
    Ok(StatusOutput::new(if already {
        "scope_already_configured"
    } else {
        "scope_created"
    }))
}

/// `cmdScopesAddParent`
pub fn add_parent(ctx: &mut Ctx, parent_path: &str, id: Option<&str>) -> Res<StatusOutput> {
    let cwd = ctx.cwd.clone();
    let Some(child_wl) = find_nearest_worklog(ctx, &cwd, None) else {
        return fail(
            Code::NotInitialized,
            "No worklog found. Run 'wl init' first.",
        );
    };
    let child_dir = child_wl[..child_wl.len() - wl_len(ctx)].to_string();
    let resolved = if parent_path.starts_with('/') {
        parent_path.to_string()
    } else {
        format!("{cwd}/{parent_path}")
    };
    let parent_dir = match ctx.ports.fs.real_path(&resolved) {
        Ok(p) => p,
        Err(_) => {
            return fail(
                Code::IoError,
                format!("Parent path does not exist: {parent_path}"),
            );
        }
    };
    let norm_child = ctx
        .ports
        .fs
        .real_path(&child_dir)
        .unwrap_or(child_dir.clone());
    if parent_dir == norm_child {
        return fail(
            Code::InvalidArgs,
            "Cannot configure a scope as its own parent.",
        );
    }
    let parent_wl = join(&parent_dir, &ctx.wl_dir);
    if !ctx.ports.fs.exists(&parent_wl) {
        return fail(
            Code::NotInitialized,
            format!("No worklog found at parent path: {parent_path}. Run 'wl init' there first."),
        );
    }
    let rel_to_parent = relative_path(&child_dir, &parent_dir);
    let mut already = false;
    if let Some(cfg) = load_scope_config(ctx, &child_wl)
        && let Some(p) = parent_of(&cfg)
    {
        if p == rel_to_parent {
            already = true;
        } else {
            return fail(
                Code::AlreadyHasParent,
                format!(
                    "This scope already has a parent configured: {p}. Remove it first if you want to change parents."
                ),
            );
        }
    }
    if !already {
        save_scope_config(ctx, &child_wl, &child_config(&rel_to_parent))?;
    }
    let pcfg = load_or_create_scope_config(ctx, &parent_wl, &parent_dir);
    if !is_parent_config(&pcfg) {
        return fail(
            Code::InvalidState,
            "Parent is configured as a child scope itself. Nested hierarchies are not yet supported.",
        );
    }
    let rel_to_child = relative_path(&parent_dir, &child_dir);
    let child_id = id
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| basename(&child_dir));
    let mut children = children_of(&pcfg);
    match children.iter_mut().find(|c| entry_path(c) == rel_to_child) {
        None => children.push(child_entry(&rel_to_child, &child_id)),
        Some(c) => {
            if let Some(i) = id.filter(|s| !s.is_empty()) {
                c.set("id", Some(J::str(i)));
            }
        }
    }
    save_scope_config(ctx, &parent_wl, &parent_config(children))?;
    Ok(StatusOutput::new(if already {
        "parent_already_configured"
    } else {
        "parent_configured"
    }))
}

/// `RenameScopeUseCase`
pub fn rename(ctx: &mut Ctx, scope: &str, new_id: &str) -> Res<StatusOutput> {
    let root = root_or_fail(ctx, NOT_GIT)?;
    let root_wl = join(&root, &ctx.wl_dir);
    let cfg = load_scope_config(ctx, &root_wl);
    let Some(cfg) = cfg.filter(is_parent_config) else {
        return fail(
            Code::ScopeNotFound,
            "Root configuration corrupted or no child scopes found.",
        );
    };
    let mut children = children_of(&cfg);
    let Some(child) = children
        .iter_mut()
        .find(|c| entry_id(c) == scope || entry_path(c) == scope)
    else {
        return fail(Code::ScopeNotFound, format!("Scope not found: {scope}"));
    };
    child.set("id", Some(J::str(new_id)));
    save_scope_config(ctx, &root_wl, &parent_config(children))?;
    Ok(StatusOutput::new("scope_renamed"))
}

/// `cmdScopesDelete` + `DeleteScopeUseCase`
pub fn delete(
    ctx: &mut Ctx,
    scope: &str,
    move_to: Option<&str>,
    delete_tasks: bool,
) -> Res<StatusOutput> {
    let cwd = ctx.cwd.clone();
    let root = root_or_fail(ctx, NOT_GIT)?;
    if let Some(dest) = move_to.filter(|m| !m.is_empty()) {
        let wl = resolve_scope_identifier(ctx, scope, &root, &cwd)?;
        let index = ctx.load_index_from(&wl)?;
        let ids = index.ids();
        if !ids.is_empty() {
            let res = assign(ctx, dest, &ids)?;
            if !res.errors.is_empty() {
                return fail(
                    Code::IoError,
                    format!(
                        "Failed to move some tasks: {}",
                        res.errors
                            .iter()
                            .map(|e| e.task_id.clone())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                );
            }
        }
    }
    let wl = resolve_scope_identifier_list(ctx, scope, &root)?;
    let index_path = join(&wl, "index.json");
    let Ok(Some(text)) = ctx.ports.fs.read_to_string(&index_path) else {
        return fail(Code::NotInitialized, format!("No worklog at: {wl}"));
    };
    let index = Index::parse(&text, false)
        .or_else(|_| fail(Code::IoError, format!("Failed to read file: {index_path}")))?;
    let count = index.ids().len();
    if count > 0 {
        if let Some(dest) = move_to.filter(|m| !m.is_empty()) {
            return fail(
                Code::ScopeHasTasks,
                format!(
                    "Scope has {count} task(s). Move tasks first using 'wl scopes assign {dest} ...'"
                ),
            );
        } else if !delete_tasks {
            return fail(
                Code::ScopeHasTasks,
                format!("Scope has {count} task(s). Use --move-to <scope-id> or --delete-tasks"),
            );
        }
    }
    ctx.ports.fs.remove(&wl);
    let scopes = discover_scopes(ctx, &root, ctx.depth_limit, true);
    if let Some(rs) = scopes.iter().find(|s| s.is_parent)
        && let Some(cfg) = load_scope_config(ctx, &rs.absolute_path)
        && is_parent_config(&cfg)
    {
        let kept: Vec<J> = children_of(&cfg)
            .into_iter()
            .filter(|c| {
                let p = entry_path(c);
                let cwl = if p.starts_with('/') {
                    format!("{p}/{}", ctx.wl_dir)
                } else {
                    format!("{root}/{p}/{}", ctx.wl_dir)
                };
                cwl != wl
            })
            .collect();
        save_scope_config(ctx, &rs.absolute_path, &parent_config(kept))?;
    }
    Ok(StatusOutput::new("scope_deleted"))
}

fn find_task_in_scopes(
    ctx: &Ctx,
    prefix: &str,
    scopes: &[DiscoveredScope],
) -> Option<(String, String)> {
    let mut all: Vec<(String, String)> = Vec::new();
    for s in scopes {
        let Ok(Some(text)) = ctx
            .ports
            .fs
            .read_to_string(&join(&s.absolute_path, "index.json"))
        else {
            continue;
        };
        let Ok(index) = Index::parse(&text, false) else {
            continue;
        };
        for id in index.ids() {
            all.push((s.absolute_path.clone(), id));
        }
    }
    if let Some(t) = all.iter().find(|(_, id)| id == prefix) {
        return Some(t.clone());
    }
    let ids: Vec<String> = all.iter().map(|(_, id)| id.clone()).collect();
    let m = prefix_matches(prefix, &ids);
    if m.len() == 1 {
        return all.iter().find(|(_, id)| *id == m[0]).cloned();
    }
    None
}

fn raw_index(ctx: &Ctx, wl: &str) -> Res<Index> {
    let path = join(wl, "index.json");
    let text = ctx.read_text(&path)?;
    Index::parse(&text, false)
        .or_else(|_| fail(Code::IoError, format!("Failed to read file: {path}")))
}

/// `AssignScopeUseCase`
pub fn assign(ctx: &mut Ctx, target: &str, task_ids: &[String]) -> Res<AssignOutput> {
    let root = root_or_fail(ctx, NOT_GIT)?;
    let target_wl = resolve_scope_identifier_list(ctx, target, &root)?;
    let scopes = discover_scopes(ctx, &root, ctx.depth_limit, true);
    let (mut assigned, mut merged) = (0, 0);
    let mut errors: Vec<TaskError> = Vec::new();
    for prefix in task_ids {
        let r: Res<()> = (|| {
            let Some((source_wl, task_id)) = find_task_in_scopes(ctx, prefix, &scopes) else {
                errors.push(TaskError {
                    task_id: prefix.clone(),
                    error: "Task not found in any scope".into(),
                });
                return Ok(());
            };
            if source_wl == target_wl {
                return Ok(());
            }
            let source_path = join(&source_wl, &format!("tasks/{task_id}.md"));
            let content = ctx.read_text(&source_path)?;
            let parsed = taskfile::parse_task_file(&content)?;
            let mut target_index = raw_index(ctx, &target_wl)?;
            let mut existing = None;
            for id in target_index.ids() {
                let p = join(&target_wl, &format!("tasks/{id}.md"));
                if ctx.ports.fs.exists(&p) {
                    let dest = taskfile::parse_task_file(&ctx.read_text(&p)?)?;
                    if dest.uid() == parsed.uid() {
                        existing = Some(id);
                        break;
                    }
                }
            }
            if existing.is_some() {
                merged += 1;
            } else {
                ctx.write_text(&join(&target_wl, &format!("tasks/{task_id}.md")), &content)?;
                let mut entry = vec![
                    ("name".to_string(), J::str(parsed.name())),
                    ("desc".into(), J::strings(parsed.desc())),
                    (
                        "status".into(),
                        parsed.timestamp("status").map_or(J::Null, J::Str),
                    ),
                    ("created".into(), J::str(parsed.created_at())),
                    ("status_updated_at".into(), J::str(parsed.created_at())),
                ];
                if parsed.fm.iter().any(|(k, _)| k == "done_at") {
                    entry.push((
                        "done_at".into(),
                        parsed.timestamp("done_at").map_or(J::Null, J::Str),
                    ));
                }
                target_index.put(&task_id, J::Obj(entry));
                ctx.save_index_to(&target_wl, &target_index)?;
                assigned += 1;
            }
            ctx.ports.fs.remove(&source_path);
            let mut source_index = raw_index(ctx, &source_wl)?;
            source_index.remove(&task_id);
            ctx.save_index_to(&source_wl, &source_index)?;
            Ok(())
        })();
        if let Err(crate::ctx::Fail::Wt(e)) = r {
            errors.push(TaskError {
                task_id: prefix.clone(),
                error: e.message,
            });
        }
    }
    Ok(AssignOutput {
        assigned,
        merged,
        errors,
    })
}

fn strip_tag(tags: &[String], pattern: &str) -> Vec<String> {
    tags.iter()
        .filter(|t| !matches_tag_pattern(pattern, t))
        .map(|t| {
            t.strip_prefix(&format!("{pattern}/"))
                .map_or(t.clone(), str::to_string)
        })
        .collect()
}

/// `AssignByTagUseCase`
pub fn assign_by_tag(ctx: &mut Ctx, scope: &str, tag: &str) -> Res<AssignByTagOutput> {
    let root = root_or_fail(ctx, NOT_GIT)?;
    let target_wl = resolve_scope_identifier_list(ctx, scope, &root)?;
    let scopes = discover_scopes(ctx, &root, ctx.depth_limit, true);
    let mut matching: Vec<(String, String)> = Vec::new();
    for s in &scopes {
        let Ok(Some(text)) = ctx
            .ports
            .fs
            .read_to_string(&join(&s.absolute_path, "index.json"))
        else {
            continue;
        };
        let Ok(index) = Index::parse(&text, false) else {
            continue;
        };
        for (id, e) in index.entries() {
            if e.tags.iter().any(|t| matches_tag_pattern(tag, t)) {
                matching.push((id, s.absolute_path.clone()));
            }
        }
    }
    let (mut moved, mut updated) = (0, 0);
    let mut errors: Vec<TaskError> = Vec::new();
    for (task_id, scope_path) in matching {
        let r: Res<()> = (|| {
            let source_path = join(&scope_path, &format!("tasks/{task_id}.md"));
            let content = ctx.read_text(&source_path)?;
            let mut source_index = raw_index(ctx, &scope_path)?;
            let Some(entry) = source_index.entry(&task_id) else {
                return fail(Code::TaskNotFound, "missing index entry");
            };
            let new_tags = strip_tag(&entry.tags, tag);
            let value = (!new_tags.is_empty())
                .then(|| Value::Seq(new_tags.iter().cloned().map(Value::Str).collect()));
            let new_content = taskfile::update_frontmatter(&content, &[("tags", value)]);
            let tags_json = (!new_tags.is_empty()).then(|| J::strings(new_tags.clone()));
            if scope_path == target_wl {
                ctx.write_text(&source_path, &new_content)?;
                source_index.update(&task_id, vec![("tags", tags_json)]);
                ctx.save_index_to(&scope_path, &source_index)?;
                updated += 1;
            } else {
                ctx.write_text(
                    &join(&target_wl, &format!("tasks/{task_id}.md")),
                    &new_content,
                )?;
                let mut updated_entry = source_index.raw(&task_id).cloned().unwrap_or_else(J::obj);
                updated_entry.set("tags", tags_json);
                let mut target_index = raw_index(ctx, &target_wl)?;
                target_index.put(&task_id, updated_entry);
                ctx.save_index_to(&target_wl, &target_index)?;
                ctx.ports.fs.remove(&source_path);
                source_index.remove(&task_id);
                ctx.save_index_to(&scope_path, &source_index)?;
                moved += 1;
            }
            Ok(())
        })();
        if let Err(crate::ctx::Fail::Wt(e)) = r {
            errors.push(TaskError {
                task_id: task_id.clone(),
                error: e.message,
            });
        }
    }
    Ok(AssignByTagOutput {
        moved,
        updated,
        errors,
    })
}

/// `ExportScopeUseCase`
pub fn export(
    ctx: &mut Ctx,
    tag: &str,
    target_path: &str,
    remove_tag: bool,
    custom_id: Option<&str>,
) -> Res<ExportOutput> {
    if let Some(e) = validate_tag(tag) {
        return fail(Code::InvalidArgs, format!("Invalid tag '{tag}': {e}"));
    }
    let root = root_or_fail(ctx, "Not in a git repository. Export requires git.")?;
    let scope_id_text = custom_id
        .filter(|s| !s.is_empty())
        .unwrap_or(tag)
        .to_string();
    let scopes = discover_scopes(ctx, &root, ctx.depth_limit, true);
    let mut matching: Vec<(String, String, J)> = Vec::new();
    for s in &scopes {
        let index_path = join(&s.absolute_path, "index.json");
        if !ctx.ports.fs.exists(&index_path) {
            continue;
        }
        let index = raw_index(ctx, &s.absolute_path)?;
        for (id, raw) in index.raw_entries() {
            let e = index
                .entry(id)
                .unwrap_or_else(|| worklog_core::index::IndexEntry::from_json(raw));
            if e.tags.iter().any(|t| matches_tag_pattern(tag, t)) {
                matching.push((id.clone(), s.absolute_path.clone(), raw.clone()));
            }
        }
    }
    if matching.is_empty() {
        return fail(Code::TaskNotFound, format!("No tasks with tag: {tag}"));
    }
    let abs_target = if target_path.starts_with('/') {
        target_path.to_string()
    } else {
        format!("{}/{target_path}", ctx.cwd)
    };
    let target_wl = join(&abs_target, &ctx.wl_dir);
    if ctx.ports.fs.exists(&target_wl) && ctx.ports.fs.exists(&join(&target_wl, "index.json")) {
        let ti = raw_index(ctx, &target_wl)?;
        if !ti.ids().is_empty() {
            return fail(
                Code::InvalidState,
                format!(
                    "Target worklog has {} tasks. Choose different path.",
                    ti.ids().len()
                ),
            );
        }
    }
    ctx.ports
        .fs
        .create_dir_all(&join(&target_wl, "tasks"))
        .or_else(|_| fail(Code::IoError, format!("Failed to write file: {target_wl}")))?;
    let mut target_index = Index::empty();
    for (id, scope_path, raw) in &matching {
        let source_path = join(scope_path, &format!("tasks/{id}.md"));
        let content = ctx.read_text(&source_path)?;
        let current = worklog_core::index::IndexEntry::from_json(raw).tags;
        let new_tags = if remove_tag {
            strip_tag(&current, tag)
        } else {
            current
        };
        let value = (!new_tags.is_empty())
            .then(|| Value::Seq(new_tags.iter().cloned().map(Value::Str).collect()));
        let content = taskfile::update_frontmatter(&content, &[("tags", value)]);
        ctx.write_text(&join(&target_wl, &format!("tasks/{id}.md")), &content)?;
        let mut entry = raw.clone();
        entry.set(
            "tags",
            (!new_tags.is_empty()).then(|| J::strings(new_tags.clone())),
        );
        target_index.put(id, entry);
        ctx.ports.fs.remove(&source_path);
        let mut si = raw_index(ctx, scope_path)?;
        si.remove(id);
        ctx.save_index_to(scope_path, &si)?;
    }
    ctx.save_index_to(&target_wl, &target_index)?;
    save_scope_config(
        ctx,
        &target_wl,
        &child_config(&relative_path(&abs_target, &root)),
    )?;
    let parent_wl = join(&root, &ctx.wl_dir);
    let mut children = load_scope_config(ctx, &parent_wl)
        .filter(is_parent_config)
        .map(|c| children_of(&c))
        .unwrap_or_default();
    let mut e = child_entry(&relative_path(&root, &abs_target), &scope_id_text);
    e.set("type", Some(J::str("path")));
    children.push(e);
    save_scope_config(ctx, &parent_wl, &parent_config(children))?;
    Ok(ExportOutput {
        exported: matching.len(),
        scope_id: scope_id_text,
        target_path: abs_target,
    })
}

/// `cmdScopesSyncWorktrees`
pub fn sync_worktrees(ctx: &mut Ctx, dry_run: bool) -> Res<SyncOutput> {
    let cwd = ctx.cwd.clone();
    let root = root_or_fail(ctx, NOT_GIT)?;
    let root_wl = join(&root, &ctx.wl_dir);
    if !ctx.ports.fs.exists(&root_wl) {
        return fail(
            Code::NotInitialized,
            "No worklog found at git root. Run 'wl init' first.",
        );
    }
    let cfg = load_or_create_scope_config(ctx, &root_wl, &root);
    if !is_parent_config(&cfg) {
        return fail(
            Code::InvalidState,
            "Root worklog is configured as a child scope. This is invalid.",
        );
    }
    let mut children = children_of(&cfg);
    let worktrees = ctx
        .ports
        .git
        .worktrees(&cwd)
        .or_else(|e| fail(Code::IoError, format!("Failed to list worktrees: {e}")))?;
    let main = worktrees.iter().find(|w| w.is_main);
    let (mut added, mut removed, mut warnings) = (Vec::new(), Vec::new(), Vec::new());
    let is_wt = |c: &J| c.get("type").and_then(J::as_str) == Some("worktree");
    let existing: Vec<J> = children.iter().filter(|c| is_wt(c)).cloned().collect();
    for scope in existing {
        let git_ref = scope.get("gitRef").and_then(J::as_str).map(str::to_string);
        if !worktrees.iter().any(|w| w.branch == git_ref) {
            let sid = entry_id(&scope);
            warnings.push(format!(
                "Worktree for '{}' no longer exists. Tasks and traces in this scope have been lost. Consider running 'wl scopes delete {sid}' before removing worktrees.",
                git_ref.clone().unwrap_or_else(|| "undefined".into()),
            ));
            removed.push(sid);
            if !dry_run && let Some(pos) = children.iter().position(|c| *c == scope) {
                children.remove(pos);
            }
        }
    }
    for w in &worktrees {
        let Some(branch) = &w.branch else { continue };
        if w.is_main {
            continue;
        }
        let registered = children
            .iter()
            .any(|c| is_wt(c) && c.get("gitRef").and_then(J::as_str) == Some(branch.as_str()));
        if registered {
            continue;
        }
        let effective = match main {
            Some(m) if w.path.starts_with(&m.path) => {
                let rest = w.path.get(m.path.len() + 1..).unwrap_or("");
                if rest.is_empty() {
                    ".".to_string()
                } else {
                    rest.to_string()
                }
            }
            _ => w.path.clone(),
        };
        added.push(branch.clone());
        if !dry_run {
            let wl = join(&w.path, &ctx.wl_dir);
            if !ctx.ports.fs.exists(&wl) {
                empty_worklog(ctx, &wl)?;
            }
            save_scope_config(ctx, &wl, &child_config(&relative_path(&w.path, &root)))?;
            let mut e = child_entry(&effective, branch);
            e.set("type", Some(J::str("worktree")));
            e.set("gitRef", Some(J::str(branch.clone())));
            children.push(e);
        }
    }
    if !dry_run && (!added.is_empty() || !removed.is_empty()) {
        save_scope_config(ctx, &root_wl, &parent_config(children))?;
    }
    Ok(SyncOutput {
        added,
        removed,
        warnings,
    })
}
