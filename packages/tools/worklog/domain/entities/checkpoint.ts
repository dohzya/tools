// Checkpoint entity - represents a progress checkpoint in a task

/**
 * Immutable checkpoint entity.
 * Records changes made and learnings acquired at a point in time.
 */
export type Checkpoint = {
  readonly ts: string; // Short format: "YYYY-MM-DD HH:mm"
  readonly changes: string;
  readonly learnings: string;
};
