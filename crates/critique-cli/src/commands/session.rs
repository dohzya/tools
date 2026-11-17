//! `session` / `agent`: snapshot lifecycle and actions on items by id.

use crate::args::{CliError, Result, err};
use crate::commands::list::{Located, collect_located, display_id, slash};
use crate::commands::now::encode_local;
use crate::config;
use crate::ctx::Ctx;
use crate::files;
use crate::format::{self, Style};
use crate::subargs::{self, Parsed, Spec};
use critique_core::actions;
use critique_core::agent::{
    self, ActionResult, AgentItem, CleanResult, FileSnapshot, Guardrail, Handoff, RollbackResult,
    SessionSnapshot, SessionStatus,
};
use critique_core::ids::{self, PREFIX};
use critique_core::review::{self, Filter};
use critique_core::scan::{self, Kind, Status as ConvStatus};
use critique_core::sha1::sha1_hex;
use critique_core::timestamp::Format;
use serde::Serialize;

const JSON: &[&str] = &["--json"];
const START: Spec = Spec {
    flags: &["--dry-run", "-f,--force", "--json"],
    values: &[],
};
const JSON_ONLY: Spec = Spec {
    flags: JSON,
    values: &[],
};
const DONE: Spec = Spec {
    flags: JSON,
    values: &["--acknowledge"],
};
const LIST: Spec = Spec {
    flags: JSON,
    values: &["--limit"],
};
const SHOW: Spec = Spec {
    flags: JSON,
    values: &["-c,--context"],
};
const RESPOND: Spec = Spec {
    flags: JSON,
    values: &["-m,--message"],
};
const APPLY: Spec = Spec {
    flags: &["--json", "--remove"],
    values: &["--replace", "-m,--message"],
};
const CLEAN: Spec = Spec {
    flags: &["--validated", "--dry-run", "--json"],
    values: &[],
};
const ACTIVE: Spec = Spec {
    flags: &[],
    values: &["--template"],
};

fn json_text<T: Serialize>(value: &T) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_default();
    text.push('\n');
    text
}

struct AgentState {
    files: Vec<FileSnapshot>,
    items: Vec<AgentItem>,
    texts: Vec<(String, String)>,
}

fn text_of<'a>(state: &'a AgentState, path: &str) -> Option<&'a str> {
    state
        .texts
        .iter()
        .find(|(p, _)| p == path)
        .map(|(_, t)| t.as_str())
}

fn collect_state(ctx: &Ctx<'_>, file_list: &[String], include_empty: bool) -> Result<AgentState> {
    let mut state = AgentState {
        files: Vec::new(),
        items: Vec::new(),
        texts: Vec::new(),
    };
    for file in file_list {
        let path = slash(file);
        if !ctx.host.exists(file) {
            if include_empty {
                state.files.push(FileSnapshot {
                    path,
                    timestamp_format: "none".into(),
                    content_hash: String::new(),
                    item_ids: Vec::new(),
                    original_content: None,
                });
            }
            continue;
        }
        let text = ctx.read_file(file)?;
        let collected = review::collect_review_items(&text, false, Filter::All);
        let ids = ctx.assign_ids(&path, &text, &collected)?;
        let items: Vec<AgentItem> = collected
            .iter()
            .zip(&ids)
            .map(|(item, id)| agent::to_agent_item(&path, id, item, &format::SUMMARY))
            .collect();
        if items.is_empty() && !include_empty {
            continue;
        }
        state.files.push(FileSnapshot {
            path: path.clone(),
            timestamp_format: agent::detect_timestamp_format(scan::timestamp_format_stats(&text))
                .into(),
            content_hash: sha1_hex(&text),
            item_ids: items.iter().map(|i| i.id.clone()).collect(),
            original_content: None,
        });
        state.items.extend(items);
        state.texts.push((path, text));
    }
    Ok(state)
}

fn resolve_agent_files(ctx: &Ctx<'_>, given: &[String]) -> Result<Vec<String>> {
    if !given.is_empty() {
        let defaults: Vec<_> = config::default_ignore_patterns(ctx.host, &ctx.settings)
            .iter()
            .filter_map(|p| crate::ignore::compile(p))
            .collect();
        return Ok(files::filter_ignored(ctx, given.to_vec(), &defaults));
    }
    let rules = files::read_rules(ctx);
    if !files::inside_work_tree(ctx) {
        return err(format!(
            "{} agent requires files unless it runs inside a Git worktree.",
            ctx.program()
        ));
    }
    let diff = files::worktree_diff(ctx, &[])?;
    let mut resolved: Vec<String> = review::added_lines_by_file(&diff)
        .into_iter()
        .map(|(f, _)| f)
        .collect();
    for f in crate::ignore::files_included_by_rules(ctx.host, &rules) {
        if !resolved.contains(&f) {
            resolved.push(f);
        }
    }
    Ok(files::filter_ignored(ctx, resolved, &rules))
}

