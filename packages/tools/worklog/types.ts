/**
 * Worklog type definitions — task statuses, index structures, and command output shapes.
 *
 * @module
 */

import type { TraceKind } from "./domain/entities/entry.ts";
export type { TraceKind } from "./domain/entities/entry.ts";

/** Lifecycle status of a worklog task. */
export type TaskStatus = "created" | "ready" | "started" | "done" | "cancelled";

/** Ordered list of all valid task statuses. */
export const TASK_STATUSES = [
  "created",
  "ready",
  "started",
  "done",
  "cancelled",
] as const;

/** Type guard that checks whether a string is a valid TaskStatus. */
export function isValidTaskStatus(value: string): value is TaskStatus {
  const statuses: readonly string[] = TASK_STATUSES;
  return statuses.includes(value);
}

/** Supported non-hierarchical task link types. */
export type TaskLinkType = "depends_on" | "blocks" | "related";

/** A non-hierarchical relation to another task. */
export interface TaskLink {
  type: TaskLinkType;
  task: string;
}

/** Full metadata for a task, as stored in the task's Markdown frontmatter. */
export interface TaskMeta {
  /** Full task ID (25-char base36). */
  id: string;
  /** UUID for cross-worktree identity. */
  uid: string;
  /** Short name for display in list views. */
  name: string;
  /** Longer description of the task. */
  desc: string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 timestamp when task became ready. */
  ready_at?: string | null;
  /** ISO 8601 timestamp when task was started. */
  started_at?: string | null;
  /** ISO 8601 timestamp when task was completed. */
  done_at?: string | null;
  /** ISO 8601 timestamp when task was cancelled. */
  cancelled_at?: string | null;
  /** ISO 8601 timestamp of the last checkpoint, or null if none. */
  last_checkpoint: string | null;
  /** Whether there are trace entries recorded after the last checkpoint. */
  has_uncheckpointed_entries: boolean;
  /** Custom key-value attributes (e.g. commit_id, pr_url). */
  metadata?: Record<string, string>;
  /** User-defined hierarchical tags for flexible organization. */
  tags?: string[];
  /** Full parent task ID if this is a subtask. */
  parent?: string | null;
  /** Non-hierarchical links to other tasks. */
  links?: TaskLink[];
}

/** Denormalized task entry stored in the worklog index for fast listing. */
export interface IndexEntry {
  /** Short name for display in list views. */
  name: string;
  /** Task description. */
  desc: string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Task creation date (no _at suffix in index). */
  created: string;
  /** ISO 8601 timestamp of the last status change. */
  status_updated_at: string;
  /** ISO 8601 timestamp when task was completed. */
  done_at?: string | null;
  /** ISO 8601 timestamp when task was cancelled. */
  cancelled_at?: string | null;
  /** Denormalized from task frontmatter for fast tag-based filtering. */
  tags?: string[];
  /** Full parent task ID if this is a subtask. */
  parent?: string;
  /** Non-hierarchical links to other tasks. */
  links?: TaskLink[];
}

/** Top-level worklog index mapping task IDs to their index entries. */
export interface Index {
  /** Index format version (2 = current). */
  version?: number;
  /** Map from full task ID to its index entry. */
  tasks: Record<string, IndexEntry>;
}

/** A single trace entry recorded against a task. */
export interface Entry {
  /** Generated stable identifier for this trace within the task. */
  id?: string;
  /** Timestamp in short format: "YYYY-MM-DD HH:mm". */
  ts: string;
  /** Trace message content. */
  msg: string;
  /** Optional classification used to route synthesis and filter noisy traces. */
  kind?: TraceKind;
  /** Wall-clock time when trace was invoked (set only when ts differs from current time). */
  added_at?: string;
}

/** A checkpoint that consolidates recent trace entries. */
export interface Checkpoint {
  /** Timestamp in short format: "YYYY-MM-DD HH:mm". */
  ts: string;
  /** Summary of changes since the previous checkpoint. */
  changes: string;
  /** Learnings captured during the checkpoint. */
  learnings: string;
}

/** Lifecycle status of a todo item within a task. */
export type TodoStatus = "todo" | "wip" | "blocked" | "cancelled" | "done";

