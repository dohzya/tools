// UpdateTodoUseCase - Update todo status/text

import type { StatusOutput } from "../../entities/outputs.ts";
import type { Todo } from "../../entities/todo.ts";
import type { TodoStatus } from "../../entities/todo.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";

export interface UpdateTodoInput {
  readonly todoId: string;
  readonly updates: Readonly<Record<string, string>>;
}

export class UpdateTodoUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
  ) {}

  async execute(input: UpdateTodoInput): Promise<StatusOutput> {
    const index = await this.indexRepo.load();

    // Collect all todos to resolve prefix
    const allTodos: Todo[] = [];
    const todoToTask = new Map<string, string>();

    for (const taskId of Object.keys(index.tasks)) {
      try {
        const taskData = await this.taskRepo.findById(taskId);
        if (!taskData) continue;

        for (const todo of taskData.todos) {
          allTodos.push(todo);
          todoToTask.set(todo.id, taskId);
        }
      } catch {
        continue;
      }
    }

    // Resolve todo ID prefix
    const resolvedTodoId = this.resolveTodoId(input.todoId, allTodos);
    const foundTaskId = todoToTask.get(resolvedTodoId);

    if (!foundTaskId) {
      throw new WtError("todo_not_found", `Todo ${input.todoId} not found`);
    }

    // Update the todo in the task file using raw content manipulation
    const content = await this.taskRepo.loadContent(foundTaskId);
    const lines = content.split("\n");

    const statusMap: Record<TodoStatus, string> = {
      "todo": " ",
      "wip": "/",
      "blocked": ">",
      "cancelled": "-",
      "done": "x",
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(`^${resolvedTodoId}`)) {
        const todoMatch = line.match(/^(-\s*\[)(.)\](\s*)(.+)$/);
        if (!todoMatch) continue;

        const prefix = todoMatch[1];
        let statusChar = todoMatch[2];
        const spacing = todoMatch[3];
        let rest = todoMatch[4];

        // Apply updates
        if (input.updates.status) {
          statusChar = statusMap[input.updates.status as TodoStatus] ||
            statusChar;
        }

        // Update metadata
        for (const [key, value] of Object.entries(input.updates)) {
          if (key === "status") continue;

          const metaRegex = new RegExp(`\\[${key}::\\s*([^\\]]+)\\]`);
          if (metaRegex.test(rest)) {
            rest = rest.replace(metaRegex, `[${key}:: ${value}]`);
          } else {
            const blockRefMatch = rest.match(/(\s+\^[\w]+)$/);
            if (blockRefMatch) {
              rest = rest.substring(0, blockRefMatch.index) +
                ` [${key}:: ${value}]` + blockRefMatch[0];
            }
          }
        }

        lines[i] = `${prefix}${statusChar}]${spacing}${rest}`;
        break;
      }
    }

    await this.taskRepo.saveContent(foundTaskId, lines.join("\n"));

    return { status: "todo_updated" };
  }

  private resolveTodoId(prefix: string, todos: readonly Todo[]): string {
    const matches = todos.filter((t) =>
      t.id.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (matches.length === 0) {
      throw new WtError(
        "todo_not_found",
        `No todo found matching prefix: ${prefix}`,
      );
    }

    if (matches.length > 1) {
      const _allIds = todos.map((t) => t.id);
      const lines = [
        `Ambiguous todo ID prefix '${prefix}' matches ${matches.length} todos:`,
      ];
      for (const todo of matches.slice(0, 10)) {
        lines.push(`  ${todo.id}  "${todo.text}"`);
      }
      throw new WtError("invalid_args", lines.join("\n"));
    }

    return matches[0].id;
  }
}
