//! Command line definition. Names, options and defaults follow the TS CLI;
//! arguments the TS CLI declares as required are optional here and checked by
//! the handlers, because `WORKLOG_TASK_ID` makes them optional.

use clap::{Args, Parser, Subcommand};
use clap_complete::Shell;

/// Worklog - Track work progress with traces and checkpoints
#[derive(Debug, Parser)]
#[command(name = "worklog", version, disable_help_subcommand = true)]
pub struct Cli {
    /// Change to directory before doing anything
    #[arg(short = 'C', long = "cwd", value_name = "dir", global = true)]
    pub cwd: Option<String>,
    /// Path to .worklog directory (relative to -C if set)
    #[arg(long = "worklog-dir", value_name = "path", global = true)]
    pub worklog_dir: Option<String>,
    /// Days before done tasks are purged (default 30; overrides
    /// WORKLOG_PURGE_TTL_DAYS and config.json 'purgeTtlDays')
    #[arg(
        long = "purge-ttl",
        value_name = "days",
        global = true,
        allow_hyphen_values = true
    )]
    pub purge_ttl: Option<String>,
    /// What to do
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// Top-level commands.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Initialize worklog in current directory
    Init(JsonOnly),
    /// Create a new task with lifecycle states
    Create(CreateArgs),
    /// Mark task as ready to work on
    Ready(IdArgs),
    /// Start working on a task (or reopen a done/cancelled task)
    Start(StartArgs),
    /// Execute a command with WORKLOG_TASK_ID set in environment
    Run(RunArgs),
    /// Launch Claude with task context injected via system prompt
    Claude(AgentArgs),
    /// Launch Codex with task context injected via developer instructions
    Codex(AgentArgs),
    /// Auto-detect AI agent and launch with task context
    Agent(AgentArgs),
    /// Print AGENTS.md instructions for wl
    AgentInstructions(AgentInstructionsArgs),
    /// Update task name or description
    Update(UpdateArgs),
    /// Log a typed entry: action, info, state, hypothesis, finding, or learning
    Trace(TraceArgs),
    /// List all traces for a task
    Traces(TracesArgs),
    /// Show task context
    Show(ShowArgs),
    /// Create a self-contained synthesis of the task context
    Checkpoint(CheckpointArgs),
    /// Final self-contained synthesis: close the task
    Done(DoneArgs),
    /// Cancel/abandon a task (marks as cancelled)
    Cancel(CancelArgs),
    /// Get or set task metadata
    Meta(MetaArgs),
    /// Link two tasks without making either task a subtask
    Link(LinkArgs),
    /// Manage task tags
    Tags(TagsArgs),
    /// List tasks (optionally filter by tag or scope pattern)
    List(ListArgs),
    /// Show a compact dashboard of active work
    Status(DashArgs),
    /// Show a compact dashboard of active work
    Dash(DashArgs),
    /// Show a compact dashboard of active work
    Dashboard(DashArgs),
    /// Aggregate all tasks
    Summary(SummaryArgs),
    /// Import tasks from another worktree
    Import(ImportArgs),
    /// Todo management
    Todo(TodoArgs),
    /// Configure parent for current scope
    AddParent(AddParentArgs),
    /// Scope management
    Scopes(ScopesArgs),
    /// Generate shell completions
    Completions {
        /// Target shell
        shell: Shell,
    },
}

/// `--json` only.
#[derive(Debug, Args)]
pub struct JsonOnly {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// A task id and the usual options.
#[derive(Debug, Args)]
pub struct IdArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
}

