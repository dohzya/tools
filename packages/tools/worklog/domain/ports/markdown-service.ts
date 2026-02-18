// Markdown service port - interface for task file parsing and serialization

import type { Checkpoint } from "../entities/checkpoint.ts";
import type { Entry } from "../entities/entry.ts";
import type { TaskMeta } from "../entities/task.ts";
import type { Todo } from "../entities/todo.ts";

/**
 * Parsed data from a task markdown file.
 */
export type ParsedTaskFile = {
  readonly meta: TaskMeta;
  readonly entries: readonly Entry[];
  readonly checkpoints: readonly Checkpoint[];
  readonly todos: readonly Todo[];
};

/**
 * Service for parsing and serializing task markdown files.
 */
export interface MarkdownService {
  /** Parse a task file content into structured data. */
  parseTaskFile(content: string): Promise<ParsedTaskFile>;

  /** Serialize task data into markdown file content. */
  serializeTask(
    meta: TaskMeta,
    entries: readonly Entry[],
    checkpoints: readonly Checkpoint[],
    todos: readonly Todo[],
  ): string;

  /** Append an entry to existing task file content. */
  appendEntry(content: string, entry: Entry): Promise<string>;

  /** Append a checkpoint to existing task file content. */
  appendCheckpoint(content: string, checkpoint: Checkpoint): Promise<string>;

  /** Update frontmatter in existing task file content. */
  updateFrontmatter(
    content: string,
    updates: Record<string, unknown>,
  ): Promise<string>;
}
