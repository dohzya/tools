// UpdateMetaUseCase - Set/get task metadata

import { WtError } from "../../entities/errors.ts";
import { ExplicitCast } from "../../../../explicit-cast.ts";
import type { IndexEntry } from "../../entities/index.ts";
import { isValidTaskStatus, TASK_STATUSES } from "../../entities/task.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface UpdateMetaInput {
  readonly taskId: string;
  readonly key?: string;
  readonly value?: string;
  readonly deleteKey?: string;
  readonly parent?: string;
  readonly detach?: boolean;
  readonly force?: boolean;
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

    const shouldDetach = input.detach === true || input.deleteKey === "parent";
    if (input.parent !== undefined || shouldDetach) {
      if (input.parent !== undefined && shouldDetach) {
        throw new WtError(
          "invalid_args",
          "Cannot specify both --parent and --detach",
        );
      }

      if (input.parent !== undefined) {
        this.validateNewParent(taskId, input.parent, index.tasks);
        const currentParent = taskData.meta.parent ?? null;
        if (currentParent && !input.force) {
          throw new WtError(
            "already_has_parent",
            `Task already has parent ${currentParent}. Detach it first or use --force to reparent.`,
          );
        }

        let content = await this.taskRepo.loadContent(taskId);
        content = await this.markdownService.updateFrontmatter(content, {
          parent: input.parent,
        });
        await this.taskRepo.saveContent(taskId, content);
        await this.indexRepo.updateEntry(taskId, { parent: input.parent });

        return { metadata };
      }

      let content = await this.taskRepo.loadContent(taskId);
      content = await this.markdownService.updateFrontmatter(content, {
        parent: undefined,
      });
      await this.taskRepo.saveContent(taskId, content);
      await this.indexRepo.updateEntry(taskId, { parent: undefined });

      return { metadata };
    }

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
        const status = input.value;
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
          indexUpdates.done_at = ExplicitCast.from<unknown>(
            statusUpdates.done_at,
          ).dangerousCast<string>();
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

  private validateNewParent(
    taskId: string,
    parentId: string,
    tasks: Readonly<Record<string, IndexEntry>>,
  ): void {
    if (parentId === taskId) {
      throw new WtError("invalid_args", "A task cannot be its own parent");
    }

    let cursor: string | undefined = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === taskId) {
        throw new WtError(
          "invalid_args",
          "Cannot set parent: this would create a task-parent cycle",
        );
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = tasks[cursor]?.parent;
    }
  }
}
