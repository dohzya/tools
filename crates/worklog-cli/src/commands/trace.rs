//! Traces, checkpoints and `show`.

use crate::ctx::{Ctx, Res, fail};
use crate::resolve::resolve_task_id;
use crate::scope::effective_tags;
use worklog_core::error::Code;
use worklog_core::index::{Index, IndexEntry, format_short};
use worklog_core::output::{
    LinkRef, ParentRef, ShowOutput, StatusOutput, SubtaskSummary, TraceOutput, TracesOutput,
};
use worklog_core::taskfile::{self, TaskFile};
use worklog_core::time::{self, Clock};
use worklog_core::types::{Checkpoint, Entry, TaskStatus, TraceKind};
use worklog_core::yaml::Value;

const CHECKPOINT_THRESHOLD: usize = 50;

fn entries_after_checkpoint(
    entries: &[Entry],
    last: Option<&str>,
    clock: &dyn Clock,
) -> Vec<Entry> {
    let Some(last) = last.filter(|l| !l.is_empty()) else {
        return entries.to_vec();
    };
    let cp = time::parse_stored_date(&format_short(last), clock);
    entries
        .iter()
        .filter(|e| {
            let ts = e.added_at.as_deref().unwrap_or(&e.ts);
            match (time::parse_stored_date(ts, clock), cp) {
                (Some(a), Some(b)) => a > b,
                _ => false,
            }
        })
        .cloned()
        .collect()
}

/// `AddTraceUseCase`
pub fn add_trace(
    ctx: &mut Ctx,
    id: &str,
    message: &str,
    kind: Option<TraceKind>,
    timestamp: Option<&str>,
    force: bool,
) -> Res<TraceOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    let task = ctx.require_task(&id)?;
    let status = task.status();
    if status == Some(TaskStatus::Done) {
        if !force {
            return fail(
                Code::TaskAlreadyDone,
                "Task is done. Use --force to add post-completion traces.",
            );
        }
        ctx.eprintln(&format!(
            "Warning: Task is done. Trace recorded. Run 'wl checkpoint {} \"<changes>\" \"<learnings>\"' to consolidate post-completion traces.",
            task.id()
        ));
    } else if status == Some(TaskStatus::Cancelled) && !force {
        return fail(
            Code::TaskAlreadyDone,
            format!(
                "Task is cancelled. Reopen it with 'wl start {}', or use --force to add traces.",
                task.id()
            ),
        );
    } else if status != Some(TaskStatus::Started) {
        ctx.eprintln(&format!(
            "Warning: Task is not started. Trace recorded. Run 'wl start {id}' to start working."
        ));
    }
    let now_short = match timestamp.filter(|t| !t.is_empty()) {
        Some(t) => {
            if time::parse_instant(t, ctx.ports.clock.as_ref()).is_none() {
                return fail(
                    Code::InvalidArgs,
                    format!(
                        "Invalid timestamp format: {t}. Use ISO format (YYYY-MM-DDTHH:MM:SS+TZ) or short format (YYYY-MM-DD HH:MM)"
                    ),
                );
            }
            format_short(t)
        }
        None => ctx.now_short(),
    };
    let wallclock = ctx.now_short();
    let entry = Entry {
        id: None,
        ts: now_short.clone(),
        msg: message.to_string(),
        kind,
        added_at: (now_short != wallclock).then_some(wallclock),
    };
    let content = ctx.load_task_content(&id)?;
    let content = taskfile::append_entry(&content, &entry).map_err(crate::ctx::Fail::Wt)?;
    let content = taskfile::update_frontmatter(
        &content,
        &[("has_uncheckpointed_entries", Some(Value::Bool(true)))],
    );
    ctx.save_task_content(&id, &content)?;
    let parsed = taskfile::parse_task_file(&content).map_err(crate::ctx::Fail::Wt)?;
    let since = entries_after_checkpoint(
        &parsed.entries,
        task.last_checkpoint().as_deref(),
        ctx.ports.clock.as_ref(),
    );
    if since.len() >= CHECKPOINT_THRESHOLD {
        return Ok(TraceOutput {
            status: "checkpoint_recommended".into(),
            entries_since_checkpoint: Some(since.len()),
        });
    }
    Ok(TraceOutput {
        status: "ok".into(),
        entries_since_checkpoint: None,
    })
}

