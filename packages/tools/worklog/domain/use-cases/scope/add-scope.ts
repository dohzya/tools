// AddScopeUseCase - Add a scope (cmdScopesAdd / cmdScopesAddParent)

import type { StatusOutput } from "../../entities/outputs.ts";
import type { ScopeConfigParent, ScopeEntry } from "../../entities/scope.ts";
import { WtError } from "../../entities/errors.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";

export interface AddScopeInput {
  readonly scopeId: string;
  readonly path?: string;
  readonly worktree?: boolean;
  readonly gitRef?: string;
  readonly cwd: string;
  readonly worklogDir: string;
  readonly depthLimit: number;
}

export interface AddScopeParentInput {
  readonly parentPath: string;
  readonly scopeId?: string;
  readonly cwd: string;
  readonly worklogDir: string;
}

export class AddScopeUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
  ) {}

  async execute(input: AddScopeInput): Promise<StatusOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scopes require git.",
      );
    }

    if (input.path && input.worktree) {
      throw new WtError(
        "invalid_args",
        "Cannot use --path and --worktree together. Choose one.",
      );
    }

    let targetDir: string;
    let effectivePath: string;
    let gitRef: string | undefined;
    let scopeType: "path" | "worktree" = "path";

    if (input.worktree) {
      scopeType = "worktree";
      gitRef = input.gitRef ?? input.scopeId;

      const worktrees = await this.gitService.listWorktrees(input.cwd);
      const worktree = worktrees.find((wt) => wt.branch === gitRef);

      if (worktree) {
        targetDir = worktree.path;
      } else {
        const currentBranch = await this.gitService.getCurrentBranch(input.cwd);
        if (currentBranch === gitRef) {
          targetDir = gitRoot;
        } else {
          throw new WtError(
            "worktree_not_found",
            `No worktree found for ref: ${gitRef}. Create the worktree first with 'git worktree add'.`,
          );
        }
      }

      const mainWorktree = worktrees.find((wt) => wt.isMainWorktree);
      if (mainWorktree && targetDir.startsWith(mainWorktree.path)) {
        effectivePath = targetDir.slice(mainWorktree.path.length + 1) || ".";
      } else {
        effectivePath = targetDir;
      }
    } else {
      effectivePath = input.path ?? input.scopeId;
      targetDir = effectivePath.startsWith("/")
        ? effectivePath
        : `${gitRoot}/${effectivePath}`;
    }

    const worklogPath = `${targetDir}/${input.worklogDir}`;

    if (await this.fs.exists(worklogPath)) {
      // Check if already has parent
      const config = await this.scopeRepo.loadConfig(worklogPath);
      if (config && "parent" in config && config.parent) {
        throw new WtError(
          "already_has_parent",
          `Scope at ${effectivePath} already has a parent configured.`,
        );
      }

      // Configure parent for existing worklog
      const scopeDir = worklogPath.slice(0, -input.worklogDir.length - 1);
      const relativeToGitRoot = scopeDir.slice(gitRoot.length + 1);
      const depth = relativeToGitRoot.split("/").filter((p) => p).length;
      const parentPath = "../".repeat(depth);
      await this.scopeRepo.saveConfig(worklogPath, { parent: parentPath });
    } else {
      // Create new worklog directory
      await this.fs.ensureDir(`${worklogPath}/tasks`);
      await this.fs.writeFile(
        `${worklogPath}/index.json`,
        JSON.stringify({ tasks: {} }, null, 2),
      );

      const scopeDir = worklogPath.slice(0, -input.worklogDir.length - 1);
      const relativeToGitRoot = scopeDir.slice(gitRoot.length + 1);
      const depth = relativeToGitRoot.split("/").filter((p) => p).length;
      const parentPath = "../".repeat(depth);
      await this.scopeRepo.saveConfig(worklogPath, { parent: parentPath });
    }

    // Update parent scope.json
    const rootWorklogPath = `${gitRoot}/${input.worklogDir}`;
    const rootConfig = await this.scopeRepo.loadConfig(rootWorklogPath);

    let children: ScopeEntry[] = [];
    if (rootConfig && "children" in rootConfig) {
      children = [...rootConfig.children];
    } else if (rootConfig && "parent" in rootConfig) {
      throw new WtError(
        "invalid_state",
        "Root worklog is configured as a child scope. This is invalid.",
      );
    }

    const existingChild = children.find((c) => c.path === effectivePath);
    if (!existingChild) {
      const newEntry: ScopeEntry = {
        path: effectivePath,
        id: input.scopeId,
        ...(scopeType === "worktree" && { type: "worktree", gitRef }),
      };
      children.push(newEntry);
    } else {
      children = children.map((c) =>
        c.path === effectivePath
          ? {
            ...c,
            id: input.scopeId,
            ...(scopeType === "worktree" && { type: "worktree", gitRef }),
          }
          : c
      );
    }

    await this.scopeRepo.saveConfig(rootWorklogPath, {
      children,
    } as ScopeConfigParent);

    return { status: "scope_created" };
  }

  async executeAddParent(input: AddScopeParentInput): Promise<StatusOutput> {
    // Find child worklog
    const childWorklogPath = await this.findNearestWorklog(
      input.cwd,
      null,
      input.worklogDir,
    );

    if (!childWorklogPath) {
      throw new WtError(
        "not_initialized",
        "No worklog found. Run 'wl init' first.",
      );
    }

    const childDir = childWorklogPath.slice(0, -input.worklogDir.length - 1);

    // Resolve parent path
    const parentDir = input.parentPath.startsWith("/")
      ? input.parentPath
      : this.resolveRelativePath(input.cwd, input.parentPath);

    const parentWorklogPath = `${parentDir}/${input.worklogDir}`;

    if (!(await this.fs.exists(parentWorklogPath))) {
      throw new WtError(
        "not_initialized",
        `No worklog found at parent path: ${input.parentPath}. Run 'wl init' there first.`,
      );
    }

    // Check if child already has parent
    const childConfig = await this.scopeRepo.loadConfig(childWorklogPath);
    if (childConfig && "parent" in childConfig && childConfig.parent) {
      throw new WtError(
        "already_has_parent",
        `This scope already has a parent configured: ${childConfig.parent}.`,
      );
    }

    // Calculate relative paths
    const relativeToParent = this.calculateRelativePath(childDir, parentDir);
    await this.scopeRepo.saveConfig(childWorklogPath, {
      parent: relativeToParent,
    });

    // Update parent config
    const parentConfig = await this.scopeRepo.loadConfig(parentWorklogPath);
    if (parentConfig && !("children" in parentConfig)) {
      throw new WtError(
        "invalid_state",
        "Parent is configured as a child scope itself.",
      );
    }

    const relativeToChild = this.calculateRelativePath(parentDir, childDir);
    const childId = input.scopeId ?? childDir.split("/").pop() ??
      relativeToChild;

    const children: ScopeEntry[] = parentConfig && "children" in parentConfig
      ? [...parentConfig.children]
      : [];

    const existingChild = children.find((c) => c.path === relativeToChild);
    if (!existingChild) {
      children.push({
        path: relativeToChild,
        id: childId,
      });
    } else if (input.scopeId) {
      // Update ID if provided
      const idx = children.indexOf(existingChild);
      children[idx] = { ...existingChild, id: input.scopeId };
    }

    await this.scopeRepo.saveConfig(parentWorklogPath, { children });

    return { status: "parent_configured" };
  }

  private async findNearestWorklog(
    cwd: string,
    stopAt: string | null,
    worklogDir: string,
  ): Promise<string | null> {
    let current = cwd;
    while (true) {
      const worklogPath = `${current}/${worklogDir}`;
      if (await this.fs.exists(worklogPath)) return worklogPath;
      if (stopAt && current === stopAt) break;
      const parent = current.split("/").slice(0, -1).join("/");
      if (!parent || parent === current) break;
      current = parent;
    }
    return null;
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