fn target_files(
    ctx: &Ctx<'_>,
    snapshot: &SessionSnapshot,
    given: &[String],
) -> Result<Vec<String>> {
    if given.is_empty() {
        Ok(snapshot.files.iter().map(|f| f.path.clone()).collect())
    } else {
        resolve_agent_files(ctx, given)
    }
}

/// ISO value for "now" in the local offset, as `encodeTimestamp(new Date(), "iso")`.
fn now_iso(ctx: &Ctx<'_>) -> Result<String> {
    encode_local(
        ctx,
        i64::try_from(ctx.host.now().unix_seconds).unwrap_or(0),
        Format::Iso,
    )
}

fn started_at(ctx: &Ctx<'_>) -> String {
    let now = ctx.host.now();
    let utc =
        critique_core::timestamp::format_for_display(critique_core::timestamp::ReviewTimestamp {
            unix_seconds: now.unix_seconds,
            offset_minutes: 0,
        });
    format!("{}.{:03}Z", utc.trim_end_matches("+00:00"), now.millis)
}

fn write_snapshot(ctx: &Ctx<'_>, snapshot: &SessionSnapshot) -> Result<()> {
    let dir = config::state_dirs(ctx.host, &ctx.settings).write;
    ctx.host.create_dir_all(&crate::paths::slashes(&dir))?;
    ctx.host
        .write(&ctx.session_write_path(), &json_text(snapshot))?;
    Ok(())
}

/// Stamps the files of a new snapshot and returns the snapshot of their state.
fn stamp_and_snapshot(ctx: &Ctx<'_>, resolved: &[String]) -> Result<SessionSnapshot> {
    let original = collect_state(ctx, resolved, false)?;
    let formats: Vec<(String, String)> = original
        .files
        .iter()
        .map(|f| (f.path.clone(), f.timestamp_format.clone()))
        .collect();
    for file in &original.files {
        let Some(text) = text_of(&original, &file.path) else {
            continue;
        };
        let fallback = mtime_or_now(ctx, &file.path);
        let (_, updated) = transform(ctx, text, fallback, Format::Iso)?;
        if updated != text {
            ctx.host.write(&file.path, &updated)?;
        }
    }
    let paths: Vec<String> = original.files.iter().map(|f| f.path.clone()).collect();
    let state = collect_state(ctx, &paths, false)?;
    let files = state
        .files
        .into_iter()
        .map(|mut f| {
            f.timestamp_format = formats
                .iter()
                .find(|(p, _)| *p == f.path)
                .map_or("none".into(), |(_, t)| t.clone());
            f.original_content = text_of(&original, &f.path).map(str::to_string);
            f
        })
        .collect();
    Ok(SessionSnapshot {
        version: 1,
        started_at: started_at(ctx),
        cwd: crate::paths::slashes(&ctx.host.cwd()),
        files,
        items: state.items,
        dismissed_item_ids: None,
    })
}

fn mtime_or_now(ctx: &Ctx<'_>, file: &str) -> i64 {
    let secs = ctx
        .host
        .mtime_seconds(file)
        .unwrap_or_else(|| ctx.host.now().unix_seconds);
    i64::try_from(secs).unwrap_or(0)
}

fn transform(
    ctx: &Ctx<'_>,
    text: &str,
    fallback_secs: i64,
    format: Format,
) -> Result<(usize, String)> {
    let fallback = encode_local(ctx, fallback_secs, format)?;
    scan::transform_timestamps(text, &fallback, format).map_err(CliError)
}

fn last_message_line(item: &AgentItem) -> String {
    match &item.last_message {
        None => "-".into(),
        Some(m) => format!("{} {}", m.author, ids::collapse_whitespace(&m.body)),
    }
}

fn inbox(ctx: &Ctx<'_>, items: &[AgentItem], dry_run: bool, path: &str) -> String {
    let _ = ctx;
    let mut lines = vec![
        "Agent inbox".to_string(),
        format!(
            "Snapshot: {path}{}",
            if dry_run { " (not written)" } else { "" }
        ),
        String::new(),
    ];
    if items.is_empty() {
        lines.push("No review annotations found.".into());
        return format!("{}\n", lines.join("\n"));
    }
    let all: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
    for item in items {
        lines.extend([
            format!("id: {}", display_id(&item.id, &all)),
            format!("location: {}:{}", item.file, item.line_start),
            format!("state: {}", item.state),
            format!("last: {}", last_message_line(item)),
            format!("context: {}", item.context),
            format!("suggested action: {}", item.suggested_action),
            String::new(),
        ]);
    }
    lines.join("\n")
}

#[derive(Serialize)]
struct StartJson<'a> {
    #[serde(flatten)]
    snapshot: &'a SessionSnapshot,
    #[serde(rename = "dryRun")]
    dry_run: bool,
}

