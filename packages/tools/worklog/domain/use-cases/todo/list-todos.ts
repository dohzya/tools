// ListTodosUseCase - List todos (for a specific task or all active tasks)

import type { TodoListOutput } from "../../entities/outputs.ts";
import type { Todo } from "../../entities/todo.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";

export interface ListTodosInput {
  readonly taskId?: string;
}

export class ListTodosUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
  ) {}

  async execute(input: ListTodosInput): Promise<TodoListOutput> {
    const index = await this.indexRepo.load();

    if (input.taskId) {
      const taskId = this.resolveTaskId(
        input.taskId,
        Object.keys(index.tasks),
      );

      const taskData = await this.taskRepo.findById(taskId);
      if (!taskData) {
        throw new WtError("task_not_found", `Task not found: ${taskId}`);
      }

      return { todos: taskData.todos };
    }

    // List todos across all active tasks
    const allTodos: Todo[] = [];

    for (const [id, task] of Object.entries(index.tasks)) {
      if (task.status === "done") continue;

      try {
        const taskData = await this.taskRepo.findById(id);
        if (!taskData) continue;

        for (const todo of taskData.todos) {
          allTodos.push({
            ...todo,
            metadata: {
              ...todo.metadata,
              taskId: id,
              taskDesc: taskData.meta.desc,
            },
          });
        }
      } catch {
        continue;
      }
    }

    return { todos: allTodos };
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
