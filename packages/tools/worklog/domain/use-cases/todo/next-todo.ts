// GetNextTodoUseCase - Get next actionable todo

import type { Todo } from "../../entities/todo.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";

export interface GetNextTodoInput {
  readonly taskId?: string;
}

export class GetNextTodoUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
  ) {}

  async execute(input: GetNextTodoInput): Promise<Todo | null> {
    const index = await this.indexRepo.load();

    if (input.taskId) {
      const taskId = this.resolveTaskId(
        input.taskId,
        Object.keys(index.tasks),
      );
      return await this.getNextForTask(taskId);
    }

    // Scan all active tasks
    for (const taskId of Object.keys(index.tasks)) {
      if (index.tasks[taskId].status === "done") continue;

      try {
        const next = await this.getNextForTask(taskId);
        if (next) return next;
      } catch {
        continue;
      }
    }

    return null;
  }

  private async getNextForTask(taskId: string): Promise<Todo | null> {
    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) return null;

    for (const todo of taskData.todos) {
      if (todo.status === "done" || todo.status === "cancelled") continue;
      if (todo.status === "blocked") {
        const dependsOn = todo.metadata.dependsOn;
        if (dependsOn) continue;
      }
      return todo;
    }

    return null;
  }

  private resolveTaskId(prefix: string, allIds: string[]): string {
    const matches = allIds.filter((id) =>
      id.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (matches.length === 0) {
      throw new WtError(
        "task_not_found",
        `No task found matching prefix: ${prefix}`,
      );
    }

    if (matches.length > 1) {
      throw new WtError(
        "invalid_args",
        `Ambiguous task ID prefix '${prefix}' matches ${matches.length} tasks`,
      );
    }

    return matches[0];
  }
}
