// ExportScopeUseCase - Export scope tasks with tag to new child worklog

import type { Index, IndexEntry } from "../../entities/index.ts";
import { WtError } from "../../entities/errors.ts";
import { matchesTagPattern, validateTag } from "../../entities/task-helpers.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface ExportScopeInput {
  readonly tagPattern: string;
  readonly targetPath: string;
  readonly removeTag?: boolean;
  readonly customScopeId?: string;
  readonly gitRoot: string | null;
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export interface ExportScopeOutput {
  readonly exported: number;
  readonly scopeId: string;
  readonly targetPath: string;
}

export class ExportScopeUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: ExportScopeInput): Promise<ExportScopeOutput> {
    const error = validateTag(input.tagPattern);
    if (error) {
      throw new WtError(
        "invalid_args",
        `Invalid tag '${input.tagPattern}': ${error}`,
      );
    }

    if (!input.gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Export requires git.",
      );
    }

    const scopeId = input.customScopeId || input.tagPattern;

    // Find matching tasks across scopes
    const scopes = await this.scopeRepo.discoverScopes(
      input.gitRoot,
      input.depthLimit,
    );

    const matchingTasks: Array<{
      id: string;
      scopePath: string;
      indexEntry: Index["tasks"][string];
    }> = [];

    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (!(await this.fs.exists(indexPath))) continue;

      const content = await this.fs.readFile(indexPath);
      const index = JSON.parse(content) as Index;

      for (const [id, task] of Object.entries(index.tasks)) {
        const tags = task.tags ?? [];
        if (tags.some((tag) => matchesTagPattern(input.tagPattern, tag))) {
          matchingTasks.push({
            id,
            scopePath: scope.absolutePath,
            indexEntry: task,
          });
        }
      }
    }

    if (matchingTasks.length === 0) {
      throw new WtError(
        "task_not_found",
        `No tasks with tag: ${input.tagPattern}`,
      );
    }

    // Resolve target path
    const absoluteTargetPath = input.targetPath.startsWith("/")
      ? input.targetPath
      : `${input.cwd}/${input.targetPath}`;
    const targetWorklogPath = `${absoluteTargetPath}/${input.worklogDir}`;

    // Check if target exists and has tasks
    if (await this.fs.exists(targetWorklogPath)) {
      const targetIndexPath = `${targetWorklogPath}/index.json`;
      if (await this.fs.exists(targetIndexPath)) {
        const targetIndex = JSON.parse(
          await this.fs.readFile(targetIndexPath),
        ) as Index;
        if (Object.keys(targetIndex.tasks).length > 0) {
          throw new WtError(
            "invalid_state",
            `Target worklog has ${
              Object.keys(targetIndex.tasks).length
            } tasks. Choose different path.`,
          );
        }
      }
    }

    // Create target directory
    await this.fs.ensureDir(`${targetWorklogPath}/tasks`);

    // Initialize target index
    const targetIndex: { version: number; tasks: Record<string, IndexEntry> } =
      {
        version: 2,
        tasks: {},
      };

    // Copy tasks
    for (const { id, scopePath, indexEntry } of matchingTasks) {
      const sourceTaskPath = `${scopePath}/tasks/${id}.md`;
      let content = await this.fs.readFile(sourceTaskPath);

      // Adjust tags
      const currentTags = indexEntry.tags ?? [];
      const newTags = input.removeTag
        ? (currentTags as string[])
          .filter((t) => !matchesTagPattern(input.tagPattern, t))
          .map((t) =>
            t.startsWith(input.tagPattern + "/")
              ? t.slice(input.tagPattern.length + 1)
              : t
          )
        : [...currentTags];

      // Update tags in frontmatter
      const tagUpdate = newTags.length > 0 ? newTags : undefined;
      content = await this.markdownService.updateFrontmatter(content, {
        tags: tagUpdate,
      });

      // Save to target
      await this.fs.writeFile(
        `${targetWorklogPath}/tasks/${id}.md`,
        content,
      );

      // Add to target index
      targetIndex.tasks[id] = {
        ...indexEntry,
        tags: tagUpdate,
      };

      // Remove from source
      await this.fs.remove(sourceTaskPath);
      const sourceIndexPath = `${scopePath}/index.json`;
      const sourceIndexContent = await this.fs.readFile(sourceIndexPath);
      const sourceIndex = JSON.parse(sourceIndexContent) as Index;
      const updatedTasks = { ...sourceIndex.tasks };
      delete updatedTasks[id];
      await this.fs.writeFile(
        sourceIndexPath,
        JSON.stringify({ ...sourceIndex, tasks: updatedTasks }, null, 2),
      );
    }

    // Save target index
    await this.fs.writeFile(
      `${targetWorklogPath}/index.json`,
      JSON.stringify(targetIndex, null, 2),
    );

    // Create scope.json in target (child)
    const gitRoot = input.gitRoot;
    const relativeToGitRoot = this.calculateRelativePath(
      absoluteTargetPath,
      gitRoot,
    );
    await this.scopeRepo.saveConfig(targetWorklogPath, {
      parent: relativeToGitRoot,
    });

    // Update parent scope.json
    const parentWorklogPath = `${gitRoot}/${input.worklogDir}`;
    const parentConfig = await this.scopeRepo.loadConfig(parentWorklogPath);

    const children = parentConfig && "children" in parentConfig
      ? [...parentConfig.children]
      : [];

    const relativePath = this.calculateRelativePath(
      gitRoot,
      absoluteTargetPath,
    );
    children.push({
      path: relativePath,
      id: scopeId,
      type: "path",
    });

    await this.scopeRepo.saveConfig(parentWorklogPath, { children });

    return {
      exported: matchingTasks.length,
      scopeId,
      targetPath: absoluteTargetPath,
    };
  }

  private calculateRelativePath(from: string, to: string): string {
    const fromParts = from.split("/").filter((p) => p);
    const toParts = to.split("/").filter((p) => p);

    let commonLength = 0;
    while (
      commonLength < fromParts.length &&
      commonLength < toParts.length &&
      fromParts[commonLength] === toParts[commonLength]
    ) {
      commonLength++;
    }

    const upCount = fromParts.length - commonLength;
    const downParts = toParts.slice(commonLength);
    const relativeParts = [...Array(upCount).fill(".."), ...downParts];

    return relativeParts.length > 0 ? relativeParts.join("/") : ".";
  }
}
