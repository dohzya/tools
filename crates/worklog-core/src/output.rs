//! Command results. Serialized as-is for `--json`, so field order is part of
//! the contract.

use crate::types::{Checkpoint, Entry, LinkType, TaskLink, TaskStatus, Todo};
use serde::Serialize;

/// `{ "status": "..." }`
#[derive(Debug, Clone, Serialize)]
pub struct StatusOutput {
    /// Machine status such as `task_ready`.
    pub status: String,
}

impl StatusOutput {
    /// Builds a status result.
    pub fn new(s: &str) -> Self {
        StatusOutput { status: s.into() }
    }
}

/// Result of `create`.
#[derive(Debug, Clone, Serialize)]
pub struct AddOutput {
    /// Short id.
    pub id: String,
}

/// Result of `trace`.
#[derive(Debug, Clone, Serialize)]
pub struct TraceOutput {
    /// `ok` or `checkpoint_recommended`.
    pub status: String,
    /// Count since the last checkpoint, when a checkpoint is recommended.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries_since_checkpoint: Option<usize>,
}

/// Result of `traces`.
#[derive(Debug, Clone, Serialize)]
pub struct TracesOutput {
    /// Full task id.
    pub task: String,
    /// Description, parts joined.
    pub desc: String,
    /// Description parts.
    pub desc_parts: Vec<String>,
    /// Entries.
    pub entries: Vec<Entry>,
}

/// Parent of a task, in `show`.
#[derive(Debug, Clone, Serialize)]
pub struct ParentRef {
    /// Full id.
    pub id: String,
    /// Short id.
    #[serde(rename = "shortId")]
    pub short_id: String,
    /// Name.
    pub name: String,
    /// Status.
    pub status: TaskStatus,
}

/// Linked task, in `show`.
#[derive(Debug, Clone, Serialize)]
pub struct LinkRef {
    /// Link type from this task.
    #[serde(rename = "type")]
    pub kind: LinkType,
    /// Full id.
    pub task: String,
    /// Short id.
    #[serde(rename = "shortId")]
    pub short_id: String,
    /// Name.
    pub name: String,
    /// Status.
    pub status: TaskStatus,
}

/// Subtask summary, in `show`.
#[derive(Debug, Clone, Serialize)]
pub struct SubtaskSummary {
    /// Full id.
    pub id: String,
    /// Short id.
    #[serde(rename = "shortId")]
    pub short_id: String,
    /// Name.
    pub name: String,
    /// Status.
    pub status: TaskStatus,
    /// Completion time (closed subtasks).
    #[serde(rename = "doneAt", skip_serializing_if = "Option::is_none")]
    pub done_at: Option<Option<String>>,
    /// Cancellation time (closed subtasks).
    #[serde(rename = "cancelledAt", skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<Option<String>>,
    /// Last checkpoint (closed subtasks).
    #[serde(rename = "lastCheckpoint", skip_serializing_if = "Option::is_none")]
    pub last_checkpoint: Option<Option<Checkpoint>>,
    /// Open todos (active subtasks).
    #[serde(rename = "activeTodos", skip_serializing_if = "Option::is_none")]
    pub active_todos: Option<Vec<Todo>>,
    /// Nested subtasks (active subtasks).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<Vec<SubtaskSummary>>,
}

/// Result of `show`.
#[derive(Debug, Clone, Serialize)]
pub struct ShowOutput {
    /// Short id.
    pub task: String,
    /// Full id.
    #[serde(rename = "fullId")]
    pub full_id: String,
    /// Name.
    pub name: String,
    /// Description, parts joined.
    pub desc: String,
    /// Description parts.
    pub desc_parts: Vec<String>,
    /// Status (as written, so unknown values survive).
    pub status: String,
    /// Creation time, short.
    pub created: String,
    /// Ready time, short.
    pub ready: Option<String>,
    /// Start time, short.
    pub started: Option<String>,
    /// Last checkpoint.
    pub last_checkpoint: Option<Checkpoint>,
    /// Entries after the last checkpoint.
    pub entries_since_checkpoint: Vec<Entry>,
    /// Todos.
    pub todos: Vec<Todo>,
    /// Effective tags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Parent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<ParentRef>,
    /// Links.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<LinkRef>>,
    /// Direct subtasks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<Vec<SubtaskSummary>>,
}

