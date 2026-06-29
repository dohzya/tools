// UpdateTaskUseCase - Update task name/desc

import type { StatusOutput } from "../../entities/outputs.ts";
import type { IndexEntry } from "../../entities/index.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import {
  appendDescParts,
  normalizeDescParts,
} from "../../entities/description.ts";

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly name?: string;
  readonly desc?: readonly string[];
  readonly appendDesc?: readonly string[];
}

export class UpdateTaskUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: UpdateTaskInput): Promise<StatusOutput> {
    if (
      !input.name && input.desc === undefined && input.appendDesc === undefined
    ) {
      throw new WtError(
        "invalid_args",
        "Must provide at least one of --name, --desc, or --append-desc",
      );
    }

    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    let content = await this.taskRepo.loadContent(taskId);
    const updates: Record<string, unknown> = {};
    if (input.name) updates.name = input.name;
    let descUpdate: string[] | undefined;
    if (input.desc !== undefined) {
      descUpdate = normalizeDescParts(input.desc);
    } else if (input.appendDesc !== undefined) {
      const parsed = await this.markdownService.parseTaskFile(content);
      descUpdate = appendDescParts(
        parsed.meta.desc,
        normalizeDescParts(input.appendDesc),
      );
    }
    if (descUpdate !== undefined) updates.desc = descUpdate;

    content = await this.markdownService.updateFrontmatter(content, updates);
    await this.taskRepo.saveContent(taskId, content);

    // Update index
    const indexUpdates: Partial<
      { -readonly [K in keyof IndexEntry]: IndexEntry[K] }
    > = {};
    if (input.name) indexUpdates.name = input.name;
    if (descUpdate !== undefined) indexUpdates.desc = descUpdate;
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
