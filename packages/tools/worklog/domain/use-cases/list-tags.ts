// ListTagsUseCase - List/manage tags

import type { Index } from "../entities/index.ts";
import { WtError } from "../entities/errors.ts";
import { validateTag } from "../entities/task-helpers.ts";
import type { IndexRepository } from "../ports/index-repository.ts";
import type { TaskRepository } from "../ports/task-repository.ts";
import type { ScopeRepository } from "../ports/scope-repository.ts";
import type { FileSystem } from "../ports/filesystem.ts";
import type { MarkdownService } from "../ports/markdown-service.ts";

export interface ListTagsInput {
  readonly gitRoot: string | null;
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export interface ListTagsOutput {
  readonly tags: ReadonlyArray<{ tag: string; count: number }>;
}

export interface ManageTagsInput {
  readonly taskId?: string;
  readonly addTags?: readonly string[];
  readonly removeTags?: readonly string[];
  readonly gitRoot: string | null;
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export interface ManageTagsOutput {
  readonly tags?: readonly string[];
  readonly allTags?: ReadonlyArray<{ tag: string; count: number }>;
}

export class ListTagsUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly markdownService: MarkdownService,
  ) {}

  async listAll(input: ListTagsInput): Promise<ListTagsOutput> {
    const tagCounts = new Map<string, number>();

    const scopes = input.gitRoot
      ? await this.scopeRepo.discoverScopes(input.gitRoot, input.depthLimit)
      : [{
        absolutePath: `${input.cwd}/${input.worklogDir}`,
        id: ".",
        relativePath: ".",
        isParent: false,
      }];

    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (!(await this.fs.exists(indexPath))) continue;

      const content = await this.fs.readFile(indexPath);
      const index = JSON.parse(content) as Index;
      for (const task of Object.values(index.tasks)) {
        if (task.tags) {
          for (const tag of task.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }
    }

    const tags = Array.from(tagCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));

    return { tags };
  }

  async manageTags(input: ManageTagsInput): Promise<ManageTagsOutput> {
    // Case 1: No taskId -> list all tags
    if (!input.taskId) {
      const result = await this.listAll(input);
      return { allTags: result.tags };
    }

    // Validate add tags
    if (input.addTags?.length) {
      for (const tag of input.addTags) {
        const error = validateTag(tag);
        if (error) {
          throw new WtError("invalid_args", `Invalid tag '${tag}': ${error}`);
        }
      }
    }

    const index = await this.indexRepo.load();
    const taskId = this.resolveTaskId(input.taskId, Object.keys(index.tasks));

    // Case 2: taskId only -> show task tags
    if (!input.addTags?.length && !input.removeTags?.length) {
      const taskData = await this.taskRepo.findById(taskId);
      if (!taskData) {
        throw new WtError("task_not_found", `Task not found: ${taskId}`);
      }
      const tags = taskData.meta.tags ? [...taskData.meta.tags] : [];
      return { tags };
    }

    // Case 3: Modify tags
    const taskData = await this.taskRepo.findById(taskId);
    if (!taskData) {
      throw new WtError("task_not_found", `Task not found: ${taskId}`);
    }

    const currentTags = taskData.meta.tags ? [...taskData.meta.tags] : [];
    const tagSet = new Set(currentTags);

    input.addTags?.forEach((t) => tagSet.add(t));
    input.removeTags?.forEach((t) => tagSet.delete(t));

    const newTags = Array.from(tagSet).sort();
    const tagsValue = newTags.length > 0 ? newTags : undefined;

    // Save task
    let content = await this.taskRepo.loadContent(taskId);
    content = await this.markdownService.updateFrontmatter(content, {
      tags: tagsValue,
    });
    await this.taskRepo.saveContent(taskId, content);

    // Update index
    await this.indexRepo.updateEntry(taskId, {
      tags: tagsValue,
    });

    return { tags: newTags };
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
