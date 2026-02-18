// GenerateSummaryUseCase - Generate summary

import type { SummaryOutput, SummaryTaskItem } from "../entities/outputs.ts";
import type { Entry } from "../entities/entry.ts";
import type { IndexRepository } from "../ports/index-repository.ts";
import type { TaskRepository } from "../ports/task-repository.ts";

export interface GenerateSummaryInput {
  readonly since: string | null;
}

export class GenerateSummaryUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
  ) {}

  async execute(input: GenerateSummaryInput): Promise<SummaryOutput> {
    const index = await this.indexRepo.load();
    const sinceDate = input.since ? this.parseDate(input.since) : null;

    const result: SummaryTaskItem[] = [];

    for (const [id, info] of Object.entries(index.tasks)) {
      const include = ["created", "ready", "started"].includes(info.status) ||
        (sinceDate && info.done_at &&
          this.parseDate(info.done_at) >= sinceDate);

      if (!include) continue;

      const taskData = await this.taskRepo.findById(id);
      if (!taskData) continue;

      let filteredEntries: readonly Entry[] = taskData.entries;
      if (sinceDate) {
        filteredEntries = taskData.entries.filter(
          (e) => this.parseDate(e.ts) >= sinceDate,
        );
      }

      result.push({
        id,
        desc: info.desc,
        status: info.status,
        checkpoints: taskData.checkpoints,
        entries: filteredEntries,
      });
    }

    return { tasks: result };
  }

  private parseDate(dateStr: string): Date {
    if (dateStr.includes("T")) return new Date(dateStr);
    if (dateStr.includes(" ")) {
      return new Date(dateStr.replace(" ", "T") + ":00");
    }
    return new Date(dateStr + "T00:00:00");
  }
}