/// `ListTracesUseCase`
pub fn list_traces(
    ctx: &mut Ctx,
    id: &str,
    kinds: &[TraceKind],
    excluded: &[TraceKind],
) -> Res<TracesOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    let task = ctx.require_task(&id)?;
    let mut entries: Vec<Entry> = task
        .entries
        .iter()
        .filter(|e| kinds.is_empty() || e.kind.is_some_and(|k| kinds.contains(&k)))
        .filter(|e| e.kind.is_none_or(|k| !excluded.contains(&k)))
        .cloned()
        .collect();
    entries.sort_by(|a, b| a.ts.cmp(&b.ts));
    let desc = task.desc();
    Ok(TracesOutput {
        task: id,
        desc: desc.join("\n\n---\n\n"),
        desc_parts: desc,
        entries,
    })
}

/// `UpdateTraceUseCase`, editing only the heading of the trace.
pub fn update_trace(
    ctx: &mut Ctx,
    id: &str,
    trace_id: &str,
    kind: Option<TraceKind>,
) -> Res<StatusOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    ctx.require_task(&id)?;
    let Some(kind) = kind else {
        return fail(Code::InvalidArgs, "Nothing to update. Provide --kind.");
    };
    let content = ctx.load_task_content(&id)?;
    match taskfile::set_entry_kind(&content, trace_id, kind) {
        Some(new) => ctx.save_task_content(&id, &new)?,
        None => return fail(Code::TraceNotFound, format!("Trace not found: {trace_id}")),
    }
    Ok(StatusOutput::new("trace updated"))
}

/// `CreateCheckpointUseCase`
pub fn create_checkpoint(
    ctx: &mut Ctx,
    id: &str,
    changes: &str,
    learnings: &str,
    force: bool,
) -> Res<StatusOutput> {
    let task = ctx.require_task(id)?;
    if !force {
        let mut needs = task.has_uncheckpointed_entries();
        if !needs && let Some(last) = task.entries.last() {
            let last_ts = last.added_at.as_deref().unwrap_or(&last.ts);
            needs = match task.last_checkpoint() {
                Some(cp) => {
                    let clock = ctx.ports.clock.as_ref();
                    match (
                        time::parse_stored_date(last_ts, clock),
                        time::parse_stored_date(&cp, clock),
                    ) {
                        (Some(a), Some(b)) => a > b,
                        _ => false,
                    }
                }
                None => true,
            };
        }
        if !needs {
            return fail(
                Code::NoUncheckpointedEntries,
                "No uncheckpointed entries. Use --force to create checkpoint anyway",
            );
        }
    }
    let now = ctx.now_iso();
    let short_ts = now
        .chars()
        .take(16)
        .collect::<String>()
        .replacen('T', " ", 1);
    let content = ctx.load_task_content(id)?;
    let content = taskfile::append_checkpoint(
        &content,
        &Checkpoint {
            ts: short_ts,
            changes: changes.to_string(),
            learnings: learnings.to_string(),
        },
    )
    .map_err(crate::ctx::Fail::Wt)?;
    let content = taskfile::update_frontmatter(
        &content,
        &[
            ("last_checkpoint", Some(Value::str(now))),
            ("has_uncheckpointed_entries", Some(Value::Bool(false))),
        ],
    );
    ctx.save_task_content(id, &content)?;
    Ok(StatusOutput::new("checkpoint_created"))
}

/// `wl checkpoint` (manual), after resolution.
pub fn checkpoint(
    ctx: &mut Ctx,
    id: &str,
    changes: &str,
    learnings: &str,
    force: bool,
) -> Res<StatusOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    create_checkpoint(ctx, &id, changes, learnings, force)
}

fn summary_entry(index: &Index, id: &str) -> Option<IndexEntry> {
    index.entry(id)
}

/// `ShowTaskUseCase` as used by the agent launchers: no purge, no git.
pub fn show_task_no_purge(ctx: &mut Ctx, id: &str) -> Res<ShowOutput> {
    show_resolved(ctx, id, false, None)
}

/// `cmdShow`
pub fn show_task(
    ctx: &mut Ctx,
    id: &str,
    active_only: bool,
    git_root: Option<&str>,
) -> Res<ShowOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    show_resolved(ctx, &id, active_only, git_root)
}

