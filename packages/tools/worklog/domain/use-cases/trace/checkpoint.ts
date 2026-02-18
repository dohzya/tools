// CreateCheckpointUseCase - Create a checkpoint

import type { StatusOutput } from "../../entities/outputs.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface CreateCheckpointInput {
  readonly taskId: string;
  readonly changes: string;
  readonly learnings: string;
  readonly force?: boolean;
}

export class CreateCheckpointUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
    private readonly getTimestamp: () => string = () => {
      const now = new Date();
      const tzOffset = -now.getTimezoneOffset();
      const sign = tzOffset >= 0 ? "+" : "-";
      const hours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(
        2,
        "0",
      );
      const minutes = String(Math.abs(tzOffset) % 60).padStart(2, "0");
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hour = String(now.getHours()).padStart(2, "0");
      const minute = String(now.getMinutes()).padStart(2, "0");
      const second = String(now.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hours}:${minutes}`;
    },
  ) {}

  async execute(input: CreateCheckpointInput): Promise<StatusOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const { meta, entries } = taskData;

    // Check if task is active (unless forcing)
    if (!input.force) {
      if (meta.status === "done") {
        throw new WtError(
          "task_already_done",
          `Task ${meta.id} is already completed`,
        );
      }
    }

    // Check if checkpoint is needed (unless forced)
    if (!input.force) {
      let needsCheckpoint = meta.has_uncheckpointed_entries;

      if (!needsCheckpoint && entries.length > 0) {
        const lastEntryTs = entries[entries.length - 1].ts;
        if (meta.last_checkpoint) {
          const lastCheckpointDate = this.parseDate(meta.last_checkpoint);
          const lastEntryDate = this.parseDate(lastEntryTs);
          needsCheckpoint = lastEntryDate > lastCheckpointDate;
        } else {
          needsCheckpoint = true;
        }
      }

      if (!needsCheckpoint) {
        throw new WtError(
          "no_uncheckpointed_entries",
          "No uncheckpointed entries. Use --force to create checkpoint anyway",
        );
      }
    }

    const now = this.getTimestamp();
    const shortTs = now.slice(0, 16).replace("T", " ");

    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.appendCheckpoint(content, {
      ts: shortTs,
      changes: input.changes,
      learnings: input.learnings,
    });
    content = await this.markdownService.updateFrontmatter(content, {
      last_checkpoint: now,
      has_uncheckpointed_entries: false,
    });
    await this.taskRepo.saveContent(taskId, content);

    return { status: "checkpoint_created" };
  }

  private parseDate(dateStr: string): Date {
    if (dateStr.includes("T")) {
      return new Date(dateStr);
    }
    if (dateStr.includes(" ")) {
      return new Date(dateStr.replace(" ", "T") + ":00");
    }
    return new Date(dateStr + "T00:00:00");
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
