//! `wl import`: bring tasks of another worklog into this one.

use crate::ctx::{Ctx, Res, fail};
use crate::path::{join, resolve};
use crate::scope::{children_of, entry_id, entry_path, load_scope_config};
use worklog_core::error::Code;
use worklog_core::index::{Index, validate_tag};
use worklog_core::json::J;
use worklog_core::output::{ImportOutput, ImportTaskResult};
use worklog_core::taskfile::{self, TaskFile};
use worklog_core::time;
use worklog_core::types::{Checkpoint, Entry};
use worklog_core::yaml::Value;

fn increment_letter(s: &str) -> String {
    if s == "z" {
        return "aa".into();
    }
    let mut chars: Vec<char> = s.chars().collect();
    if chars.len() == 1 {
        return char::from_u32(chars[0] as u32 + 1)
            .map(String::from)
            .unwrap_or_default();
    }
    let mut i = chars.len() as isize - 1;
    while i >= 0 {
        let idx = i as usize;
        if chars[idx] == 'z' {
            chars[idx] = 'a';
            i -= 1;
        } else {
            chars[idx] = char::from_u32(chars[idx] as u32 + 1).unwrap_or('a');
            break;
        }
    }
    if i < 0 {
        chars.insert(0, 'a');
    }
    chars.into_iter().collect()
}

