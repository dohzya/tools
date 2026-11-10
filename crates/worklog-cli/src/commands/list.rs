//! `list`, the dashboard, `summary` and the interactive task picker.

use crate::ctx::{Ctx, Res, fail};
use crate::path::{is_absolute, join, resolve};
use crate::resolve::resolve_across_scopes;
use crate::scope::{
    children_of, discover_scopes, entry_id, entry_path, is_child_worklog, load_scope_config,
    parent_scope_dir, scope_id,
};
use std::collections::HashMap;
use worklog_core::error::Code;
use worklog_core::index::{Index, IndexEntry, format_short, matches_tag_pattern, short_id};
use worklog_core::json::J;
use worklog_core::output::{
    ChildWorklog, DashboardOutput, DashboardSubtask, DashboardTask, ListOutput, ListTaskItem,
    SummaryOutput, SummaryTask,
};
use worklog_core::time;
use worklog_core::types::{LinkType, TaskStatus, Todo};

/// Options of `list`, already resolved.
#[derive(Default, Clone)]
pub struct ListOptions {
    /// Include every status.
    pub show_all: bool,
    /// Directory of a worklog to read (`--path`, or `--worklog-dir`).
    pub base_dir: Option<String>,
    /// `--scope`
    pub scope_identifier: Option<String>,
    /// `--all-scopes`
    pub all_scopes: bool,
    /// Git root.
    pub git_root: Option<String>,
    /// Worklog of the current scope.
    pub current_scope: Option<String>,
    /// Working directory.
    pub cwd: Option<String>,
    /// Status flags.
    pub status_filters: Option<Vec<TaskStatus>>,
    /// Tag or scope pattern.
    pub filter_pattern: Option<String>,
    /// `--subtasks`
    pub show_subtasks: bool,
    /// `--subtasks-of-started`
    pub show_subtasks_of_started: bool,
    /// Full id of the parent filter.
    pub parent_filter: Option<String>,
    /// Link filter: task and optional type.
    pub link_filter: Option<(String, Option<LinkType>)>,
    /// `--include-blocked`
    pub include_blocked: bool,
    /// Add `sourceWorklogPath` to items.
    pub include_source_path: bool,
}

type Tasks = Vec<(String, IndexEntry)>;

struct Filter<'a> {
    o: &'a ListOptions,
}

impl Filter<'_> {
    fn match_status(&self, status: Option<TaskStatus>) -> bool {
        if self.o.show_all {
            return true;
        }
        let allowed: &[TaskStatus] = match &self.o.status_filters {
            Some(f) => f,
            None => &[TaskStatus::Created, TaskStatus::Ready, TaskStatus::Started],
        };
        status.is_some_and(|s| allowed.contains(&s))
    }

    fn blocked(
        &self,
        t: &IndexEntry,
        tasks: &Tasks,
        related: Option<&HashMap<String, Option<TaskStatus>>>,
    ) -> bool {
        if t.status.is_some_and(TaskStatus::is_closed) {
            return false;
        }
        t.links.iter().any(|l| {
            if l.kind != LinkType::DependsOn {
                return false;
            }
            let st = tasks
                .iter()
                .find(|(id, _)| *id == l.task)
                .map(|(_, e)| e.status)
                .or_else(|| related.and_then(|r| r.get(&l.task).copied()));
            // A dependency that is not found counts as open.
            !st.flatten().is_some_and(TaskStatus::is_closed)
        })
    }

    fn include(
        &self,
        t: &IndexEntry,
        parent_status: Option<TaskStatus>,
        tasks: &Tasks,
        related: Option<&HashMap<String, Option<TaskStatus>>>,
    ) -> bool {
        let o = self.o;
        if let Some(p) = &o.parent_filter
            && t.parent.as_deref() != Some(p.as_str())
        {
            return false;
        }
        if let Some((target, ty)) = &o.link_filter
            && !t
                .links
                .iter()
                .any(|l| l.task == *target && ty.is_none_or(|ty| l.kind == ty))
        {
            return false;
        }
        if !o.include_blocked && o.link_filter.is_none() && self.blocked(t, tasks, related) {
            return false;
        }
        if o.parent_filter.is_some() {
            return t.parent == o.parent_filter;
        }
        if o.show_subtasks {
            return true;
        }
        if t.parent.is_none() {
            return true;
        }
        o.show_subtasks_of_started && parent_status == Some(TaskStatus::Started)
    }

    fn display_parent(&self) -> bool {
        self.o.show_subtasks || self.o.show_subtasks_of_started
    }
}