/** A todo item attached to a task. */
export interface Todo {
  /** Unique 7-char base62 identifier. */
  id: string;
  /** Human-readable todo description. */
  text: string;
  /** Current status of the todo item. */
  status: TodoStatus;
  /** Custom key-value attributes (e.g. dependsOn, due). */
  metadata: Record<string, string>;
}

/** Recursive summary of a subtask, used in the show command output. */
export interface SubtaskSummary {
  /** Full task ID. */
  id: string;
  /** Display-length prefix of the task ID. */
  shortId: string;
  /** Short display name. */
  name: string;
  /** Current lifecycle status. */
  status: TaskStatus;
  /** ISO 8601 timestamp when the subtask was completed. */
  doneAt?: string | null;
  /** ISO 8601 timestamp when the subtask was cancelled. */
  cancelledAt?: string | null;
  /** Most recent checkpoint of the subtask. */
  lastCheckpoint?: Checkpoint | null;
  /** Outstanding todo items for the subtask. */
  activeTodos?: readonly Todo[];
  /** Nested subtasks beneath this subtask. */
  subtasks?: readonly SubtaskSummary[];
}

// Command outputs

/** Output of the create (add) command. */
export interface AddOutput {
  /** Short display ID of the newly created task. */
  id: string;
}

/** Output of the trace command. */
export interface TraceOutput {
  /** Whether the trace succeeded or a checkpoint is recommended. */
  status: "ok" | "checkpoint_recommended";
  /** Number of trace entries since the last checkpoint. */
  entries_since_checkpoint?: number;
}

/** Output of the traces command (list all traces for a task). */
export interface TracesOutput {
  /** Short display ID of the task. */
  task: string;
  /** Task description. */
  desc: string;
  /** Structured task description parts. */
  desc_parts: readonly string[];
  /** All trace entries for the task. */
  entries: readonly Entry[];
}

/** Output of the show command (detailed task view). */
export interface ShowOutput {
  /** Short display ID. */
  task: string;
  /** Full task ID. */
  fullId: string;
  /** Short display name. */
  name: string;
  /** Task description. */
  desc: string;
  /** Structured task description parts. */
  desc_parts: readonly string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Formatted creation date (from created_at). */
  created: string;
  /** Formatted ready date (from ready_at). */
  ready: string | null;
  /** Formatted started date (from started_at). */
  started: string | null;
  /** Most recent checkpoint, if any. */
  last_checkpoint: Checkpoint | null;
  /** Trace entries recorded after the last checkpoint. */
  entries_since_checkpoint: readonly Entry[];
  /** Todo items attached to this task. */
  todos: readonly Todo[];
  /** Effective tags (task-level + inherited worktree tags). */
  tags?: readonly string[];
  /** Parent task reference, if this is a subtask. */
  parent?:
    | {
      /** Full parent task ID. */
      id: string;
      /** Display-length prefix of the parent ID. */
      shortId: string;
      /** Parent task name. */
      name: string;
      /** Parent task status. */
      status: TaskStatus;
    }
    | null;
  /** Non-hierarchical task links with display metadata. */
  links?: readonly {
    /** Link type relative to this task. */
    type: TaskLinkType;
    /** Full linked task ID. */
    task: string;
    /** Display-length prefix of the linked task ID. */
    shortId: string;
    /** Linked task name. */
    name: string;
    /** Linked task status. */
    status: TaskStatus;
  }[];
  /** Summaries of direct subtasks. */
  subtasks?: readonly SubtaskSummary[];
}

/** A single task in the list command output. */
export interface ListTaskItem {
  /** Full task ID. */
  id: string;
  /** Short display name. */
  name: string;
  /** Task description. */
  desc: string;
  /** Structured task description parts. */
  desc_parts: readonly string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Scope prefix prepended in multi-scope listings. */
  scopePrefix?: string;
  /** Formatted creation date. */
  created: string;
  /** Effective tags for the task. */
  tags?: readonly string[];
  /** Filter pattern used for matching (hidden from display). */
  filterPattern?: string;
  /** Full parent task ID (present in --subtasks mode). */
  parent?: string;
  /** Non-hierarchical links to other tasks. */
  links?: readonly TaskLink[];
  /** Source worklog path, requested only by commands that need task details. */
  sourceWorklogPath?: string;
}