/// `ImportTasksUseCase`
pub fn import_tasks(ctx: &mut Ctx, source_arg: &str, remove_source: bool) -> Res<ImportOutput> {
    let source = resolve(&ctx.cwd, source_arg);
    // Both worklogs are rewritten (the source too with `--rm`, and for the
    // uid it gets when it has none).
    let current = ctx.wl_path();
    ctx.lock_worklogs(vec![current, source.clone()])?;
    let source_index_path = join(&source, "index.json");
    if !ctx.ports.fs.exists(&source_index_path) {
        return fail(
            Code::ImportSourceNotFound,
            format!("Source worklog not found: {source_arg}"),
        );
    }
    let text = ctx.read_text(&source_index_path)?;
    let mut source_index = Index::parse(&text, false).or_else(|_| {
        fail(
            Code::IoError,
            format!("Failed to read file: {source_index_path}"),
        )
    })?;
    let mut dest_index = ctx.load_index()?;
    let mut results: Vec<ImportTaskResult> = Vec::new();
    let (mut imported, mut merged, mut skipped) = (0, 0, 0);
    let mut to_remove: Vec<String> = Vec::new();
    for (source_id, info) in source_index.entries() {
        let _ = info;
        let source_task_path = join(&source, &format!("tasks/{source_id}.md"));
        let mut source_content = ctx.read_text(&source_task_path)?;
        let source_parsed: TaskFile = taskfile::parse_task_file(&source_content)?;
        let mut source_uid = source_parsed.uid();
        if source_uid.is_none() {
            let uid = ctx.ports.env.uuid();
            source_content = taskfile::update_frontmatter(
                &source_content,
                &[("uid", Some(Value::str(uid.clone())))],
            );
            ctx.write_text(&source_task_path, &source_content)?;
            source_uid = Some(uid);
        }
        let mut existing: Option<String> = None;
        for id in dest_index.ids() {
            let Some(dest) = ctx.find_task(&id)? else {
                continue;
            };
            let mut uid = dest.uid();
            if uid.is_none() {
                let u = ctx.ports.env.uuid();
                let c = ctx.load_task_content(&id)?;
                let c = taskfile::update_frontmatter(&c, &[("uid", Some(Value::str(u.clone())))]);
                ctx.save_task_content(&id, &c)?;
                uid = Some(u);
            }
            if uid == source_uid {
                existing = Some(id);
                break;
            }
        }
        if let Some(eid) = existing {
            let Some(dest) = ctx.find_task(&eid)? else {
                continue;
            };
            let mut warnings: Vec<String> = Vec::new();
            let clock = ctx.ports.clock.clone();
            let dest_ts: Vec<&str> = dest.entries.iter().map(|e| e.ts.as_str()).collect();
            let mut to_add: Vec<Entry> = Vec::new();
            for entry in &source_parsed.entries {
                if dest_ts.contains(&entry.ts.as_str()) {
                    continue;
                }
                if let Some(lc) = dest.last_checkpoint() {
                    let a = time::parse_stored_date(&entry.ts, clock.as_ref());
                    let b = time::parse_stored_date(&lc, clock.as_ref());
                    if let (Some(a), Some(b)) = (a, b)
                        && a < b
                    {
                        warnings.push(format!(
                            "Entry at {} is older than last checkpoint, skipped",
                            entry.ts
                        ));
                        continue;
                    }
                }
                to_add.push(entry.clone());
            }
            let dest_cps: Vec<&str> = dest.checkpoints.iter().map(|c| c.ts.as_str()).collect();
            let cps_to_add: Vec<Checkpoint> = source_parsed
                .checkpoints
                .iter()
                .filter(|c| !dest_cps.contains(&c.ts.as_str()))
                .cloned()
                .collect();
            if !to_add.is_empty() || !cps_to_add.is_empty() {
                let mut content = ctx.load_task_content(&eid)?;
                for e in &to_add {
                    content = taskfile::append_entry(&content, e).map_err(crate::ctx::Fail::Wt)?;
                }
                if !to_add.is_empty() {
                    content = taskfile::update_frontmatter(
                        &content,
                        &[("has_uncheckpointed_entries", Some(Value::Bool(true)))],
                    );
                }
                for c in &cps_to_add {
                    content =
                        taskfile::append_checkpoint(&content, c).map_err(crate::ctx::Fail::Wt)?;
                }
                if !cps_to_add.is_empty() {
                    let mut all: Vec<&Checkpoint> = dest.checkpoints.iter().collect();
                    all.extend(cps_to_add.iter());
                    // Newest first; stable, as the JS sort.
                    all.sort_by(|a, b| {
                        let (x, y) = (
                            time::parse_stored_date(&b.ts, clock.as_ref()),
                            time::parse_stored_date(&a.ts, clock.as_ref()),
                        );
                        x.cmp(&y)
                    });
                    if let Some(ms) = all
                        .first()
                        .and_then(|c| time::parse_stored_date(&c.ts, clock.as_ref()))
                    {
                        content = taskfile::update_frontmatter(
                            &content,
                            &[("last_checkpoint", Some(Value::str(time::to_iso_string(ms))))],
                        );
                    }
                }
                ctx.save_task_content(&eid, &content)?;
                results.push(ImportTaskResult {
                    id: eid,
                    status: "merged".into(),
                    warnings: (!warnings.is_empty()).then(|| warnings.clone()),
                });
                merged += 1;
                if warnings.is_empty() {
                    to_remove.push(source_id.clone());
                }
            } else {
                results.push(ImportTaskResult {
                    id: eid,
                    status: "skipped".into(),
                    warnings: Some(vec!["No new entries or checkpoints to merge".into()]),
                });
                skipped += 1;
                to_remove.push(source_id.clone());
            }
        } else {
            let mut target_id = source_id.clone();
            if dest_index.contains(&source_id) {
                let prefix: String = source_id.chars().take(6).collect();
                let mut existing_suffixes: Vec<String> = dest_index
                    .ids()
                    .into_iter()
                    .filter(|id| id.starts_with(&prefix))
                    .map(|id| id.chars().skip(6).collect())
                    .collect();
                existing_suffixes.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                let last = existing_suffixes.last().cloned().unwrap_or_default();
                target_id = format!("{prefix}{}", increment_letter(&last));
            }
            let content = if target_id != source_id {
                taskfile::update_frontmatter(
                    &source_content,
                    &[("id", Some(Value::str(target_id.clone())))],
                )
            } else {
                source_content.clone()
            };
            ctx.save_task_content(&target_id, &content)?;
            // The whole source entry: tags, links, parent and timestamps too.
            let entry = source_index.raw(&source_id).cloned().unwrap_or_else(J::obj);
            dest_index = ctx.load_index()?;
            dest_index.put(&target_id, entry);
            ctx.save_index(&dest_index)?;
            results.push(ImportTaskResult {
                id: target_id.clone(),
                status: "imported".into(),
                warnings: (target_id != source_id)
                    .then(|| vec![format!("Renamed from {source_id} to {target_id}")]),
            });
            imported += 1;
            to_remove.push(source_id.clone());
        }
    }
    if remove_source && !to_remove.is_empty() {
        for id in &to_remove {
            ctx.ports
                .fs
                .remove(&join(&source, &format!("tasks/{id}.md")));
            source_index.remove(id);
        }
        ctx.write_raw(&source_index_path, &source_index.to_text())?;
        if source_index.ids().is_empty() {
            ctx.ports.fs.remove(&source);
        }
    }
    Ok(ImportOutput {
        imported,
        merged,
        skipped,
        tasks: results,
        tag: None,
    })
}

