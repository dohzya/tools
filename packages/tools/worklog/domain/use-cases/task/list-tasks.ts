// ListTasksUseCase - List tasks with filtering (VERY COMPLEX)
// Handles scopes, tags, filtering, status matching

import type { Index, IndexEntry } from "../../entities/index.ts";
import type { ListOutput, ListTaskItem } from "../../entities/outputs.ts";
import type { TaskStatus } from "../../entities/task.ts";
import type { ScopeConfig } from "../../entities/scope.ts";
import { WtError } from "../../entities/errors.ts";
import { matchesTagPattern } from "../../entities/task-helpers.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";

export interface ListTasksInput {
  readonly showAll: boolean;
  readonly statusFilters?: readonly TaskStatus[];
  readonly filterPattern?: string;
  readonly baseDir?: string;
  readonly scopeIdentifier?: string;
  readonly allScopes?: boolean;
  readonly gitRoot?: string | null;
  readonly currentScope?: string;
  readonly cwd?: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export class ListTasksUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
  ) {}

  async execute(input: ListTasksInput): Promise<ListOutput> {
    const defaultStatuses: TaskStatus[] = ["created", "ready", "started"];
    const allowedStatuses = input.statusFilters ?? defaultStatuses;
    const matchStatus = (status: string) =>
      input.showAll || allowedStatuses.includes(status as TaskStatus);

    const tasks: ListTaskItem[] = [];

    // Handle unified tag/scope filtering
    if (input.filterPattern && input.gitRoot && input.cwd) {
      return await this.filterByTagOrScope(
        input.filterPattern,
        input.gitRoot,
        input.cwd,
        input.worklogDir,
        input.depthLimit,
        matchStatus,
      );
    }

    // All scopes listing
    if (input.allScopes && input.gitRoot) {
      const scopes = await this.scopeRepo.discoverScopes(
        input.gitRoot,
        input.depthLimit,
      );

      for (const scope of scopes) {
        const indexPath = `${scope.absolutePath}/index.json`;
        if (!(await this.fs.exists(indexPath))) continue;

        const content = await this.fs.readFile(indexPath);
        const index = JSON.parse(content) as Index;
        const scopeId = await this.getScopeId(
          scope.absolutePath,
          input.gitRoot,
          input.worklogDir,
        );

        const scopeTasks = Object.entries(index.tasks)
          .filter(([_, t]) => matchStatus(t.status))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, t]) => ({
            id,
            name: t.name ?? t.desc,
            desc: t.desc,
            status: t.status,
            created: this.formatShort(t.created),
            scopePrefix: scopeId,
            tags: t.tags,
          }));

        tasks.push(...scopeTasks);
      }

      return { tasks };
    }

    // Specific scope
    if (input.scopeIdentifier && input.gitRoot && input.cwd) {
      const worklogPath = await this.resolveScopeIdentifier(
        input.scopeIdentifier,
        input.gitRoot,
        input.cwd,
        input.worklogDir,
        input.depthLimit,
      );
      const indexPath = `${worklogPath}/index.json`;

      if (!(await this.fs.exists(indexPath))) {
        throw new WtError(
          "not_initialized",
          `Worklog not found at: ${worklogPath}`,
        );
      }

      const content = await this.fs.readFile(indexPath);
      const index = JSON.parse(content) as Index;

      const scopeTasks = Object.entries(index.tasks)
        .filter(([_, t]) => matchStatus(t.status))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, t]) => ({
          id,
          name: t.name ?? t.desc,
          desc: t.desc,
          status: t.status,
          created: this.formatShort(t.created),
          tags: t.tags,
        }));

      return { tasks: scopeTasks };
    }

    // Current scope + children
    if (input.gitRoot && input.currentScope) {
      return await this.listCurrentScopeWithChildren(
        input.currentScope,
        input.gitRoot,
        input.cwd ?? "",
        input.worklogDir,
        input.depthLimit,
        matchStatus,
      );
    }

    // Single worklog fallback
    let index: Index;
    if (input.baseDir) {
      const indexPath = `${input.baseDir}/index.json`;
      if (!(await this.fs.exists(indexPath))) {
        throw new WtError(
          "not_initialized",
          `Worklog not found at: ${input.baseDir}`,
        );
      }
      const content = await this.fs.readFile(indexPath);
      index = JSON.parse(content) as Index;
    } else {
      index = await this.indexRepo.load();
    }

    const singleTasks = Object.entries(index.tasks)
      .filter(([_, t]) => matchStatus(t.status))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, t]) => ({
        id,
        name: t.name ?? t.desc,
        desc: t.desc,
        status: t.status,
        created: this.formatShort(t.created),
        tags: t.tags,
      }));

    return { tasks: singleTasks };
  }

  private async filterByTagOrScope(
    filterPattern: string,
    gitRoot: string,
    cwd: string,
    worklogDir: string,
    depthLimit: number,
    matchStatus: (status: string) => boolean,
  ): Promise<ListOutput> {
    // Try tag filtering first
    const taggedTasks = await this.findTasksByTagPattern(
      filterPattern,
      gitRoot,
      cwd,
      worklogDir,
      depthLimit,
    );

    if (taggedTasks.length > 0) {
      const filteredTasks = taggedTasks
        .filter(({ task }) => matchStatus(task.status))
        .map(({ id, task }) => ({
          id,
          name: task.name ?? task.desc,
          desc: task.desc,
          status: task.status,
          created: this.formatShort(task.created),
          scopePrefix: undefined,
          tags: task.tags,
          filterPattern,
        }));

      return { tasks: filteredTasks };
    }

    // Fall back to scope filtering
    try {
      const worklogPath = await this.resolveScopeIdentifier(
        filterPattern,
        gitRoot,
        cwd,
        worklogDir,
        depthLimit,
      );
      const indexPath = `${worklogPath}/index.json`;

      if (await this.fs.exists(indexPath)) {
        const content = await this.fs.readFile(indexPath);
        const index = JSON.parse(content) as Index;

        const scopeTasks = Object.entries(index.tasks)
          .filter(([_, t]) => matchStatus(t.status))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, t]) => ({
            id,
            name: t.name ?? t.desc,
            desc: t.desc,
            status: t.status,
            created: this.formatShort(t.created),
            scopePrefix: undefined,
            tags: t.tags,
            filterPattern,
          }));

        return { tasks: scopeTasks };
      }
    } catch {
      // No scope matching either
    }

    throw new WtError(
      "task_not_found",
      `No tag or scope matching: ${filterPattern}`,
    );
  }

  private async listCurrentScopeWithChildren(
    currentScope: string,
    gitRoot: string,
    cwd: string,
    worklogDir: string,
    depthLimit: number,
    matchStatus: (status: string) => boolean,
  ): Promise<ListOutput> {
    const tasks: ListTaskItem[] = [];
    const currentScopeId = await this.getScopeId(
      currentScope,
      gitRoot,
      worklogDir,
    );

    // Check if child worklog
    const isChild = await this.isChildWorklog(currentScope);

    // Load current scope tasks (no prefix)
    const currentIndexPath = `${currentScope}/index.json`;
    if (await this.fs.exists(currentIndexPath)) {
      const content = await this.fs.readFile(currentIndexPath);
      const index = JSON.parse(content) as Index;

      const currentTasks = Object.entries(index.tasks)
        .filter(([_, t]) => matchStatus(t.status))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, t]) => ({
          id,
          name: t.name ?? t.desc,
          desc: t.desc,
          status: t.status,
          created: this.formatShort(t.created),
          tags: t.tags,
        }));

      tasks.push(...currentTasks);
    }

    // Parent tag pull: if child, include parent tasks with matching tags
    if (isChild && currentScopeId && currentScopeId !== ".") {
      try {
        const parentScope = await this.getParentScope(currentScope);
        const parentTasks = await this.findTasksByTagPattern(
          currentScopeId,
          gitRoot,
          cwd,
          worklogDir,
          depthLimit,
        );

        const parentWorklogPath = `${parentScope}/${worklogDir}`;
        const activeParentTasks = parentTasks
          .filter(({ task, scopePath }) =>
            matchStatus(task.status) &&
            scopePath === parentWorklogPath
          )
          .map(({ id, task }) => ({
            id,
            name: task.name ?? task.desc,
            desc: task.desc,
            status: task.status,
            created: this.formatShort(task.created),
            scopePrefix: "\u2B06",
            tags: task.tags,
          }));

        tasks.push(...activeParentTasks);
      } catch {
        // Ignore parent scope errors
      }
    }

    // Load children tasks (with prefix)
    const scopeConfigPath = `${currentScope}/scope.json`;
    if (await this.fs.exists(scopeConfigPath)) {
      try {
        const configContent = await this.fs.readFile(scopeConfigPath);
        const config = JSON.parse(configContent) as ScopeConfig;

        if ("children" in config) {
          for (const child of config.children) {
            const childWorklogPath = child.path.startsWith("/")
              ? `${child.path}/${worklogDir}`
              : `${gitRoot}/${child.path}/${worklogDir}`;
            const childIndexPath = `${childWorklogPath}/index.json`;

            if (!(await this.fs.exists(childIndexPath))) continue;

            const content = await this.fs.readFile(childIndexPath);
            const index = JSON.parse(content) as Index;

            const childTasks = Object.entries(index.tasks)
              .filter(([_, t]) => matchStatus(t.status))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, t]) => ({
                id,
                name: t.name ?? t.desc,
                desc: t.desc,
                status: t.status,
                created: this.formatShort(t.created),
                scopePrefix: child.id,
                tags: t.tags,
              }));

            tasks.push(...childTasks);
          }
        }
      } catch {
        // No scope.json or parse error
      }
    }

    return { tasks };
  }

  private async findTasksByTagPattern(
    pattern: string,
    gitRoot: string,
    _cwd: string,
    _worklogDir: string,
    depthLimit: number,
  ): Promise<
    Array<{
      id: string;
      task: IndexEntry;
      scopeId: string;
      scopePath: string;
    }>
  > {
    const results: Array<{
      id: string;
      task: IndexEntry;
      scopeId: string;
      scopePath: string;
    }> = [];

    const scopes = await this.scopeRepo.discoverScopes(gitRoot, depthLimit);

    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (!(await this.fs.exists(indexPath))) continue;

      const content = await this.fs.readFile(indexPath);
      const index = JSON.parse(content) as Index;
      for (const [id, task] of Object.entries(index.tasks)) {
        const tags = task.tags ?? [];
        if (tags.some((tag) => matchesTagPattern(pattern, tag))) {
          results.push({
            id,
            task,
            scopeId: scope.id,
            scopePath: scope.absolutePath,
          });
        }
      }
    }

    return results;
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

    // Try custom ID match
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

  private async getScopeId(
    worklogPath: string,
    gitRoot: string,
    worklogDir: string,
  ): Promise<string> {
    const relativePath = this.getRelativeScopePath(
      worklogPath,
      gitRoot,
      worklogDir,
    );
    if (relativePath === ".") return "(root)";

    const rootConfigPath = `${gitRoot}/${worklogDir}/scope.json`;
    if (await this.fs.exists(rootConfigPath)) {
      try {
        const content = await this.fs.readFile(rootConfigPath);
        const rootConfig = JSON.parse(content) as ScopeConfig;
        if ("children" in rootConfig) {
          const child = rootConfig.children.find(
            (c) => c.path === relativePath,
          );
          if (child) return child.id;
        }
      } catch {
        // Fallback to path
      }
    }

    return relativePath;
  }

  private getRelativeScopePath(
    worklogPath: string,
    gitRoot: string,
    worklogDir: string,
  ): string {
    if (!worklogPath.startsWith(gitRoot)) {
      return worklogPath.split("/").pop() ?? worklogPath;
    }
    const relativePath = worklogPath.slice(gitRoot.length + 1);
    if (relativePath === worklogDir) return ".";
    return relativePath.slice(0, -worklogDir.length - 1);
  }

  private async isChildWorklog(scopePath: string): Promise<boolean> {
    const scopeJsonPath = `${scopePath}/scope.json`;
    if (!(await this.fs.exists(scopeJsonPath))) return false;

    try {
      const content = await this.fs.readFile(scopeJsonPath);
      const config = JSON.parse(content) as ScopeConfig;
      return "parent" in config;
    } catch {
      return false;
    }
  }

  private async getParentScope(childPath: string): Promise<string> {
    const scopeJsonPath = `${childPath}/scope.json`;
    const content = await this.fs.readFile(scopeJsonPath);
    const config = JSON.parse(content) as { parent: string };
    // Resolve relative parent path
    const childDir = childPath.split("/").slice(0, -1).join("/");
    return this.resolveRelativePath(childDir, config.parent);
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

  private formatShort(isoTs: string): string {
    return isoTs.slice(0, 16).replace("T", " ");
  }
}