/** Output of the list command. */
export interface ListOutput {
  /** Current worklog context when listing from a child worklog. */
  childWorklog?: {
    /** Display ID of the current child scope. */
    scope: string;
    /** Parent path from the child worklog's scope configuration. */
    childOf: string;
    /** Warning when the configured parent cannot be used. */
    warning?: string;
  };
  /** Ordered list of matching tasks. */
  tasks: readonly ListTaskItem[];
}

/** A subtask expanded in dashboard output. */
export interface DashboardSubtaskItem {
  /** Full task ID. */
  id: string;
  /** Short display name. */
  name: string;
  /** Task description. */
  desc: string;
  /** Structured task description parts. */
  desc_parts: readonly string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Scope prefix prepended for cross-scope subtasks. */
  scopePrefix?: string;
  /** Formatted creation date. */
  created: string;
  /** Non-hierarchical links to other tasks. */
  links?: readonly TaskLink[];
  /** Open todo items attached to the subtask. */
  todos: readonly Todo[];
  /** Open nested subtasks attached to this subtask. */
  subtasks: readonly DashboardSubtaskItem[];
}

/** A top-level task in dashboard output. */
export interface DashboardTaskItem {
  /** Full task ID. */
  id: string;
  /** Short display name. */
  name: string;
  /** Task description. */
  desc: string;
  /** Structured task description parts. */
  desc_parts: readonly string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Formatted creation date. */
  created: string;
  /** Effective tags for the task. */
  tags?: readonly string[];
  /** Non-hierarchical links to other tasks. */
  links?: readonly TaskLink[];
  /** Open todo items attached to a started task. */
  todos: readonly Todo[];
  /** Open subtasks attached to a started task. */
  subtasks: readonly DashboardSubtaskItem[];
}

/** Output of the dashboard command. */
export interface DashboardOutput {
  /** Current worklog context when dashboarding from a child worklog. */
  childWorklog?: {
    /** Display ID of the current child scope. */
    scope: string;
    /** Parent path from the child worklog's scope configuration. */
    childOf: string;
    /** Warning when the configured parent cannot be used. */
    warning?: string;
  };
  /** Number of open top-level tasks hidden by --limit. */
  hiddenTopLevelTasks?: number;
  /** Applied top-level task limit. */
  limit?: number;
  /** Ordered top-level tasks, optionally expanded with details. */
  tasks: readonly DashboardTaskItem[];
}

/** A task with its full history, used in summary output. */
export interface SummaryTaskItem {
  /** Full task ID. */
  id: string;
  /** Task description. */
  desc: string;
  /** Structured task description parts. */
  desc_parts: readonly string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** All checkpoints for the task. */
  checkpoints: readonly Checkpoint[];
  /** All trace entries for the task. */
  entries: readonly Entry[];
}

/** Output of the summary command. */
export interface SummaryOutput {
  /** Tasks included in the summary. */
  tasks: readonly SummaryTaskItem[];
}

/** Output of status-change commands (ready, start, done, cancel). */
export interface StatusOutput {
  /** Human-readable status confirmation message. */
  status: string;
}

/** Result for a single task during an import operation. */
export interface ImportTaskResult {
  /** Full ID of the imported task. */
  id: string;
  /** Outcome of the import for this task. */
  status: "imported" | "merged" | "skipped";
  /** Warnings encountered during import. */
  warnings?: readonly string[];
}

/** Output of the import command. */
export interface ImportOutput {
  /** Number of tasks newly imported. */
  imported: number;
  /** Number of tasks merged with existing ones. */
  merged: number;
  /** Number of tasks skipped (already up to date). */
  skipped: number;
  /** Per-task import results. */
  tasks: readonly ImportTaskResult[];
}

// Scope management (monorepo)

/** Type of scope: subdirectory path or git worktree. */
export type ScopeType = "path" | "worktree";

/** Configuration entry for a single scope in a monorepo setup. */
export interface ScopeEntry {
  /** Relative path from git root (or absolute for external worktrees). */
  path: string;
  /** Display ID (defaults to path or git ref). */
  id: string;
  /** Scope kind: "path" (default) or "worktree". */
  type?: ScopeType;
  /** Git ref for worktree scopes (e.g. "feature/xyz"). */
  gitRef?: string;
  /** Worktree-level tags inherited by all tasks in this scope. */
  tags?: string[];
}