/// `create`
#[derive(Debug, Args)]
pub struct CreateArgs {
    /// Task name
    pub name: String,
    /// Description
    pub desc: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Create task in 'ready' state
    #[arg(long)]
    pub ready: bool,
    /// Create task in 'started' state
    #[arg(long)]
    pub started: bool,
    /// Flexible timestamp (T11:15, 2024-12-15T11:15, etc.)
    #[arg(short = 't', long, value_name = "ts", allow_hyphen_values = true)]
    pub timestamp: Option<String>,
    /// Add a todo item (repeatable)
    #[arg(long, value_name = "text", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub todo: Vec<String>,
    /// Set metadata key=value (repeatable)
    #[arg(long, value_name = "kv", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub meta: Vec<String>,
    /// Add tag (repeatable)
    #[arg(long, value_name = "tag", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub tag: Vec<String>,
    /// Set parent task (creates a subtask)
    #[arg(long, value_name = "taskId")]
    pub parent: Option<String>,
    /// Link new task as depending on task
    #[arg(long = "depends-on", value_name = "taskId", action = clap::ArgAction::Append)]
    pub depends_on: Vec<String>,
    /// Link new task as blocking task
    #[arg(long, value_name = "taskId", action = clap::ArgAction::Append)]
    pub blocks: Vec<String>,
    /// Link new task as related to task
    #[arg(long, value_name = "taskId", action = clap::ArgAction::Append)]
    pub related: Vec<String>,
    /// Add a description part (repeatable)
    #[arg(long = "desc", value_name = "desc", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub desc_part: Vec<String>,
    /// Read description part from file path, or "-" for stdin (repeatable)
    #[arg(long = "desc-src", value_name = "source", action = clap::ArgAction::Append)]
    pub desc_src: Vec<String>,
    /// Read description from the system clipboard
    #[arg(short = 'P', long = "desc-from-clipboard")]
    pub desc_from_clipboard: bool,
    /// Launch Claude after creation with WORKLOG_TASK_ID set
    #[arg(long)]
    pub claude: bool,
    /// Launch Codex after creation with WORKLOG_TASK_ID set
    #[arg(long)]
    pub codex: bool,
    /// Auto-detect and launch AI agent after creation
    #[arg(long)]
    pub agent: bool,
    /// Arguments passed to the launched agent (after `--`)
    #[arg(last = true)]
    pub agent_args: Vec<String>,
}

/// `start`
#[derive(Debug, Args)]
pub struct StartArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Update task name
    #[arg(long, value_name = "name", allow_hyphen_values = true)]
    pub name: Option<String>,
    /// Replace description with part (repeatable)
    #[arg(long = "desc", value_name = "desc", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub desc: Vec<String>,
    /// Append a description part (repeatable)
    #[arg(long = "append-desc", value_name = "desc", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub append_desc: Vec<String>,
}

/// `run`
#[derive(Debug, Args)]
pub struct RunArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Create task on-the-fly with given name
    #[arg(long, value_name = "name")]
    pub create: Option<String>,
    /// [taskId] command...
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}

/// `claude`, `codex`, `agent`
#[derive(Debug, Args)]
pub struct AgentArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Advisor model to pass to Claude
    #[arg(long, value_name = "model")]
    pub advisor: Option<String>,
    /// [taskId] [agent args...]
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}

/// `agent-instructions`
#[derive(Debug, Args)]
pub struct AgentInstructionsArgs {
    /// Use mandatory wording for strict agent instructions
    #[arg(long)]
    pub mandatory: bool,
}

/// `update`
#[derive(Debug, Args)]
pub struct UpdateArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// New name for the task
    #[arg(long, value_name = "name", allow_hyphen_values = true)]
    pub name: Option<String>,
    /// Replace description with part (repeatable)
    #[arg(long = "desc", value_name = "desc", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub desc: Vec<String>,
    /// Replace description with part from file path, or "-" for stdin
    #[arg(long = "desc-src", value_name = "source", action = clap::ArgAction::Append)]
    pub desc_src: Vec<String>,
    /// Read description from the system clipboard
    #[arg(short = 'P', long = "desc-from-clipboard")]
    pub desc_from_clipboard: bool,
    /// Append a description part (repeatable)
    #[arg(long = "append-desc", value_name = "desc", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub append_desc: Vec<String>,
    /// Append a description part from file path, or "-" for stdin
    #[arg(long = "append-desc-src", value_name = "source", action = clap::ArgAction::Append)]
    pub append_desc_src: Vec<String>,
    /// Append a description part from the system clipboard
    #[arg(long = "append-desc-from-clipboard")]
    pub append_desc_from_clipboard: bool,
}

/// `trace`
#[derive(Debug, Args)]
pub struct TraceArgs {
    /// Task id (prefix), or the message when WORKLOG_TASK_ID is set
    pub task_id: Option<String>,
    /// Message
    #[arg(allow_hyphen_values = true)]
    pub message: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Flexible timestamp (T11:15, 2024-12-15T11:15, etc.)
    #[arg(short = 't', long, value_name = "ts", allow_hyphen_values = true)]
    pub timestamp: Option<String>,
    /// Trace kind (action, info, state, hypothesis, finding, learning)
    #[arg(short = 'k', long, value_name = "kind")]
    pub kind: Option<String>,
    /// Force trace on completed tasks
    #[arg(short = 'f', long)]
    pub force: bool,
}

