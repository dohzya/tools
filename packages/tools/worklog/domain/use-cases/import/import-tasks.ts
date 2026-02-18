// ImportTasksUseCase - Import tasks from another worklog

import type { ImportOutput, ImportTaskResult } from "../../entities/outputs.ts";
import type { Index } from "../../entities/index.ts";
import type { Entry } from "../../entities/entry.ts";
import type { Checkpoint } from "../../entities/checkpoint.ts";
import { WtError } from "../../entities/errors.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface ImportTasksInput {
  readonly sourcePath: string;
  readonly removeSource: boolean;
}

export class ImportTasksUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly fs: FileSystem,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: ImportTasksInput): Promise<ImportOutput> {
    const sourceIndexPath = `${input.sourcePath}/index.json`;
    if (!(await this.fs.exists(sourceIndexPath))) {
      throw new WtError(
        "import_source_not_found",
        `Source worklog not found: ${input.sourcePath}`,
      );
    }

    const sourceIndexContent = await this.fs.readFile(sourceIndexPath);
    const sourceIndex = JSON.parse(sourceIndexContent) as Index;
    const destIndex = await this.indexRepo.load();

    const results: ImportTaskResult[] = [];
    let imported = 0;
    let merged = 0;
    let skipped = 0;
    const tasksToRemove: string[] = [];

    for (const [sourceId, sourceInfo] of Object.entries(sourceIndex.tasks)) {
      const sourceTaskPath = `${input.sourcePath}/tasks/${sourceId}.md`;
      let sourceContent = await this.fs.readFile(sourceTaskPath);
      const sourceParsed = await this.markdownService.parseTaskFile(
        sourceContent,
      );
      let sourceMeta = sourceParsed.meta;

      // Generate uid if missing
      if (!sourceMeta.uid) {
        const uid = crypto.randomUUID();
        sourceContent = await this.markdownService.updateFrontmatter(
          sourceContent,
          { uid },
        );
        await this.fs.writeFile(sourceTaskPath, sourceContent);
        sourceMeta = { ...sourceMeta, uid };
      }

      // Check if UID already exists in destination
      let existingTaskId: string | undefined;
      for (const id of Object.keys(destIndex.tasks)) {
        const destData = await this.taskRepo.findById(id);
        if (!destData) continue;

        let destMeta = destData.meta;
        if (!destMeta.uid) {
          const uid = crypto.randomUUID();
          let content = await this.taskRepo.loadContent(id);
          content = await this.markdownService.updateFrontmatter(content, {
            uid,
          });
          await this.taskRepo.saveContent(id, content);
          destMeta = { ...destMeta, uid };
        }

        if (destMeta.uid === sourceMeta.uid) {
          existingTaskId = id;
          break;
        }
      }

      if (existingTaskId) {
        // Merge traces
        const destData = await this.taskRepo.findById(existingTaskId);
        if (!destData) continue;

        const warnings: string[] = [];
        const destTimestamps = new Set(destData.entries.map((e) => e.ts));
        const entriesToAdd: Entry[] = [];

        for (const entry of sourceParsed.entries) {
          if (destTimestamps.has(entry.ts)) continue;

          if (destData.meta.last_checkpoint) {
            const entryDate = this.parseDate(entry.ts);
            const lastCheckpointDate = this.parseDate(
              destData.meta.last_checkpoint,
            );
            if (entryDate < lastCheckpointDate) {
              warnings.push(
                `Entry at ${entry.ts} is older than last checkpoint, skipped`,
              );
              continue;
            }
          }

          entriesToAdd.push(entry);
        }

        const destCheckpointTimestamps = new Set(
          destData.checkpoints.map((c) => c.ts),
        );
        const checkpointsToAdd: Checkpoint[] = [];
        for (const checkpoint of sourceParsed.checkpoints) {
          if (!destCheckpointTimestamps.has(checkpoint.ts)) {
            checkpointsToAdd.push(checkpoint);
          }
        }

        if (entriesToAdd.length > 0 || checkpointsToAdd.length > 0) {
          let content = await this.taskRepo.loadContent(existingTaskId);

          for (const entry of entriesToAdd) {
            content = await this.markdownService.appendEntry(content, entry);
          }

          if (entriesToAdd.length > 0) {
            content = await this.markdownService.updateFrontmatter(content, {
              has_uncheckpointed_entries: true,
            });
          }

          for (const checkpoint of checkpointsToAdd) {
            content = await this.markdownService.appendCheckpoint(
              content,
              checkpoint,
            );
          }

          if (checkpointsToAdd.length > 0) {
            const allCheckpoints = [
              ...destData.checkpoints,
              ...checkpointsToAdd,
            ];
            const newestTs = allCheckpoints.sort((a, b) =>
              this.parseDate(b.ts).getTime() - this.parseDate(a.ts).getTime()
            )[0].ts;
            const newestDate = this.parseDate(newestTs);
            content = await this.markdownService.updateFrontmatter(content, {
              last_checkpoint: newestDate.toISOString(),
            });
          }

          await this.taskRepo.saveContent(existingTaskId, content);

          results.push({
            id: existingTaskId,
            status: "merged",
            warnings: warnings.length > 0 ? warnings : undefined,
          });
          merged++;

          if (warnings.length === 0) {
            tasksToRemove.push(sourceId);
          }
        } else {
          results.push({
            id: existingTaskId,
            status: "skipped",
            warnings: ["No new entries or checkpoints to merge"],
          });
          skipped++;
          tasksToRemove.push(sourceId);
        }
      } else {
        // New task - check ID collision
        let targetId = sourceId;
        if (destIndex.tasks[sourceId]) {
          const prefix = sourceId.slice(0, 6);
          const existing = Object.keys(destIndex.tasks)
            .filter((id) => id.startsWith(prefix))
            .map((id) => id.slice(6))
            .sort();
          const last = existing[existing.length - 1];
          targetId = `${prefix}${this.incrementLetter(last)}`;
        }

        // Import task with possibly renamed ID
        let taskContent = sourceContent;
        if (targetId !== sourceId) {
          taskContent = await this.markdownService.updateFrontmatter(
            sourceContent,
            { id: targetId },
          );
        }

        await this.taskRepo.saveContent(targetId, taskContent);

        await this.indexRepo.addEntry(targetId, {
          name: sourceInfo.name,
          desc: sourceInfo.desc,
          status: sourceInfo.status,
          created: sourceInfo.created,
          status_updated_at: sourceInfo.status_updated_at,
          done_at: sourceInfo.done_at,
        });

        results.push({
          id: targetId,
          status: "imported",
          warnings: targetId !== sourceId
            ? [`Renamed from ${sourceId} to ${targetId}`]
            : undefined,
        });
        imported++;
        tasksToRemove.push(sourceId);
      }
    }

