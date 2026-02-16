// Task repository port - persistence interface for tasks

import type { Checkpoint } from "../entities/checkpoint.ts";
import type { Entry } from "../entities/entry.ts";
import type { TaskMeta } from "../entities/task.ts";
import type { Todo } from "../entities/todo.ts";

/**
 * Parsed data from a task markdown file.
 */
export type TaskFileData = {
  readonly meta: TaskMeta;
  readonly entries: readonly Entry[];
  readonly checkpoints: readonly Checkpoint[];
  readonly todos: readonly Todo[];
};

/**
 * Repository for persisting and retrieving task files.
 */
export interface TaskRepository {
  /** Load and parse a task file by ID. Returns null if not found. */
  findById(taskId: string): Promise<TaskFileData | null>;

  /** Save a complete task file (meta + entries + checkpoints + todos). */
  save(
    taskId: string,
    meta: TaskMeta,
    entries: readonly Entry[],
    checkpoints: readonly Checkpoint[],
    todos: readonly Todo[],
  ): Promise<void>;

  /** Delete a task file. */
  delete(taskId: string): Promise<void>;

  /** Check if a task file exists. */
  exists(taskId: string): Promise<boolean>;

  /** Get the filesystem path for a task file. */
  getTaskFilePath(taskId: string): string;

  /** Load raw task file content by ID. */
  loadContent(taskId: string): Promise<string>;

  /** Save raw task file content by ID. */
  saveContent(taskId: string, content: string): Promise<void>;
}
