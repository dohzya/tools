// ListTracesUseCase - List all traces for a task

import type { TracesOutput } from "../../entities/outputs.ts";
import { WtError } from "../../entities/errors.ts";
import type { TraceKind } from "../../entities/entry.ts";
import { renderDesc } from "../../entities/description.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";

export interface ListTracesInput {
  readonly taskId: string;
  readonly kinds?: readonly TraceKind[];
  readonly excludedKinds?: readonly TraceKind[];
}

export class ListTracesUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
  ) {}

  async execute(input: ListTracesInput): Promise<TracesOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const included = new Set(input.kinds ?? []);
    const excluded = new Set(input.excludedKinds ?? []);
    const entries = taskData.entries
      .filter((entry) =>
        included.size === 0 || (entry.kind ? included.has(entry.kind) : false)
      )
      .filter((entry) => !entry.kind || !excluded.has(entry.kind))
      .sort((a, b) => a.ts.localeCompare(b.ts));

    return {
      task: taskId,
      desc: renderDesc(taskData.meta.desc),
      desc_parts: taskData.meta.desc,
      entries,
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
