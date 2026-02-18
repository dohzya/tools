// Todo entity - represents a todo item within a task

export type TodoStatus = "todo" | "wip" | "blocked" | "cancelled" | "done";

/**
 * Immutable todo entity.
 * A trackable action item attached to a task.
 */
export type Todo = {
  readonly id: string; // Unique 7-char base62 ID
  readonly text: string;
  readonly status: TodoStatus;
  readonly metadata: Readonly<Record<string, string>>;
};
