// UpdateTaskUseCase - Update task name/desc

import type { StatusOutput } from "../../entities/outputs.ts";
import type { IndexEntry } from "../../entities/index.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly name?: string;
  readonly desc?: string;
}

export class UpdateTaskUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: UpdateTaskInput): Promise<StatusOutput> {
    if (!input.name && input.desc === undefined) {
      throw new WtError(
        "invalid_args",
        "Must provide at least one of --name or --desc",
      );
    }

    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const updates: Record<string, unknown> = {};
    if (input.name) updates.name = input.name;
    if (input.desc !== undefined) updates.desc = input.desc;

    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.updateFrontmatter(content, updates);
    await this.taskRepo.saveContent(taskId, content);

    // Update index
    const indexUpdates: Partial<
      { -readonly [K in keyof IndexEntry]: IndexEntry[K] }
    > = {};
    if (input.name) indexUpdates.name = input.name;
    if (input.desc !== undefined) indexUpdates.desc = input.desc;
    await this.indexRepo.updateEntry(taskId, indexUpdates);

    return { status: "task_updated" };
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
