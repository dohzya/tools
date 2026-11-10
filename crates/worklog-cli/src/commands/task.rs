//! Task lifecycle: init, create, ready, start, update, meta, link, cancel,
//! done.

use super::common::*;
use crate::ctx::{Ctx, Res, fail};
use crate::resolve::resolve_task_id;
use worklog_core::error::Code;
use worklog_core::format::{Palette, format_meta, format_status};
use worklog_core::index::{links_json, validate_tag};
use worklog_core::json::J;
use worklog_core::output::{AddOutput, StatusOutput};
use worklog_core::taskfile::{self, TaskFile};
use worklog_core::types::{LinkType, TaskLink, TaskStatus};
use worklog_core::yaml::Value;

/// `wl init`
pub fn init(ctx: &mut Ctx, json: bool, palette: &Palette) -> Res<()> {
    let out = if ctx.ports.fs.exists(&ctx.wl_path()) {
        StatusOutput::new("already_initialized")
    } else {
        ctx.ports.fs.create_dir_all(&ctx.tasks_dir()).or_else(|_| {
            fail(
                Code::IoError,
                format!("Failed to write file: {}", ctx.tasks_dir()),
            )
        })?;
        ctx.save_index(&worklog_core::index::Index::empty())?;
        StatusOutput::new("initialized")
    };
    emit(ctx, json, &out, || format_status(&out, palette));
    Ok(())
}

/// Inputs of the creation of a task.
pub struct NewTask {
    /// Name.
    pub name: String,
    /// Description parts.
    pub desc: Vec<String>,
    /// Initial status.
    pub status: TaskStatus,
    /// Todo texts.
    pub todos: Vec<String>,
    /// Metadata.
    pub metadata: Option<Vec<(String, String)>>,
    /// Tags.
    pub tags: Vec<String>,
    /// Timestamp (ISO with offset).
    pub timestamp: Option<String>,
    /// Full id of the parent.
    pub parent: Option<String>,
}

/// `cmdAdd`: creates the task and returns its short id.
pub fn add_task(ctx: &mut Ctx, t: NewTask) -> Res<AddOutput> {
    ctx.auto_init()?;
    ctx.purge()?;
    for tag in &t.tags {
        if let Some(e) = validate_tag(tag) {
            return fail(Code::InvalidArgs, format!("Invalid tag '{tag}': {e}"));
        }
    }
    let uid = ctx.ports.env.uuid();
    let id = uuid_to_base36(&uid);
    let now = t.timestamp.clone().unwrap_or_else(|| ctx.now_iso());
    let (ready_at, started_at) = match t.status {
        TaskStatus::Ready => (Some(now.clone()), None),
        TaskStatus::Started => (None, Some(now.clone())),
        _ => (None, None),
    };
    let opt = |v: Option<String>| v.map_or(Value::Null, Value::Str);
    let mut fm: Vec<(String, Value)> = vec![
        ("id".into(), Value::str(id.clone())),
        ("uid".into(), Value::str(uid)),
        ("name".into(), Value::str(t.name.clone())),
        ("desc".into(), str_seq(&t.desc)),
        ("status".into(), Value::str(t.status.as_str())),
        ("created_at".into(), Value::str(now.clone())),
        ("ready_at".into(), opt(ready_at)),
        ("started_at".into(), opt(started_at)),
        ("done_at".into(), Value::Null),
        ("last_checkpoint".into(), Value::Null),
        ("has_uncheckpointed_entries".into(), Value::Bool(false)),
    ];
    if let Some(m) = &t.metadata {
        fm.push((
            "metadata".into(),
            Value::Map(
                m.iter()
                    .map(|(k, v)| (k.clone(), Value::str(v.clone())))
                    .collect(),
            ),
        ));
    }
    if !t.tags.is_empty() {
        fm.push(("tags".into(), str_seq(&t.tags)));
    }
    if let Some(p) = &t.parent {
        fm.push(("parent".into(), Value::str(p.clone())));
    }
    let todos: Vec<(String, String)> = t
        .todos
        .iter()
        .map(|text| (ctx.ports.env.todo_id(), text.clone()))
        .collect();
    let content = taskfile::new_task_content(&fm, &todos);
    ctx.save_task_content(&id, &content)?;
    let mut index = ctx.load_index()?;
    let mut entry = vec![
        ("name".to_string(), J::str(t.name)),
        ("desc".into(), J::strings(t.desc)),
        ("status".into(), J::str(t.status.as_str())),
        ("created".into(), J::str(now.clone())),
        ("status_updated_at".into(), J::str(now)),
        ("done_at".into(), J::Null),
    ];
    if !t.tags.is_empty() {
        entry.push(("tags".into(), J::strings(t.tags)));
    }
    if let Some(p) = t.parent {
        entry.push(("parent".into(), J::str(p)));
    }
    index.put(&id, J::Obj(entry));
    ctx.save_index(&index)?;
    Ok(AddOutput {
        id: index.short_id(&id),
    })
}

