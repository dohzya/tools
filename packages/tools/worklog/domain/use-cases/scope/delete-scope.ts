// DeleteScopeUseCase - Delete scope

import type { StatusOutput } from "../../entities/outputs.ts";
import { WtError } from "../../entities/errors.ts";
import type { Index } from "../../entities/index.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";

export interface DeleteScopeInput {
  readonly scopeId: string;
  readonly moveTo?: string;
  readonly deleteTasks?: boolean;
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export class DeleteScopeUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
  ) {}

  async execute(input: DeleteScopeInput): Promise<StatusOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scopes require git.",
      );
    }

    const worklogPath = await this.resolveScopeIdentifier(
      input.scopeId,
      gitRoot,
      input.cwd,
      input.worklogDir,
      input.depthLimit,
    );

    // Load index to check for tasks
    const indexPath = `${worklogPath}/index.json`;
    if (!(await this.fs.exists(indexPath))) {
      throw new WtError("not_initialized", `No worklog at: ${worklogPath}`);
    }

    const content = await this.fs.readFile(indexPath);
    const index = JSON.parse(content) as Index;
    const taskCount = Object.keys(index.tasks).length;

    if (taskCount > 0) {
      if (input.moveTo) {
        // Note: actual task moving would be done by AssignScopeUseCase
        // For now, indicate the need to move
        throw new WtError(
          "scope_has_tasks",
          `Scope has ${taskCount} task(s). Move tasks first using 'wl scopes assign ${input.moveTo} ...'`,
        );
      } else if (!input.deleteTasks) {
        throw new WtError(
          "scope_has_tasks",
          `Scope has ${taskCount} task(s). Use --move-to <scope-id> or --delete-tasks`,
        );
      }
    }

    // Delete .worklog directory
    await this.fs.remove(worklogPath);

    // Refresh hierarchy
    const scopes = await this.scopeRepo.discoverScopes(
      gitRoot,
      input.depthLimit,
    );
    // Refresh parent scope.json
    const rootScope = scopes.find((s) => s.isParent);
    if (rootScope) {
      const _childScopes = scopes.filter((s) => !s.isParent);
      const rootConfig = await this.scopeRepo.loadConfig(
        rootScope.absolutePath,
      );

      if (rootConfig && "children" in rootConfig) {
        const updatedChildren = rootConfig.children.filter((c) => {
          const childPath = c.path.startsWith("/")
            ? `${c.path}/${input.worklogDir}`
            : `${gitRoot}/${c.path}/${input.worklogDir}`;
          return childPath !== worklogPath;
        });
        await this.scopeRepo.saveConfig(rootScope.absolutePath, {
          children: updatedChildren,
        });
      }
    }

    return { status: "scope_deleted" };
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
