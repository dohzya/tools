// AssignScopeUseCase - Assign tasks to scope

import type { AssignOutput } from "../../entities/outputs.ts";
import type { Index } from "../../entities/index.ts";
import { WtError } from "../../entities/errors.ts";
import { resolveIdPrefix } from "../../entities/task-helpers.ts";
import type { DiscoveredScope } from "../../entities/scope.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";

export interface AssignScopeInput {
  readonly targetScopeId: string;
  readonly taskIds: readonly string[];
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export class AssignScopeUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
    private readonly markdownService: MarkdownService,
  ) {}

  async execute(input: AssignScopeInput): Promise<AssignOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scopes require git.",
      );
    }

    const targetWorklog = await this.resolveScopeIdentifier(
      input.targetScopeId,
      gitRoot,
      input.cwd,
      input.worklogDir,
      input.depthLimit,
    );

    const scopes = await this.scopeRepo.discoverScopes(
      gitRoot,
      input.depthLimit,
    );

    let assigned = 0;
    let merged = 0;
    const errors: Array<{ taskId: string; error: string }> = [];

    for (const taskIdPrefix of input.taskIds) {
      try {
        const found = await this.findTaskInScopes(
          taskIdPrefix,
          scopes,
          input.worklogDir,
        );

        if (!found) {
          errors.push({
            taskId: taskIdPrefix,
            error: "Task not found in any scope",
          });
          continue;
        }

        const { worklog: sourceWorklog, taskId } = found;

        if (sourceWorklog === targetWorklog) continue;

        // Load task content from source
        const sourceTaskPath = `${sourceWorklog}/tasks/${taskId}.md`;
        const taskContent = await this.fs.readFile(sourceTaskPath);
        const parsed = await this.markdownService.parseTaskFile(taskContent);

        // Load target index
        const targetIndexPath = `${targetWorklog}/index.json`;
        const targetIndexContent = await this.fs.readFile(targetIndexPath);
        const targetIndex = JSON.parse(targetIndexContent) as Index;

        // Check UID conflict
        let existingTaskId: string | undefined;
        for (const id of Object.keys(targetIndex.tasks)) {
          const destTaskPath = `${targetWorklog}/tasks/${id}.md`;
          if (await this.fs.exists(destTaskPath)) {
            const destContent = await this.fs.readFile(destTaskPath);
            const destParsed = await this.markdownService.parseTaskFile(
              destContent,
            );
            if (destParsed.meta.uid === parsed.meta.uid) {
              existingTaskId = id;
              break;
            }
          }
        }

        if (existingTaskId) {
          merged++;
          // Remove from source
          await this.fs.remove(sourceTaskPath);
          const sourceIndex = await this.loadIndex(sourceWorklog);
          const updatedTasks = { ...sourceIndex.tasks };
          delete updatedTasks[taskId];
          await this.fs.writeFile(
            `${sourceWorklog}/index.json`,
            JSON.stringify({ ...sourceIndex, tasks: updatedTasks }, null, 2),
          );
        } else {
          // Import as new task
          await this.fs.writeFile(
            `${targetWorklog}/tasks/${taskId}.md`,
            taskContent,
          );

          const updatedTargetTasks = {
            ...targetIndex.tasks,
            [taskId]: {
              name: parsed.meta.name,
              desc: parsed.meta.desc,
              status: parsed.meta.status,
              created: parsed.meta.created_at,
              status_updated_at: parsed.meta.created_at,
              done_at: parsed.meta.done_at,
            },
          };

          await this.fs.writeFile(
            targetIndexPath,
            JSON.stringify(
              { ...targetIndex, tasks: updatedTargetTasks },
              null,
              2,
            ),
          );

          assigned++;

          // Remove from source
          await this.fs.remove(sourceTaskPath);
          const sourceIndex = await this.loadIndex(sourceWorklog);
          const updatedTasks = { ...sourceIndex.tasks };
          delete updatedTasks[taskId];
          await this.fs.writeFile(
            `${sourceWorklog}/index.json`,
            JSON.stringify({ ...sourceIndex, tasks: updatedTasks }, null, 2),
          );
        }
      } catch (error) {
        errors.push({
          taskId: taskIdPrefix,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { assigned, merged, errors };
  }

  private async loadIndex(worklogPath: string): Promise<Index> {
    const indexPath = `${worklogPath}/index.json`;
    const content = await this.fs.readFile(indexPath);
    return JSON.parse(content) as Index;
  }

  private async findTaskInScopes(
    taskIdPrefix: string,
    scopes: readonly DiscoveredScope[],
    _worklogDir: string,
  ): Promise<{ worklog: string; taskId: string } | null> {
    const allTasks: Array<{ scope: string; taskId: string }> = [];

    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (await this.fs.exists(indexPath)) {
        try {
          const content = await this.fs.readFile(indexPath);
          const index = JSON.parse(content) as Index;
          for (const id of Object.keys(index.tasks)) {
            allTasks.push({ scope: scope.absolutePath, taskId: id });
          }
        } catch {
          continue;
        }
      }
    }

    // Exact match first
    for (const task of allTasks) {
      if (task.taskId === taskIdPrefix) {
        return { worklog: task.scope, taskId: task.taskId };
      }
    }

    // Prefix resolution
    const allIds = allTasks.map((t) => t.taskId);
    try {
      const resolvedId = resolveIdPrefix(taskIdPrefix, allIds);
      const task = allTasks.find((t) => t.taskId === resolvedId);
      if (task) {
        return { worklog: task.scope, taskId: task.taskId };
      }
    } catch {
      return null;
    }

    return null;
  }

  private async resolveScopeIdentifier(
    identifier: string,
    gitRoot: string,
    _cwd: string,
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