/// `traces`
#[derive(Debug, Args)]
#[command(args_conflicts_with_subcommands = true)]
pub struct TracesArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Only include comma-separated trace kinds
    #[arg(long, value_name = "kinds")]
    pub kind: Option<String>,
    /// Exclude comma-separated trace kinds
    #[arg(long = "exclude-kind", value_name = "kinds")]
    pub exclude_kind: Option<String>,
    /// Subcommand
    #[command(subcommand)]
    pub command: Option<TracesCommand>,
}

/// `traces <command>`
#[derive(Debug, Subcommand)]
pub enum TracesCommand {
    /// Update an existing trace entry
    Update(TracesUpdateArgs),
}

/// `traces update`
#[derive(Debug, Args)]
pub struct TracesUpdateArgs {
    /// Task id (prefix), or the trace id when WORKLOG_TASK_ID is set
    pub task_id: Option<String>,
    /// Trace id
    pub trace_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Trace kind
    #[arg(short = 'k', long, value_name = "kind")]
    pub kind: Option<String>,
}

/// `show`
#[derive(Debug, Args)]
pub struct ShowArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Show only active todos (exclude done/cancelled)
    #[arg(long)]
    pub active: bool,
    /// Silently exit if no task ID (for hooks)
    #[arg(short = 'q', long)]
    pub quiet: bool,
}

/// `checkpoint`
#[derive(Debug, Args)]
pub struct CheckpointArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Changes
    #[arg(allow_hyphen_values = true)]
    pub changes: Option<String>,
    /// Learnings
    #[arg(allow_hyphen_values = true)]
    pub learnings: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Force checkpoint on completed tasks
    #[arg(short = 'f', long)]
    pub force: bool,
    /// Timestamp (currently ignored)
    #[arg(short = 't', long, value_name = "ts", allow_hyphen_values = true)]
    pub timestamp: Option<String>,
    /// Silently exit if no task ID (for hooks)
    #[arg(short = 'q', long)]
    pub quiet: bool,
    /// Let Claude synthesize the checkpoint
    #[arg(long)]
    pub claude: bool,
    /// Let Codex synthesize the checkpoint
    #[arg(long)]
    pub codex: bool,
    /// Auto-detect AI agent for synthesis
    #[arg(long)]
    pub agent: bool,
}

/// `done`
#[derive(Debug, Args)]
pub struct DoneArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Changes
    #[arg(allow_hyphen_values = true)]
    pub changes: Option<String>,
    /// Learnings
    #[arg(allow_hyphen_values = true)]
    pub learnings: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Force completion
    #[arg(short = 'f', long)]
    pub force: bool,
    /// Timestamp (currently ignored)
    #[arg(short = 't', long, value_name = "ts", allow_hyphen_values = true)]
    pub timestamp: Option<String>,
    /// Set metadata key=value (repeatable)
    #[arg(long, value_name = "kv", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub meta: Vec<String>,
    /// Let Claude synthesize the final checkpoint
    #[arg(long)]
    pub claude: bool,
    /// Let Codex synthesize the final checkpoint
    #[arg(long)]
    pub codex: bool,
    /// Auto-detect AI agent for final synthesis
    #[arg(long)]
    pub agent: bool,
}

/// `cancel`
#[derive(Debug, Args)]
pub struct CancelArgs {
    /// Task id (prefix), or the reason when WORKLOG_TASK_ID is set
    pub task_id: Option<String>,
    /// Reason
    #[arg(allow_hyphen_values = true)]
    pub reason: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
}

/// `meta`
#[derive(Debug, Args)]
pub struct MetaArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Key
    pub key: Option<String>,
    /// Value
    #[arg(allow_hyphen_values = true)]
    pub value: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Delete a metadata key
    #[arg(long, value_name = "key")]
    pub delete: Option<String>,
    /// Attach task under parent
    #[arg(long, value_name = "taskId")]
    pub parent: Option<String>,
    /// Detach task into a top-level task
    #[arg(long)]
    pub detach: bool,
    /// Allow reparenting a task that already has a parent
    #[arg(short = 'f', long)]
    pub force: bool,
}

/// `link`
#[derive(Debug, Args)]
pub struct LinkArgs {
    /// Source task
    pub source: String,
    /// depends-on, blocks or related
    pub link_type: String,
    /// Target task
    pub target: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
}

/// `tags`
#[derive(Debug, Args)]
#[command(args_conflicts_with_subcommands = true)]
pub struct TagsArgs {
    /// Task id (prefix)
    pub task_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Add tag (repeatable)
    #[arg(long, value_name = "tag", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub add: Vec<String>,
    /// Remove tag (repeatable)
    #[arg(long, value_name = "tag", action = clap::ArgAction::Append, allow_hyphen_values = true)]
    pub remove: Vec<String>,
    /// Subcommand
    #[command(subcommand)]
    pub command: Option<TagsCommand>,
}