fn start(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let (force, dry_run) = (parsed.flag("force"), parsed.flag("dry-run"));
    let session = ctx.session_read_path();
    if !dry_run && !force && ctx.host.exists(&session) {
        let p = ctx.program();
        return err(format!(
            "agent session already exists at {session}.\nUse {p} agent status [file...] to inspect progress, {p} session done [file...] to finish, or {p} session start --force [file...] to replace the snapshot."
        ));
    }
    let resolved = resolve_agent_files(ctx, &parsed.positional)?;
    let snapshot = if dry_run {
        let original = collect_state(ctx, &resolved, false)?;
        SessionSnapshot {
            version: 1,
            started_at: started_at(ctx),
            cwd: crate::paths::slashes(&ctx.host.cwd()),
            files: original
                .files
                .iter()
                .map(|f| FileSnapshot {
                    original_content: text_of(&original, &f.path).map(str::to_string),
                    ..f.clone()
                })
                .collect(),
            items: original.items.clone(),
            dismissed_item_ids: None,
        }
    } else {
        let snapshot = stamp_and_snapshot(ctx, &resolved)?;
        write_snapshot(ctx, &snapshot)?;
        snapshot
    };
    let text = if parsed.flag("json") {
        json_text(&StartJson {
            snapshot: &snapshot,
            dry_run,
        })
    } else {
        inbox(ctx, &snapshot.items, dry_run, &ctx.session_write_path())
    };
    ctx.print(&text);
    Ok(())
}

fn add_file(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    if parsed.positional.is_empty() {
        return err("Missing argument(s): files");
    }
    let snapshot = ctx.read_session()?;
    let resolved = resolve_agent_files(ctx, &parsed.positional)?;
    let added = stamp_and_snapshot(ctx, &resolved)?;
    let paths: Vec<&str> = added.files.iter().map(|f| f.path.as_str()).collect();
    let merged = SessionSnapshot {
        files: snapshot
            .files
            .iter()
            .filter(|f| !paths.contains(&f.path.as_str()))
            .cloned()
            .chain(added.files.iter().cloned())
            .collect(),
        items: snapshot
            .items
            .iter()
            .filter(|i| !paths.contains(&i.file.as_str()))
            .cloned()
            .chain(added.items.iter().cloned())
            .collect(),
        ..snapshot
    };
    write_snapshot(ctx, &merged)?;
    let text = if parsed.flag("json") {
        json_text(&merged)
    } else {
        inbox(ctx, &merged.items, false, &ctx.session_write_path())
    };
    ctx.print(&text);
    Ok(())
}

fn count_modified(snapshot: &SessionSnapshot, state: &AgentState) -> usize {
    snapshot
        .files
        .iter()
        .filter(|f| {
            state
                .files
                .iter()
                .find(|c| c.path == f.path)
                .map(|c| &c.content_hash)
                != Some(&f.content_hash)
        })
        .count()
}

fn count_answered(snapshot: &SessionSnapshot, state: &AgentState) -> usize {
    state
        .items
        .iter()
        .filter(|item| {
            item.kind == "conversation"
                && snapshot
                    .items
                    .iter()
                    .find(|s| s.id == item.id)
                    .is_some_and(|s| s.raw_hash != item.raw_hash)
                && item
                    .last_message
                    .as_ref()
                    .is_some_and(|m| m.author == "@agent")
        })
        .count()
}

fn guardrails(
    ctx: &Ctx<'_>,
    snapshot: &SessionSnapshot,
    state: &AgentState,
) -> Result<Vec<Guardrail>> {
    let mut out = Vec::new();
    let dismissed = snapshot.dismissed_item_ids.clone().unwrap_or_default();
    for item in &snapshot.items {
        if item.kind == "conversation"
            && !state.items.iter().any(|c| c.id == item.id)
            && !dismissed.contains(&item.id)
        {
            out.push(Guardrail {
                id: item.id.clone(),
                file: item.file.clone(),
                line: item.line_start,
                message: "started conversation missing; verify no durable rationale was deleted"
                    .into(),
            });
        }
    }
    for file in &state.files {
        let Some(text) = text_of(state, &file.path) else {
            continue;
        };
        let items = review::collect_review_items(text, false, Filter::All);
        let ids = ctx.assign_ids(&file.path, text, &items)?;
        for (item, id) in items.iter().zip(ids) {
            let line = item.ann.line_start;
            let failure = |message: &str| Guardrail {
                id: id.clone(),
                file: file.path.clone(),
                line,
                message: message.into(),
            };
            if item.ann.kind != Kind::Conversation {
                if item.ann.timestamp.is_none() {
                    out.push(failure("review annotation missing timestamp"));
                }
                continue;
            }
            let messages = review::messages(&item.ann.raw);
            for m in &messages {
                if m.marker == scan::Marker::Quick && m.timestamp.is_some() {
                    out.push(failure("timestamped bare @ marker should be @me"));
                }
                if m.timestamp.is_none() {
                    out.push(failure("conversation message missing timestamp"));
                }
            }
            if scan::conversation_status(&item.ann.raw) == ConvStatus::Resolved {
                out.push(failure("validated conversation remains cleanable"));
            }
            let started_first = snapshot
                .items
                .iter()
                .find(|s| s.id == id)
                .and_then(|s| s.first_message.as_ref());
            if let (Some(started), Some(current)) = (started_first, messages.first())
                && (started.author != current.marker.as_str()
                    || ids::collapse_whitespace(&started.body)
                        != ids::collapse_whitespace(&current.body))
            {
                out.push(failure("conversation role order changed suspiciously"));
            }
        }
    }
    Ok(out)
}

