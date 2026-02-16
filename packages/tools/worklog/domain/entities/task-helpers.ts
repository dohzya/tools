// Task helper functions - pure domain logic for task operations

import type { Task, TaskStatus } from "./task.ts";
import type { Index } from "./index.ts";

/**
 * Valid status transitions map.
 * Key: current status, Value: set of allowed target statuses.
 *
 * Transitions derived from cli.ts behavior:
 * - created -> ready, started, done, cancelled
 * - ready -> created, started, done, cancelled
 * - started -> ready, done, cancelled
 * - done -> started (reopen)
 * - cancelled -> (none - terminal state)
 */
const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  created: new Set(["ready", "started", "done", "cancelled"]),
  ready: new Set(["created", "started", "done", "cancelled"]),
  started: new Set(["ready", "done", "cancelled"]),
  done: new Set(["started"]),
  cancelled: new Set([]),
};

/**
 * Check if a status transition is valid.
 */
export function canChangeStatus(
  task: Task,
  newStatus: TaskStatus,
): boolean {
  return VALID_TRANSITIONS[task.status].has(newStatus);
}

/**
 * Create a new Task with the given status transition applied (immutable update).
 * Does NOT validate the transition - caller should use canChangeStatus() first.
 *
 * @param task - Current task state
 * @param newStatus - Target status
 * @param timestamp - ISO 8601 timestamp for the transition
 * @returns A new Task with updated status and timestamp fields
 */
export function transitionToStatus(
  task: Task,
  newStatus: TaskStatus,
  timestamp: string,
): Task {
  const base = { ...task };

  switch (newStatus) {
    case "ready":
      return { ...base, status: "ready", readyAt: timestamp };
    case "started":
      return {
        ...base,
        status: "started",
        startedAt: timestamp,
        // Clear doneAt if reopening from done
        doneAt: task.status === "done" ? null : task.doneAt,
      };
    case "done":
      return { ...base, status: "done", doneAt: timestamp };
    case "cancelled":
      return { ...base, status: "cancelled", cancelledAt: timestamp };
    case "created":
      return { ...base, status: "created" };
  }
}

/**
 * Convert a UUID to a base36 task ID (25 characters).
 */
function uuidToBase36(uuid: string): string {
  // Remove hyphens and convert to BigInt
  const hex = uuid.replace(/-/g, "");
  const bigInt = BigInt("0x" + hex);

  // Convert to base36
  const base36Chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  let n = bigInt;

  while (n > 0n) {
    result = base36Chars[Number(n % 36n)] + result;
    n = n / 36n;
  }

  // Pad to ensure consistent length (25 chars for 128-bit UUID)
  return result.padStart(25, "0");
}

/**
 * Generate a new task ID using a UUID converted to base36.
 * Returns a 25-character base36 string.
 */
export function generateTaskIdBase62(uid?: string): string {
  const uuid = uid ?? crypto.randomUUID();
  return uuidToBase36(uuid);
}

/**
 * Get the shortest unambiguous prefix for a task ID.
 * Minimum 5 characters, plus 1 character margin for safety.
 */
export function getShortId(index: Index, taskId: string): string {
  const allIds = Object.keys(index.tasks);
  const minLen = 5;
  let len = minLen;

  while (len < taskId.length) {
    const prefix = taskId.slice(0, len);
    const conflicts = allIds.filter(
      (other) =>
        other !== taskId &&
        other.toLowerCase().startsWith(prefix.toLowerCase()),
    );

    if (conflicts.length === 0) {
      // Add 1 char margin, but don't exceed id length
      return taskId.slice(0, Math.min(len + 1, taskId.length));
    }
    len++;
  }

  return taskId;
}

/**
 * Resolve an ID prefix to a full task ID.
 * Throws if no match or ambiguous.
 */
export function resolveIdPrefix(
  prefix: string,
  allIds: readonly string[],
): string {
  const matches = allIds.filter((id) =>
    id.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (matches.length === 0) {
    throw new Error(`No ID found matching prefix: ${prefix}`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous ID prefix '${prefix}' matches ${matches.length} IDs: ${
        matches.slice(0, 5).join(", ")
      }${matches.length > 5 ? "..." : ""}`,
    );
  }

  return matches[0];
}

/**
 * Generate a random 7-char base62 ID for todos.
 */
export function generateTodoId(): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < 7; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Validate a tag according to worklog conventions.
 *
 * Rules:
 * - No whitespace
 * - Allowed: a-z A-Z 0-9 / - _
 * - Cannot start/end with /
 * - Cannot contain //
 * - Max 100 chars
 *
 * @returns Error message if invalid, null if valid.
 */
export function validateTag(tag: string): string | null {
  if (!tag || tag.length === 0) return "Tag cannot be empty";
  if (tag.length > 100) return "Tag too long (max 100 characters)";
  if (/\s/.test(tag)) return "Tag cannot contain whitespace";
  if (tag.startsWith("/") || tag.endsWith("/")) {
    return "Tag cannot start or end with /";
  }
  if (tag.includes("//")) return "Tag cannot contain consecutive slashes";
  if (!/^[a-zA-Z0-9/_-]+$/.test(tag)) {
    return "Tag contains invalid characters (allowed: a-z A-Z 0-9 / - _)";
  }
  return null;
}

/**
 * Check if a tag matches a search pattern hierarchically.
 *
 * Examples:
 *   matchesTagPattern("feat", "feat/auth") -> true
 *   matchesTagPattern("feat", "feat") -> true
 *   matchesTagPattern("feat", "feature") -> false
 *   matchesTagPattern("feat/auth", "feat") -> false
 */
export function matchesTagPattern(pattern: string, tag: string): boolean {
  if (pattern === tag) return true;
  return tag.startsWith(pattern + "/");
}