/// `tags <command>`
#[derive(Debug, Subcommand)]
pub enum TagsCommand {
    /// Add a tag to a task
    Add(TagTaskArgs),
    /// Remove a tag from a task
    Remove(TagTaskArgs),
    /// Rename a tag across all tasks
    Rename(TagRenameArgs),
}

/// `tags add|remove <tag> <taskId>`
#[derive(Debug, Args)]
pub struct TagTaskArgs {
    /// Tag
    pub tag: String,
    /// Task id (prefix)
    pub task_id: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
}

/// `tags rename`
#[derive(Debug, Args)]
pub struct TagRenameArgs {
    /// Old tag
    pub old_tag: String,
    /// New tag
    pub new_tag: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// `list`
#[derive(Debug, Args)]
pub struct ListArgs {
    /// Tag or scope pattern
    pub pattern: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Include completed tasks
    #[arg(long)]
    pub all: bool,
    /// Show only created tasks
    #[arg(long)]
    pub created: bool,
    /// Show only ready tasks
    #[arg(long)]
    pub ready: bool,
    /// Show only started tasks
    #[arg(long)]
    pub started: bool,
    /// Show only done tasks
    #[arg(long)]
    pub done: bool,
    /// Show only cancelled tasks
    #[arg(long)]
    pub cancelled: bool,
    /// Path to .worklog directory
    #[arg(short = 'p', long, value_name = "path")]
    pub path: Option<String>,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
    /// Show all scopes
    #[arg(long = "all-scopes")]
    pub all_scopes: bool,
    /// Include subtasks (hidden by default)
    #[arg(long)]
    pub subtasks: bool,
    /// Include subtasks of started tasks
    #[arg(long = "subtasks-of-started")]
    pub subtasks_of_started: bool,
    /// Show only subtasks of this parent
    #[arg(long, value_name = "taskId")]
    pub parent: Option<String>,
    /// Show tasks depending on this task
    #[arg(long = "depends-on", value_name = "taskId")]
    pub depends_on: Option<String>,
    /// Show tasks blocking this task
    #[arg(long, value_name = "taskId")]
    pub blocks: Option<String>,
    /// Show tasks related to this task
    #[arg(long = "related-to", value_name = "taskId")]
    pub related_to: Option<String>,
    /// Show tasks linked to this task
    #[arg(long = "linked-to", value_name = "taskId")]
    pub linked_to: Option<String>,
    /// Include tasks blocked by open dependencies
    #[arg(long = "include-blocked")]
    pub include_blocked: bool,
    /// Hide contextual header lines
    #[arg(long = "no-header")]
    pub no_header: bool,
    /// Page text output with $PAGER
    #[arg(long)]
    pub pager: bool,
    /// Print text output directly
    #[arg(long = "no-pager")]
    pub no_pager: bool,
}

/// `status`, `dash`, `dashboard`
#[derive(Debug, Args)]
pub struct DashArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Limit top-level tasks before expansion
    #[arg(long, value_name = "n", allow_hyphen_values = true)]
    pub limit: Option<String>,
    /// Include tasks blocked by open dependencies
    #[arg(long = "include-blocked")]
    pub include_blocked: bool,
    /// Print nothing when there are no active tasks or no worklog
    #[arg(short = 'q', long)]
    pub quiet: bool,
}

/// `summary`
#[derive(Debug, Args)]
pub struct SummaryArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Filter by date (YYYY-MM-DD)
    #[arg(long, value_name = "date")]
    pub since: Option<String>,
}

/// `import`
#[derive(Debug, Args)]
pub struct ImportArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Path to source .worklog directory
    #[arg(short = 'p', long, value_name = "path")]
    pub path: Option<String>,
    /// Resolve worktree path from branch name
    #[arg(short = 'b', long, value_name = "branch")]
    pub branch: Option<String>,
    /// Remove imported tasks from source
    #[arg(long)]
    pub rm: bool,
    /// Convert source scope to tag
    #[arg(long = "scope-to-tag")]
    pub scope_to_tag: bool,
    /// Custom tag name (with --scope-to-tag)
    #[arg(long = "tag-name", value_name = "name")]
    pub tag_name: Option<String>,
    /// Succeed silently if source worktree or .worklog does not exist
    #[arg(long = "allow-missing")]
    pub allow_missing: bool,
}

/// `todo`
#[derive(Debug, Args)]
pub struct TodoArgs {
    /// Subcommand
    #[command(subcommand)]
    pub command: Option<TodoCommand>,
}