/** Scope configuration for a parent worklog that manages child scopes. */
export interface ScopeConfigParent {
  /** Child scopes managed by this parent. */
  children: ScopeEntry[];
}

/** Scope configuration for a child worklog that references its parent. */
export interface ScopeConfigChild {
  /** Relative path to the parent worklog directory. */
  parent: string;
}

/** Scope configuration: either a parent with children or a child with a parent reference. */
export type ScopeConfig = ScopeConfigParent | ScopeConfigChild;

/** A scope discovered at runtime by scanning the filesystem. */
export interface DiscoveredScope {
  /** Absolute filesystem path to the scope. */
  absolutePath: string;
  /** Path relative to the git root. */
  relativePath: string;
  /** Display ID for the scope. */
  id: string;
  /** Whether this scope is the parent (vs a child). */
  isParent: boolean;
}

/** Output of the scopes list command. */
export interface ScopesOutput {
  /** All known scopes with their active state. */
  scopes: Array<{
    /** Display ID for the scope. */
    id: string;
    /** Filesystem path of the scope. */
    path: string;
    /** Whether this scope is the currently active one. */
    isActive: boolean;
  }>;
}

/** Output of the move command (move tasks between scopes). */
export interface MoveOutput {
  /** Number of tasks moved. */
  moved: number;
  /** Target scope ID. */
  target: string;
}

/** Detailed information about a single scope. */
export interface ScopeDetailOutput {
  /** Display ID for the scope. */
  id: string;
  /** Filesystem path of the scope. */
  path: string;
  /** Number of tasks in this scope. */
  taskCount: number;
}

/** Output of the assign command (assign tasks to scopes). */
export interface AssignOutput {
  /** Number of tasks successfully assigned. */
  assigned: number;
  /** Number of tasks merged during assignment. */
  merged: number;
  /** Tasks that failed to be assigned. */
  errors: ReadonlyArray<{
    /** ID of the task that failed. */
    taskId: string;
    /** Reason for the failure. */
    error: string;
  }>;
}

/** Output of the assign-by-tag command. */
export interface AssignByTagOutput {
  /** Number of tasks moved to a new scope. */
  moved: number;
  /** Number of tasks updated in place. */
  updated: number;
  /** Tasks that failed during the operation. */
  errors: ReadonlyArray<{
    /** ID of the task that failed. */
    taskId: string;
    /** Reason for the failure. */
    error: string;
  }>;
}

/** Output of the todo list command. */
export interface TodoListOutput {
  /** All todo items for the task. */
  todos: readonly Todo[];
}

/** Output of the todo add command. */
export interface TodoAddOutput {
  /** ID of the newly created todo item. */
  id: string;
  /** ID of the task the todo was added to. */
  taskId: string;
}

/** Output of the run command (execute a command with task context). */
export interface RunOutput {
  /** ID of the task the command ran under. */
  taskId: string;
  /** Exit code of the executed command. */
  exitCode: number;
  /** Whether the task was created by the --create flag. */
  created?: boolean;
}

// Error handling

/** Machine-readable error code for worklog operations. */
export type WtErrorCode =
  | "not_initialized"
  | "already_initialized"
  | "already_has_parent"
  | "invalid_state"
  | "task_not_found"
  | "task_already_done"
  | "no_uncheckpointed_entries"
  | "invalid_args"
  | "io_error"
  | "worktree_not_found"
  | "import_source_not_found"
  | "not_in_git_repo"
  | "scope_not_found"
  | "scope_ambiguous"
  | "scope_has_tasks"
  | "scope_deleted"
  | "scope_created"
  | "scope_renamed"
  | "todo_not_found"
  | "task_has_pending_todos";

/** Structured error with a machine-readable code for worklog operations. */
export class WtError extends Error {
  /** Create a WtError with a specific error code and human-readable message. */
  constructor(
    /** Machine-readable error code. */
    public code: WtErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WtError";
  }

  /** Serialize the error to a JSON-friendly object. */
  toJSON(): { error: string; code: WtErrorCode; message: string } {
    return {
      error: this.code,
      code: this.code,
      message: this.message,
    };
  }
}
