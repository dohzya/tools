// Worktrack types

export type TaskStatus = "active" | "done";

export interface TaskMeta {
  id: string;
  desc: string;
  status: TaskStatus;
  created: string; // ISO 8601
  done_at: string | null;
  last_checkpoint: string | null; // ISO 8601 timestamp
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

// Error handling
export type WtErrorCode =
  | "not_initialized"
  | "already_initialized"
  | "task_not_found"
  | "task_already_done"
  | "invalid_args"
  | "io_error";

export class WtError extends Error {
  constructor(
    public code: WtErrorCode,
    message: string
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
