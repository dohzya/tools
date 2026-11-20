//! Task id resolution: prefixes, `scope:prefix`, the `WORKLOG_TASK_ID`
//! fallback and the search across scopes.

use crate::ctx::{Ctx, Res, fail};
use crate::path::{is_absolute, join, resolve};
use crate::scope::{
    children_of, discover_scopes, entry_id, entry_path, is_child_worklog, is_parent_config,
    load_scope_config, parent_scope_dir, resolve_scope_identifier,
};
use worklog_core::error::Code;
use worklog_core::index::{prefix_matches, short_id};

/// Resolves a prefix in the current worklog.
pub fn resolve_task_id(ctx: &mut Ctx, prefix: &str) -> Res<String> {
    let index = ctx.load_index()?;
    let all = index.ids();
    let matches = prefix_matches(prefix, &all);
    if matches.is_empty() {
        return fail(
            Code::TaskNotFound,
            format!("No task found matching prefix: {prefix}"),
        );
    }
    if matches.len() > 1 {
        let mut lines = vec![format!(
            "Ambiguous task ID prefix '{prefix}' matches {} tasks:",
            matches.len()
        )];
        for id in matches.iter().take(10) {
            let desc = index
                .entry(id)
                .map(|e| e.desc.join(","))
                .unwrap_or_default();
            lines.push(format!("  {}  \"{desc}\"", short_id(id, &all)));
        }
        if matches.len() > 10 {
            lines.push(format!("  ... and {} more", matches.len() - 10));
        }
        return fail(Code::InvalidArgs, lines.join("\n"));
    }
    Ok(matches[0].clone())
}

/// `taskId`, else `WORKLOG_TASK_ID`.
pub fn required_id(ctx: &Ctx, task_id: Option<&str>) -> Res<String> {
    match task_id
        .map(str::to_string)
        .or_else(|| ctx.env_task_id.clone())
    {
        Some(id) => Ok(id),
        None => fail(
            Code::InvalidArgs,
            "taskId argument is required (or set WORKLOG_TASK_ID environment variable)",
        ),
    }
}

/// Local resolution with the environment fallback.
pub fn resolve_with_env(ctx: &mut Ctx, task_id: Option<&str>) -> Res<String> {
    let id = required_id(ctx, task_id)?;
    resolve_task_id(ctx, &id)
}

fn split_scoped(input: &str) -> (Option<&str>, &str) {
    match input.find(':') {
        Some(i) if i > 0 => (Some(&input[..i]), &input[i + 1..]),
        _ => (None, input),
    }
}

/// Resolves across scopes: `scope:prefix`, then the current scope, then every
/// other scope of the repository. A match in another scope moves the context
/// into that scope.
pub fn resolve_across_scopes(ctx: &mut Ctx, input: &str, git_root: Option<&str>) -> Res<String> {
    let (hint, prefix) = split_scoped(input);
    if let Some(hint) = hint {
        let Some(root) = git_root else {
            return fail(
                Code::InvalidArgs,
                "Scope-qualified task IDs require a git repository",
            );
        };
        let cwd = ctx.cwd.clone();
        let scope_path = if hint == "⬆" || hint == "^" {
            let current = join(&cwd, &ctx.wl_dir);
            if !is_child_worklog(ctx, &current) {
                return fail(Code::ScopeNotFound, "Current scope has no parent");
            }
            match parent_scope_dir(ctx, &current) {
                Some(p) => p,
                None => return fail(Code::ScopeNotFound, "Current scope has no parent"),
            }
        } else {
            let wl = resolve_scope_identifier(ctx, hint, root, &cwd)?;
            wl[..wl.len() - ctx.wl_dir.len() - 1].to_string()
        };
        ctx.cwd = scope_path;
        return resolve_task_id(ctx, prefix);
    }

    match resolve_task_id(ctx, input) {
        Ok(id) => return Ok(id),
        Err(crate::ctx::Fail::Wt(e)) if e.code == Code::TaskNotFound => {}
        Err(other) => return Err(other),
    }
    let Some(root) = git_root else {
        return fail(
            Code::TaskNotFound,
            format!("No task found matching prefix: {input}"),
        );
    };
    let current_wl = join(&ctx.cwd, &ctx.wl_dir);
    let mut to_search: Vec<(String, String)> = Vec::new();
    for s in discover_scopes(ctx, root, ctx.depth_limit, false) {
        if s.absolute_path != current_wl {
            to_search.push((s.absolute_path.clone(), s.id.clone()));
        }
    }
    if let Some(cfg) = load_scope_config(ctx, &current_wl)
        && is_parent_config(&cfg)
    {
        for child in children_of(&cfg) {
            let path = entry_path(&child);
            let wl = if is_absolute(&path) {
                format!("{path}/{}", ctx.wl_dir)
            } else {
                resolve(root, &format!("{path}/{}", ctx.wl_dir))
            };
            if !to_search.iter().any(|(p, _)| *p == wl) {
                to_search.push((wl, entry_id(&child)));
            }
        }
    }
    if is_child_worklog(ctx, &current_wl)
        && let Some(parent) = parent_scope_dir(ctx, &current_wl)
        && !to_search.iter().any(|(p, _)| *p == parent)
    {
        to_search.push((parent, "^".into()));
    }
    let mut matches: Vec<(String, String, String)> = Vec::new();
    for (wl, id) in &to_search {
        let Ok(index) = ctx.load_index_from(wl) else {
            continue;
        };
        for task in prefix_matches(input, &index.ids()) {
            matches.push((wl.clone(), id.clone(), task));
        }
    }
    match matches.len() {
        0 => fail(
            Code::TaskNotFound,
            format!("No task found matching prefix: {input} (searched all scopes)"),
        ),
        1 => {
            let (wl, _, task) = matches.remove(0);
            ctx.cwd = wl[..wl.len() - ctx.wl_dir.len() - 1].to_string();
            Ok(task)
        }
        n => {
            let all: Vec<String> = matches.iter().map(|m| m.2.clone()).collect();
            let mut lines = vec![format!(
                "Ambiguous task ID prefix '{input}' matches {n} tasks across scopes:"
            )];
            for m in matches.iter().take(10) {
                lines.push(format!("  {}:{}", m.1, short_id(&m.2, &all)));
            }
            if n > 10 {
                lines.push(format!("  ... and {} more", n - 10));
            }
            fail(Code::InvalidArgs, lines.join("\n"))
        }
    }
}

/// Environment fallback plus cross-scope resolution.
pub fn resolve_env_across(
    ctx: &mut Ctx,
    task_id: Option<&str>,
    git_root: Option<&str>,
) -> Res<String> {
    let id = required_id(ctx, task_id)?;
    resolve_across_scopes(ctx, &id, git_root)
}