/// 128-bit UUID as 25 base36 chars.
pub fn uuid_to_base36(uuid: &str) -> String {
    let hex: String = uuid.chars().filter(|c| *c != '-').collect();
    let mut n = u128::from_str_radix(&hex, 16).unwrap_or(0);
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    while out.len() < 25 {
        out.push(b'0');
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn status_updates(ctx: &Ctx, id: &str, updates: Vec<(&str, Option<Value>)>) -> Res<()> {
    let content = ctx.load_task_content(id)?;
    let content = taskfile::update_frontmatter(&content, &updates);
    ctx.save_task_content(id, &content)?;
    Ok(())
}

fn index_update(ctx: &mut Ctx, id: &str, ups: Vec<(&str, Option<J>)>) -> Res<()> {
    let mut index = ctx.load_index()?;
    if !index.update(id, ups) {
        return fail(Code::TaskNotFound, format!("Task not found in index: {id}"));
    }
    ctx.save_index(&index)?;
    Ok(())
}

/// `wl ready`
pub fn ready(ctx: &mut Ctx, id: &str) -> Res<StatusOutput> {
    let task = ctx.require_task(id)?;
    let status = task.status();
    if !matches!(status, Some(TaskStatus::Created | TaskStatus::Started)) {
        let name = task.timestamp("status").unwrap_or_default();
        let shown = status.map_or(name, |s| s.as_str().to_string());
        return fail(
            Code::InvalidState,
            format!("Cannot transition from '{shown}' to 'ready'"),
        );
    }
    let now = ctx.now_iso();
    status_updates(
        ctx,
        id,
        vec![
            ("status", Some(Value::str("ready"))),
            ("ready_at", Some(Value::str(now.clone()))),
        ],
    )?;
    index_update(
        ctx,
        id,
        vec![
            ("status", Some(J::str("ready"))),
            ("status_updated_at", Some(J::str(now))),
        ],
    )?;
    Ok(StatusOutput::new("task_ready"))
}

/// `wl start`
pub fn start(ctx: &mut Ctx, id: &str) -> Res<StatusOutput> {
    let task = ctx.require_task(id)?;
    let status = task.status();
    if status == Some(TaskStatus::Started) {
        return Ok(StatusOutput::new("task_already_started"));
    }
    let reopening = matches!(status, Some(TaskStatus::Done | TaskStatus::Cancelled));
    let now = ctx.now_iso();
    let mut ups: Vec<(&str, Option<Value>)> = vec![
        ("status", Some(Value::str("started"))),
        ("started_at", Some(Value::str(now.clone()))),
    ];
    if task.timestamp("done_at").is_some() {
        ups.push(("done_at", Some(Value::Null)));
    }
    if task.timestamp("cancelled_at").is_some() {
        ups.push(("cancelled_at", Some(Value::Null)));
    }
    status_updates(ctx, id, ups)?;
    index_update(
        ctx,
        id,
        vec![
            ("status", Some(J::str("started"))),
            ("status_updated_at", Some(J::str(now))),
        ],
    )?;
    Ok(StatusOutput::new(if reopening {
        "task_reopened"
    } else {
        "task_started"
    }))
}

/// The status transition of `done`, once checkpoint and metadata are in.
fn mark_done(ctx: &mut Ctx, id: &str, force: bool) -> Res<StatusOutput> {
    let task = ctx.require_task(id)?;
    if !force {
        let pending = task.todos.iter().filter(|t| !t.status.is_closed()).count();
        if pending > 0 {
            return fail(
                Code::TaskHasPendingTodos,
                format!("Task has {pending} pending todo(s). Use --force to complete anyway."),
            );
        }
        if task.has_uncheckpointed_entries() {
            return fail(
                Code::NoUncheckpointedEntries,
                "Cannot mark done: uncheckpointed entries exist. Provide changes and learnings.",
            );
        }
    }
    let now = ctx.now_iso();
    status_updates(
        ctx,
        id,
        vec![
            ("status", Some(Value::str("done"))),
            ("done_at", Some(Value::str(now.clone()))),
        ],
    )?;
    index_update(
        ctx,
        id,
        vec![
            ("status", Some(J::str("done"))),
            ("done_at", Some(J::str(now))),
        ],
    )?;
    Ok(StatusOutput::new("task_completed"))
}

/// `cmdDone`
pub fn done(
    ctx: &mut Ctx,
    id: &str,
    changes: Option<&str>,
    learnings: Option<&str>,
    force: bool,
    metadata: Option<Vec<(String, String)>>,
) -> Res<StatusOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    let changes = changes.filter(|c| !c.is_empty());
    let learnings = learnings.filter(|c| !c.is_empty());
    if !force {
        let task = ctx.require_task(&id)?;
        let pending = task.todos.iter().filter(|t| !t.status.is_closed()).count();
        if pending > 0 {
            return fail(
                Code::TaskHasPendingTodos,
                format!("Task has {pending} pending todo(s). Use --force to complete anyway."),
            );
        }
        if changes.is_none() && learnings.is_none() && task.has_uncheckpointed_entries() {
            return fail(
                Code::NoUncheckpointedEntries,
                "Cannot mark done: uncheckpointed entries exist. Provide changes and learnings.",
            );
        }
    }
    if changes.is_some() || learnings.is_some() {
        super::trace::create_checkpoint(
            ctx,
            &id,
            changes.unwrap_or(""),
            learnings.unwrap_or(""),
            true,
        )?;
    }
    if let Some(meta) = metadata {
        for (k, v) in meta {
            update_meta(ctx, &id, Some(&k), Some(&v), None, None, false, false)?;
        }
    }
    mark_done(ctx, &id, force)
}

/// `wl cancel`
pub fn cancel(ctx: &mut Ctx, id: &str, reason: Option<&str>) -> Res<StatusOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    if let Some(r) = reason.filter(|r| !r.is_empty()) {
        update_meta(
            ctx,
            &id,
            Some("cancellation_reason"),
            Some(r),
            None,
            None,
            false,
            false,
        )?;
    }
    let now = ctx.now_iso();
    status_updates(
        ctx,
        &id,
        vec![
            ("status", Some(Value::str("cancelled"))),
            ("cancelled_at", Some(Value::str(now.clone()))),
        ],
    )?;
    index_update(
        ctx,
        &id,
        vec![
            ("status", Some(J::str("cancelled"))),
            ("cancelled_at", Some(J::str(now))),
        ],
    )?;
    Ok(StatusOutput::new("task_cancelled"))
}