fn show_resolved(
    ctx: &mut Ctx,
    id: &str,
    active_only: bool,
    git_root: Option<&str>,
) -> Res<ShowOutput> {
    let id = id.to_string();
    let index = ctx.load_index()?;
    let task = ctx.require_task(&id)?;
    let last_checkpoint = task.checkpoints.last().cloned();
    let mut entries = entries_after_checkpoint(
        &task.entries,
        task.last_checkpoint().as_deref(),
        ctx.ports.clock.as_ref(),
    );
    entries.sort_by(|a, b| a.ts.cmp(&b.ts));
    let todos = if active_only {
        task.todos
            .iter()
            .filter(|t| !t.status.is_closed())
            .cloned()
            .collect()
    } else {
        task.todos.clone()
    };
    let wl = ctx.wl_path();
    let tags = effective_tags(ctx, &task.tags(), &wl, git_root, false);
    let parent = task.parent().and_then(|p| {
        let e = summary_entry(&index, &p)?;
        Some(ParentRef {
            short_id: index.short_id(&p),
            name: e.name.unwrap_or_default(),
            status: e.status.unwrap_or(TaskStatus::Created),
            id: p,
        })
    });
    let links: Vec<LinkRef> = task
        .links()
        .into_iter()
        .filter_map(|l| {
            let e = summary_entry(&index, &l.task)?;
            Some(LinkRef {
                kind: l.kind,
                short_id: index.short_id(&l.task),
                name: e.name.unwrap_or_default(),
                status: e.status.unwrap_or(TaskStatus::Created),
                task: l.task,
            })
        })
        .collect();
    let children: Vec<(String, IndexEntry)> = index
        .entries()
        .into_iter()
        .filter(|(_, e)| e.parent.as_deref() == Some(id.as_str()))
        .collect();
    let subtasks = if children.is_empty() {
        None
    } else {
        Some(build_subtasks(
            ctx,
            &children,
            task.last_checkpoint().as_deref(),
            &index,
            0,
        )?)
    };
    let desc = task.desc();
    Ok(ShowOutput {
        task: index.short_id(&id),
        full_id: id.clone(),
        name: task.name(),
        desc: desc.join("\n\n---\n\n"),
        desc_parts: desc,
        status: task.timestamp("status").unwrap_or_default(),
        created: format_short(&task.created_at()),
        ready: task.timestamp("ready_at").map(|t| format_short(&t)),
        started: task.timestamp("started_at").map(|t| format_short(&t)),
        last_checkpoint,
        entries_since_checkpoint: entries,
        todos,
        tags: if tags.is_empty() { None } else { Some(tags) },
        parent,
        links: if links.is_empty() { None } else { Some(links) },
        subtasks,
    })
}

const MAX_SUBTASK_DEPTH: usize = 3;

fn build_subtasks(
    ctx: &mut Ctx,
    children: &[(String, IndexEntry)],
    parent_last_checkpoint: Option<&str>,
    index: &Index,
    depth: usize,
) -> Res<Vec<SubtaskSummary>> {
    if depth >= MAX_SUBTASK_DEPTH {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for (child_id, entry) in children {
        let is_done = entry.status.is_some_and(TaskStatus::is_closed);
        let terminated_at = entry.done_at.clone().or_else(|| entry.cancelled_at.clone());
        if is_done && let (Some(t), Some(cp)) = (terminated_at.as_deref(), parent_last_checkpoint) {
            let clock = ctx.ports.clock.as_ref();
            if let (Some(a), Some(b)) = (
                time::parse_instant(t, clock),
                time::parse_instant(cp, clock),
            ) && a <= b
            {
                continue;
            }
        }
        let Some(child): Option<TaskFile> = ctx.find_task(child_id)? else {
            continue;
        };
        let last_cp = child.checkpoints.last().cloned();
        let short = index.short_id(child_id);
        let status = child.status().unwrap_or(TaskStatus::Created);
        if is_done {
            result.push(SubtaskSummary {
                id: child_id.clone(),
                short_id: short,
                name: child.name(),
                status,
                done_at: Some(child.timestamp("done_at")),
                cancelled_at: Some(child.timestamp("cancelled_at")),
                last_checkpoint: Some(last_cp),
                active_todos: None,
                subtasks: None,
            });
        } else {
            let active: Vec<_> = child
                .todos
                .iter()
                .filter(|t| !t.status.is_closed())
                .cloned()
                .collect();
            let grandchildren: Vec<(String, IndexEntry)> = index
                .entries()
                .into_iter()
                .filter(|(_, e)| e.parent.as_deref() == Some(child_id.as_str()))
                .collect();
            let nested = if grandchildren.is_empty() {
                None
            } else {
                Some(build_subtasks(
                    ctx,
                    &grandchildren,
                    child.last_checkpoint().as_deref(),
                    index,
                    depth + 1,
                )?)
            };
            result.push(SubtaskSummary {
                id: child_id.clone(),
                short_id: short,
                name: child.name(),
                status,
                done_at: None,
                cancelled_at: None,
                last_checkpoint: None,
                active_todos: if active.is_empty() {
                    None
                } else {
                    Some(active)
                },
                subtasks: nested.filter(|n| !n.is_empty()),
            });
        }
    }
    Ok(result)
}
