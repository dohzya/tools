// ShowTaskUseCase - Show task details with recent entries

import type { ShowOutput } from "../../entities/outputs.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import { WtError } from "../../entities/errors.ts";
import { getShortId } from "../../entities/task-helpers.ts";
import type { IndexEntry } from "../../entities/index.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { ScopeConfigParent } from "../../entities/scope.ts";
import type { Entry } from "../../entities/entry.ts";

export interface ShowTaskInput {
  readonly taskId: string;
  readonly activeOnly?: boolean;
  readonly worklogDir: string;
  readonly gitRoot: string | null;
}

export class ShowTaskUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
  ) {}

  async execute(input: ShowTaskInput): Promise<ShowOutput> {
    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const { meta, entries, checkpoints, todos } = taskData;

    const lastCheckpoint = checkpoints.length > 0
      ? checkpoints[checkpoints.length - 1]
      : null;
    const entriesSinceCheckpoint = this.getEntriesAfterCheckpoint(
      entries,
      meta.last_checkpoint,
    );

    // Filter todos if activeOnly
    const filteredTodos = input.activeOnly
      ? todos.filter((todo) =>
        todo.status !== "done" && todo.status !== "cancelled"
      )
      : todos;

    const shortId = getShortId(index, taskId);

    // Get effective tags
    const effectiveTags = await this.getEffectiveTags(
      meta.tags as string[] | undefined,
      input.worklogDir,
      input.gitRoot,
    );

    return {
      task: shortId,
      fullId: taskId,
      name: meta.name,
      desc: meta.desc,
      status: meta.status,
      created: this.formatShort(meta.created_at),
      ready: meta.ready_at ? this.formatShort(meta.ready_at) : null,
      started: meta.started_at ? this.formatShort(meta.started_at) : null,
      last_checkpoint: lastCheckpoint,
      entries_since_checkpoint: entriesSinceCheckpoint,
      todos: filteredTodos,
      tags: effectiveTags.length > 0 ? effectiveTags : undefined,
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
      const lines = [
        `Ambiguous task ID prefix '${prefix}' matches ${matches.length} tasks:`,
      ];
      for (const id of matches.slice(0, 10)) {
        const shortId = getShortId(
          {
            tasks: Object.fromEntries(allIds.map((i) => [i, {} as IndexEntry])),
          },
          id,
        );
        lines.push(`  ${shortId}`);
      }
      if (matches.length > 10) {
        lines.push(`  ... and ${matches.length - 10} more`);
      }
      throw new WtError("invalid_args", lines.join("\n"));
    }

    return matches[0];
  }

  private formatShort(isoTs: string): string {
    return isoTs.slice(0, 16).replace("T", " ");
  }

  private getEntriesAfterCheckpoint(
    entries: readonly Entry[],
    lastCheckpointTs: string | null,
  ): Entry[] {
    if (!lastCheckpointTs) return [...entries];

    const checkpointDate = new Date(
      this.formatShort(lastCheckpointTs).replace(" ", "T") + ":00",
    );
    return entries.filter((e) => {
      const entryDate = new Date(e.ts.replace(" ", "T") + ":00");
      return entryDate > checkpointDate;
    });
  }

  private async getEffectiveTags(
    taskTags: string[] | undefined,
    scopePath: string,
    gitRoot: string | null,
  ): Promise<string[]> {
    const tags = new Set<string>(taskTags || []);

    if (!gitRoot) return Array.from(tags);

    const scopeConfig = await this.scopeRepo.loadConfig(scopePath);
    if (!scopeConfig) return Array.from(tags);

    if ("parent" in scopeConfig) {
      // Child scope - load parent config to get our inherited tags
      try {
        const parentDir = scopePath.split("/").slice(0, -1).join("/");
        const resolvedParent = this.resolvePath(parentDir, scopeConfig.parent);
        const parentConfig = await this.scopeRepo.loadConfig(resolvedParent);
        if (parentConfig && "children" in parentConfig) {
          const myEntry = (parentConfig as ScopeConfigParent).children.find(
            (c) => {
              const resolvedChildPath = this.resolvePath(
                resolvedParent,
                c.path,
              );
              return resolvedChildPath === scopePath;
            },
          );
          if (myEntry?.tags) {
            myEntry.tags.forEach((t) => tags.add(t));
          }
        }
      } catch {
        // Ignore errors resolving parent
      }
    }

    return Array.from(tags).sort();
  }

  private resolvePath(base: string, relative: string): string {
    if (relative.startsWith("/")) return relative;
    const parts = base.split("/");
    for (const part of relative.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    return parts.join("/");
  }
}
