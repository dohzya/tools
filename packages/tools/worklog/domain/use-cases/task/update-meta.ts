// UpdateMetaUseCase - Set/get task metadata

import { WtError } from "../../entities/errors.ts";
import type { IndexEntry } from "../../entities/index.ts";
import {
  isValidTaskStatus,
  TASK_STATUSES,
  type TaskStatus,
} from "../../entities/task.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface UpdateMetaInput {
  readonly taskId: string;
  readonly key?: string;
  readonly value?: string;
  readonly deleteKey?: string;
}

export interface UpdateMetaOutput {
  readonly metadata: Readonly<Record<string, string>>;
}

export class UpdateMetaUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
    private readonly getTimestamp: () => string = () =>
      new Date().toISOString(),
  ) {}

  async execute(input: UpdateMetaInput): Promise<UpdateMetaOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const metadata: Record<string, string> = {
      ...(taskData.meta.metadata ?? {}),
    };

    // Delete key if requested
    if (input.deleteKey) {
      delete metadata[input.deleteKey];
    }

    // Set/update key-value if provided
    if (input.key && input.value !== undefined) {
      if (input.key === "status") {
        // Handle special status field
        if (!isValidTaskStatus(input.value)) {
          throw new WtError(
            "invalid_args",
            `Invalid status: ${input.value}. Must be one of: ${
              TASK_STATUSES.join(", ")
            }`,
          );
        }

        const now = this.getTimestamp();
        const statusUpdates: Record<string, unknown> = {
          status: input.value,
        };

        // Update timestamp fields based on status
        const status = input.value as TaskStatus;
        if (status === "done" && !taskData.meta.done_at) {
          statusUpdates.done_at = now;
        } else if (status === "cancelled" && !taskData.meta.cancelled_at) {
          statusUpdates.cancelled_at = now;
        } else if (status === "started" && !taskData.meta.started_at) {
          statusUpdates.started_at = now;
          statusUpdates.done_at = null;
          statusUpdates.cancelled_at = null;
        } else if (status === "ready" && !taskData.meta.ready_at) {
          statusUpdates.ready_at = now;
        } else if (status === "created") {
          statusUpdates.ready_at = null;
          statusUpdates.started_at = null;
          statusUpdates.done_at = null;
          statusUpdates.cancelled_at = null;
        }

        let content = await this.taskRepo.loadContent(taskId);
        content = await this.markdownService.updateFrontmatter(
          content,
          statusUpdates,
        );
        await this.taskRepo.saveContent(taskId, content);

        // Update index
        const indexUpdates: Partial<
          { -readonly [K in keyof IndexEntry]: IndexEntry[K] }
        > = {
          status: input.value,
          status_updated_at: now,
        };
        if (["created", "ready", "started"].includes(status)) {
          indexUpdates.done_at = undefined;
        } else if (status === "done" && statusUpdates.done_at) {
          indexUpdates.done_at = statusUpdates.done_at as string;
        }
        await this.indexRepo.updateEntry(taskId, indexUpdates);

        return { metadata };
      }

      // Regular metadata field
      metadata[input.key] = input.value;
    }

    // Save changes
    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.updateFrontmatter(content, {
      metadata,
    });
    await this.taskRepo.saveContent(taskId, content);

    return { metadata };
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
