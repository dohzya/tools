// Worktrack types

export type TaskStatus = "created" | "ready" | "started" | "done" | "cancelled";

export const TASK_STATUSES = [
  "created",
  "ready",
  "started",
  "done",
  "cancelled",
] as const;

export function isValidTaskStatus(value: string): value is TaskStatus {
  const statuses: readonly string[] = TASK_STATUSES;
  return statuses.includes(value);
}

export interface TaskMeta {
  id: string;
  uid: string; // UUID for cross-worktree identity
  name: string; // Short name for display in list
  desc: string;
  status: TaskStatus;
  created_at: string; // ISO 8601 (renamed from 'created')
  ready_at?: string | null; // ISO 8601 - when task became ready
  started_at?: string | null; // ISO 8601 - when task was started
  done_at?: string | null;
  cancelled_at?: string | null;
  last_checkpoint: string | null; // ISO 8601 timestamp
  has_uncheckpointed_entries: boolean;
  metadata?: Record<string, string>; // Custom attributes like commit_id, pr_url, etc.
  tags?: string[]; // User-defined hierarchical tags for flexible organization
  parent?: string | null; // Full parent task ID (if this is a subtask)
}

export interface IndexEntry {
  name: string; // Short name for display in list
  desc: string;
  status: TaskStatus;
  created: string; // Task creation date (no _at suffix in index)
  status_updated_at: string; // ISO 8601 - last status change
  done_at?: string | null;
  cancelled_at?: string | null;
  tags?: string[]; // Denormalized from task frontmatter for fast filtering
  parent?: string; // Full parent task ID (if this is a subtask)
}

export interface Index {
  version?: number; // Index format version (2 = current)
  tasks: Record<string, IndexEntry>;
}

export interface Entry {
  ts: string; // Short format: "YYYY-MM-DD HH:mm"
  msg: string;
}

export interface Checkpoint {
  ts: string; // Short format: "YYYY-MM-DD HH:mm"
  changes: string;
  learnings: string;
}

export type TodoStatus = "todo" | "wip" | "blocked" | "cancelled" | "done";

export interface Todo {
  id: string; // Unique 7-char base62 ID
  text: string;
  status: TodoStatus;
  metadata: Record<string, string>; // Custom attributes like dependsOn, due, etc.
}

export interface SubtaskSummary {
  id: string;
  shortId: string;
  name: string;
  status: TaskStatus;
  doneAt?: string | null;
  cancelledAt?: string | null;
  lastCheckpoint?: Checkpoint | null;
  activeTodos?: readonly Todo[];
  subtasks?: readonly SubtaskSummary[];
}

// Command outputs
export interface AddOutput {
  id: string;
}

export interface TraceOutput {
  status: "ok" | "checkpoint_recommended";
  entries_since_checkpoint?: number;
}

export interface TracesOutput {
  task: string;
  desc: string;
  entries: readonly Entry[];
}

export interface ShowOutput {
  task: string; // short ID
  fullId: string; // full ID
  name: string; // short name
  desc: string;
  status: TaskStatus;
  created: string; // formatted date (from created_at)
  ready: string | null; // formatted date (from ready_at)
  started: string | null; // formatted date (from started_at)
  last_checkpoint: Checkpoint | null;
  entries_since_checkpoint: readonly Entry[];
  todos: readonly Todo[];
  tags?: readonly string[]; // Effective tags (task + inherited worktree tags)
  parent?:
    | { id: string; shortId: string; name: string; status: TaskStatus }
    | null;
  subtasks?: readonly SubtaskSummary[];
}

export interface ListTaskItem {
  id: string;
  name: string;
  desc: string;
  status: TaskStatus;
  created: string;
  scopePrefix?: string;
  tags?: readonly string[];
  filterPattern?: string; // Pattern used for filtering (to hide from display)
  parent?: string; // Full parent task ID (set in --subtasks mode)
}

export interface ListOutput {
  tasks: readonly ListTaskItem[];
}

export interface SummaryTaskItem {
  id: string;
  desc: string;
  status: TaskStatus;
  checkpoints: readonly Checkpoint[];
  entries: readonly Entry[];
}

export interface SummaryOutput {
  tasks: readonly SummaryTaskItem[];
}

export interface StatusOutput {
  status: string;
}

export interface ImportTaskResult {
  id: string;
  status: "imported" | "merged" | "skipped";
  warnings?: readonly string[];
}

export interface ImportOutput {
  imported: number;
  merged: number;
  skipped: number;
  tasks: readonly ImportTaskResult[];
}

// Scope management (monorepo)
export type ScopeType = "path" | "worktree";

export interface ScopeEntry {
  path: string; // Relative to git root (or absolute for worktrees outside repo)
  id: string; // Display ID (defaults to path or git ref)
  type?: ScopeType; // "path" (default) or "worktree"
  gitRef?: string; // Git ref for worktree scopes (e.g., "feature/xyz")
  tags?: string[]; // Worktree-level tags inherited by all tasks in this scope
}

export interface ScopeConfigParent {
  children: ScopeEntry[];
}

export interface ScopeConfigChild {
  parent: string;
}

export type ScopeConfig = ScopeConfigParent | ScopeConfigChild;

export interface DiscoveredScope {
  absolutePath: string;
  relativePath: string;
  id: string;
  isParent: boolean;
}

export interface ScopesOutput {
  scopes: Array<{
    id: string;
    path: string;
    isActive: boolean;
  }>;
}

export interface MoveOutput {
  moved: number;
  target: string;
}

export interface ScopeDetailOutput {
  id: string;
  path: string;
  taskCount: number;
}

export interface AssignOutput {
  assigned: number;
  merged: number;
  errors: ReadonlyArray<{ taskId: string; error: string }>;
}

export interface TodoListOutput {
  todos: readonly Todo[];
}

export interface TodoAddOutput {
  id: string;
  taskId: string;
}

export interface RunOutput {
  taskId: string;
  exitCode: number;
  created?: boolean; // true if task was created with --create
}

// Error handling
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

export class WtError extends Error {
  constructor(
    public code: WtErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WtError";
  }

  toJSON(): { error: string; code: WtErrorCode; message: string } {
    return {
      error: this.code,
      code: this.code,
      message: this.message,
    };
  }
}
