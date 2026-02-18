/**
 * Adapter: JsonIndexRepository
 *
 * Implements the IndexRepository port using JSON file storage.
 * Reads/writes {worklogDir}/index.json.
 *
 * Replicates the exact behavior from cli.ts:
 *   - loadIndex / saveIndex
 *   - migrateIndexToV2 (v1 -> v2 migration)
 *
 * The migration logic is critical:
 *   - Converts "active" status to "created"
 *   - Renames "created" -> "created_at" in frontmatter
 *   - Adds ready_at, started_at to frontmatter
 *   - Extracts "name" from first line of "desc"
 *   - Updates index entries with name, status_updated_at
 *   - Sets version to 2
 *
 * Dependencies:
 *   - FileSystem (port) for file operations
 *   - MarkdownService (port) for parsing task files during migration
 */

import type { Index, IndexEntry } from "../../domain/entities/index.ts";
import { WtError } from "../../domain/entities/errors.ts";
import type { FileSystem } from "../../domain/ports/filesystem.ts";
import type { IndexRepository } from "../../domain/ports/index-repository.ts";
import type { MarkdownService } from "../../domain/ports/markdown-service.ts";

export class JsonIndexRepository implements IndexRepository {
  constructor(
    private readonly fs: FileSystem,
    private readonly markdownService: MarkdownService,
    private readonly indexPath: string,
    private readonly tasksDir: string,
  ) {}

  async load(): Promise<Index> {
    if (!(await this.fs.exists(this.indexPath))) {
      throw new WtError(
        "not_initialized",
        "Worktrack not initialized. Run 'wt init' first.",
      );
    }

    const content = await this.fs.readFile(this.indexPath);
    const index = JSON.parse(content) as Index;

    // Run migration if needed
    if (!index.version || index.version < 2) {
      await this.migrateToV2();
      // Reload index after migration
      const newContent = await this.fs.readFile(this.indexPath);
      return JSON.parse(newContent) as Index;
    }

    return index;
  }

  async save(index: Index): Promise<void> {
    await this.fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  async addEntry(taskId: string, entry: IndexEntry): Promise<void> {
    const index = await this.load();
    const mutableTasks = { ...index.tasks } as Record<string, IndexEntry>;
    mutableTasks[taskId] = entry;
    await this.save({ ...index, tasks: mutableTasks });
  }

  async updateEntry(
    taskId: string,
    updates: Partial<IndexEntry>,
  ): Promise<void> {
    const index = await this.load();
    const existing = index.tasks[taskId];
    if (!existing) {
      throw new WtError("task_not_found", `Task not found in index: ${taskId}`);
    }
    const mutableTasks = { ...index.tasks } as Record<string, IndexEntry>;
    mutableTasks[taskId] = { ...existing, ...updates };
    await this.save({ ...index, tasks: mutableTasks });
  }

  async removeEntry(taskId: string): Promise<void> {
    const index = await this.load();
    const mutableTasks = { ...index.tasks } as Record<string, IndexEntry>;
    delete mutableTasks[taskId];
    await this.save({ ...index, tasks: mutableTasks });
  }

  async exists(): Promise<boolean> {
    return await this.fs.exists(this.indexPath);
  }

  // =========================================================================
  // Migration: v1 -> v2
  // Exact replica of migrateIndexToV2() from cli.ts
  // =========================================================================

  private async migrateToV2(): Promise<void> {
    // Load index directly without triggering migration
    const content = await this.fs.readFile(this.indexPath);
    const index = JSON.parse(content) as Record<string, unknown> & {
      version?: number;
      tasks: Record<string, Record<string, unknown>>;
    };

    // Check if migration is needed
    if (index.version === 2) {
      return; // Already migrated
    }

    console.error("Migrating worklog to v2...");

    // Get all task IDs
    const taskIds = Object.keys(index.tasks);

    // Migrate each task
    for (const taskId of taskIds) {
      const indexEntry = index.tasks[taskId];

      // Load task file
      const taskPath = `${this.tasksDir}/${taskId}.md`;
      if (!(await this.fs.exists(taskPath))) {
        continue; // Skip missing task files
      }

      const taskContent = await this.fs.readFile(taskPath);
      const parsed = await this.markdownService.parseTaskFile(taskContent);
      const frontmatter = { ...parsed.meta } as Record<string, unknown>;

      // 1. Convert active status to created (NOT started)
      if (frontmatter.status === "active") {
        frontmatter.status = "created";
        indexEntry.status = "created";
      }

      // 2. Rename 'created' to 'created_at' in frontmatter
      if ("created" in frontmatter) {
        frontmatter.created_at = frontmatter.created;
        delete frontmatter.created;
      }

      // 3. Initialize new timestamp fields
      frontmatter.ready_at = null;
      frontmatter.started_at = null;

      // 4. Extract name from desc (first line)
      const desc = String(frontmatter.desc || "");
      const descLines = desc.split("\n");
      const name = descLines[0].trim();
      frontmatter.name = name;
      // Keep full desc unchanged

      // 5. Update index entry
      indexEntry.name = name;
      indexEntry.status_updated_at = String(frontmatter.created_at || "");

      // Ensure index has created field (no _at suffix)
      if (!indexEntry.created && frontmatter.created_at) {
        indexEntry.created = String(frontmatter.created_at);
      }

      // Save updated task file using updateFrontmatter
      const updatedContent = await this.markdownService.updateFrontmatter(
        taskContent,
        frontmatter,
      );
      await this.fs.writeFile(taskPath, updatedContent);
    }

    // Set version to 2
    index.version = 2;
    await this.fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));

    console.error(`Migration complete. ${taskIds.length} tasks updated.`);
  }
}
