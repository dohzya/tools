// LinkTaskUseCase - Maintain reciprocal non-hierarchical task links

import { WtError } from "../../entities/errors.ts";
import type { TaskLink, TaskLinkType } from "../../entities/task.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";

export type TaskLinkInputType = TaskLinkType | "depends-on" | "relates-to";

export type LinkTaskInput = {
  readonly sourceTaskId: string;
  readonly type: TaskLinkInputType;
  readonly targetTaskId: string;
};

export type LinkTaskOutput = {
  readonly sourceTaskId: string;
  readonly sourceType: TaskLinkType;
  readonly targetTaskId: string;
  readonly targetType: TaskLinkType;
};

export class LinkTaskUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: LinkTaskInput): Promise<LinkTaskOutput> {
    const sourceType = this.normalizeType(input.type);
    const targetType = this.reciprocalType(sourceType);

    if (input.sourceTaskId === input.targetTaskId) {
      throw new WtError("invalid_args", "A task cannot link to itself");
    }

    const sourceData = await this.taskRepo.findById(input.sourceTaskId);
    if (!sourceData) {
      throw new WtError(
        "task_not_found",
        `Task not found: ${input.sourceTaskId}`,
      );
    }

    const targetData = await this.taskRepo.findById(input.targetTaskId);
    if (!targetData) {
      throw new WtError(
        "task_not_found",
        `Task not found: ${input.targetTaskId}`,
      );
    }

    await this.updateTaskLinks(input.sourceTaskId, {
      type: sourceType,
      task: input.targetTaskId,
    });
    await this.updateTaskLinks(input.targetTaskId, {
      type: targetType,
      task: input.sourceTaskId,
    });

    return {
      sourceTaskId: input.sourceTaskId,
      sourceType,
      targetTaskId: input.targetTaskId,
      targetType,
    };
  }

  private async updateTaskLinks(taskId: string, link: TaskLink): Promise<void> {
    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const links = [...(taskData.meta.links ?? [])];
    if (
      !links.some((item) => item.type === link.type && item.task === link.task)
    ) {
      links.push(link);
    }

    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.updateFrontmatter(content, { links });
    await this.taskRepo.saveContent(taskId, content);
    await this.indexRepo.updateEntry(taskId, { links });
  }

  private normalizeType(type: TaskLinkInputType): TaskLinkType {
    if (type === "depends-on") return "depends_on";
    if (type === "relates-to") return "related";
    return type;
  }

  private reciprocalType(type: TaskLinkType): TaskLinkType {
    if (type === "depends_on") return "blocks";
    if (type === "blocks") return "depends_on";
    return "related";
  }
}
