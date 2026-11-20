//! Text rendering of command results, with the Catppuccin Latte palette when
//! colors are on.

use crate::index::short_id;
use crate::output::*;
use crate::types::{Checkpoint, TaskLink, Todo, TodoStatus};

/// Semantic colors. Without colors every role is the identity.
#[derive(Debug, Clone, Copy)]
pub struct Palette {
    color: bool,
}

fn rgb(hex: &str) -> (u8, u8, u8) {
    let n = u32::from_str_radix(&hex[1..], 16).unwrap_or(0);
    (
        ((n >> 16) & 0xff) as u8,
        ((n >> 8) & 0xff) as u8,
        (n & 0xff) as u8,
    )
}

fn paint(hex: &str, s: &str) -> String {
    let (r, g, b) = rgb(hex);
    format!("\x1b[38;2;{r};{g};{b}m{s}\x1b[39m")
}

impl Palette {
    /// A palette; `color` turns the ANSI sequences on.
    pub fn new(color: bool) -> Palette {
        Palette { color }
    }

    fn role(&self, hex: &str, s: &str) -> String {
        if self.color {
            paint(hex, s)
        } else {
            s.to_string()
        }
    }

    /// Status color.
    pub fn status(&self, status: &str) -> String {
        let hex = match status {
            "done" => "#40a02b",
            "started" => "#df8e1d",
            "ready" => "#179299",
            "created" => "#1e66f5",
            "cancelled" => "#8c8fa1",
            _ => return status.to_string(),
        };
        self.role(hex, status)
    }

    /// Ids.
    pub fn id(&self, s: &str) -> String {
        self.role("#8c8fa1", s)
    }

    /// Timestamps.
    pub fn timestamp(&self, s: &str) -> String {
        self.role("#6c6f85", s)
    }

    /// Tags, kinds and scope prefixes.
    pub fn tag(&self, s: &str) -> String {
        self.role("#8839ef", s)
    }

    /// Field labels.
    pub fn header(&self, s: &str) -> String {
        self.role("#209fb5", s)
    }
}

fn marker(s: TodoStatus) -> char {
    s.marker()
}

fn dashboard_marker(s: TodoStatus) -> char {
    match s {
        TodoStatus::Todo => ' ',
        TodoStatus::Wip => '>',
        TodoStatus::Blocked => '!',
        TodoStatus::Cancelled => '-',
        TodoStatus::Done => 'x',
    }
}

