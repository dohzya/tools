//! Todos and tags.

use crate::ctx::{Ctx, Res, fail};
use crate::resolve::resolve_task_id;
use crate::scope::{discover_scopes, effective_tags};
use serde::Serialize;
use worklog_core::error::Code;
use worklog_core::index::{Index, validate_tag};
use worklog_core::json::J;
use worklog_core::output::{StatusOutput, TodoAddOutput};
use worklog_core::taskfile;
use worklog_core::types::{Todo, TodoStatus};
use worklog_core::yaml::Value;

/// `{ todos }`
#[derive(Serialize)]
pub struct TodoListOutput {
    /// Todos.
    pub todos: Vec<Todo>,
}

/// `ListTodosUseCase`
pub fn list_todos(ctx: &mut Ctx, task_id: Option<&str>) -> Res<TodoListOutput> {
    ctx.purge()?;
    let task_id = match task_id {
        Some(t) => Some(resolve_task_id(ctx, t)?),
        None => None,
    };
    let index = ctx.load_index()?;
    if let Some(id) = task_id {
        let task = ctx.require_task(&id)?;
        return Ok(TodoListOutput { todos: task.todos });
    }
    let mut all = Vec::new();
    for (id, e) in index.entries() {
        if e.status == Some(worklog_core::types::TaskStatus::Done) {
            continue;
        }
        let Ok(Some(task)) = ctx.find_task(&id) else {
            continue;
        };
        let desc = task.desc().join("\n\n---\n\n");
        for mut t in task.todos {
            t.metadata.insert("taskId", id.clone());
            t.metadata.insert("taskDesc", desc.clone());
            all.push(t);
        }
    }
    Ok(TodoListOutput { todos: all })
}

/// `AddTodoUseCase`
pub fn add_todo(ctx: &mut Ctx, task_id: &str, text: &str) -> Res<TodoAddOutput> {
    ctx.purge()?;
    let id = resolve_task_id(ctx, task_id)?;
    ctx.require_task(&id)?;
    let todo_id = ctx.ports.env.todo_id();
    let content = ctx.load_task_content(&id)?;
    let content = taskfile::add_todo(&content, text, &todo_id, &[]);
    ctx.save_task_content(&id, &content)?;
    Ok(TodoAddOutput {
        id: todo_id,
        task_id: id,
    })
}

/// `GetNextTodoUseCase`
pub fn next_todo(ctx: &mut Ctx, task_id: Option<&str>) -> Res<Option<Todo>> {
    ctx.purge()?;
    let task_id = match task_id {
        Some(t) => Some(resolve_task_id(ctx, t)?),
        None => None,
    };
    let index = ctx.load_index()?;
    let next_for = |ctx: &Ctx, id: &str| -> Res<Option<Todo>> {
        let Some(task) = ctx.find_task(id)? else {
            return Ok(None);
        };
        Ok(task.todos.into_iter().find(|t| {
            !t.status.is_closed()
                && !(t.status == TodoStatus::Blocked
                    && t.metadata.get("dependsOn").is_some_and(|d| !d.is_empty()))
        }))
    };
    if let Some(id) = task_id {
        return next_for(ctx, &id);
    }
    for (id, e) in index.entries() {
        if e.status == Some(worklog_core::types::TaskStatus::Done) {
            continue;
        }
        if let Ok(Some(t)) = next_for(ctx, &id) {
            return Ok(Some(t));
        }
    }
    Ok(None)
}