/// A task of the `list` output.
#[derive(Debug, Clone, Serialize)]
pub struct ListTaskItem {
    /// Full id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Description, parts joined.
    pub desc: String,
    /// Description parts.
    pub desc_parts: Vec<String>,
    /// Status (as written).
    pub status: String,
    /// Creation time, short.
    pub created: String,
    /// Scope the task comes from, in multi-scope listings.
    #[serde(rename = "scopePrefix", skip_serializing_if = "Option::is_none")]
    pub scope_prefix: Option<String>,
    /// Own tags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Links.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<TaskLink>>,
    /// Pattern the list was filtered with.
    #[serde(rename = "filterPattern", skip_serializing_if = "Option::is_none")]
    pub filter_pattern: Option<String>,
    /// Worklog the task lives in (dashboard only).
    #[serde(rename = "sourceWorklogPath", skip_serializing_if = "Option::is_none")]
    pub source_worklog_path: Option<String>,
    /// Parent id, in subtask modes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

/// Context of a child worklog.
#[derive(Debug, Clone, Serialize)]
pub struct ChildWorklog {
    /// Scope id.
    pub scope: String,
    /// Parent path as configured.
    #[serde(rename = "childOf")]
    pub child_of: String,
    /// Problem with the parent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Result of `list`.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ListOutput {
    /// Child worklog context.
    #[serde(rename = "childWorklog", skip_serializing_if = "Option::is_none")]
    pub child_worklog: Option<ChildWorklog>,
    /// Tasks.
    pub tasks: Vec<ListTaskItem>,
}

/// A subtask of the dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct DashboardSubtask {
    /// Full id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Description.
    pub desc: String,
    /// Description parts.
    pub desc_parts: Vec<String>,
    /// Status.
    pub status: String,
    /// Scope prefix.
    #[serde(rename = "scopePrefix", skip_serializing_if = "Option::is_none")]
    pub scope_prefix: Option<String>,
    /// Creation time.
    pub created: String,
    /// Links.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<TaskLink>>,
    /// Open todos.
    pub todos: Vec<Todo>,
    /// Nested subtasks.
    pub subtasks: Vec<DashboardSubtask>,
}

/// A top-level task of the dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct DashboardTask {
    /// Full id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Description.
    pub desc: String,
    /// Description parts.
    pub desc_parts: Vec<String>,
    /// Status.
    pub status: String,
    /// Scope prefix.
    #[serde(rename = "scopePrefix", skip_serializing_if = "Option::is_none")]
    pub scope_prefix: Option<String>,
    /// Creation time.
    pub created: String,
    /// Tags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Links.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<TaskLink>>,
    /// Open todos of a started task.
    pub todos: Vec<Todo>,
    /// Open subtasks of a started task.
    pub subtasks: Vec<DashboardSubtask>,
}

/// Result of `status` / `dash` / `dashboard`.
#[derive(Debug, Clone, Serialize)]
pub struct DashboardOutput {
    /// Child worklog context.
    #[serde(rename = "childWorklog", skip_serializing_if = "Option::is_none")]
    pub child_worklog: Option<ChildWorklog>,
    /// Applied limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    /// Top-level tasks hidden by the limit.
    #[serde(
        rename = "hiddenTopLevelTasks",
        skip_serializing_if = "Option::is_none"
    )]
    pub hidden_top_level_tasks: Option<usize>,
    /// Tasks.
    pub tasks: Vec<DashboardTask>,
}

/// A task of `summary`.
#[derive(Debug, Clone, Serialize)]
pub struct SummaryTask {
    /// Full id.
    pub id: String,
    /// Description.
    pub desc: String,
    /// Description parts.
    pub desc_parts: Vec<String>,
    /// Status.
    pub status: String,
    /// Checkpoints.
    pub checkpoints: Vec<Checkpoint>,
    /// Entries.
    pub entries: Vec<Entry>,
}