/// `UpdateTaskUseCase`
pub fn update_task(
    ctx: &mut Ctx,
    id: &str,
    name: Option<&str>,
    desc: Option<Vec<String>>,
    append: Option<Vec<String>>,
) -> Res<StatusOutput> {
    let name = name.filter(|n| !n.is_empty());
    if name.is_none() && desc.is_none() && append.is_none() {
        return fail(
            Code::InvalidArgs,
            "Must provide at least one of --name, --desc, or --append-desc",
        );
    }
    ctx.purge()?;
    let id = resolve_task_id(ctx, id)?;
    let content = ctx.load_task_content(&id)?;
    let mut updates: Vec<(&str, Option<Value>)> = Vec::new();
    if let Some(n) = name {
        updates.push(("name", Some(Value::str(n))));
    }
    let new_desc: Option<Vec<String>> = if let Some(d) = desc {
        Some(d)
    } else if let Some(a) = append {
        let parsed = taskfile::parse_task_file(&content).map_err(crate::ctx::Fail::Wt)?;
        let mut cur = parsed.desc();
        cur.extend(a.into_iter().filter(|p| !p.is_empty()));
        Some(cur)
    } else {
        None
    };
    if let Some(d) = &new_desc {
        updates.push(("desc", Some(str_seq(d))));
    }
    let content = taskfile::update_frontmatter(&content, &updates);
    ctx.save_task_content(&id, &content)?;
    let mut ups: Vec<(&str, Option<J>)> = Vec::new();
    if let Some(n) = name {
        ups.push(("name", Some(J::str(n))));
    }
    if let Some(d) = new_desc {
        ups.push(("desc", Some(J::strings(d))));
    }
    index_update(ctx, &id, ups)?;
    Ok(StatusOutput::new("task_updated"))
}

