// Worktrack types

export type TaskStatus = "active" | "done";

export interface TaskMeta {
  id: string;
  uid: string; // UUID for cross-worktree identity
  desc: string;
  status: TaskStatus;
  created: string; // ISO 8601
  done_at: string | null;
  last_checkpoint: string | null; // ISO 8601 timestamp
  has_uncheckpointed_entries: boolean;
}

export interface IndexEntry {
  desc: string;
  status: TaskStatus;
  created: string;
  done_at: string | null;
}

export interface Index {
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

// Command outputs
export interface AddOutput {
  id: string;
}

export interface TraceOutput {
  status: "ok" | "checkpoint_recommended";
  entries_since_checkpoint?: number;
}

export interface LogsOutput {
  task: string;
  desc: string;
  status: TaskStatus;
  last_checkpoint: Checkpoint | null;
  entries_since_checkpoint: Entry[];
}

export interface ListTaskItem {
  id: string;
  desc: string;
  status: TaskStatus;
  created: string;
  scopePrefix?: string;
}

export interface ListOutput {
  tasks: ListTaskItem[];
}

export interface SummaryTaskItem {
  id: string;
  desc: string;
  status: TaskStatus;
  checkpoints: Checkpoint[];
  entries: Entry[];
}

export interface SummaryOutput {
  tasks: SummaryTaskItem[];
}

export interface StatusOutput {
  status: string;
}

export interface ImportTaskResult {
  id: string;
  status: "imported" | "merged" | "skipped";
  warnings?: string[];
}

export interface ImportOutput {
  imported: number;
  merged: number;
  skipped: number;
  tasks: ImportTaskResult[];
}

// Scope management (monorepo)
export interface ScopeEntry {
  path: string; // Relative to git root
  id: string; // Display ID (defaults to path)
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
  errors: Array<{ taskId: string; error: string }>;
}

// Error handling
export type WtErrorCode =
  | "not_initialized"
  | "already_initialized"
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
  | "scope_renamed";

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
