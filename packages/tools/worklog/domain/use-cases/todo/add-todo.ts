// AddTodoUseCase - Add a todo to a task

import type { TodoAddOutput } from "../../entities/outputs.ts";
import { WtError } from "../../entities/errors.ts";
import { generateTodoId } from "../../entities/task-helpers.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface AddTodoInput {
  readonly taskId: string;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export class AddTodoUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
    private readonly generateId: () => string = generateTodoId,
  ) {}

  async execute(input: AddTodoInput): Promise<TodoAddOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const todoId = this.generateId();

    // Build metadata string
    let metadataStr = `  [id:: ${todoId}]`;
    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        metadataStr += ` [${key}:: ${value}]`;
      }
    }

    // Save updated task with new todo
    // We need to work with the raw content to add the todo line
    const content = await this.taskRepo.loadContent(taskId);
    const newTodoLine = `- [ ] ${input.text}${metadataStr} ^${todoId}`;

    // Check if # TODO section exists
    const hasTodoSection = content.includes("\n# TODO\n") ||
      content.includes("\n# TODO\r\n");

    let newContent: string;
    if (hasTodoSection) {
      // Find the end of the TODO section and append
      const lines = content.split("\n");
      let todoSectionEnd = -1;
      let inTodoSection = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "# TODO") {
          inTodoSection = true;
          continue;
        }
        if (inTodoSection && lines[i].startsWith("# ")) {
          todoSectionEnd = i;
          break;
        }
      }

      if (todoSectionEnd === -1) {
        // TODO section is at the end of the file
        todoSectionEnd = lines.length;
      }

      lines.splice(todoSectionEnd, 0, newTodoLine);
      newContent = lines.join("\n");
    } else {
      // Add TODO section before # Checkpoints (or at end)
      const checkpointsIdx = content.indexOf("\n# Checkpoints");
      if (checkpointsIdx >= 0) {
        newContent = content.slice(0, checkpointsIdx) +
          "\n# TODO\n\n" + newTodoLine + "\n" +
          content.slice(checkpointsIdx);
      } else {
        newContent = content + "\n# TODO\n\n" + newTodoLine + "\n";
      }
    }

    await this.taskRepo.saveContent(taskId, newContent);

    return { id: todoId, taskId };
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
