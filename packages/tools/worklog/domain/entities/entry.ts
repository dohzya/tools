// Entry entity - represents a trace/log entry in a task

export const TRACE_KINDS = [
  "action",
  "info",
  "state",
  "hypothesis",
  "finding",
  "learning",
] as const;

export type TraceKind = typeof TRACE_KINDS[number];

export function isTraceKind(value: string): value is TraceKind {
  const kinds: readonly string[] = TRACE_KINDS;
  return kinds.includes(value);
}

/**
 * Immutable entry entity.
 * A timestamped message recording work progress.
 */
export type Entry = {
  readonly id?: string;
  readonly ts: string; // Short format: "YYYY-MM-DD HH:mm"
  readonly msg: string;
  readonly kind?: TraceKind;
  readonly added_at?: string; // Wall-clock time when trace was invoked (set only when ts differs)
};