fn handoff(
    ctx: &Ctx<'_>,
    snapshot: &SessionSnapshot,
    state: &AgentState,
    guardrail_failures: Vec<Guardrail>,
) -> Handoff {
    let _ = ctx;
    Handoff {
        version: 1,
        files_annotated: state
            .files
            .iter()
            .filter(|f| !f.item_ids.is_empty())
            .count(),
        files_modified: count_modified(snapshot, state),
        conversations_answered: count_answered(snapshot, state),
        cleanable_conversations: state
            .items
            .iter()
            .filter(|i| i.kind == "conversation" && i.state == "resolved")
            .cloned()
            .collect(),
        remaining_open_items: state
            .items
            .iter()
            .filter(|i| i.kind == "conversation" && (i.state == "open" || i.state == "wip"))
            .cloned()
            .collect(),
        guardrail_failures,
    }
}

fn status_of(
    ctx: &Ctx<'_>,
    snapshot: &SessionSnapshot,
    state: AgentState,
) -> Result<SessionStatus> {
    let failures = guardrails(ctx, snapshot, &state)?;
    Ok(SessionStatus {
        handoff: handoff(ctx, snapshot, &state, failures),
        items: state.items,
    })
}

fn handoff_ids(h: &Handoff) -> Vec<String> {
    h.cleanable_conversations
        .iter()
        .map(|i| i.id.clone())
        .chain(h.remaining_open_items.iter().map(|i| i.id.clone()))
        .chain(h.guardrail_failures.iter().map(|g| g.id.clone()))
        .filter(|id| id.starts_with(PREFIX))
        .collect()
}

fn failure_lines(h: &Handoff, all: &[String]) -> Vec<String> {
    h.guardrail_failures
        .iter()
        .map(|g| {
            format!(
                "- {} {}:{} {}",
                display_id(&g.id, all),
                g.file,
                g.line,
                g.message
            )
        })
        .collect()
}

fn counters(h: &Handoff, with_annotated: bool) -> Vec<String> {
    let mut lines = Vec::new();
    if with_annotated {
        lines.push(format!("files annotated: {}", h.files_annotated));
    }
    lines.extend([
        format!("files modified: {}", h.files_modified),
        format!("conversations answered: {}", h.conversations_answered),
        format!(
            "validated/cleanable conversations: {}",
            h.cleanable_conversations.len()
        ),
        format!("remaining open items: {}", h.remaining_open_items.len()),
        format!("guardrail failures: {}", h.guardrail_failures.len()),
    ]);
    lines
}

fn restore_formats(ctx: &Ctx<'_>, snapshot: &SessionSnapshot, file_list: &[String]) -> Result<()> {
    for file in file_list {
        let Some(snap) = snapshot.files.iter().find(|f| f.path == slash(file)) else {
            continue;
        };
        let format = match snap.timestamp_format.as_str() {
            "compact" => Format::Compact,
            "hangul" => Format::Hangul,
            "iso" => Format::Iso,
            _ => continue,
        };
        if !ctx.host.exists(file) {
            continue;
        }
        let text = ctx.read_file(file)?;
        let (_, updated) = transform(ctx, &text, mtime_or_now(ctx, file), format)?;
        if updated != text {
            ctx.host.write(file, &updated)?;
        }
    }
    Ok(())
}

fn dismiss(ctx: &Ctx<'_>, snapshot: &mut SessionSnapshot, input: &[String]) -> Result<()> {
    let mut existing: Vec<String> = snapshot.dismissed_item_ids.clone().unwrap_or_default();
    let all: Vec<String> = snapshot.items.iter().map(|i| i.id.clone()).collect();
    for id in input {
        let resolved = resolve_prefix(id, &all).unwrap_or_else(|| id.clone());
        if !existing.contains(&resolved) {
            existing.push(resolved);
        }
    }
    snapshot.dismissed_item_ids = Some(existing);
    write_snapshot(ctx, snapshot)
}

/// Unique id of `all` matching `input` (see [`matches_id`]).
fn resolve_prefix(input: &str, all: &[String]) -> Option<String> {
    let wanted = input.to_lowercase();
    let matches: Vec<&String> = all.iter().filter(|id| matches_id(id, &wanted)).collect();
    (matches.len() == 1).then(|| matches[0].clone())
}

