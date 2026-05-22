// Entry entity - represents a trace/log entry in a task

/**
 * Immutable entry entity.
 * A timestamped message recording work progress.
 */
export type Entry = {
  readonly ts: string; // Short format: "YYYY-MM-DD HH:mm"
  readonly msg: string;
  readonly added_at?: string; // Wall-clock time when trace was invoked (set only when ts differs)
};