/// `ImportScopeToTagUseCase`
pub fn import_scope_to_tag(
    ctx: &mut Ctx,
    source: &str,
    remove_source: bool,
    custom_tag: Option<&str>,
    git_root: Option<&str>,
) -> Res<ImportOutput> {
    if let Some(t) = custom_tag.filter(|t| !t.is_empty())
        && let Some(e) = validate_tag(t)
    {
        return fail(Code::InvalidArgs, format!("Invalid tag '{t}': {e}"));
    }
    // The TS code takes the directory of the path as given (possibly relative).
    let mut parts: Vec<&str> = source.split('/').collect();
    parts.pop();
    let source_dir = parts.join("/");
    let scope_id = match git_root {
        Some(root) => {
            if !source_dir.starts_with(root) {
                source_dir
                    .rsplit('/')
                    .next()
                    .unwrap_or(&source_dir)
                    .to_string()
            } else {
                let rel = source_dir.get(root.len() + 1..).unwrap_or("");
                if rel.is_empty() || rel == "." {
                    "(root)".to_string()
                } else {
                    let cfg = load_scope_config(ctx, &join(root, &ctx.wl_dir));
                    cfg.and_then(|c| {
                        children_of(&c)
                            .into_iter()
                            .find(|ch| entry_path(ch) == rel)
                            .map(|ch| entry_id(&ch))
                    })
                    .unwrap_or_else(|| rel.to_string())
                }
            }
        }
        None => source_dir
            .rsplit('/')
            .next()
            .unwrap_or(&source_dir)
            .to_string(),
    };
    let tag = custom_tag
        .filter(|t| !t.is_empty())
        .unwrap_or(&scope_id)
        .to_string();
    if let Some(e) = validate_tag(&tag) {
        return fail(Code::InvalidArgs, format!("Invalid tag '{tag}': {e}"));
    }
    let mut result = import_tasks(ctx, source, remove_source)?;
    for r in result.tasks.clone() {
        if r.status != "imported" {
            continue;
        }
        let content = ctx.load_task_content(&r.id)?;
        let parsed = taskfile::parse_task_file(&content).map_err(crate::ctx::Fail::Wt)?;
        let mut tags = parsed.tags();
        if !tags.contains(&tag) {
            tags.push(tag.clone());
        }
        tags.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let content = taskfile::update_frontmatter(
            &content,
            &[(
                "tags",
                Some(Value::Seq(tags.iter().cloned().map(Value::Str).collect())),
            )],
        );
        ctx.save_task_content(&r.id, &content)?;
        let mut index = ctx.load_index()?;
        index.update(&r.id, vec![("tags", Some(J::strings(tags)))]);
        ctx.save_index(&index)?;
    }
    result.tag = Some(tag);
    Ok(result)
}

/// `resolveWorktreePath`: `.worklog` of the worktree holding `branch`.
pub fn resolve_worktree_path(ctx: &Ctx, branch: &str) -> Res<String> {
    let list = ctx
        .ports
        .git
        .worktrees(&ctx.cwd)
        .or_else(|e| fail(Code::IoError, format!("Failed to list worktrees: {e}")))?;
    match list.iter().find(|w| w.branch.as_deref() == Some(branch)) {
        Some(w) => Ok(format!("{}/.worklog", w.path)),
        None => fail(
            Code::WorktreeNotFound,
            format!("No worktree found for branch: {branch}"),
        ),
    }
}
