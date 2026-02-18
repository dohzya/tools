// Task entity - core domain type for worklog tasks

export type TaskStatus =
  | "created"
  | "ready"
  | "started"
  | "done"
  | "cancelled";

export const TASK_STATUSES = [
  "created",
  "ready",
  "started",
  "done",
  "cancelled",
] as const;

export function isValidTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

/**
 * Immutable task entity representing a worklog task.
 */
export type Task = {
  readonly id: string;
  readonly uid: string; // UUID for cross-worktree identity
  readonly name: string; // Short name for display in list
  readonly desc: string;
  readonly status: TaskStatus;
  readonly createdAt: string; // ISO 8601
  readonly readyAt: string | null; // ISO 8601 - when task became ready
  readonly startedAt: string | null; // ISO 8601 - when task was started
  readonly doneAt: string | null;
  readonly cancelledAt: string | null;
  readonly lastCheckpoint: string | null; // ISO 8601 timestamp
  readonly hasUncheckpointedEntries: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly tags: readonly string[];
};

/**
 * TaskMeta matches the frontmatter format in task markdown files.
 * Uses snake_case to match YAML frontmatter field names.
 */
export type TaskMeta = {
  readonly id: string;
  readonly uid: string;
  readonly name: string;
  readonly desc: string;
  readonly status: TaskStatus;
  readonly created_at: string;
  readonly ready_at?: string | null;
  readonly started_at?: string | null;
  readonly done_at?: string | null;
  readonly cancelled_at?: string | null;
  readonly last_checkpoint: string | null;
  readonly has_uncheckpointed_entries: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
};

/**
 * Factory function to create a new Task with defaults.
 */
export function createTask(params: {
  readonly id: string;
  readonly uid: string;
  readonly name: string;
  readonly desc: string;
  readonly createdAt: string;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}): Task {
  return {
    id: params.id,
    uid: params.uid,
    name: params.name,
    desc: params.desc,
    status: "created",
    createdAt: params.createdAt,
    readyAt: null,
    startedAt: null,
    doneAt: null,
    cancelledAt: null,
    lastCheckpoint: null,
    hasUncheckpointedEntries: false,
    metadata: params.metadata ?? {},
    tags: params.tags ?? [],
  };
}

/**
 * Convert a TaskMeta (frontmatter format) to a Task (domain format).
 */
export function taskFromMeta(meta: TaskMeta): Task {
  return {
    id: meta.id,
    uid: meta.uid,
    name: meta.name,
    desc: meta.desc,
    status: meta.status,
    createdAt: meta.created_at,
    readyAt: meta.ready_at ?? null,
    startedAt: meta.started_at ?? null,
    doneAt: meta.done_at ?? null,
    cancelledAt: meta.cancelled_at ?? null,
    lastCheckpoint: meta.last_checkpoint,
    hasUncheckpointedEntries: meta.has_uncheckpointed_entries,
    metadata: meta.metadata ?? {},
    tags: meta.tags ?? [],
  };
}

/**
 * Convert a Task (domain format) to TaskMeta (frontmatter format).
 */
export function taskToMeta(task: Task): TaskMeta {
  return {
    id: task.id,
    uid: task.uid,
    name: task.name,
    desc: task.desc,
    status: task.status,
    created_at: task.createdAt,
    ready_at: task.readyAt,
    started_at: task.startedAt,
    done_at: task.doneAt,
    cancelled_at: task.cancelledAt,
    last_checkpoint: task.lastCheckpoint,
    has_uncheckpointed_entries: task.hasUncheckpointedEntries,
    metadata: task.metadata,
    tags: task.tags,
  };
}