/// `todo <command>`
#[derive(Debug, Subcommand)]
pub enum TodoCommand {
    /// List todos (all active tasks or specific task)
    List(IdArgs),
    /// Add a todo to a task
    Add(TodoAddArgs),
    /// Update todo (e.g., status=done)
    Set(TodoSetArgs),
    /// Show next available todo
    Next(IdArgs),
}

/// `todo add`
#[derive(Debug, Args)]
pub struct TodoAddArgs {
    /// Task id (prefix)
    pub task_id: String,
    /// Todo text
    #[arg(required = true)]
    pub text: Vec<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
}

/// `todo set`
#[derive(Debug, Args)]
pub struct TodoSetArgs {
    /// `key=value ... <todo-id>`
    #[arg(required = true)]
    pub args: Vec<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Target specific scope
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,
}

/// `add-parent` and `scopes add-parent`
#[derive(Debug, Args)]
pub struct AddParentArgs {
    /// Path of the parent
    pub path: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Scope ID for this scope
    #[arg(long, value_name = "id")]
    pub id: Option<String>,
}

/// `scopes`
#[derive(Debug, Args)]
#[command(args_conflicts_with_subcommands = true)]
pub struct ScopesArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Force rescan of scopes
    #[arg(long)]
    pub refresh: bool,
    /// Subcommand
    #[command(subcommand)]
    pub command: Option<ScopesCommand>,
}

/// `scopes <command>`
#[derive(Debug, Subcommand)]
pub enum ScopesCommand {
    /// List all scopes or show scope details
    List(ScopesListArgs),
    /// Add scope (creates or links existing .worklog)
    Add(ScopesAddArgs),
    /// Configure parent for current scope
    AddParent(AddParentArgs),
    /// Rename scope ID
    Rename(ScopesRenameArgs),
    /// Delete scope
    Delete(ScopesDeleteArgs),
    /// Assign task(s) to scope, or assign tasks by tag with --tag
    Assign(ScopesAssignArgs),
    /// Export tasks with tag to new child worklog
    Export(ScopesExportArgs),
    /// Sync worktree scopes (add missing, remove stale)
    SyncWorktrees(SyncArgs),
}

/// `scopes list`
#[derive(Debug, Args)]
pub struct ScopesListArgs {
    /// Scope id
    pub scope_id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Force rescan of scopes
    #[arg(long)]
    pub refresh: bool,
}

/// `scopes add`
#[derive(Debug, Args)]
pub struct ScopesAddArgs {
    /// Scope id
    pub scope_id: String,
    /// Path
    pub path_arg: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Path to scope directory
    #[arg(short = 'p', long, value_name = "path")]
    pub path: Option<String>,
    /// Treat scope as git worktree
    #[arg(long)]
    pub worktree: bool,
    /// Git ref for worktree
    #[arg(long = "ref", value_name = "ref")]
    pub git_ref: Option<String>,
    /// Assign tasks tagged with scope ID to this scope after creation
    #[arg(long)]
    pub assign: bool,
}

/// `scopes rename`
#[derive(Debug, Args)]
pub struct ScopesRenameArgs {
    /// Scope id
    pub scope_id: String,
    /// New id
    pub new_id: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// `scopes delete`
#[derive(Debug, Args)]
pub struct ScopesDeleteArgs {
    /// Scope id
    pub scope_id: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Move tasks to another scope before delete
    #[arg(long = "move-to", value_name = "scope")]
    pub move_to: Option<String>,
    /// Force delete with tasks
    #[arg(long = "delete-tasks")]
    pub delete_tasks: bool,
}

/// `scopes assign`
#[derive(Debug, Args)]
pub struct ScopesAssignArgs {
    /// Scope id, then task ids
    pub args: Vec<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Assign tasks with this tag to scope (scope ID defaults to tag value)
    #[arg(long, value_name = "tag")]
    pub tag: Option<String>,
}

/// `scopes export`
#[derive(Debug, Args)]
pub struct ScopesExportArgs {
    /// Tag
    pub tag: String,
    /// Target path
    pub target_path: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Keep tag on exported tasks
    #[arg(long = "keep-tag")]
    pub keep_tag: bool,
    /// Custom scope ID (defaults to tag)
    #[arg(long = "scope-id", value_name = "id")]
    pub scope_id: Option<String>,
}

/// `scopes sync-worktrees`
#[derive(Debug, Args)]
pub struct SyncArgs {
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Preview changes without applying
    #[arg(long = "dry-run")]
    pub dry_run: bool,
}
