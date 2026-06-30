// ListTasksUseCase - List tasks with filtering (VERY COMPLEX)
// Handles scopes, tags, filtering, status matching

import type { Index, IndexEntry } from "../../entities/index.ts";
import type { ListOutput, ListTaskItem } from "../../entities/outputs.ts";
import type { TaskLinkType, TaskStatus } from "../../entities/task.ts";
import type { ScopeConfig } from "../../entities/scope.ts";
import { WtError } from "../../entities/errors.ts";
import { normalizeDescParts, renderDesc } from "../../entities/description.ts";
import { matchesTagPattern } from "../../entities/task-helpers.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import { ExplicitCast } from "../../../../explicit-cast.ts";

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
  readonly showSubtasks?: boolean; // Include subtasks (hidden by default)
  readonly showSubtasksOfStarted?: boolean; // Include subtasks whose parent is started
  readonly parentFilter?: string; // Full parent task ID — show only direct children
  readonly linkFilter?: {
    readonly taskId: string;
    readonly type?: TaskLinkType;
  };
  readonly includeBlocked?: boolean; // Include tasks blocked by open dependencies
  readonly includeSourceWorklogPath?: boolean;
}

export class ListTasksUseCase {
  constructor(
    private readonly indexRepo: IndexRepository,
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
  ) {}

  private linkFields(task: IndexEntry): Pick<ListTaskItem, "links"> {
    return task.links && task.links.length > 0 ? { links: task.links } : {};
  }

  private isClosedStatus(status: TaskStatus | undefined): boolean {
    return status === "done" || status === "cancelled";
  }

  private hasLinkTo(
    task: IndexEntry,
    taskId: string,
    type?: TaskLinkType,
  ): boolean {
    return (task.links ?? []).some((link) =>
      link.task === taskId && (type === undefined || link.type === type)
    );
  }

  private isBlockedByOpenDependency(
    task: IndexEntry,
    tasks: Readonly<Record<string, IndexEntry>>,
    relatedTaskStatuses?: ReadonlyMap<string, TaskStatus>,
  ): boolean {
    if (this.isClosedStatus(task.status)) return false;
    return (task.links ?? []).some((link) => {
      if (link.type !== "depends_on") return false;
      const dependencyStatus = tasks[link.task]?.status ??
        relatedTaskStatuses?.get(link.task);
      return !this.isClosedStatus(dependencyStatus);
    });
  }