/// `wanted` (lowercase) is a prefix of `id`, with or without `rvw_`. Display
/// ids are such prefixes, whatever set they were shortened over: the VS Code
/// panel shortens over the whole reference map, so it may show more
/// characters than the command's own display id.
fn matches_id(id: &str, wanted: &str) -> bool {
    let canonical = id.to_lowercase();
    canonical.starts_with(wanted)
        || canonical
            .strip_prefix(PREFIX)
            .is_some_and(|bare| bare.starts_with(wanted))
}

fn done(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let mut snapshot = ctx.read_session()?;
    let acks: Vec<String> = parsed
        .all("acknowledge")
        .iter()
        .flat_map(|a| a.split(',').map(str::to_string))
        .collect();
    if !acks.is_empty() {
        dismiss(ctx, &mut snapshot, &acks)?;
    }
    let snapshot = ctx.read_session()?;
    let targets = target_files(ctx, &snapshot, &parsed.positional)?;
    let before = collect_state(ctx, &targets, true)?;
    let modified = count_modified(&snapshot, &before);
    let answered = count_answered(&snapshot, &before);
    restore_formats(ctx, &snapshot, &targets)?;
    let after = collect_state(ctx, &targets, true)?;
    let mut failures = guardrails(ctx, &snapshot, &after)?;
    for file in &snapshot.files {
        if matches!(file.timestamp_format.as_str(), "mixed" | "none") {
            continue;
        }
        let Some(current) = after.files.iter().find(|c| c.path == file.path) else {
            continue;
        };
        if current.timestamp_format != file.timestamp_format {
            failures.push(Guardrail {
                id: file
                    .item_ids
                    .first()
                    .cloned()
                    .unwrap_or_else(|| file.path.clone()),
                file: file.path.clone(),
                line: 1,
                message: format!(
                    "timestamp format drift: expected {}, found {}",
                    file.timestamp_format, current.timestamp_format
                ),
            });
        }
    }
    let mut result = handoff(ctx, &snapshot, &after, failures);
    result.files_modified = modified;
    result.conversations_answered = answered;
    let text = if parsed.flag("json") {
        json_text(&result)
    } else {
        let mut lines = vec!["Agent handoff".to_string()];
        lines.extend(counters(&result, true));
        if !result.guardrail_failures.is_empty() {
            lines.push(String::new());
            lines.extend(failure_lines(&result, &handoff_ids(&result)));
        }
        format!("{}\n", lines.join("\n"))
    };
    ctx.print(&text);
    if !result.guardrail_failures.is_empty() {
        return err("session done guardrails failed");
    }
    Ok(())
}

fn status_cmd(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let snapshot = ctx.read_session()?;
    let targets = target_files(ctx, &snapshot, &parsed.positional)?;
    let state = collect_state(ctx, &targets, true)?;
    let status = status_of(ctx, &snapshot, state)?;
    let text = if parsed.flag("json") {
        json_text(&status)
    } else {
        let mut lines = vec![
            "Agent status".to_string(),
            format!("Snapshot: {}", ctx.session_read_path()),
        ];
        lines.extend(counters(&status.handoff, true));
        if !status.items.is_empty() {
            let all: Vec<String> = status.items.iter().map(|i| i.id.clone()).collect();
            lines.push(String::new());
            for i in &status.items {
                lines.push(format!(
                    "id: {} {}:{} {} {}",
                    display_id(&i.id, &all),
                    i.file,
                    i.line_start,
                    i.state,
                    i.suggested_action
                ));
            }
        }
        if !status.handoff.guardrail_failures.is_empty() {
            lines.push(String::new());
            lines.extend(failure_lines(
                &status.handoff,
                &handoff_ids(&status.handoff),
            ));
        }
        format!("{}\n", lines.join("\n"))
    };
    ctx.print(&text);
    Ok(())
}

