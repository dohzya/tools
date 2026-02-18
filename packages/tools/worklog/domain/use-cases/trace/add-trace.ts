// AddTraceUseCase - Add a trace entry to a task

import type { TraceOutput } from "../../entities/outputs.ts";
import type { Entry } from "../../entities/entry.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

const CHECKPOINT_THRESHOLD = 50;

export interface AddTraceInput {
  readonly taskId: string;
  readonly message: string;
  readonly timestamp?: string;
  readonly force?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export class AddTraceUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly markdownService: MarkdownService,
    private readonly getTimestamp: () => string = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hour = String(now.getHours()).padStart(2, "0");
      const minute = String(now.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day} ${hour}:${minute}`;
    },
    private readonly warn: (msg: string) => void = (_msg) => {},
  ) {}

  async execute(input: AddTraceInput): Promise<TraceOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const { meta } = taskData;

    // Check status: reject done unless --force, warn if not started
    if (meta.status === "done" && !input.force) {
      throw new WtError(
        "task_already_done",
        `Task ${meta.id} is completed. Use --force to add post-completion traces.`,
      );
    }
    if (meta.status !== "started") {
      this.warn(
        `Warning: Task is not started. Trace recorded. Run 'wl start ${taskId}' to start working.`,
      );
    }

    // Build timestamp
    let nowShort: string;
    if (input.timestamp) {
      try {
        const testDate = new Date(input.timestamp);
        if (isNaN(testDate.getTime())) {
          throw new WtError(
            "invalid_args",
            `Invalid timestamp format: ${input.timestamp}. Use ISO format (YYYY-MM-DDTHH:MM:SS+TZ) or short format (YYYY-MM-DD HH:MM)`,
          );
        }
        // Use formatShort to preserve timezone info from ISO string
        nowShort = input.timestamp.slice(0, 16).replace("T", " ");
      } catch (e) {
        if (e instanceof WtError) throw e;
        throw new WtError(
          "invalid_args",
          `Invalid timestamp: ${input.timestamp}`,
        );
      }
    } else {
      nowShort = this.getTimestamp();
    }

    const entry: Entry = { ts: nowShort, msg: input.message };

    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.appendEntry(content, entry);

    // Update frontmatter
    const fmUpdates: Record<string, unknown> = {
      has_uncheckpointed_entries: true,
    };

    if (input.metadata && Object.keys(input.metadata).length > 0) {
      fmUpdates.metadata = input.metadata;
    }

    content = await this.markdownService.updateFrontmatter(content, fmUpdates);
    await this.taskRepo.saveContent(taskId, content);

    // Count entries since last checkpoint
    const parsed = await this.markdownService.parseTaskFile(content);
    const entriesSinceCheckpoint = this.getEntriesAfterCheckpoint(
      parsed.entries,
      meta.last_checkpoint,
    );

    if (entriesSinceCheckpoint.length >= CHECKPOINT_THRESHOLD) {
      return {
        status: "checkpoint_recommended",
        entries_since_checkpoint: entriesSinceCheckpoint.length,
      };
    }

    return { status: "ok" };
  }

  private getEntriesAfterCheckpoint(
    entries: readonly Entry[],
    lastCheckpointTs: string | null,
  ): Entry[] {
    if (!lastCheckpointTs) return [...entries];

    const checkpointStr = lastCheckpointTs.slice(0, 16).replace("T", " ");
    const checkpointDate = new Date(checkpointStr.replace(" ", "T") + ":00");
    return entries.filter((e) => {
      const entryDate = new Date(e.ts.replace(" ", "T") + ":00");
      return entryDate > checkpointDate;
    });
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
