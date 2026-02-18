// Error types for worklog domain

export type WtErrorCode =
  | "not_initialized"
  | "already_initialized"
  | "already_has_parent"
  | "invalid_state"
  | "task_not_found"
  | "invalid_task_id"
  | "invalid_task_file"
  | "ambiguous_task_id"
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
    public readonly code: WtErrorCode,
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