/// `me status` without status options, in a session.
pub fn me_status(ctx: &mut Ctx<'_>, files: &[String], json: bool) -> Result<()> {
    let snapshot = ctx.read_session()?;
    let targets = target_files(ctx, &snapshot, files)?;
    let state = collect_state(ctx, &targets, true)?;
    let status = status_of(ctx, &snapshot, state)?;
    if json {
        ctx.print(&json_text(&status));
        return Ok(());
    }
    let all: Vec<String> = status.items.iter().map(|i| i.id.clone()).collect();
    let issues: Vec<&Guardrail> = status
        .handoff
        .guardrail_failures
        .iter()
        .filter(|g| g.message != "validated conversation remains cleanable")
        .collect();
    let h = &status.handoff;
    let mut lines = vec![
        "In review session".to_string(),
        format!(
            "{} to review - {} to clean - {} still open - {} issues",
            h.remaining_open_items.len(),
            h.cleanable_conversations.len(),
            h.remaining_open_items.len(),
            issues.len()
        ),
    ];
    let item_line = |i: &AgentItem| {
        let body = i
            .last_message
            .as_ref()
            .map_or("-".to_string(), |m| ids::collapse_whitespace(&m.body));
        format!(
            "- {} {}:{} {body}",
            display_id(&i.id, &all),
            i.file,
            i.line_start
        )
    };
    if h.remaining_open_items.is_empty()
        && h.cleanable_conversations.is_empty()
        && issues.is_empty()
    {
        lines.extend([String::new(), "Nothing to do.".into()]);
    } else {
        if !h.remaining_open_items.is_empty() {
            lines.extend([String::new(), "Open conversations:".into()]);
            lines.extend(h.remaining_open_items.iter().map(item_line));
        }
        if !h.cleanable_conversations.is_empty() {
            lines.extend([String::new(), "Clean validated conversations:".into()]);
            lines.extend(h.cleanable_conversations.iter().map(item_line));
            lines.push(format!("Run: {} agent clean --validated", ctx.program()));
        }
        if !issues.is_empty() {
            lines.extend([String::new(), "Fix review issues:".into()]);
            lines.extend(issues.iter().map(|g| {
                format!(
                    "- {} {}:{} {}",
                    display_id(&g.id, &all),
                    g.file,
                    g.line,
                    g.message
                )
            }));
        }
    }
    ctx.print(&format!("{}\n", lines.join("\n")));
    Ok(())
}

fn list_cmd(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let limit = match parsed.value("limit") {
        Some(v)
            if v.starts_with(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
                && v.bytes().all(|b| b.is_ascii_digit()) =>
        {
            v.parse().ok()
        }
        Some(_) => return err("--limit expects a positive integer."),
        None => None,
    };
    let snapshot = ctx.read_session()?;
    let targets = target_files(ctx, &snapshot, &parsed.positional)?;
    let state = collect_state(ctx, &targets, true)?;
    let items: Vec<AgentItem> = state
        .items
        .into_iter()
        .filter(|i| i.state != "resolved")
        .take(limit.unwrap_or(usize::MAX))
        .collect();
    let text = if parsed.flag("json") {
        #[derive(Serialize)]
        struct Out<'a> {
            version: u32,
            items: &'a [AgentItem],
        }
        json_text(&Out {
            version: 1,
            items: &items,
        })
    } else {
        inbox(ctx, &items, false, &ctx.session_write_path())
    };
    ctx.print(&text);
    Ok(())
}

fn resolve_located(
    ctx: &Ctx<'_>,
    snapshot: &SessionSnapshot,
    given: &[String],
    id: &str,
) -> Result<Located> {
    let targets = target_files(ctx, snapshot, given)?;
    let items = collect_located(ctx, &targets, None, false, Filter::All, None)?;
    let wanted = id.to_lowercase();
    let mut matches: Vec<Located> = items
        .into_iter()
        .filter(|l| matches_id(&l.id, &wanted))
        .collect();
    match matches.len() {
        0 => err(format!("No review item found for id {id}.")),
        1 => Ok(matches.remove(0)),
        _ => err(format!(
            "Ambiguous review item id {id}; provide a longer stable id."
        )),
    }
}

fn id_and_files(parsed: &Parsed) -> Result<(String, Vec<String>)> {
    match parsed.positional.split_first() {
        Some((id, files)) => Ok((id.clone(), files.to_vec())),
        None => err("Missing argument(s): id"),
    }
}

fn show(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let (id, files) = id_and_files(parsed)?;
    let snapshot = ctx.read_session()?;
    let located = resolve_located(ctx, &snapshot, &files, &id)?;
    if parsed.flag("json") {
        #[derive(Serialize)]
        struct Out {
            version: u32,
            item: AgentItem,
        }
        ctx.print(&json_text(&Out {
            version: 1,
            item: agent::to_agent_item(
                &slash(&located.file),
                &located.id,
                &located.item,
                &format::SUMMARY,
            ),
        }));
        return Ok(());
    }
    let context = match parsed.value("context") {
        Some(v) if !v.is_empty() => crate::args::parse_context(v)?,
        _ => crate::args::DEFAULT_CONTEXT,
    };
    let style = Style::resolve(ctx.host, None);
    let text = format::full_item(
        &style,
        &format::Shown {
            file: &located.file,
            index: 1,
            total: 1,
            item: &located.item,
            text: &located.text,
            id: &display_id(&located.id, std::slice::from_ref(&located.id)),
        },
        context,
    );
    ctx.print(&text);
    Ok(())
}

fn action_text(result: &ActionResult, json: bool) -> String {
    if json {
        json_text(result)
    } else {
        format!(
            "{} {} {}:{}\n",
            result.action, result.id, result.file, result.line
        )
    }
}