  async execute(input: ListTasksInput): Promise<ListOutput> {
    const defaultStatuses: TaskStatus[] = ["created", "ready", "started"];
    const allowedStatuses = input.statusFilters ?? defaultStatuses;
    const matchStatus = (status: string) => {
      const statuses: readonly string[] = allowedStatuses;
      return input.showAll || statuses.includes(status);
    };

    // Helper: filter tasks based on subtask visibility settings
    const shouldInclude = (
      t: IndexEntry,
      parentStatus?: TaskStatus,
      tasks: Readonly<Record<string, IndexEntry>> = {},
      relatedTaskStatuses?: ReadonlyMap<string, TaskStatus>,
    ): boolean => {
      if (input.parentFilter && t.parent !== input.parentFilter) return false;
      if (
        input.linkFilter &&
        !this.hasLinkTo(t, input.linkFilter.taskId, input.linkFilter.type)
      ) {
        return false;
      }
      if (
        !input.includeBlocked && !input.linkFilter &&
        this.isBlockedByOpenDependency(t, tasks, relatedTaskStatuses)
      ) {
        return false;
      }
      if (input.parentFilter) return t.parent === input.parentFilter;
      if (input.showSubtasks) return true;
      if (!t.parent) return true;
      return input.showSubtasksOfStarted === true &&
        parentStatus === "started";
    };
    const shouldDisplayParent = input.showSubtasks === true ||
      input.showSubtasksOfStarted === true;

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
        shouldInclude,
        shouldDisplayParent,
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
        const index = this.parseIndexContent(content);
        const scopeId = await this.getScopeId(
          scope.absolutePath,
          input.gitRoot,
          input.worklogDir,
        );

        const scopeTasks = Object.entries(index.tasks)
          .filter(([_, t]) => matchStatus(t.status))
          .filter(([_, t]) =>
            shouldInclude(
              t,
              t.parent ? index.tasks[t.parent]?.status : undefined,
              index.tasks,
            )
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, t]) => ({
            id,
            name: t.name ?? renderDesc(t.desc),
            desc: renderDesc(t.desc),
            desc_parts: t.desc,
            status: t.status,
            created: this.formatShort(t.created),
            scopePrefix: scopeId,
            tags: t.tags,
            ...this.linkFields(t),
            ...(shouldDisplayParent && t.parent ? { parent: t.parent } : {}),
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
      const index = this.parseIndexContent(content);

      const scopeTasks = Object.entries(index.tasks)
        .filter(([_, t]) => matchStatus(t.status))
        .filter(([_, t]) =>
          shouldInclude(
            t,
            t.parent ? index.tasks[t.parent]?.status : undefined,
            index.tasks,
          )
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, t]) => ({
          id,
          name: t.name ?? renderDesc(t.desc),
          desc: renderDesc(t.desc),
          desc_parts: t.desc,
          status: t.status,
          created: this.formatShort(t.created),
          tags: t.tags,
          ...this.linkFields(t),
          ...(shouldDisplayParent && t.parent ? { parent: t.parent } : {}),
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
        shouldInclude,
        shouldDisplayParent,
        input.includeSourceWorklogPath ?? false,
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
      index = this.parseIndexContent(content);
    } else {
      index = await this.indexRepo.load();
    }

    const singleTasks = Object.entries(index.tasks)
      .filter(([_, t]) => matchStatus(t.status))
      .filter(([_, t]) =>
        shouldInclude(
          t,
          t.parent ? index.tasks[t.parent]?.status : undefined,
          index.tasks,
        )
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, t]) => ({
        id,
        name: t.name ?? renderDesc(t.desc),
        desc: renderDesc(t.desc),
        desc_parts: t.desc,
        status: t.status,
        created: this.formatShort(t.created),
        tags: t.tags,
        ...this.linkFields(t),
        ...(shouldDisplayParent && t.parent ? { parent: t.parent } : {}),
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
    shouldInclude: (
      t: IndexEntry,
      parentStatus?: TaskStatus,
      tasks?: Readonly<Record<string, IndexEntry>>,
      relatedTaskStatuses?: ReadonlyMap<string, TaskStatus>,
    ) => boolean,
    shouldDisplayParent: boolean,
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
        .filter(({ task, parentStatus, taskIndex }) =>
          shouldInclude(task, parentStatus, taskIndex)
        )
        .map(({ id, task }) => ({
          id,
          name: task.name ?? renderDesc(task.desc),
          desc: renderDesc(task.desc),
          desc_parts: task.desc,
          status: task.status,
          created: this.formatShort(task.created),
          scopePrefix: undefined,
          tags: task.tags,
          ...this.linkFields(task),
          filterPattern,
          ...(shouldDisplayParent && task.parent
            ? { parent: task.parent }
            : {}),
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
        const index = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
          Index
        >();

        const scopeTasks = Object.entries(index.tasks)
          .filter(([_, t]) => matchStatus(t.status))
          .filter(([_, t]) =>
            shouldInclude(
              t,
              t.parent ? index.tasks[t.parent]?.status : undefined,
              index.tasks,
            )
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, t]) => ({
            id,
            name: t.name ?? renderDesc(t.desc),
            desc: renderDesc(t.desc),
            desc_parts: t.desc,
            status: t.status,
            created: this.formatShort(t.created),
            scopePrefix: undefined,
            tags: t.tags,
            ...this.linkFields(t),
            filterPattern,
            ...(shouldDisplayParent && t.parent ? { parent: t.parent } : {}),
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
    shouldInclude: (
      t: IndexEntry,
      parentStatus?: TaskStatus,
      tasks?: Readonly<Record<string, IndexEntry>>,
      relatedTaskStatuses?: ReadonlyMap<string, TaskStatus>,
    ) => boolean,
    shouldDisplayParent: boolean,
    includeSourceWorklogPath: boolean,
  ): Promise<ListOutput> {
    const tasks: ListTaskItem[] = [];
    const seenTasks = new Set<string>();
    const pushTask = (task: ListTaskItem) => {
      const key = `${task.scopePrefix ?? "."}:${task.id}`;
      if (seenTasks.has(key)) return;
      seenTasks.add(key);
      tasks.push(task);
    };
    // Check if child worklog
    const isChild = await this.isChildWorklog(currentScope);
    const currentScopeId = isChild
      ? await this.getChildScopeId(currentScope, gitRoot, worklogDir)
      : await this.getScopeId(
        currentScope,
        gitRoot,
        worklogDir,
      );
    const childWorklog = isChild && currentScopeId && currentScopeId !== "."
      ? await this.getChildWorklogContext(
        currentScope,
        currentScopeId,
        worklogDir,
      )
      : undefined;

    const relatedTaskStatuses = new Map<string, TaskStatus>();
    const parentScopeTasks = new Map<string, IndexEntry>();
    let parentScopeDir: string | undefined;
    let parentWorklogPath: string | undefined;

    if (isChild && currentScopeId && currentScopeId !== ".") {
      try {
        parentScopeDir = await this.getParentScope(currentScope);
        parentWorklogPath = `${parentScopeDir}/${worklogDir}`;
        const parentIndexPath = `${parentWorklogPath}/index.json`;
        if (await this.fs.exists(parentIndexPath)) {
          const content = await this.fs.readFile(parentIndexPath);
          const parentIndex = this.parseIndexContent(content);
          for (const [id, task] of Object.entries(parentIndex.tasks)) {
            relatedTaskStatuses.set(id, task.status);
            parentScopeTasks.set(id, task);
          }
        }
      } catch {
        // Ignore parent scope errors
      }
    }

    // Load current scope tasks (no prefix)
    const currentIndexPath = `${currentScope}/index.json`;
    if (await this.fs.exists(currentIndexPath)) {
      const content = await this.fs.readFile(currentIndexPath);
      const index = this.parseIndexContent(content);
      for (const [id, task] of Object.entries(index.tasks)) {
        relatedTaskStatuses.set(id, task.status);
      }

      const visibleEntries = Object.entries(index.tasks)
        .filter(([_, t]) => matchStatus(t.status))
        .filter(([_, t]) =>
          shouldInclude(
            t,
            t.parent
              ? index.tasks[t.parent]?.status ??
                relatedTaskStatuses.get(t.parent)
              : undefined,
            index.tasks,
            relatedTaskStatuses,
          )
        );

      if (isChild && shouldDisplayParent) {
        for (const [_, task] of visibleEntries) {
          if (!task.parent) continue;
          const parentTask = parentScopeTasks.get(task.parent);
          if (!parentTask || !matchStatus(parentTask.status)) continue;
          pushTask({
            id: task.parent,
            name: parentTask.name ?? renderDesc(parentTask.desc),
            desc: renderDesc(parentTask.desc),
            desc_parts: parentTask.desc,
            status: parentTask.status,
            created: this.formatShort(parentTask.created),
            scopePrefix: "^",
            tags: parentTask.tags,
            ...this.linkFields(parentTask),
            ...(includeSourceWorklogPath && parentWorklogPath
              ? { sourceWorklogPath: parentWorklogPath }
              : {}),
          });
        }
      }

      const currentTasks = visibleEntries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, t]) => ({
          id,
          name: t.name ?? renderDesc(t.desc),
          desc: renderDesc(t.desc),
          desc_parts: t.desc,
          status: t.status,
          created: this.formatShort(t.created),
          tags: t.tags,
          ...this.linkFields(t),
          ...(includeSourceWorklogPath
            ? { sourceWorklogPath: currentScope }
            : {}),
          ...(shouldDisplayParent && t.parent ? { parent: t.parent } : {}),
        }));

      for (const task of currentTasks) {
        pushTask(task);
      }
    }

    // Parent tag pull: if child, include parent tasks with matching tags
    if (isChild && currentScopeId && currentScopeId !== ".") {
      try {
        parentScopeDir ??= await this.getParentScope(currentScope);
        parentWorklogPath ??= `${parentScopeDir}/${worklogDir}`;
        const parentTasks = await this.findTasksByTagPattern(
          currentScopeId,
          gitRoot,
          cwd,
          worklogDir,
          depthLimit,
        );

        const activeParentTasks = parentTasks
          .filter(({ task, scopePath }) =>
            matchStatus(task.status) &&
            shouldInclude(task, undefined, {}, relatedTaskStatuses) &&
            scopePath === parentWorklogPath
          )
          .map(({ id, task }) => ({
            id,
            name: task.name ?? renderDesc(task.desc),
            desc: renderDesc(task.desc),
            desc_parts: task.desc,
            status: task.status,
            created: this.formatShort(task.created),
            scopePrefix: "^",
            tags: task.tags,
            ...this.linkFields(task),
            ...(includeSourceWorklogPath && parentWorklogPath
              ? { sourceWorklogPath: parentWorklogPath }
              : {}),
            ...(shouldDisplayParent && task.parent
              ? { parent: task.parent }
              : {}),
          }));

        for (const task of activeParentTasks) {
          pushTask(task);
        }
      } catch {
        // Ignore parent scope errors
      }
    }

    // Load children tasks (with prefix)
    const scopeConfigPath = `${currentScope}/scope.json`;
    if (await this.fs.exists(scopeConfigPath)) {
      try {
        const configContent = await this.fs.readFile(scopeConfigPath);
        const config = ExplicitCast.fromAny(JSON.parse(configContent))
          .dangerousCast<ScopeConfig>();

        if ("children" in config) {
          for (const child of config.children) {
            const childWorklogPath = child.path.startsWith("/")
              ? `${child.path}/${worklogDir}`
              : `${gitRoot}/${child.path}/${worklogDir}`;
            if (
              this.normalizePath(childWorklogPath) ===
                this.normalizePath(currentScope)
            ) continue;

            const childIndexPath = `${childWorklogPath}/index.json`;

            if (!(await this.fs.exists(childIndexPath))) continue;

            const content = await this.fs.readFile(childIndexPath);
            const index = this.parseIndexContent(content);
            for (const [id, task] of Object.entries(index.tasks)) {
              relatedTaskStatuses.set(id, task.status);
            }

            const childTasks = Object.entries(index.tasks)
              .filter(([_, t]) => matchStatus(t.status))
              .filter(([_, t]) =>
                shouldInclude(
                  t,
                  t.parent
                    ? index.tasks[t.parent]?.status ??
                      relatedTaskStatuses.get(t.parent)
                    : undefined,
                  index.tasks,
                  relatedTaskStatuses,
                )
              )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, t]) => ({
                id,
                name: t.name ?? renderDesc(t.desc),
                desc: renderDesc(t.desc),
                desc_parts: t.desc,
                status: t.status,
                created: this.formatShort(t.created),
                scopePrefix: child.id,
                tags: t.tags,
                ...this.linkFields(t),
                ...(includeSourceWorklogPath
                  ? { sourceWorklogPath: childWorklogPath }
                  : {}),
                ...(shouldDisplayParent && t.parent
                  ? { parent: t.parent }
                  : {}),
              }));

            for (const task of childTasks) {
              pushTask(task);
            }
          }
        }
      } catch {
        // No scope.json or parse error
      }
    }

    return { ...(childWorklog ? { childWorklog } : {}), tasks };
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
      taskIndex: Readonly<Record<string, IndexEntry>>;
      parentStatus?: TaskStatus;
      scopeId: string;
      scopePath: string;
    }>
  > {
    const results: Array<{
      id: string;
      task: IndexEntry;
      taskIndex: Readonly<Record<string, IndexEntry>>;
      parentStatus?: TaskStatus;
      scopeId: string;
      scopePath: string;
    }> = [];

    const scopes = await this.scopeRepo.discoverScopes(gitRoot, depthLimit);

    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (!(await this.fs.exists(indexPath))) continue;

      const content = await this.fs.readFile(indexPath);
      const index = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
        Index
      >();
      for (const [id, task] of Object.entries(index.tasks)) {
        const tags = task.tags ?? [];
        if (tags.some((tag) => matchesTagPattern(pattern, tag))) {
          results.push({
            id,
            task,
            taskIndex: index.tasks,
            parentStatus: task.parent
              ? index.tasks[task.parent]?.status
              : undefined,
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
        const rootConfig = ExplicitCast.fromAny(JSON.parse(content))
          .dangerousCast<ScopeConfig>();
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

  private async getChildScopeId(
    childWorklogPath: string,
    gitRoot: string,
    worklogDir: string,
  ): Promise<string> {
    try {
      const parentScopeDir = await this.getParentScope(childWorklogPath);
      const parentConfigPath = `${parentScopeDir}/${worklogDir}/scope.json`;
      if (await this.fs.exists(parentConfigPath)) {
        const content = await this.fs.readFile(parentConfigPath);
        const parentConfig = ExplicitCast.fromAny(JSON.parse(content))
          .dangerousCast<ScopeConfig>();
        if ("children" in parentConfig) {
          const childDir = this.scopeDir(childWorklogPath, worklogDir);
          const normalizedChildDir = this.normalizePath(childDir);
          const child = parentConfig.children.find((c) => {
            const entryDir = c.path.startsWith("/")
              ? c.path
              : this.resolveRelativePath(parentScopeDir, c.path);
            return this.normalizePath(entryDir) === normalizedChildDir;
          });
          if (child) return child.id;
        }
      }
    } catch {
      // Fall back to the current git-root based behavior.
    }

    return await this.getScopeId(childWorklogPath, gitRoot, worklogDir);
  }

  private async getChildWorklogContext(
    childWorklogPath: string,
    scopeId: string,
    worklogDir: string,
  ): Promise<{ scope: string; childOf: string; warning?: string }> {
    const childOf = await this.getChildOfDisplay(childWorklogPath);
    const warning = await this.getParentScopeWarning(
      childWorklogPath,
      worklogDir,
    );

    return {
      scope: scopeId,
      childOf,
      ...(warning ? { warning } : {}),
    };
  }

  private async getParentScopeWarning(
    childWorklogPath: string,
    worklogDir: string,
  ): Promise<string | undefined> {
    try {
      const parentScopeDir = await this.getParentScope(childWorklogPath);
      const parentWorklogPath = `${parentScopeDir}/${worklogDir}`;
      if (!(await this.worklogExists(parentWorklogPath))) {
        return "Invalid parent: missing .worklog";
      }
      return undefined;
    } catch {
      return "Invalid parent: unreadable scope config";
    }
  }

  private async worklogExists(worklogPath: string): Promise<boolean> {
    return await this.fs.exists(worklogPath) ||
      await this.fs.exists(`${worklogPath}/scope.json`) ||
      await this.fs.exists(`${worklogPath}/index.json`);
  }

  private scopeDir(worklogPath: string, worklogDir: string): string {
    return worklogPath.slice(0, -worklogDir.length - 1);
  }

  private normalizePath(path: string): string {
    let normalized = path;
    while (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
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
      const config = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
        ScopeConfig
      >();
      return "parent" in config;
    } catch {
      return false;
    }
  }

  private async getParentScope(childPath: string): Promise<string> {
    const scopeJsonPath = `${childPath}/scope.json`;
    const content = await this.fs.readFile(scopeJsonPath);
    const config = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
      { parent: string }
    >();
    // Resolve relative parent path
    const childDir = childPath.split("/").slice(0, -1).join("/");
    return this.resolveRelativePath(childDir, config.parent);
  }

  private async getChildOfDisplay(childPath: string): Promise<string> {
    const scopeJsonPath = `${childPath}/scope.json`;
    const content = await this.fs.readFile(scopeJsonPath);
    const config = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
      { parent: string }
    >();
    return this.stripTrailingSlashes(config.parent);
  }

  private stripTrailingSlashes(path: string): string {
    let displayPath = path;
    while (displayPath.length > 1 && displayPath.endsWith("/")) {
      displayPath = displayPath.slice(0, -1);
    }
    return displayPath;
  }

  private parseIndexContent(content: string): Index {
    const rawIndex = ExplicitCast.fromAny(JSON.parse(content)).dangerousCast<
      Index
    >();
    const tasks: Record<string, IndexEntry> = {};
    for (const [taskId, entry] of Object.entries(rawIndex.tasks)) {
      tasks[taskId] = {
        ...entry,
        desc: normalizeDescParts(entry.desc),
      };
    }
    return { ...rawIndex, tasks };
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