fn sorted(tasks: &Tasks) -> Tasks {
    let mut v = tasks.clone();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

fn item(id: &str, e: &IndexEntry, f: &Filter) -> ListTaskItem {
    ListTaskItem {
        id: id.to_string(),
        name: e.name.clone().unwrap_or_else(|| e.desc.join("\n\n---\n\n")),
        desc: e.desc.join("\n\n---\n\n"),
        desc_parts: e.desc.clone(),
        status: status_text(e),
        created: format_short(&e.created),
        scope_prefix: None,
        tags: if e.tags.is_empty() {
            None
        } else {
            Some(e.tags.clone())
        },
        links: if e.links.is_empty() {
            None
        } else {
            Some(e.links.clone())
        },
        filter_pattern: None,
        source_worklog_path: None,
        parent: if f.display_parent() {
            e.parent.clone()
        } else {
            None
        },
    }
}

fn status_text(e: &IndexEntry) -> String {
    e.status
        .map_or_else(String::new, |s| s.as_str().to_string())
}

fn parse_index_text(text: &str) -> Option<Index> {
    Index::parse(text, true).ok()
}

fn read_index_at(ctx: &Ctx, worklog_path: &str) -> Option<Index> {
    let text = ctx
        .ports
        .fs
        .read_to_string(&join(worklog_path, "index.json"))
        .ok()??;
    parse_index_text(&text)
}

fn list_from_index(index: &Index, f: &Filter, scope_prefix: Option<&str>) -> Vec<ListTaskItem> {
    let tasks = index.entries();
    sorted(&tasks)
        .into_iter()
        .filter(|(_, e)| f.match_status(e.status))
        .filter(|(_, e)| {
            f.include(
                e,
                e.parent
                    .as_ref()
                    .and_then(|p| index.entry(p))
                    .and_then(|p| p.status),
                &tasks,
                None,
            )
        })
        .map(|(id, e)| {
            let mut it = item(&id, &e, f);
            it.scope_prefix = scope_prefix.map(str::to_string);
            it
        })
        .collect()
}

/// `ListTasksUseCase`
pub fn list_tasks(ctx: &mut Ctx, o: &ListOptions) -> Res<ListOutput> {
    let f = Filter { o };
    if let (Some(pattern), Some(root), Some(_)) = (&o.filter_pattern, &o.git_root, &o.cwd)
        && !pattern.is_empty()
    {
        return filter_by_tag_or_scope(ctx, &f, pattern, root);
    }
    if o.all_scopes
        && let Some(root) = &o.git_root
    {
        let mut tasks = Vec::new();
        for s in discover_scopes(ctx, root, ctx.depth_limit, true) {
            let Some(index) = read_index_at(ctx, &s.absolute_path) else {
                continue;
            };
            let sid = scope_id(ctx, &s.absolute_path, root);
            tasks.extend(list_from_index(&index, &f, Some(&sid)));
        }
        return Ok(ListOutput {
            child_worklog: None,
            tasks,
        });
    }
    if let (Some(scope), Some(root), Some(cwd)) = (&o.scope_identifier, &o.git_root, &o.cwd)
        && !scope.is_empty()
    {
        let wl = resolve_scope_identifier_list(ctx, scope, root)?;
        let _ = cwd;
        let index_path = join(&wl, "index.json");
        let Ok(Some(text)) = ctx.ports.fs.read_to_string(&index_path) else {
            return fail(Code::NotInitialized, format!("Worklog not found at: {wl}"));
        };
        let index = parse_index_text(&text).ok_or_else(|| {
            crate::ctx::Fail::Wt(worklog_core::error::WtError::new(
                Code::IoError,
                "Failed to read index",
            ))
        })?;
        return Ok(ListOutput {
            child_worklog: None,
            tasks: list_from_index(&index, &f, None),
        });
    }
    if let (Some(root), Some(current)) = (&o.git_root, &o.current_scope) {
        return list_current_scope(ctx, &f, current, root);
    }
    let index = match &o.base_dir {
        Some(dir) => {
            let abs = resolve(&ctx.cwd, dir);
            let Ok(Some(text)) = ctx.ports.fs.read_to_string(&join(&abs, "index.json")) else {
                return fail(Code::NotInitialized, format!("Worklog not found at: {dir}"));
            };
            parse_index_text(&text).ok_or_else(|| {
                crate::ctx::Fail::Wt(worklog_core::error::WtError::new(
                    Code::IoError,
                    "Failed to read index",
                ))
            })?
        }
        None => ctx.load_index()?,
    };
    Ok(ListOutput {
        child_worklog: None,
        tasks: list_from_index(&index, &f, None),
    })
}

/// Scope lookup of the list use case: no `.` alias, ids must be unique.
pub fn resolve_scope_identifier_list(ctx: &Ctx, identifier: &str, git_root: &str) -> Res<String> {
    if identifier == "/" {
        return Ok(join(git_root, &ctx.wl_dir));
    }
    let scopes = discover_scopes(ctx, git_root, ctx.depth_limit, true);
    if let Some(s) = scopes.iter().find(|s| s.relative_path == identifier) {
        return Ok(s.absolute_path.clone());
    }
    if let Some(cfg) = load_scope_config(ctx, &join(git_root, &ctx.wl_dir)) {
        let matches: Vec<J> = children_of(&cfg)
            .into_iter()
            .filter(|c| entry_id(c) == identifier)
            .collect();
        if matches.len() == 1 {
            let p = entry_path(&matches[0]);
            return Ok(if is_absolute(&p) {
                format!("{p}/{}", ctx.wl_dir)
            } else {
                format!("{git_root}/{p}/{}", ctx.wl_dir)
            });
        }
    }
    fail(
        Code::ScopeNotFound,
        format!("Scope not found: {identifier}"),
    )
}

struct Tagged {
    id: String,
    task: IndexEntry,
    index_tasks: Tasks,
    parent_status: Option<TaskStatus>,
    scope_path: String,
}

fn find_by_tag(ctx: &Ctx, pattern: &str, root: &str) -> Vec<Tagged> {
    let mut out = Vec::new();
    for s in discover_scopes(ctx, root, ctx.depth_limit, true) {
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
        let tasks = index.entries();
        for (id, task) in &tasks {
            if task.tags.iter().any(|t| matches_tag_pattern(pattern, t)) {
                out.push(Tagged {
                    id: id.clone(),
                    task: task.clone(),
                    index_tasks: tasks.clone(),
                    parent_status: task
                        .parent
                        .as_ref()
                        .and_then(|p| index.entry(p))
                        .and_then(|p| p.status),
                    scope_path: s.absolute_path.clone(),
                });
            }
        }
    }
    out
}

/// Worklogs of the scopes designated by `pattern`: the scope with this path or
/// id, and the scopes whose entry in the root `scope.json` carries this tag.
fn scopes_for_pattern(ctx: &Ctx, pattern: &str, root: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Ok(wl) = resolve_scope_identifier_list(ctx, pattern, root) {
        out.push(wl);
    }
    if let Some(cfg) = load_scope_config(ctx, &join(root, &ctx.wl_dir)) {
        for child in children_of(&cfg) {
            let tagged = matches!(child.get("tags"), Some(J::Arr(ts))
                if ts.iter().filter_map(J::as_str).any(|t| matches_tag_pattern(pattern, t)));
            if tagged {
                let p = entry_path(&child);
                let wl = if is_absolute(&p) {
                    format!("{p}/{}", ctx.wl_dir)
                } else {
                    format!("{root}/{p}/{}", ctx.wl_dir)
                };
                if !out.contains(&wl) {
                    out.push(wl);
                }
            }
        }
    }
    out
}

/// `list <pattern>`: the tasks carrying the tag, plus the tasks of the scope
/// named or tagged by the pattern.
fn filter_by_tag_or_scope(ctx: &mut Ctx, f: &Filter, pattern: &str, root: &str) -> Res<ListOutput> {
    let tagged = find_by_tag(ctx, pattern, root);
    let scope_wls = scopes_for_pattern(ctx, pattern, root);
    let mut seen: Vec<(String, String)> = Vec::new();
    let mut tasks: Vec<ListTaskItem> = Vec::new();
    for t in &tagged {
        if f.match_status(t.task.status)
            && f.include(&t.task, t.parent_status, &t.index_tasks, None)
        {
            let mut it = item(&t.id, &t.task, f);
            it.filter_pattern = Some(pattern.to_string());
            seen.push((t.scope_path.clone(), t.id.clone()));
            tasks.push(it);
        }
    }
    let mut scope_found = false;
    for wl in &scope_wls {
        let Ok(Some(text)) = ctx.ports.fs.read_to_string(&join(wl, "index.json")) else {
            continue;
        };
        let Ok(index) = Index::parse(&text, false) else {
            continue;
        };
        scope_found = true;
        let all = index.entries();
        for (id, e) in sorted(&all) {
            let ps = e
                .parent
                .as_ref()
                .and_then(|p| index.entry(p))
                .and_then(|p| p.status);
            if f.match_status(e.status)
                && f.include(&e, ps, &all, None)
                && !seen.contains(&(wl.clone(), id.clone()))
            {
                let mut it = item(&id, &e, f);
                it.filter_pattern = Some(pattern.to_string());
                seen.push((wl.clone(), id));
                tasks.push(it);
            }
        }
    }
    if tagged.is_empty() && !scope_found {
        return fail(
            Code::TaskNotFound,
            format!("No tag or scope matching: {pattern}"),
        );
    }
    Ok(ListOutput {
        child_worklog: None,
        tasks,
    })
}

fn norm_trailing(p: &str) -> String {
    let mut n = p.to_string();
    while n.len() > 1 && n.ends_with('/') {
        n.pop();
    }
    n
}

fn child_scope_id(ctx: &Ctx, child_wl: &str, root: &str) -> String {
    if let Some(parent_dir) = parent_scope_dir(ctx, child_wl)
        && let Some(cfg) = load_scope_config(ctx, &join(&parent_dir, &ctx.wl_dir))
    {
        let child_dir = child_wl[..child_wl.len() - ctx.wl_dir.len() - 1].to_string();
        let nc = norm_trailing(&child_dir);
        for c in children_of(&cfg) {
            let p = entry_path(&c);
            let entry_dir = if is_absolute(&p) {
                p
            } else {
                crate::path::resolve_relative(&parent_dir, &p)
            };
            if norm_trailing(&entry_dir) == nc {
                return entry_id(&c);
            }
        }
    }
    scope_id(ctx, child_wl, root)
}

fn list_current_scope(ctx: &mut Ctx, f: &Filter, current: &str, root: &str) -> Res<ListOutput> {
    let o = f.o;
    let mut tasks: Vec<ListTaskItem> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut push = |t: ListTaskItem, tasks: &mut Vec<ListTaskItem>| {
        let key = format!("{}:{}", t.scope_prefix.as_deref().unwrap_or("."), t.id);
        if seen.contains(&key) {
            return;
        }
        seen.push(key);
        tasks.push(t);
    };
    let is_child = is_child_worklog(ctx, current);
    let current_id = if is_child {
        child_scope_id(ctx, current, root)
    } else {
        scope_id(ctx, current, root)
    };
    let child_ctx = if is_child && !current_id.is_empty() && current_id != "." {
        Some(child_worklog_context(ctx, current, &current_id))
    } else {
        None
    };
    let mut related: HashMap<String, Option<TaskStatus>> = HashMap::new();
    let mut parent_tasks: Tasks = Vec::new();
    let mut parent_dir: Option<String> = None;
    let mut parent_wl: Option<String> = None;
    if child_ctx.is_some()
        && let Some(pd) = parent_scope_dir(ctx, current)
    {
        let pw = join(&pd, &ctx.wl_dir);
        if let Some(pi) = read_index_at(ctx, &pw) {
            for (id, e) in pi.entries() {
                related.insert(id.clone(), e.status);
                parent_tasks.push((id, e));
            }
        }
        parent_dir = Some(pd);
        parent_wl = Some(pw);
    }
    if let Some(index) = read_index_at(ctx, current) {
        let all = index.entries();
        for (id, e) in &all {
            related.insert(id.clone(), e.status);
        }
        let visible: Tasks = all
            .iter()
            .filter(|(_, e)| f.match_status(e.status))
            .filter(|(_, e)| {
                let ps = e.parent.as_ref().and_then(|p| {
                    index
                        .entry(p)
                        .map(|x| x.status)
                        .or_else(|| related.get(p).copied())
                });
                f.include(e, ps.flatten(), &all, Some(&related))
            })
            .cloned()
            .collect();
        if is_child && f.display_parent() {
            for (_, e) in &visible {
                let Some(p) = &e.parent else { continue };
                let Some((_, pt)) = parent_tasks.iter().find(|(id, _)| id == p) else {
                    continue;
                };
                if !f.match_status(pt.status) {
                    continue;
                }
                let mut it = item(p, pt, f);
                it.parent = None;
                it.scope_prefix = Some("^".into());
                if o.include_source_path {
                    it.source_worklog_path = parent_wl.clone();
                }
                push(it, &mut tasks);
            }
        }
        for (id, e) in sorted(&visible) {
            let mut it = item(&id, &e, f);
            if o.include_source_path {
                it.source_worklog_path = Some(current.to_string());
            }
            push(it, &mut tasks);
        }
    }
    if child_ctx.is_some() {
        if parent_dir.is_none() {
            parent_dir = parent_scope_dir(ctx, current);
            parent_wl = parent_dir.as_ref().map(|d| join(d, &ctx.wl_dir));
        }
        if parent_dir.is_some() {
            let found = find_by_tag(ctx, &current_id, root);
            for t in found {
                let pw = parent_wl.clone().unwrap_or_default();
                if f.match_status(t.task.status)
                    && f.include(&t.task, None, &Vec::new(), Some(&related))
                    && t.scope_path == pw
                {
                    let mut it = item(&t.id, &t.task, f);
                    it.scope_prefix = Some("^".into());
                    if o.include_source_path {
                        it.source_worklog_path = Some(pw);
                    }
                    push(it, &mut tasks);
                }
            }
        }
    }
    if let Some(cfg) = load_scope_config(ctx, current) {
        for child in children_of(&cfg) {
            let p = entry_path(&child);
            let cwl = if is_absolute(&p) {
                format!("{p}/{}", ctx.wl_dir)
            } else {
                format!("{root}/{p}/{}", ctx.wl_dir)
            };
            if norm_trailing(&cwl) == norm_trailing(current) {
                continue;
            }
            let Some(index) = read_index_at(ctx, &cwl) else {
                continue;
            };
            let all = index.entries();
            for (id, e) in &all {
                related.insert(id.clone(), e.status);
            }
            let list: Tasks = all
                .iter()
                .filter(|(_, e)| f.match_status(e.status))
                .filter(|(_, e)| {
                    let ps = e.parent.as_ref().and_then(|p| {
                        index
                            .entry(p)
                            .map(|x| x.status)
                            .or_else(|| related.get(p).copied())
                    });
                    f.include(e, ps.flatten(), &all, Some(&related))
                })
                .cloned()
                .collect();
            for (id, e) in sorted(&list) {
                let mut it = item(&id, &e, f);
                it.scope_prefix = Some(entry_id(&child));
                if o.include_source_path {
                    it.source_worklog_path = Some(cwl.clone());
                }
                push(it, &mut tasks);
            }
        }
    }
    Ok(ListOutput {
        child_worklog: child_ctx,
        tasks,
    })
}

fn child_worklog_context(ctx: &Ctx, child_wl: &str, scope: &str) -> ChildWorklog {
    let child_of = load_scope_config(ctx, child_wl)
        .and_then(|c| c.get("parent").and_then(J::as_str).map(str::to_string))
        .unwrap_or_default();
    let child_of = norm_trailing(&child_of);
    let warning = match parent_scope_dir(ctx, child_wl) {
        None => Some("Invalid parent: unreadable scope config".to_string()),
        Some(pd) => {
            let pw = join(&pd, &ctx.wl_dir);
            let exists = ctx.ports.fs.exists(&pw)
                || ctx.ports.fs.exists(&join(&pw, "scope.json"))
                || ctx.ports.fs.exists(&join(&pw, "index.json"));
            if exists {
                None
            } else {
                Some("Invalid parent: missing .worklog".to_string())
            }
        }
    };
    ChildWorklog {
        scope: scope.to_string(),
        child_of,
        warning,
    }
}

// ---- dashboard -------------------------------------------------------

fn open_todos(ctx: &Ctx, t: &ListTaskItem) -> Res<Vec<Todo>> {
    let content = match &t.source_worklog_path {
        Some(wl) => {
            let p = join(wl, &format!("tasks/{}.md", t.id));
            if !ctx.ports.fs.exists(&p) {
                return fail(Code::TaskNotFound, format!("Task not found: {}", t.id));
            }
            ctx.read_text(&p)?
        }
        None => ctx.load_task_content(&t.id)?,
    };
    let task = worklog_core::taskfile::parse_task_file(&content).map_err(crate::ctx::Fail::Wt)?;
    Ok(task
        .todos
        .into_iter()
        .filter(|t| !t.status.is_closed())
        .collect())
}

fn newest_first(ctx: &Ctx, a: &ListTaskItem, b: &ListTaskItem) -> std::cmp::Ordering {
    let clock = ctx.ports.clock.as_ref();
    let (ta, tb) = (
        time::parse_stored_date(&a.created, clock),
        time::parse_stored_date(&b.created, clock),
    );
    match (ta, tb) {
        (Some(x), Some(y)) if x != y => y.cmp(&x),
        _ => a.id.cmp(&b.id),
    }
}

/// `buildDashboardOutput`
pub fn build_dashboard(
    ctx: &mut Ctx,
    list: ListOutput,
    limit: Option<usize>,
) -> Res<DashboardOutput> {
    let mut top: Vec<&ListTaskItem> = list.tasks.iter().filter(|t| t.parent.is_none()).collect();
    top.sort_by(|a, b| newest_first(ctx, a, b));
    let top_count = top.len();
    if let Some(l) = limit {
        top.truncate(l);
    }
    let hidden = if limit.is_none() {
        0
    } else {
        top_count.saturating_sub(top.len())
    };
    let mut by_parent: Vec<(String, Vec<&ListTaskItem>)> = Vec::new();
    for t in &list.tasks {
        let Some(p) = &t.parent else { continue };
        match by_parent.iter_mut().find(|(k, _)| k == p) {
            Some(g) => g.1.push(t),
            None => by_parent.push((p.clone(), vec![t])),
        }
    }
    fn subtasks(
        ctx: &Ctx,
        parent: &str,
        seen: &[String],
        by_parent: &[(String, Vec<&ListTaskItem>)],
    ) -> Res<Vec<DashboardSubtask>> {
        let mut out = Vec::new();
        let Some((_, kids)) = by_parent.iter().find(|(k, _)| k == parent) else {
            return Ok(out);
        };
        let mut kids = kids.clone();
        kids.sort_by(|a, b| newest_first(ctx, a, b));
        for s in kids {
            if seen.contains(&s.id) {
                continue;
            }
            let mut next = seen.to_vec();
            next.push(s.id.clone());
            out.push(DashboardSubtask {
                id: s.id.clone(),
                name: s.name.clone(),
                desc: s.desc.clone(),
                desc_parts: s.desc_parts.clone(),
                status: s.status.clone(),
                scope_prefix: s.scope_prefix.clone(),
                created: s.created.clone(),
                links: s.links.clone(),
                todos: open_todos(ctx, s)?,
                subtasks: subtasks(ctx, &s.id, &next, by_parent)?,
            });
        }
        Ok(out)
    }
    let mut tasks = Vec::new();
    for t in top {
        let expand = t.status == "started";
        let subs = if expand {
            subtasks(ctx, &t.id, std::slice::from_ref(&t.id), &by_parent)?
        } else {
            Vec::new()
        };
        tasks.push(DashboardTask {
            id: t.id.clone(),
            name: t.name.clone(),
            desc: t.desc.clone(),
            desc_parts: t.desc_parts.clone(),
            status: t.status.clone(),
            scope_prefix: t.scope_prefix.clone(),
            created: t.created.clone(),
            tags: t.tags.clone(),
            links: t.links.clone(),
            todos: if expand {
                open_todos(ctx, t)?
            } else {
                Vec::new()
            },
            subtasks: subs,
        });
    }
    Ok(DashboardOutput {
        child_worklog: list.child_worklog,
        limit,
        hidden_top_level_tasks: (hidden > 0).then_some(hidden),
        tasks,
    })
}

// ---- summary ---------------------------------------------------------

/// `GenerateSummaryUseCase`
pub fn summary(ctx: &mut Ctx, since: Option<&str>) -> Res<SummaryOutput> {
    ctx.purge()?;
    let index = ctx.load_index()?;
    let since = since.filter(|s| !s.is_empty());
    let clock = ctx.ports.clock.clone();
    let since_date: Option<Option<i64>> = since.map(|s| time::parse_stored_date(s, clock.as_ref()));
    let mut tasks = Vec::new();
    for (id, info) in index.entries() {
        let active = matches!(
            info.status,
            Some(TaskStatus::Created | TaskStatus::Ready | TaskStatus::Started)
        );
        let recent_done = match (&since_date, &info.done_at) {
            (Some(Some(s)), Some(d)) => {
                time::parse_stored_date(d, clock.as_ref()).is_some_and(|d| d >= *s)
            }
            _ => false,
        };
        if !(active || recent_done) {
            continue;
        }
        let Some(task) = ctx.find_task(&id)? else {
            continue;
        };
        let entries = match &since_date {
            Some(Some(s)) => task
                .entries
                .iter()
                .filter(|e| time::parse_stored_date(&e.ts, clock.as_ref()).is_some_and(|t| t >= *s))
                .cloned()
                .collect(),
            Some(None) => Vec::new(),
            None => task.entries.clone(),
        };
        tasks.push(SummaryTask {
            id,
            desc: info.desc.join("\n\n---\n\n"),
            desc_parts: info.desc.clone(),
            status: status_text(&info),
            checkpoints: task.checkpoints.clone(),
            entries,
        });
    }
    Ok(SummaryOutput { tasks })
}

// ---- interactive selection -------------------------------------------

/// Whether a task can be picked from a prompt: no id given, not in an agent
/// session, both ends on a terminal.
pub fn can_select_interactively(ctx: &Ctx, task_id: Option<&str>) -> bool {
    task_id.is_none()
        && ctx.env_task_id.is_none()
        && ctx.ports.env.stdin_is_terminal()
        && ctx.ports.env.stdout_is_terminal()
        && worklog_core::agent::detect_agent_type(&|n| ctx.ports.env.var(n)).is_none()
}

/// Lists the active tasks and asks which one.
pub fn select_task_interactively(ctx: &mut Ctx, git_root: Option<&str>) -> Res<String> {
    ctx.purge()?;
    let cwd = ctx.cwd.clone();
    let opts = ListOptions {
        git_root: git_root.map(str::to_string),
        cwd: Some(cwd),
        ..Default::default()
    };
    let list = list_tasks(ctx, &opts)?;
    let mut tasks: Vec<&ListTaskItem> = list.tasks.iter().collect();
    tasks.sort_by(|a, b| newest_first(ctx, a, b));
    if tasks.is_empty() {
        return fail(Code::TaskNotFound, "No active tasks to select");
    }
    let target = |t: &ListTaskItem| match &t.scope_prefix {
        Some(p) => format!("{p}:{}", t.id),
        None => t.id.clone(),
    };
    let targets: Vec<String> = tasks.iter().map(|t| target(t)).collect();
    let labels: Vec<String> = tasks
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let tags = if t.tags.as_ref().is_some_and(|t| !t.is_empty()) {
                format!(
                    " #{}",
                    t.tags.as_ref().map(|t| t.join(" #")).unwrap_or_default()
                )
            } else {
                String::new()
            };
            format!(
                "{} [{}] {}{tags}",
                short_id(&targets[i], &targets),
                t.status,
                t.name
            )
        })
        .collect();
    let Some(index) = ctx.ports.env.select("Select task", &labels) else {
        return fail(Code::InvalidArgs, "No task selected");
    };
    let chosen = targets[index].clone();
    resolve_across_scopes(ctx, &chosen, git_root)
}
