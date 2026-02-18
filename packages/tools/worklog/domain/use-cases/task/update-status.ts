// UpdateStatusUseCase - Change task status (ready, start, done, cancel)
// Handles transitions + done requires checkpoint

import type { StatusOutput } from "../../entities/outputs.ts";
import type { IndexEntry } from "../../entities/index.ts";
import type { TaskStatus } from "../../entities/task.ts";
import type { Todo } from "../../entities/todo.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface UpdateStatusInput {
  readonly taskId: string;
  readonly targetStatus: TaskStatus;
  readonly changes?: string;
  readonly learnings?: string;
  readonly force?: boolean;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export class UpdateStatusUseCase {
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

  async execute(input: UpdateStatusInput): Promise<StatusOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    switch (input.targetStatus) {
      case "ready":
        return await this.toReady(taskId);
      case "started":
        return await this.toStarted(taskId);
      case "done":
        return await this.toDone(taskId, input);
      case "cancelled":
        return await this.toCancelled(taskId, input.reason);
      default:
        throw new WtError(
          "invalid_args",
          `Invalid target status: ${input.targetStatus}`,
        );
    }
  }

  private async toReady(taskId: string): Promise<StatusOutput> {
    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const { meta } = taskData;

    // Validate: allow created, started; reject done, cancelled
    if (!["created", "started"].includes(meta.status)) {
      throw new WtError(
        "invalid_state",
        `Cannot transition from '${meta.status}' to 'ready'`,
      );
    }

    const now = this.getTimestamp();
    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.updateFrontmatter(content, {
      status: "ready",
      ready_at: now,
    });
    await this.taskRepo.saveContent(taskId, content);

    await this.indexRepo.updateEntry(taskId, {
      status: "ready",
      status_updated_at: now,
    });

    return { status: "task_ready" };
  }

  private async toStarted(taskId: string): Promise<StatusOutput> {
    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const { meta } = taskData;

    // Allow: created, ready, done; reject: cancelled
    if (meta.status === "cancelled") {
      throw new WtError(
        "invalid_state",
        `Cannot transition from 'cancelled' to 'started'`,
      );
    }
    if (meta.status === "started") {
      return { status: "task_already_started" };
    }

    const now = this.getTimestamp();
    const updates: Record<string, unknown> = {
      status: "started",
      started_at: now,
    };

    // Clear done_at if reopening
    if (meta.done_at) {
      updates.done_at = null;
    }

    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.updateFrontmatter(content, updates);
    await this.taskRepo.saveContent(taskId, content);

    const indexUpdates: Partial<
      { -readonly [K in keyof IndexEntry]: IndexEntry[K] }
    > = {
      status: "started",
      status_updated_at: now,
    };

    // Remove done_at from index if present
    await this.indexRepo.updateEntry(
      taskId,
      indexUpdates,
    );

    return { status: "task_started" };
  }

  private async toDone(
    taskId: string,
    input: UpdateStatusInput,
  ): Promise<StatusOutput> {
    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const { meta, todos } = taskData;

    // Check for pending todos (unless force)
    if (!input.force) {
      const pendingTodos = todos.filter(
        (t: Todo) => t.status !== "done" && t.status !== "cancelled",
      );
      if (pendingTodos.length > 0) {
        throw new WtError(
          "task_has_pending_todos",
          `Task has ${pendingTodos.length} pending todo(s). Use --force to complete anyway.`,
        );
      }

      // If no changes/learnings provided, check for uncheckpointed entries
      if (!input.changes && !input.learnings) {
        if (meta.has_uncheckpointed_entries) {
          throw new WtError(
            "no_uncheckpointed_entries",
            "Cannot mark done: uncheckpointed entries exist. Provide changes and learnings.",
          );
        }
      }
    }

    // Create final checkpoint only if changes/learnings provided
    if (input.changes || input.learnings) {
      const now = this.getTimestamp();
      const shortTs = now.slice(0, 16).replace("T", " ");
      let content = await this.taskRepo.loadContent(taskId);
      content = await this.markdownService.appendCheckpoint(content, {
        ts: shortTs,
        changes: input.changes ?? "",
        learnings: input.learnings ?? "",
      });
      content = await this.markdownService.updateFrontmatter(content, {
        last_checkpoint: now,
        has_uncheckpointed_entries: false,
      });
      await this.taskRepo.saveContent(taskId, content);
    }

    // Mark as done
    const now = this.getTimestamp();
    let content = await this.taskRepo.loadContent(taskId);
    const fmUpdates: Record<string, unknown> = {
      status: "done",
      done_at: now,
    };

    // Add metadata if provided
    if (input.metadata && Object.keys(input.metadata).length > 0) {
      fmUpdates.metadata = input.metadata;
    }

    content = await this.markdownService.updateFrontmatter(content, fmUpdates);
    await this.taskRepo.saveContent(taskId, content);

    await this.indexRepo.updateEntry(taskId, {
      status: "done",
      done_at: now,
    });

    return { status: "task_completed" };
  }

  private async toCancelled(
    taskId: string,
    reason?: string,
  ): Promise<StatusOutput> {
    const now = this.getTimestamp();

    let content = await this.taskRepo.loadContent(taskId);
    const updates: Record<string, unknown> = {
      status: "cancelled",
      cancelled_at: now,
    };

    if (reason) {
      updates.metadata = { cancellation_reason: reason };
    }

    content = await this.markdownService.updateFrontmatter(content, updates);
    await this.taskRepo.saveContent(taskId, content);

    await this.indexRepo.updateEntry(taskId, {
      status: "cancelled",
      cancelled_at: now,
    });

    return { status: "task_cancelled" };
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