/// Result of `summary`.
#[derive(Debug, Clone, Serialize)]
pub struct SummaryOutput {
    /// Tasks.
    pub tasks: Vec<SummaryTask>,
}

/// Outcome of the import of one task.
#[derive(Debug, Clone, Serialize)]
pub struct ImportTaskResult {
    /// Full id.
    pub id: String,
    /// `imported`, `merged` or `skipped`.
    pub status: String,
    /// Warnings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

/// Result of `import`.
#[derive(Debug, Clone, Serialize)]
pub struct ImportOutput {
    /// New tasks.
    pub imported: usize,
    /// Merged tasks.
    pub merged: usize,
    /// Skipped tasks.
    pub skipped: usize,
    /// Per-task results.
    pub tasks: Vec<ImportTaskResult>,
    /// Tag added to imported tasks (`--scope-to-tag`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// Result of `todo add`.
#[derive(Debug, Clone, Serialize)]
pub struct TodoAddOutput {
    /// Todo id.
    pub id: String,
    /// Task id.
    #[serde(rename = "taskId")]
    pub task_id: String,
}

/// Result of `run` and of the agent launchers.
#[derive(Debug, Clone, Serialize)]
pub struct RunOutput {
    /// Task id.
    #[serde(rename = "taskId")]
    pub task_id: String,
    /// Exit code of the child.
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    /// Whether the task was created by the command.
    pub created: bool,
}

/// One scope of `scopes list`.
#[derive(Debug, Clone, Serialize)]
pub struct ScopeLine {
    /// Scope id.
    pub id: String,
    /// Path of its worklog.
    pub path: String,
    /// Whether it is the current scope.
    #[serde(rename = "isActive")]
    pub is_active: bool,
}

/// Result of `scopes list`.
#[derive(Debug, Clone, Serialize)]
pub struct ScopesOutput {
    /// Scopes.
    pub scopes: Vec<ScopeLine>,
}

/// Result of `scopes list <id>`.
#[derive(Debug, Clone, Serialize)]
pub struct ScopeDetail {
    /// Scope id as given.
    pub id: String,
    /// Path relative to the git root.
    pub path: String,
    /// Number of tasks.
    #[serde(rename = "taskCount")]
    pub task_count: usize,
}

/// An error of one task in a batch.
#[derive(Debug, Clone, Serialize)]
pub struct TaskError {
    /// Task as given.
    #[serde(rename = "taskId")]
    pub task_id: String,
    /// Message.
    pub error: String,
}

/// Result of `scopes assign`.
#[derive(Debug, Clone, Serialize)]
pub struct AssignOutput {
    /// Moved tasks.
    pub assigned: usize,
    /// Tasks merged into an existing copy.
    pub merged: usize,
    /// Failures.
    pub errors: Vec<TaskError>,
}

/// Result of `scopes assign --tag`.
#[derive(Debug, Clone, Serialize)]
pub struct AssignByTagOutput {
    /// Moved tasks.
    pub moved: usize,
    /// Tasks updated in place.
    pub updated: usize,
    /// Failures.
    pub errors: Vec<TaskError>,
}

/// Result of `scopes export`.
#[derive(Debug, Clone, Serialize)]
pub struct ExportOutput {
    /// Exported tasks.
    pub exported: usize,
    /// Scope id.
    #[serde(rename = "scopeId")]
    pub scope_id: String,
    /// Absolute target path.
    #[serde(rename = "targetPath")]
    pub target_path: String,
}

/// Result of `scopes sync-worktrees`.
#[derive(Debug, Clone, Serialize)]
pub struct SyncOutput {
    /// Added scopes.
    pub added: Vec<String>,
    /// Removed scopes.
    pub removed: Vec<String>,
    /// Warnings.
    pub warnings: Vec<String>,
}
