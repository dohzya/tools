// UpdateTraceUseCase - Update metadata or content for an existing trace entry

import type { Entry, TraceKind } from "../../entities/entry.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";

export interface UpdateTraceInput {
  readonly taskId: string;
  readonly traceId: string;
  readonly kind?: TraceKind;
}

export class UpdateTraceUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
  ) {}

  async execute(input: UpdateTraceInput): Promise<void> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    if (!input.kind) {
      throw new WtError(
        "invalid_args",
        "Nothing to update. Provide --kind.",
      );
    }

    const entries = taskData.entries.map((entry) =>
      entry.id === input.traceId ? this.updateEntry(entry, input) : entry
    );

    if (!entries.some((entry) => entry.id === input.traceId)) {
      throw new WtError("trace_not_found", `Trace not found: ${input.traceId}`);
    }

    await this.taskRepo.save(
      taskId,
      taskData.meta,
      entries,
      taskData.checkpoints,
      taskData.todos,
    );
  }

  private updateEntry(entry: Entry, input: UpdateTraceInput): Entry {
    return {
      ...entry,
      ...(input.kind ? { kind: input.kind } : {}),
    };
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