/// `UpdateTodoUseCase`
pub fn set_todo(ctx: &mut Ctx, todo_id: &str, updates: &[(String, String)]) -> Res<StatusOutput> {
    if let Some((_, v)) = updates.iter().find(|(k, _)| k == "status")
        && !v.is_empty()
        && TodoStatus::parse(v).is_none()
    {
        return fail(
            Code::InvalidArgs,
            format!(
                "Invalid todo status: {v}. Must be one of: todo, wip, blocked, cancelled, done"
            ),
        );
    }
    ctx.purge()?;
    let index = ctx.load_index()?;
    let mut found: Vec<(String, String, String)> = Vec::new();
    for id in index.ids() {
        let Ok(Some(task)) = ctx.find_task(&id) else {
            continue;
        };
        for t in task.todos {
            found.push((t.id.clone(), id.clone(), t.text.clone()));
        }
    }
    let p = todo_id.to_lowercase();
    let matches: Vec<&(String, String, String)> = found
        .iter()
        .filter(|(tid, _, _)| tid.to_lowercase().starts_with(&p))
        .collect();
    if matches.is_empty() {
        return fail(
            Code::TodoNotFound,
            format!("No todo found matching prefix: {todo_id}"),
        );
    }
    if matches.len() > 1 {
        let mut lines = vec![format!(
            "Ambiguous todo ID prefix '{todo_id}' matches {} todos:",
            matches.len()
        )];
        for (tid, _, text) in matches.iter().take(10) {
            lines.push(format!("  {tid}  \"{text}\""));
        }
        return fail(Code::InvalidArgs, lines.join("\n"));
    }
    let (resolved, task_id, _) = matches[0].clone();
    let content = ctx.load_task_content(&task_id)?;
    let status = updates
        .iter()
        .find(|(k, _)| k == "status")
        .filter(|(_, v)| !v.is_empty())
        .and_then(|(_, v)| TodoStatus::parse(v));
    let fields: Vec<(String, String)> = updates
        .iter()
        .filter(|(k, _)| k != "status")
        .cloned()
        .collect();
    let new = taskfile::update_todo_line(&content, &resolved, status, &fields);
    ctx.save_task_content(&task_id, &new)?;
    Ok(StatusOutput::new("todo_updated"))
}

// ---- tags ------------------------------------------------------------

/// A tag and the number of tasks carrying it.
#[derive(Serialize, Clone)]
pub struct TagCount {
    /// Tag.
    pub tag: String,
    /// Tasks.
    pub count: usize,
}

/// Result of `tags`.
#[derive(Serialize, Default)]
pub struct TagsOutput {
    /// Tags of one task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// All tags with counts.
    #[serde(rename = "allTags", skip_serializing_if = "Option::is_none")]
    pub all_tags: Option<Vec<TagCount>>,
}