fn respond(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let (id, files) = id_and_files(parsed)?;
    let message = match parsed.value("message").map(str::trim) {
        Some(m) if !m.is_empty() => m.to_string(),
        _ => return err("agent respond requires --message."),
    };
    if message.contains("<!--") || message.contains("-->") {
        return err(
            "reply contains HTML comment markers (<!-- or -->); these nest inside the conversation block and corrupt it after formatting. Use plain text references instead, e.g. (source: file:line).",
        );
    }
    let snapshot = ctx.read_session()?;
    let located = resolve_located(ctx, &snapshot, &files, &id)?;
    if located.item.ann.kind != Kind::Conversation {
        return err("agent respond requires a conversation item id.");
    }
    let reply = actions::append_agent_reply(&located.item.ann.raw, &message, &now_iso(ctx)?);
    let updated = actions::splice(
        &located.text,
        located.item.ann.start,
        located.item.ann.end,
        &reply,
    );
    ctx.host.write(&located.file, &updated)?;
    let result = ActionResult {
        id: located.id.clone(),
        file: slash(&located.file),
        line: located.item.ann.line_start,
        action: "responded".into(),
        message,
    };
    ctx.print(&action_text(&result, parsed.flag("json")));
    Ok(())
}

fn apply(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let (id, files) = id_and_files(parsed)?;
    let snapshot = ctx.read_session()?;
    let located = resolve_located(ctx, &snapshot, &files, &id)?;
    if located.item.ann.kind == Kind::Conversation {
        return err("agent apply requires a review annotation item id.");
    }
    let ann = &located.item.ann;
    let remove = parsed.flag("remove");
    if remove && parsed.value("replace").is_some() {
        return err("--remove and --replace cannot be used together.");
    }
    // `--replace ""` stays refused by the option parser; `--remove` is the
    // way to drop an annotation, blanks around it included.
    let updated = if remove {
        actions::delete_with_whitespace(&located.text, ann.start, ann.end)
    } else {
        let replacement = match parsed.value("replace") {
            Some(r) => r.to_string(),
            None => actions::replacement(&ann.raw, &actions::Action::Apply),
        };
        actions::splice(&located.text, ann.start, ann.end, &replacement)
    };
    ctx.host.write(&located.file, &updated)?;
    let (action, default_message) = if remove {
        ("removed", "annotation removed")
    } else {
        ("applied", "annotation applied")
    };
    let result = ActionResult {
        id: located.id.clone(),
        file: slash(&located.file),
        line: ann.line_start,
        action: action.into(),
        message: parsed
            .value("message")
            .unwrap_or(default_message)
            .to_string(),
    };
    ctx.print(&action_text(&result, parsed.flag("json")));
    Ok(())
}

fn clean(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    if !parsed.flag("validated") {
        return err("agent clean requires --validated.");
    }
    let dry_run = parsed.flag("dry-run");
    let mut snapshot = ctx.read_session()?;
    let targets_files: Vec<String> = snapshot.files.iter().map(|f| f.path.clone()).collect();
    let all_items = collect_located(ctx, &targets_files, None, false, Filter::All, None)?;
    let mut targets: Vec<Located> = Vec::new();
    if parsed.positional.is_empty() {
        let resolved: Vec<Located> =
            collect_located(ctx, &targets_files, None, false, Filter::All, None)?
                .into_iter()
                .filter(|l| {
                    l.item.ann.kind == Kind::Conversation
                        && scan::conversation_status(&l.item.ann.raw) == ConvStatus::Resolved
                })
                .collect();
        targets.extend(resolved);
    } else {
        for id in &parsed.positional {
            if id.contains('.') || id.contains('/') {
                return err(format!(
                    "\"{id}\" looks like a file path, not a review item ID. agent clean takes conversation IDs only; it operates on all session files automatically."
                ));
            }
        }
        for id in &parsed.positional {
            targets.push(resolve_located(ctx, &snapshot, &[], id)?);
        }
    }
    let all_ids: Vec<String> = all_items.iter().map(|l| l.id.clone()).collect();
    for t in &targets {
        if t.item.ann.kind != Kind::Conversation
            || scan::conversation_status(&t.item.ann.raw) != ConvStatus::Resolved
        {
            return err(format!(
                "{} is not a validated conversation.",
                display_id(&t.id, &all_ids)
            ));
        }
    }
    if !dry_run {
        write_deleted(ctx, &targets)?;
        let ids: Vec<String> = targets.iter().map(|t| t.id.clone()).collect();
        dismiss(ctx, &mut snapshot, &ids)?;
    }
    let result = CleanResult {
        version: 1,
        dry_run,
        cleaned: if dry_run { 0 } else { targets.len() },
        cleanable: targets
            .iter()
            .map(|t| agent::to_agent_item(&slash(&t.file), &t.id, &t.item, &format::SUMMARY))
            .collect(),
    };
    let text = if parsed.flag("json") {
        json_text(&result)
    } else {
        let noun = |n: usize| {
            if n == 1 {
                "conversation"
            } else {
                "conversations"
            }
        };
        if dry_run {
            format!(
                "would clean {} {}\n",
                result.cleanable.len(),
                noun(result.cleanable.len())
            )
        } else {
            format!("cleaned {} {}\n", result.cleaned, noun(result.cleaned))
        }
    };
    ctx.print(&text);
    Ok(())
}