fn metadata_text(todo: &Todo, skip: &[&str]) -> String {
    todo.metadata
        .iter()
        .filter(|(k, _)| !skip.contains(&k.as_str()))
        .map(|(k, v)| format!("[{k}:: {v}]"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// `wl todo list`
pub fn format_todo_list(todos: &[Todo]) -> String {
    if todos.is_empty() {
        return "No todos".into();
    }
    let all_todo_ids: Vec<String> = todos.iter().map(|t| t.id.clone()).collect();
    let mut all_task_ids: Vec<String> = Vec::new();
    for t in todos {
        if let Some(id) = t.metadata.get("taskId").filter(|s| !s.is_empty())
            && !all_task_ids.contains(id)
        {
            all_task_ids.push(id.clone());
        }
    }
    let mut by_task: Vec<(String, String, Vec<&Todo>)> = Vec::new();
    let mut ungrouped: Vec<&Todo> = Vec::new();
    for t in todos {
        let task_id = t.metadata.get("taskId").filter(|s| !s.is_empty());
        let desc = t.metadata.get("taskDesc").filter(|s| !s.is_empty());
        match (task_id, desc) {
            (Some(id), Some(desc)) => match by_task.iter_mut().find(|(i, _, _)| i == id) {
                Some(g) => g.2.push(t),
                None => by_task.push((id.clone(), desc.clone(), vec![t])),
            },
            _ => ungrouped.push(t),
        }
    }
    let mut lines: Vec<String> = Vec::new();
    for (task_id, desc, group) in &by_task {
        lines.push(format!("\n{}: {desc}", short_id(task_id, &all_task_ids)));
        for t in group {
            let mut line = format!(
                "  {} [{}] {}",
                short_id(&t.id, &all_todo_ids),
                marker(t.status),
                t.text
            );
            let meta = metadata_text(t, &["taskId", "taskDesc"]);
            if !meta.is_empty() {
                line.push_str(&format!("  {meta}"));
            }
            lines.push(line);
        }
    }
    for t in ungrouped {
        let mut line = format!(
            "{} [{}] {}",
            short_id(&t.id, &all_todo_ids),
            marker(t.status),
            t.text
        );
        let meta = metadata_text(t, &[]);
        if !meta.is_empty() {
            line.push_str(&format!("  {meta}"));
        }
        lines.push(line);
    }
    lines.join("\n").trim().to_string()
}

/// `wl todo next`
pub fn format_todo_next(todo: Option<&Todo>) -> String {
    let Some(t) = todo else {
        return "No available todo".into();
    };
    let mut line = format!("{} [{}] {}", t.id, marker(t.status), t.text);
    let meta = metadata_text(t, &[]);
    if !meta.is_empty() {
        line.push_str(&format!("  {meta}"));
    }
    line
}

/// `wl trace`
pub fn format_trace(o: &TraceOutput) -> String {
    if o.status == "checkpoint_recommended" {
        return format!(
            "checkpoint recommended ({} entries)",
            o.entries_since_checkpoint.unwrap_or(0)
        );
    }
    "ok".into()
}

/// Status results: underscores become spaces, then colored.
pub fn format_status(o: &StatusOutput, p: &Palette) -> String {
    p.status(&o.status.replace('_', " "))
}

/// `wl meta`
pub fn format_meta(metadata: &[(String, String)]) -> String {
    if metadata.is_empty() {
        return "(no metadata)".into();
    }
    metadata
        .iter()
        .map(|(k, v)| format!("{k}: {v}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn link_label(t: crate::types::LinkType) -> &'static str {
    match t {
        crate::types::LinkType::DependsOn => "dep",
        crate::types::LinkType::Blocks => "blk",
        crate::types::LinkType::Related => "rel",
    }
}

fn format_task_links(links: &[TaskLink], all: &[String], p: &Palette) -> String {
    links
        .iter()
        .map(|l| format!("{}:{}", link_label(l.kind), p.id(&short_id(&l.task, all))))
        .collect::<Vec<_>>()
        .join(" ")
}

fn indent_block(text: &str, indent: &str) -> Vec<String> {
    text.split('\n').map(|l| format!("{indent}{l}")).collect()
}

/// `wl show`
pub fn format_show(o: &ShowOutput, p: &Palette) -> String {
    let h = |s: &str| p.header(s);
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("{} {}", h("id:"), p.id(&o.task)));
    lines.push(format!("{} {}", h("full id:"), p.id(&o.full_id)));
    lines.push(format!("{} {}", h("name:"), o.name));
    lines.push(format!("{} {}", h("status:"), p.status(&o.status)));
    if let Some(parent) = &o.parent {
        lines.push(format!(
            "{} {}  \"{}\"  ({})",
            h("parent:"),
            p.id(&parent.short_id),
            parent.name,
            p.status(parent.status.as_str())
        ));
    }
    if let Some(tags) = o.tags.as_ref().filter(|t| !t.is_empty()) {
        lines.push(format!(
            "{} {}",
            h("tags:"),
            tags.iter()
                .map(|t| p.tag(&format!("#{t}")))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    if let Some(links) = o.links.as_ref().filter(|l| !l.is_empty()) {
        lines.push(h("links:"));
        for l in links {
            lines.push(format!(
                "  {} {}  \"{}\"  ({})",
                h(&format!("{}:", l.kind.as_str())),
                p.id(&l.short_id),
                l.name,
                p.status(l.status.as_str())
            ));
        }
    }
    lines.push(h("history:"));
    lines.push(format!("  {} {}", h("created:"), p.timestamp(&o.created)));
    if let Some(r) = o.ready.as_ref().filter(|s| !s.is_empty()) {
        lines.push(format!("  {} {}", h("ready:"), p.timestamp(r)));
    }
    if let Some(s) = o.started.as_ref().filter(|s| !s.is_empty()) {
        lines.push(format!("  {} {}", h("started:"), p.timestamp(s)));
    }
    lines.push(String::new());
    lines.push(h("desc:"));
    lines.extend(indent_block(&o.desc, "  "));
    if let Some(cp) = &o.last_checkpoint {
        lines.push(String::new());
        lines.push(format!("{} {}", h("last checkpoint:"), p.timestamp(&cp.ts)));
        lines.push(format!("  {}", h("CHANGES")));
        lines.extend(indent_block(&cp.changes, "    "));
        lines.push(format!("  {}", h("LEARNINGS")));
        lines.extend(indent_block(&cp.learnings, "    "));
    }
    if !o.entries_since_checkpoint.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "{} {}",
            h("entries since checkpoint:"),
            o.entries_since_checkpoint.len()
        ));
        for e in &o.entries_since_checkpoint {
            let kind = e
                .kind
                .map(|k| format!("  {}", p.tag(k.as_str())))
                .unwrap_or_default();
            lines.push(format!("  {}{kind}", p.timestamp(&e.ts)));
            lines.extend(indent_block(&e.msg, "    "));
        }
    }
    if !o.todos.is_empty() {
        lines.push(String::new());
        lines.push(format!("{} {}", h("todos:"), o.todos.len()));
        let ids: Vec<String> = o.todos.iter().map(|t| t.id.clone()).collect();
        for t in &o.todos {
            let mut line = format!(
                "  {} [{}] {}",
                p.id(&short_id(&t.id, &ids)),
                marker(t.status),
                t.text
            );
            let meta = metadata_text(t, &[]);
            if !meta.is_empty() {
                line.push_str(&format!("  {meta}"));
            }
            lines.push(line);
        }
    }
    if let Some(subs) = o.subtasks.as_ref().filter(|s| !s.is_empty()) {
        lines.push(String::new());
        lines.push(format!(
            "{} {}",
            h("subtasks since checkpoint:"),
            subs.len()
        ));
        lines.extend(render_subtasks(subs, "  ", p));
    }
    lines.join("\n")
}

fn render_checkpoint(cp: &Checkpoint, indent: &str, p: &Palette, out: &mut Vec<String>) {
    out.push(format!("{indent}  {}", p.header("CHANGES")));
    out.extend(indent_block(&cp.changes, &format!("{indent}    ")));
    out.push(format!("{indent}  {}", p.header("LEARNINGS")));
    out.extend(indent_block(&cp.learnings, &format!("{indent}    ")));
}

fn render_subtasks(subs: &[SubtaskSummary], indent: &str, p: &Palette) -> Vec<String> {
    let mut lines = Vec::new();
    for s in subs {
        lines.push(format!(
            "{indent}{}  {}  \"{}\"",
            p.id(&s.short_id),
            p.status(s.status.as_str()),
            s.name
        ));
        if let Some(Some(cp)) = &s.last_checkpoint {
            render_checkpoint(cp, indent, p, &mut lines);
        }
        if let Some(todos) = s.active_todos.as_ref().filter(|t| !t.is_empty()) {
            let ids: Vec<String> = todos.iter().map(|t| t.id.clone()).collect();
            for t in todos {
                lines.push(format!(
                    "{indent}  {} [{}] {}",
                    p.id(&short_id(&t.id, &ids)),
                    marker(t.status),
                    t.text
                ));
            }
        }
        if let Some(nested) = s.subtasks.as_ref().filter(|n| !n.is_empty()) {
            lines.push(format!(
                "{indent}  {} {}",
                p.header("subtasks:"),
                nested.len()
            ));
            lines.extend(render_subtasks(nested, &format!("{indent}  "), p));
        }
    }
    lines
}

/// `wl traces`
pub fn format_traces(o: &TracesOutput, p: &Palette) -> String {
    let mut lines = vec![
        format!("{} {}", p.header("task:"), p.id(&o.task)),
        format!("{} {}", p.header("desc:"), o.desc),
    ];
    lines.push(String::new());
    if o.entries.is_empty() {
        lines.push("no traces".into());
    } else {
        lines.push(format!("{} {}", p.header("traces:"), o.entries.len()));
        for e in &o.entries {
            let kind = e
                .kind
                .map(|k| format!("  {}", p.tag(k.as_str())))
                .unwrap_or_default();
            let id =
                e.id.as_ref()
                    .map(|i| format!("{}  ", p.id(i)))
                    .unwrap_or_default();
            lines.push(format!("  {id}{}{kind}: {}", p.timestamp(&e.ts), e.msg));
        }
    }
    lines.join("\n")
}

fn child_header(c: &Option<ChildWorklog>, p: &Palette) -> String {
    match c {
        Some(c) => format!(
            "{} · child of {}{}",
            p.tag(&format!("[{}]", c.scope)),
            c.child_of,
            c.warning
                .as_ref()
                .map(|w| format!(" ! {w}"))
                .unwrap_or_default()
        ),
        None => String::new(),
    }
}

fn instant_key(s: &str, clock: &dyn crate::time::Clock) -> Option<i64> {
    crate::time::parse_stored_date(s, clock)
}

/// Sorts newest first by creation time, stable, as `new Date(b) - new Date(a)`.
fn sort_newest_first(tasks: &mut [&ListTaskItem], clock: &dyn crate::time::Clock) {
    tasks.sort_by(|a, b| {
        let (ta, tb) = (
            instant_key(&a.created, clock),
            instant_key(&b.created, clock),
        );
        match (ta, tb) {
            (Some(x), Some(y)) => y.cmp(&x),
            // NaN comparisons are false: JS keeps the order.
            _ => std::cmp::Ordering::Equal,
        }
    });
}

/// `wl list`
pub fn format_list(
    o: &ListOutput,
    show_all: bool,
    p: &Palette,
    show_header: bool,
    clock: &dyn crate::time::Clock,
) -> String {
    let header = if show_header {
        child_header(&o.child_worklog, p)
    } else {
        String::new()
    };
    if o.tasks.is_empty() {
        let empty = if show_all {
            "no tasks"
        } else {
            "no active tasks"
        };
        return if header.is_empty() {
            empty.into()
        } else {
            format!("{header}\n{empty}")
        };
    }
    let subtasks_mode = o.tasks.iter().any(|t| t.parent.is_some());
    let mut sorted: Vec<&ListTaskItem> = o.tasks.iter().collect();
    sort_newest_first(&mut sorted, clock);
    let mut all_ids: Vec<String> = sorted.iter().map(|t| t.id.clone()).collect();
    for t in &sorted {
        for l in t.links.iter().flatten() {
            all_ids.push(l.task.clone());
        }
    }
    let render = |t: &ListTaskItem, extra: &str| -> String {
        let short = short_id(&t.id, &all_ids);
        let mut prefix = extra.to_string();
        if let Some(sp) = &t.scope_prefix
            && !sp.is_empty()
            && t.filter_pattern
                .as_ref()
                .is_none_or(|f| f.is_empty() || f != sp)
        {
            prefix.push_str(&format!("{}  ", p.tag(&format!("[{sp}]"))));
        }
        let mut tags: Vec<&String> = t.tags.iter().flatten().collect();
        if let Some(f) = t.filter_pattern.as_ref().filter(|f| !f.is_empty()) {
            tags.retain(|tag| {
                if *tag == f {
                    return false;
                }
                !f.starts_with(&format!("{tag}/"))
            });
        }
        let tags_str = if tags.is_empty() {
            String::new()
        } else {
            format!(
                "{}  ",
                tags.iter()
                    .map(|t| p.tag(&format!("#{t}")))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        };
        let links = format_task_links(t.links.as_deref().unwrap_or(&[]), &all_ids, p);
        let links_suffix = if links.is_empty() {
            String::new()
        } else {
            format!("  {links}")
        };
        format!(
            "{prefix}{tags_str}{}  {}  \"{}\"  {}{links_suffix}",
            p.id(&short),
            p.status(&t.status),
            t.name,
            p.timestamp(&t.created)
        )
    };
    let body = if subtasks_mode {
        let mut children: Vec<(String, Vec<&ListTaskItem>)> = Vec::new();
        let mut top: Vec<&ListTaskItem> = Vec::new();
        for t in &sorted {
            match t.parent.as_ref().filter(|p| !p.is_empty()) {
                Some(par) => match children.iter_mut().find(|(k, _)| k == par) {
                    Some(g) => g.1.push(t),
                    None => children.push((par.clone(), vec![t])),
                },
                None => top.push(t),
            }
        }
        let mut lines = Vec::new();
        for t in top {
            lines.push(render(t, ""));
            if let Some((_, kids)) = children.iter().find(|(k, _)| *k == t.id) {
                for c in kids {
                    lines.push(render(c, "  "));
                }
            }
        }
        lines.join("\n")
    } else {
        sorted
            .iter()
            .map(|t| render(t, ""))
            .collect::<Vec<_>>()
            .join("\n")
    };
    if header.is_empty() {
        body
    } else {
        format!("{header}\n{body}")
    }
}

/// `wl status` / `dash` / `dashboard`
pub fn format_dashboard(o: &DashboardOutput, p: &Palette) -> String {
    let header = child_header(&o.child_worklog, p);
    if o.tasks.is_empty() {
        return if header.is_empty() {
            "no active tasks".into()
        } else {
            format!("{header}\nno active tasks")
        };
    }
    fn collect<'a>(subs: &'a [DashboardSubtask], out: &mut Vec<&'a DashboardSubtask>) {
        for s in subs {
            out.push(s);
            collect(&s.subtasks, out);
        }
    }
    let mut all_subs: Vec<&DashboardSubtask> = Vec::new();
    for t in &o.tasks {
        collect(&t.subtasks, &mut all_subs);
    }
    let mut all_task_ids: Vec<String> = o.tasks.iter().map(|t| t.id.clone()).collect();
    all_task_ids.extend(all_subs.iter().map(|s| s.id.clone()));
    for t in &o.tasks {
        for l in t.links.iter().flatten() {
            all_task_ids.push(l.task.clone());
        }
    }
    for s in &all_subs {
        for l in s.links.iter().flatten() {
            all_task_ids.push(l.task.clone());
        }
    }
    let mut all_todo_ids: Vec<String> = o
        .tasks
        .iter()
        .flat_map(|t| t.todos.iter().map(|x| x.id.clone()))
        .collect();
    all_todo_ids.extend(
        all_subs
            .iter()
            .flat_map(|s| s.todos.iter().map(|x| x.id.clone())),
    );

    struct Line<'a> {
        id: &'a str,
        name: &'a str,
        status: &'a str,
        created: &'a str,
        scope_prefix: Option<&'a String>,
        tags: Option<&'a Vec<String>>,
        links: Option<&'a Vec<TaskLink>>,
    }
    let task_line = |t: Line, indent: &str| -> String {
        let mut prefix = indent.to_string();
        if let Some(sp) = t.scope_prefix.filter(|s| !s.is_empty()) {
            prefix.push_str(&format!("{}  ", p.tag(&format!("[{sp}]"))));
        }
        let tags_str = match t.tags.filter(|t| !t.is_empty()) {
            Some(tags) => format!(
                "{}  ",
                tags.iter()
                    .map(|x| p.tag(&format!("#{x}")))
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
            None => String::new(),
        };
        let links = format_task_links(
            t.links.map(|l| l.as_slice()).unwrap_or(&[]),
            &all_task_ids,
            p,
        );
        let suffix = if links.is_empty() {
            String::new()
        } else {
            format!("  {links}")
        };
        format!(
            "{prefix}{tags_str}{}  {}  \"{}\"  {}{suffix}",
            p.id(&short_id(t.id, &all_task_ids)),
            p.status(t.status),
            t.name,
            p.timestamp(t.created)
        )
    };
    let todo_line = |t: &Todo, indent: &str| -> String {
        format!(
            "{indent}{} [{}] {}",
            p.id(&short_id(&t.id, &all_todo_ids)),
            dashboard_marker(t.status),
            t.text
        )
    };
    fn push_subs(
        subs: &[DashboardSubtask],
        indent: &str,
        lines: &mut Vec<String>,
        task_line: &dyn Fn(Line, &str) -> String,
        todo_line: &dyn Fn(&Todo, &str) -> String,
    ) {
        for s in subs {
            lines.push(task_line(
                Line {
                    id: &s.id,
                    name: &s.name,
                    status: &s.status,
                    created: &s.created,
                    scope_prefix: s.scope_prefix.as_ref(),
                    tags: None,
                    links: s.links.as_ref(),
                },
                indent,
            ));
            for t in &s.todos {
                lines.push(todo_line(t, &format!("{indent}  ")));
            }
            push_subs(
                &s.subtasks,
                &format!("{indent}  "),
                lines,
                task_line,
                todo_line,
            );
        }
    }
    let mut lines: Vec<String> = Vec::new();
    for t in &o.tasks {
        lines.push(task_line(
            Line {
                id: &t.id,
                name: &t.name,
                status: &t.status,
                created: &t.created,
                scope_prefix: t.scope_prefix.as_ref(),
                tags: t.tags.as_ref(),
                links: t.links.as_ref(),
            },
            "",
        ));
        for todo in &t.todos {
            lines.push(todo_line(todo, "  "));
        }
        push_subs(&t.subtasks, "  ", &mut lines, &task_line, &todo_line);
    }
    let hidden = o.hidden_top_level_tasks.unwrap_or(0);
    if hidden > 0 {
        lines.push(format!("... {hidden} more active tasks"));
    }
    let body = lines.join("\n");
    if header.is_empty() {
        body
    } else {
        format!("{header}\n{body}")
    }
}

/// `wl scopes`
pub fn format_scopes(o: &ScopesOutput) -> String {
    if o.scopes.is_empty() {
        return "no scopes found".into();
    }
    let mut lines = vec!["Scopes:".to_string()];
    for s in &o.scopes {
        let active = if s.is_active { "  [active]" } else { "" };
        let pad = 15usize.saturating_sub(s.id.encode_utf16().count());
        lines.push(format!("  {}{} {}{active}", s.id, " ".repeat(pad), s.path));
    }
    lines.join("\n")
}

/// `wl scopes list <id>`
pub fn format_scope_detail(o: &ScopeDetail) -> String {
    format!("Scope: {}\nPath: {}\nTasks: {}", o.id, o.path, o.task_count)
}

fn error_lines(errors: &[TaskError], lines: &mut Vec<String>) {
    if !errors.is_empty() {
        lines.push("\nErrors:".into());
        for e in errors {
            lines.push(format!("  {}: {}", e.task_id, e.error));
        }
    }
}

/// `wl scopes assign`
pub fn format_assign(o: &AssignOutput) -> String {
    let mut lines = vec![
        format!("Assigned: {}", o.assigned),
        format!("Merged: {}", o.merged),
    ];
    error_lines(&o.errors, &mut lines);
    lines.join("\n")
}

/// `wl scopes assign --tag`
pub fn format_assign_by_tag(o: &AssignByTagOutput) -> String {
    let mut lines = vec![
        format!("Moved: {}", o.moved),
        format!("Updated in place: {}", o.updated),
    ];
    error_lines(&o.errors, &mut lines);
    lines.join("\n")
}

/// `wl summary`
pub fn format_summary(o: &SummaryOutput) -> String {
    if o.tasks.is_empty() {
        return "no tasks".into();
    }
    let mut parts = Vec::new();
    for t in &o.tasks {
        let mut lines = vec![format!("# {}: {} ({})", t.id, t.desc, t.status)];
        if !t.checkpoints.is_empty() {
            lines.push(String::new());
            lines.push("## Checkpoints".into());
            for cp in &t.checkpoints {
                lines.push(format!("### {}", cp.ts));
                lines.push("Changes:".into());
                lines.extend(indent_block(&cp.changes, "  "));
                lines.push("Learnings:".into());
                lines.extend(indent_block(&cp.learnings, "  "));
            }
        }
        if !t.entries.is_empty() {
            lines.push(String::new());
            lines.push("## Entries".into());
            for e in &t.entries {
                lines.push(format!("{}: {}", e.ts, e.msg));
            }
        }
        parts.push(lines.join("\n"));
    }
    parts.join("\n\n---\n\n")
}

/// `wl import`
pub fn format_import(o: &ImportOutput) -> String {
    let mut lines = vec![
        format!("imported: {}", o.imported),
        format!("merged: {}", o.merged),
        format!("skipped: {}", o.skipped),
    ];
    if !o.tasks.is_empty() {
        lines.push(String::new());
        for t in &o.tasks {
            let mut line = format!("{}: {}", t.id, t.status);
            if let Some(w) = t.warnings.as_ref().filter(|w| !w.is_empty()) {
                line.push_str(&format!(" ({})", w.join(", ")));
            }
            lines.push(line);
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TaskLink;

    struct UtcClock;
    impl crate::time::Clock for UtcClock {
        fn now_ms(&self) -> i64 {
            0
        }
        fn local_offset_minutes(&self, _: i64) -> i32 {
            0
        }
    }

    fn item(id: &str, name: &str, created: &str) -> ListTaskItem {
        ListTaskItem {
            id: id.into(),
            name: name.into(),
            desc: String::new(),
            desc_parts: vec![],
            status: "started".into(),
            created: created.into(),
            scope_prefix: None,
            tags: None,
            links: None,
            filter_pattern: None,
            source_worklog_path: None,
            parent: None,
        }
    }

    #[test]
    fn list_sorts_newest_first_and_hides_the_filter_tag() {
        let mut a = item("aaaaaaaaaa", "Old", "2020-01-01 10:00");
        a.tags = Some(vec!["foo".into(), "bar".into()]);
        a.filter_pattern = Some("foo".into());
        a.links = Some(vec![TaskLink {
            kind: crate::types::LinkType::Blocks,
            task: "bbbbbbbbbb".into(),
        }]);
        let b = item("bbbbbbbbbb", "New", "2021-01-01 10:00");
        let out = ListOutput {
            child_worklog: None,
            tasks: vec![a, b],
        };
        let text = format_list(&out, false, &Palette::new(false), true, &UtcClock);
        assert_eq!(
            text,
            "bbbbbb  started  \"New\"  2021-01-01 10:00\n#bar  aaaaaa  started  \"Old\"  2020-01-01 10:00  blk:bbbbbb"
        );
    }

    #[test]
    fn empty_list_messages() {
        let out = ListOutput::default();
        let p = Palette::new(false);
        assert_eq!(
            format_list(&out, false, &p, true, &UtcClock),
            "no active tasks"
        );
        assert_eq!(format_list(&out, true, &p, true, &UtcClock), "no tasks");
    }

    #[test]
    fn palette_wraps_in_24_bit_ansi_only_when_on() {
        assert_eq!(Palette::new(false).status("done"), "done");
        assert_eq!(
            Palette::new(true).status("done"),
            "\u{1b}[38;2;64;160;43mdone\u{1b}[39m"
        );
        assert_eq!(Palette::new(true).status("weird"), "weird");
    }

    #[test]
    fn scopes_and_meta_text() {
        let o = ScopesOutput {
            scopes: vec![ScopeLine {
                id: "api".into(),
                path: "services/api/.worklog/".into(),
                is_active: true,
            }],
        };
        assert_eq!(
            format_scopes(&o),
            "Scopes:\n  api             services/api/.worklog/  [active]"
        );
        assert_eq!(format_meta(&[]), "(no metadata)");
        assert_eq!(format_meta(&[("k".into(), "v".into())]), "k: v");
    }
}
