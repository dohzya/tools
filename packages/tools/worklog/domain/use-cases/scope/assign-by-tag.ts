// AssignByTagUseCase - Assign tasks with a given tag to a scope, removing the tag

import type { Index } from "../../entities/index.ts";
import { WtError } from "../../entities/errors.ts";
import { matchesTagPattern } from "../../entities/task-helpers.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import { ExplicitCast } from "../../../../explicit-cast.ts";

export interface AssignByTagInput {
  readonly scopeId: string;
  readonly tag: string;
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export type AssignByTagOutput = {
  readonly moved: number;
  readonly updated: number;
  readonly errors: ReadonlyArray<{
    readonly taskId: string;
    readonly error: string;
  }>;
};

export class AssignByTagUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: AssignByTagInput): Promise<AssignByTagOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scopes require git.",
      );
    }

    const targetWorklog = await this.resolveScopeIdentifier(
      input.scopeId,
      gitRoot,
      input.worklogDir,
      input.depthLimit,
    );

    const scopes = await this.scopeRepo.discoverScopes(
      gitRoot,
      input.depthLimit,
    );

    // Collect matching tasks across all scopes
    const matchingTasks: Array<{ taskId: string; scopePath: string }> = [];
    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (!(await this.fs.exists(indexPath))) continue;
      try {
        const content = await this.fs.readFile(indexPath);
        const index = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
          Index
        >();
        for (const [id, task] of Object.entries(index.tasks)) {
          const tags = task.tags ?? [];
          if (tags.some((t) => matchesTagPattern(input.tag, t))) {
            matchingTasks.push({ taskId: id, scopePath: scope.absolutePath });
          }
        }
      } catch {
        continue;
      }
    }

    let moved = 0;
    let updated = 0;
    const errors: Array<{ taskId: string; error: string }> = [];

    for (const { taskId, scopePath } of matchingTasks) {
      try {
        const sourceTaskPath = `${scopePath}/tasks/${taskId}.md`;
        const taskContent = await this.fs.readFile(sourceTaskPath);

        // Load source index entry (used as base for target entry)
        const sourceIndex = await this.loadIndex(scopePath);
        const sourceEntry = sourceIndex.tasks[taskId];

        // Compute new tags: remove matched tag, strip prefix from sub-tags
        const currentTags = sourceEntry.tags ?? [];
        const newTags = currentTags
          .filter((t) => !matchesTagPattern(input.tag, t))
          .map((t) =>
            t.startsWith(input.tag + "/") ? t.slice(input.tag.length + 1) : t
          );

        const updatedContent = await this.markdownService.updateFrontmatter(
          taskContent,
          { tags: newTags.length > 0 ? newTags : undefined },
        );

        const updatedEntry = {
          ...sourceEntry,
          tags: newTags.length > 0 ? newTags : undefined,
        };

        if (scopePath === targetWorklog) {
          // Already in target scope: update file and index in place
          await this.fs.writeFile(sourceTaskPath, updatedContent);
          await this.fs.writeFile(
            `${scopePath}/index.json`,
            JSON.stringify(
              {
                ...sourceIndex,
                tasks: { ...sourceIndex.tasks, [taskId]: updatedEntry },
              },
              null,
              2,
            ),
          );
          updated++;
        } else {
          // Move to target scope
          await this.fs.writeFile(
            `${targetWorklog}/tasks/${taskId}.md`,
            updatedContent,
          );

          const targetIndex = await this.loadIndex(targetWorklog);
          await this.fs.writeFile(
            `${targetWorklog}/index.json`,
            JSON.stringify(
              {
                ...targetIndex,
                tasks: { ...targetIndex.tasks, [taskId]: updatedEntry },
              },
              null,
              2,
            ),
          );

          await this.fs.remove(sourceTaskPath);
          const updatedSourceTasks = { ...sourceIndex.tasks };
          delete updatedSourceTasks[taskId];
          await this.fs.writeFile(
            `${scopePath}/index.json`,
            JSON.stringify(
              { ...sourceIndex, tasks: updatedSourceTasks },
              null,
              2,
            ),
          );

          moved++;
        }
      } catch (error) {
        errors.push({
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { moved, updated, errors };
  }

  private async loadIndex(worklogPath: string): Promise<Index> {
    const indexPath = `${worklogPath}/index.json`;
    const content = await this.fs.readFile(indexPath);
    return ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<Index>();
  }

  private async resolveScopeIdentifier(
    identifier: string,
    gitRoot: string,
    worklogDir: string,
    depthLimit: number,
  ): Promise<string> {
    if (identifier === "/") {
      return `${gitRoot}/${worklogDir}`;
    }

    const scopes = await this.scopeRepo.discoverScopes(gitRoot, depthLimit);
    const byPath = scopes.find((s) => s.relativePath === identifier);
    if (byPath) return byPath.absolutePath;

    const rootConfig = await this.scopeRepo.loadConfig(
      `${gitRoot}/${worklogDir}`,
    );
    if (rootConfig && "children" in rootConfig) {
      const matches = rootConfig.children.filter((c) => c.id === identifier);
      if (matches.length === 1) {
        const childPath = matches[0].path;
        return childPath.startsWith("/")
          ? `${childPath}/${worklogDir}`
          : `${gitRoot}/${childPath}/${worklogDir}`;
      }
    }

    throw new WtError("scope_not_found", `Scope not found: ${identifier}`);
  }
}