/// ICU-like `localeCompare` for the ASCII tags: punctuation first, then digits,
/// then letters ignoring case, lowercase before uppercase on ties.
pub fn locale_compare(a: &str, b: &str) -> std::cmp::Ordering {
    fn weight(c: char) -> (u8, u32) {
        match c {
            ' ' => (0, 0),
            '_' => (1, 0),
            '-' => (1, 1),
            '/' => (1, 20),
            c if c.is_ascii_digit() => (2, c as u32),
            c if c.is_alphabetic() => (3, c.to_lowercase().next().map_or(0, |l| l as u32)),
            c => (1, 10 + c as u32 % 100),
        }
    }
    let primary = a.chars().map(weight).cmp(b.chars().map(weight));
    if primary != std::cmp::Ordering::Equal {
        return primary;
    }
    // Tertiary: lowercase before uppercase at the first difference.
    for (x, y) in a.chars().zip(b.chars()) {
        if x != y {
            return if x.is_lowercase() {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
    }
    a.len().cmp(&b.len())
}

/// `ListTagsUseCase.listAll`
pub fn list_all_tags(ctx: &mut Ctx, git_root: Option<&str>, cwd: &str) -> Res<Vec<TagCount>> {
    let paths: Vec<String> = match git_root {
        Some(root) => discover_scopes(ctx, root, ctx.depth_limit, true)
            .into_iter()
            .map(|s| s.absolute_path)
            .collect(),
        None => vec![crate::path::join(cwd, &ctx.wl_dir)],
    };
    let mut counts: Vec<(String, usize)> = Vec::new();
    for p in paths {
        let Ok(Some(text)) = ctx
            .ports
            .fs
            .read_to_string(&crate::path::join(&p, "index.json"))
        else {
            continue;
        };
        let Ok(index) = Index::parse(&text, false) else {
            continue;
        };
        for (_, e) in index.entries() {
            for t in e.tags {
                match counts.iter_mut().find(|(k, _)| *k == t) {
                    Some(c) => c.1 += 1,
                    None => counts.push((t, 1)),
                }
            }
        }
    }
    counts.sort_by(|a, b| locale_compare(&a.0, &b.0));
    Ok(counts
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect())
}

/// `cmdTags`
pub fn manage_tags(
    ctx: &mut Ctx,
    task_id: Option<&str>,
    add: &[String],
    remove: &[String],
    git_root: Option<&str>,
    cwd: &str,
) -> Res<TagsOutput> {
    let Some(task_id) = task_id else {
        return Ok(TagsOutput {
            all_tags: Some(list_all_tags(ctx, git_root, cwd)?),
            tags: None,
        });
    };
    for t in add {
        if let Some(e) = validate_tag(t) {
            return fail(Code::InvalidArgs, format!("Invalid tag '{t}': {e}"));
        }
    }
    ctx.purge()?;
    let id = resolve_task_id(ctx, task_id)?;
    let content = ctx.load_task_content(&id)?;
    let task = taskfile::parse_task_file(&content).map_err(crate::ctx::Fail::Wt)?;
    if add.is_empty() && remove.is_empty() {
        let wl = crate::path::join(cwd, &ctx.wl_dir);
        let tags = effective_tags(ctx, &task.tags(), &wl, git_root, true);
        return Ok(TagsOutput {
            tags: Some(tags),
            all_tags: None,
        });
    }
    let mut set = task.tags();
    for t in add {
        if !set.contains(t) {
            set.push(t.clone());
        }
    }
    set.retain(|t| !remove.contains(t));
    set.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let value =
        (!set.is_empty()).then(|| Value::Seq(set.iter().cloned().map(Value::Str).collect()));
    let content = taskfile::update_frontmatter(&content, &[("tags", value)]);
    ctx.save_task_content(&id, &content)?;
    let mut index = ctx.load_index()?;
    if index.contains(&id) {
        index.update(
            &id,
            vec![("tags", (!set.is_empty()).then(|| J::strings(set.clone())))],
        );
    }
    ctx.save_index(&index)?;
    Ok(TagsOutput {
        tags: Some(set),
        all_tags: None,
    })
}

/// Result of `tags rename`.
#[derive(Serialize)]
pub struct RenameTagOutput {
    /// `tag_renamed` or `tag_not_found`.
    pub status: String,
    /// Tasks changed.
    #[serde(rename = "updatedCount")]
    pub updated_count: usize,
    /// Old tag.
    #[serde(rename = "oldTag")]
    pub old_tag: String,
    /// New tag.
    #[serde(rename = "newTag")]
    pub new_tag: String,
}

/// `ListTagsUseCase.renameTag`
pub fn rename_tag(ctx: &mut Ctx, old: &str, new: &str) -> Res<RenameTagOutput> {
    ctx.purge()?;
    for t in [old, new] {
        if let Some(e) = validate_tag(t) {
            return fail(Code::InvalidArgs, format!("Invalid tag '{t}': {e}"));
        }
    }
    let mut index = ctx.load_index()?;
    let affected: Vec<String> = index
        .entries()
        .into_iter()
        .filter(|(_, e)| e.tags.iter().any(|t| t == old))
        .map(|(id, _)| id)
        .collect();
    if affected.is_empty() {
        return Ok(RenameTagOutput {
            status: "tag_not_found".into(),
            updated_count: 0,
            old_tag: old.into(),
            new_tag: new.into(),
        });
    }
    for id in &affected {
        let content = ctx.load_task_content(id)?;
        let task = ctx.find_task(id)?;
        let mut set = task.map(|t| t.tags()).unwrap_or_default();
        set.retain(|t| t != old);
        if !set.iter().any(|t| t == new) {
            set.push(new.to_string());
        }
        set.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let value =
            (!set.is_empty()).then(|| Value::Seq(set.iter().cloned().map(Value::Str).collect()));
        let content = taskfile::update_frontmatter(&content, &[("tags", value)]);
        ctx.save_task_content(id, &content)?;
        index = ctx.load_index()?;
        index.update(
            id,
            vec![("tags", (!set.is_empty()).then(|| J::strings(set.clone())))],
        );
        ctx.save_index(&index)?;
    }
    Ok(RenameTagOutput {
        status: "tag_renamed".into(),
        updated_count: affected.len(),
        old_tag: old.into(),
        new_tag: new.into(),
    })
}
