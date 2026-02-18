// ListScopesUseCase - List all scopes or show scope details

import type {
  ScopeDetailOutput,
  ScopesOutput,
} from "../../entities/outputs.ts";
import { WtError } from "../../entities/errors.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";
import type { Index } from "../../entities/index.ts";

export interface ListScopesInput {
  readonly cwd: string;
  readonly refresh?: boolean;
  readonly scopeId?: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export class ListScopesUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
  ) {}

  async execute(
    input: ListScopesInput,
  ): Promise<ScopesOutput | ScopeDetailOutput> {
    if (input.scopeId) {
      return await this.showScopeDetail(input);
    }
    return await this.listAllScopes(input);
  }

  private async showScopeDetail(
    input: ListScopesInput,
  ): Promise<ScopeDetailOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scope details require git.",
      );
    }

    const worklogPath = await this.resolveScopeIdentifier(
      input.scopeId!,
      gitRoot,
      input.cwd,
      input.worklogDir,
      input.depthLimit,
    );

    const indexPath = `${worklogPath}/index.json`;
    if (!(await this.fs.exists(indexPath))) {
      throw new WtError("not_initialized", `No worklog at: ${worklogPath}`);
    }

    const content = await this.fs.readFile(indexPath);
    const index = JSON.parse(content) as Index;
    const taskCount = Object.keys(index.tasks).length;

    const relativePath = worklogPath.slice(gitRoot.length + 1);
    const path = relativePath.slice(0, -input.worklogDir.length - 1) || ".";

    return {
      id: input.scopeId!,
      path,
      taskCount,
    };
  }

  private async listAllScopes(input: ListScopesInput): Promise<ScopesOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);

    // Try parent-based listing first
    const currentWorklog = await this.findNearestWorklog(
      input.cwd,
      null,
      input.worklogDir,
    );
    if (currentWorklog) {
      const config = await this.scopeRepo.loadConfig(currentWorklog);
      if (config && "parent" in config && config.parent) {
        try {
          const childDir = currentWorklog.slice(
            0,
            -input.worklogDir.length - 1,
          );
          // Resolve parent path
          const parentDir = this.resolveRelativePath(childDir, config.parent);
          const parentWorklogPath = `${parentDir}/${input.worklogDir}`;

          if (await this.fs.exists(parentWorklogPath)) {
            return await this.listScopesFromParent(
              parentWorklogPath,
              currentWorklog,
              input.worklogDir,
            );
          }
        } catch {
          // Fall through to git-based discovery
        }
      }
    }

    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository and no parent scope configured.",
      );
    }

    const scopes = await this.scopeRepo.discoverScopes(
      gitRoot,
      input.depthLimit,
    );

    // Determine active scope
    const activeScope = await this.resolveActiveScope(
      input.cwd,
      null,
      gitRoot,
      input.worklogDir,
    );

    return {
      scopes: scopes.map((s) => ({
        id: s.id,
        path: s.relativePath === "."
          ? input.worklogDir + "/"
          : s.relativePath + "/" + input.worklogDir + "/",
        isActive: s.absolutePath === activeScope,
      })),
    };
  }

  private async listScopesFromParent(
    parentWorklogPath: string,
    activeWorklogPath: string,
    worklogDir: string,
  ): Promise<ScopesOutput> {
    const parentDir = parentWorklogPath.slice(0, -worklogDir.length - 1);
    const parentConfig = await this.scopeRepo.loadConfig(parentWorklogPath);

    if (!parentConfig || !("children" in parentConfig)) {
      return { scopes: [] };
    }

    const scopes: Array<{ id: string; path: string; isActive: boolean }> = [];

    const parentDirName = parentDir.split("/").pop() ?? "parent";
    scopes.push({
      id: parentDirName,
      path: worklogDir + "/",
      isActive: parentWorklogPath === activeWorklogPath,
    });

    for (const child of parentConfig.children) {
      const childDir = this.resolveRelativePath(parentDir, child.path);
      const childWorklogPath = `${childDir}/${worklogDir}`;
      if (!(await this.fs.exists(childWorklogPath))) continue;

      scopes.push({
        id: child.id,
        path: child.path + "/" + worklogDir + "/",
        isActive: childWorklogPath === activeWorklogPath,
      });
    }

    return { scopes };
  }

  private async findNearestWorklog(
    cwd: string,
    stopAt: string | null,
    worklogDir: string,
  ): Promise<string | null> {
    let current = cwd;

    while (true) {
      const worklogPath = `${current}/${worklogDir}`;
      if (await this.fs.exists(worklogPath)) {
        return worklogPath;
      }

      if (stopAt && current === stopAt) break;

      const parent = current.split("/").slice(0, -1).join("/");
      if (!parent || parent === current) break;

      current = parent;
    }

    return null;
  }

  private async resolveActiveScope(
    cwd: string,
    _flagScope: string | null,
    gitRoot: string | null,
    worklogDir: string,
  ): Promise<string> {
    const nearest = await this.findNearestWorklog(cwd, gitRoot, worklogDir);
    if (nearest) return nearest;

    if (gitRoot) {
      const rootWorklog = `${gitRoot}/${worklogDir}`;
      if (await this.fs.exists(rootWorklog)) {
        return rootWorklog;
      }
    }

    return `${cwd}/${worklogDir}`;
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

  private resolveRelativePath(base: string, relative: string): string {
    if (relative.startsWith("/")) return relative;
    const parts = base.split("/").filter((p) => p);
    for (const part of relative.split("/").filter((p) => p)) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    return "/" + parts.join("/");
  }
}