fn write_deleted(ctx: &Ctx<'_>, targets: &[Located]) -> Result<()> {
    let mut by_file: Vec<(String, Vec<&Located>)> = Vec::new();
    for t in targets {
        match by_file.iter_mut().find(|(f, _)| *f == t.file) {
            Some((_, list)) => list.push(t),
            None => by_file.push((t.file.clone(), vec![t])),
        }
    }
    for (file, mut list) in by_file {
        let mut text = ctx.read_file(&file)?;
        list.sort_by_key(|t| std::cmp::Reverse(t.item.ann.start));
        for t in list {
            text = actions::delete_with_whitespace(&text, t.item.ann.start, t.item.ann.end);
        }
        ctx.host.write(&file, &text)?;
    }
    Ok(())
}

fn rollback(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let snapshot = ctx.read_session()?;
    let close = parsed.positional.is_empty();
    let wanted: Vec<String> = parsed.positional.iter().map(|f| slash(f)).collect();
    let mut rolled = Vec::new();
    for file in &snapshot.files {
        if !close && !wanted.contains(&file.path) {
            continue;
        }
        let Some(original) = &file.original_content else {
            return err(format!(
                "session rollback requires a session snapshot with stored file content.\nThis snapshot was created by an older {} version; start a new session before using rollback.",
                ctx.program()
            ));
        };
        ctx.host.write(&file.path, original)?;
        rolled.push(file.path.clone());
    }
    if close {
        let _ = ctx.host.remove_file(&ctx.session_read_path());
    }
    let result = RollbackResult {
        version: 1,
        rolled_back_files: rolled,
        session_closed: close,
    };
    let text = if parsed.flag("json") {
        json_text(&result)
    } else {
        let n = result.rolled_back_files.len();
        format!(
            "rolled back {n} {}{}\n",
            if n == 1 { "file" } else { "files" },
            if close { "\nsession closed" } else { "" }
        )
    };
    ctx.print(&text);
    Ok(())
}

fn diff(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let snapshot = ctx.read_session()?;
    let targets = target_files(ctx, &snapshot, &parsed.positional)?;
    let state = collect_state(ctx, &targets, true)?;
    let status = status_of(ctx, &snapshot, state)?;
    let text = if parsed.flag("json") {
        json_text(&status)
    } else {
        let mut lines = vec!["Agent action diff".to_string()];
        lines.extend(counters(&status.handoff, false));
        if !status.items.is_empty() {
            let all: Vec<String> = status.items.iter().map(|i| i.id.clone()).collect();
            lines.push(String::new());
            for i in &status.items {
                lines.push(format!(
                    "- {} {}:{} {} {}",
                    display_id(&i.id, &all),
                    i.file,
                    i.line_start,
                    i.state,
                    i.suggested_action
                ));
            }
        }
        format!("{}\n", lines.join("\n"))
    };
    ctx.print(&text);
    Ok(())
}

fn active(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    if ctx.has_session() {
        let message = parsed
            .value("template")
            .unwrap_or("in a review session")
            .to_string();
        ctx.print(&format!("{message}\n"));
    }
    Ok(())
}

/// `session <sub>` and `agent <sub>`; `Ok(None)` when `sub` is unknown.
pub fn run(ctx: &mut Ctx<'_>, group: &str, sub: &str, rest: &[String]) -> Result<bool> {
    // Lifecycle commands are public under `session`, hidden aliases under `agent`.
    let in_session = group == "session";
    let in_agent = group == "agent";
    type Handler = fn(&mut Ctx<'_>, &Parsed) -> Result<()>;
    let handled: (Spec, Handler) = match sub {
        "start" => (START, start),
        "add-file" => (JSON_ONLY, add_file),
        "status" => (JSON_ONLY, status_cmd),
        "done" => (DONE, done),
        "rollback" => (JSON_ONLY, rollback),
        "active" if in_session => (ACTIVE, active),
        "list" | "inbox" if in_agent => (LIST, list_cmd),
        "show" if in_agent => (SHOW, show),
        "respond" if in_agent => (RESPOND, respond),
        "apply" if in_agent => (APPLY, apply),
        "clean" if in_agent => (CLEAN, clean),
        "diff" if in_agent => (JSON_ONLY, diff),
        _ => return Ok(false),
    };
    let parsed = subargs::parse(rest, &handled.0)?;
    (handled.1)(ctx, &parsed)?;
    Ok(true)
}
