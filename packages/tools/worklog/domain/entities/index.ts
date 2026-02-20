// Index entity - the worklog index tracking all tasks

import type { TaskStatus } from "./task.ts";

/**
 * Immutable index entry for a single task in the worklog index.
 * Denormalized from task frontmatter for fast listing/filtering.
 */
export type IndexEntry = {
  readonly name: string; // Short name for display in list
  readonly desc: string;
  readonly status: TaskStatus;
  readonly created: string; // Task creation date (no _at suffix in index)
  readonly status_updated_at: string; // ISO 8601 - last status change
  readonly done_at?: string | null;
  readonly cancelled_at?: string | null;
  readonly tags?: readonly string[]; // Denormalized from task frontmatter for fast filtering
  readonly parent?: string; // Full parent task ID (if this is a subtask)
};

/**
 * Immutable worklog index.
 * Maps task IDs to their index entries.
 */
export type Index = {
  readonly version?: number; // Index format version (2 = current)
  readonly tasks: Readonly<Record<string, IndexEntry>>;
};
