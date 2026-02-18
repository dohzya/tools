/**
 * Adapter: MarkdownTaskRepository
 *
 * Implements the TaskRepository port using MarkdownService + FileSystem.
 * Reads/writes task markdown files under {worklogDir}/tasks/{id}.md.
 *
 * Replicates the file I/O patterns from cli.ts:
 *   - loadTaskContent / saveTaskContent -> loadContent / saveContent
 *   - taskFilePath -> getTaskFilePath
 *   - parseTaskFile via MarkdownService
 *
 * Dependencies:
 *   - FileSystem (port) for file operations
 *   - MarkdownService (port) for parsing/serialization
 */

import type { Checkpoint } from "../../domain/entities/checkpoint.ts";
import type { Entry } from "../../domain/entities/entry.ts";
import { WtError } from "../../domain/entities/errors.ts";
import type { TaskMeta } from "../../domain/entities/task.ts";
import type { Todo } from "../../domain/entities/todo.ts";
import type { FileSystem } from "../../domain/ports/filesystem.ts";
import type { MarkdownService } from "../../domain/ports/markdown-service.ts";
import type {
  TaskFileData,
  TaskRepository,
} from "../../domain/ports/task-repository.ts";

export class MarkdownTaskRepository implements TaskRepository {
  constructor(
    private readonly fs: FileSystem,
    private readonly markdownService: MarkdownService,
    private readonly tasksDir: string,
  ) {}

  async findById(taskId: string): Promise<TaskFileData | null> {
    const path = this.getTaskFilePath(taskId);
    const fileExists = await this.fs.exists(path);
    if (!fileExists) {
      return null;
    }

    const content = await this.fs.readFile(path);
    return await this.markdownService.parseTaskFile(content);
  }

  async save(
    taskId: string,
    meta: TaskMeta,
    entries: readonly Entry[],
    checkpoints: readonly Checkpoint[],
    todos: readonly Todo[],
  ): Promise<void> {
    const content = this.markdownService.serializeTask(
      meta,
      entries,
      checkpoints,
      todos,
    );
    await this.fs.writeFile(this.getTaskFilePath(taskId), content);
  }

  async delete(taskId: string): Promise<void> {
    await this.fs.remove(this.getTaskFilePath(taskId));
  }

  async exists(taskId: string): Promise<boolean> {
    return await this.fs.exists(this.getTaskFilePath(taskId));
  }

  getTaskFilePath(taskId: string): string {
    return `${this.tasksDir}/${taskId}.md`;
  }

  async loadContent(taskId: string): Promise<string> {
    const path = this.getTaskFilePath(taskId);
    const fileExists = await this.fs.exists(path);
    if (!fileExists) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }
    return await this.fs.readFile(path);
  }

  async saveContent(taskId: string, content: string): Promise<void> {
    await this.fs.writeFile(this.getTaskFilePath(taskId), content);
  }
}