/// Result of `meta`.
#[derive(serde::Serialize)]
pub struct MetaOutput {
    /// Custom metadata.
    pub metadata: worklog_core::ordered::OrderedMap<String>,
}

/// `UpdateMetaUseCase`
#[allow(clippy::too_many_arguments)]
pub fn update_meta(
    ctx: &mut Ctx,
    id: &str,
    key: Option<&str>,
    value: Option<&str>,
    delete_key: Option<&str>,
    parent: Option<&str>,
    detach: bool,
    force: bool,
) -> Res<MetaOutput> {
    let index = ctx.load_index()?;
    let task = ctx.require_task(id)?;
    let mut metadata = task.metadata();
    let should_detach = detach || delete_key == Some("parent");
    if parent.is_some() || should_detach {
        if parent.is_some() && should_detach {
            return fail(
                Code::InvalidArgs,
                "Cannot specify both --parent and --detach",
            );
        }
        if let Some(p) = parent {
            if p == id {
                return fail(Code::InvalidArgs, "A task cannot be its own parent");
            }
            let mut cursor = Some(p.to_string());
            let mut seen: Vec<String> = Vec::new();
            while let Some(c) = cursor {
                if c == id {
                    return fail(
                        Code::InvalidArgs,
                        "Cannot set parent: this would create a task-parent cycle",
                    );
                }
                if seen.contains(&c) {
                    break;
                }
                seen.push(c.clone());
                cursor = index.entry(&c).and_then(|e| e.parent);
            }
            if let Some(cur) = task.parent()
                && !force
            {
                return fail(
                    Code::AlreadyHasParent,
                    format!(
                        "Task already has parent {cur}. Detach it first or use --force to reparent."
                    ),
                );
            }
            status_updates(ctx, id, vec![("parent", Some(Value::str(p)))])?;
            index_update(ctx, id, vec![("parent", Some(J::str(p)))])?;
            return Ok(MetaOutput { metadata });
        }
        status_updates(ctx, id, vec![("parent", None)])?;
        index_update(ctx, id, vec![("parent", None)])?;
        return Ok(MetaOutput { metadata });
    }
    if let Some(d) = delete_key.filter(|d| !d.is_empty()) {
        metadata.remove(d);
    }
    if let (Some(k), Some(v)) = (key.filter(|k| !k.is_empty()), value) {
        if k == "status" {
            let Some(status) = TaskStatus::parse(v) else {
                return fail(
                    Code::InvalidArgs,
                    format!(
                        "Invalid status: {v}. Must be one of: {}",
                        TaskStatus::ALL
                            .iter()
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                );
            };
            let now = time_iso_utc(ctx);
            let mut ups: Vec<(&str, Option<Value>)> = vec![("status", Some(Value::str(v)))];
            let mut done_at_set = false;
            match status {
                TaskStatus::Done if task.timestamp("done_at").is_none() => {
                    ups.push(("done_at", Some(Value::str(now.clone()))));
                    done_at_set = true;
                }
                TaskStatus::Cancelled if task.timestamp("cancelled_at").is_none() => {
                    ups.push(("cancelled_at", Some(Value::str(now.clone()))));
                }
                TaskStatus::Started if task.timestamp("started_at").is_none() => {
                    ups.push(("started_at", Some(Value::str(now.clone()))));
                    ups.push(("done_at", Some(Value::Null)));
                    ups.push(("cancelled_at", Some(Value::Null)));
                }
                TaskStatus::Ready if task.timestamp("ready_at").is_none() => {
                    ups.push(("ready_at", Some(Value::str(now.clone()))));
                }
                TaskStatus::Created => {
                    for k in ["ready_at", "started_at", "done_at", "cancelled_at"] {
                        ups.push((k, Some(Value::Null)));
                    }
                }
                _ => {}
            }
            status_updates(ctx, id, ups)?;
            let mut iups: Vec<(&str, Option<J>)> = vec![
                ("status", Some(J::str(v))),
                ("status_updated_at", Some(J::str(now.clone()))),
            ];
            match status {
                TaskStatus::Created | TaskStatus::Ready | TaskStatus::Started => {
                    iups.push(("done_at", None))
                }
                TaskStatus::Done if done_at_set => iups.push(("done_at", Some(J::str(now)))),
                _ => {}
            }
            index_update(ctx, id, iups)?;
            return Ok(MetaOutput { metadata });
        }
        metadata.insert(k, v.to_string());
    }
    let meta_value = Value::Map(
        metadata
            .iter()
            .map(|(k, v)| (k.clone(), Value::str(v.clone())))
            .collect(),
    );
    status_updates(ctx, id, vec![("metadata", Some(meta_value))])?;
    Ok(MetaOutput { metadata })
}

// UpdateMetaUseCase stamps `new Date().toISOString()`.
fn time_iso_utc(ctx: &Ctx) -> String {
    worklog_core::time::to_iso_string(ctx.ports.clock.now_ms())
}

/// `wl meta` text.
pub fn meta_text(m: &MetaOutput) -> String {
    let entries: Vec<(String, String)> = m
        .metadata
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    format_meta(&entries)
}

/// Output of `link`.
#[derive(serde::Serialize)]
pub struct LinkOutput {
    /// Source task.
    #[serde(rename = "sourceTaskId")]
    pub source_task_id: String,
    /// Type from the source.
    #[serde(rename = "sourceType")]
    pub source_type: LinkType,
    /// Target task.
    #[serde(rename = "targetTaskId")]
    pub target_task_id: String,
    /// Type from the target.
    #[serde(rename = "targetType")]
    pub target_type: LinkType,
}

/// `parseTaskLinkType`
pub fn parse_link_type(t: &str) -> Res<LinkType> {
    match t {
        "depends-on" | "depends_on" => Ok(LinkType::DependsOn),
        "blocks" => Ok(LinkType::Blocks),
        "related" | "relates-to" => Ok(LinkType::Related),
        _ => fail(
            Code::InvalidArgs,
            "Invalid link type. Use depends-on, blocks, or related.",
        ),
    }
}

/// `LinkTaskUseCase`
pub fn link(ctx: &mut Ctx, source: &str, ty: LinkType, target: &str) -> Res<LinkOutput> {
    ctx.purge()?;
    let reciprocal = ty.reciprocal();
    if source == target {
        return fail(Code::InvalidArgs, "A task cannot link to itself");
    }
    for id in [source, target] {
        if ctx.find_task(id)?.is_none() {
            return fail(Code::TaskNotFound, format!("Task not found: {id}"));
        }
    }
    add_link(
        ctx,
        source,
        TaskLink {
            kind: ty,
            task: target.to_string(),
        },
    )?;
    add_link(
        ctx,
        target,
        TaskLink {
            kind: reciprocal,
            task: source.to_string(),
        },
    )?;
    Ok(LinkOutput {
        source_task_id: source.to_string(),
        source_type: ty,
        target_task_id: target.to_string(),
        target_type: reciprocal,
    })
}

fn add_link(ctx: &mut Ctx, id: &str, link: TaskLink) -> Res<()> {
    let task: TaskFile = ctx.require_task(id)?;
    let mut links = task.links();
    if !links.contains(&link) {
        links.push(link);
    }
    let value = Value::Seq(
        links
            .iter()
            .map(|l| {
                Value::Map(vec![
                    ("type".into(), Value::str(l.kind.as_str())),
                    ("task".into(), Value::str(l.task.clone())),
                ])
            })
            .collect(),
    );
    status_updates(ctx, id, vec![("links", Some(value))])?;
    index_update(ctx, id, vec![("links", Some(links_json(&links)))])?;
    Ok(())
}

/// `wl link` text.
pub fn link_text(o: &LinkOutput) -> String {
    format!(
        "{} {} {} ({} reciprocal)",
        o.source_task_id,
        o.source_type.as_str(),
        o.target_task_id,
        o.target_type.as_str()
    )
}