    // Remove source tasks if requested
    if (input.removeSource && tasksToRemove.length > 0) {
      const updatedSourceTasks = { ...sourceIndex.tasks };
      for (const taskId of tasksToRemove) {
        await this.fs.remove(`${input.sourcePath}/tasks/${taskId}.md`);
        delete updatedSourceTasks[taskId];
      }

      await this.fs.writeFile(
        sourceIndexPath,
        JSON.stringify(
          { ...sourceIndex, tasks: updatedSourceTasks },
          null,
          2,
        ),
      );

      if (Object.keys(updatedSourceTasks).length === 0) {
        await this.fs.remove(input.sourcePath);
      }
    }

    return { imported, merged, skipped, tasks: results };
  }

  private parseDate(dateStr: string): Date {
    if (dateStr.includes("T")) return new Date(dateStr);
    if (dateStr.includes(" ")) {
      return new Date(dateStr.replace(" ", "T") + ":00");
    }
    return new Date(dateStr + "T00:00:00");
  }

  private incrementLetter(s: string): string {
    if (s === "z") return "aa";
    if (s.length === 1) return String.fromCharCode(s.charCodeAt(0) + 1);

    const chars = s.split("");
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] === "z") {
        chars[i] = "a";
        i--;
      } else {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        break;
      }
    }
    if (i < 0) chars.unshift("a");
    return chars.join("");
  }
}
