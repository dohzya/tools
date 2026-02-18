// ImportScopeToTagUseCase - Import scope hierarchy as tags

import type { ImportOutput } from "../../entities/outputs.ts";
import { WtError } from "../../entities/errors.ts";
import { validateTag } from "../../entities/task-helpers.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import type { GitService } from "../../ports/git-service.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import { ImportTasksUseCase } from "./import-tasks.ts";

export interface ImportScopeToTagInput {
  readonly sourcePath: string;
  readonly removeSource: boolean;
  readonly customTagName?: string;
  readonly gitRoot: string | null;
  readonly worklogDir: string;
}

export interface ImportScopeToTagOutput extends ImportOutput {
  readonly tag: string;
}

export class ImportScopeToTagUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly taskRepo: TaskRepository,
    private readonly fs: FileSystem,
    private readonly markdownService: MarkdownService,
    private readonly gitService: GitService,
    private readonly scopeRepo: ScopeRepository,
  ) {}

  async execute(input: ImportScopeToTagInput): Promise<ImportScopeToTagOutput> {
    // Get source scope ID
    const sourceDir = this.dirname(input.sourcePath);
    let scopeId: string;

    if (input.gitRoot) {
      scopeId = await this.getScopeId(
        sourceDir,
        input.gitRoot,
        input.worklogDir,
      );
    } else {
      scopeId = sourceDir.split("/").pop() ?? sourceDir;
    }

    const tagName = input.customTagName || scopeId;

    const error = validateTag(tagName);
    if (error) {
      throw new WtError("invalid_args", `Invalid tag '${tagName}': ${error}`);
    }

    // Import tasks using ImportTasksUseCase
    const importUseCase = new ImportTasksUseCase(
      this.indexRepo,
      this.taskRepo,
      this.fs,
      this.markdownService,
    );

    const importResult = await importUseCase.execute({
      sourcePath: input.sourcePath,
      removeSource: input.removeSource,
    });

    // Add tag to imported tasks (not merged ones)
    for (const taskResult of importResult.tasks) {
      if (taskResult.status !== "imported") continue;

      const taskId = taskResult.id;
      let content = await this.taskRepo.loadContent(taskId);
      const parsed = await this.markdownService.parseTaskFile(content);

      const currentTags = parsed.meta.tags ? [...parsed.meta.tags] : [];
      const tagSet = new Set(currentTags);
      tagSet.add(tagName);
      const newTags = Array.from(tagSet).sort();

      content = await this.markdownService.updateFrontmatter(content, {
        tags: newTags,
      });
      await this.taskRepo.saveContent(taskId, content);

      // Update index
      await this.indexRepo.updateEntry(taskId, { tags: newTags });
    }

    return { ...importResult, tag: tagName };
  }

  private dirname(path: string): string {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  }

  private async getScopeId(
    worklogDir: string,
    gitRoot: string,
    worklogDirName: string,
  ): Promise<string> {
    if (!worklogDir.startsWith(gitRoot)) {
      return worklogDir.split("/").pop() ?? worklogDir;
    }

    const relativePath = worklogDir.slice(gitRoot.length + 1);
    if (relativePath === "" || relativePath === ".") return "(root)";

    // Try to get custom ID from root config
    const rootConfig = await this.scopeRepo.loadConfig(
      `${gitRoot}/${worklogDirName}`,
    );

    if (rootConfig && "children" in rootConfig) {
      const child = rootConfig.children.find((c) => c.path === relativePath);
      if (child) return child.id;
    }

    return relativePath;
  }
}
