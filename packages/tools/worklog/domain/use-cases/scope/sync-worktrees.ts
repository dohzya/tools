// SyncWorktreesUseCase - Sync git worktrees with scopes

import type {
  ScopeConfigChild,
  ScopeConfigParent,
  ScopeEntry,
} from "../../entities/scope.ts";
import { WtError } from "../../entities/errors.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService } from "../../ports/git-service.ts";

export interface SyncWorktreesInput {
  readonly cwd: string;
  readonly dryRun?: boolean;
  readonly worklogDir: string;
}

export interface SyncWorktreesOutput {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly warnings: readonly string[];
}

export class SyncWorktreesUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly fs: FileSystem,
    private readonly gitService: GitService,
  ) {}

  async execute(input: SyncWorktreesInput): Promise<SyncWorktreesOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scopes require git.",
      );
    }

    const rootWorklogPath = `${gitRoot}/${input.worklogDir}`;
    if (!(await this.fs.exists(rootWorklogPath))) {
      throw new WtError(
        "not_initialized",
        "No worklog found at git root. Run 'wl init' first.",
      );
    }

    const rootConfig = await this.scopeRepo.loadConfig(rootWorklogPath);
    if (!rootConfig || !("children" in rootConfig)) {
      throw new WtError(
        "invalid_state",
        "Root worklog is configured as a child scope. This is invalid.",
      );
    }

    const worktrees = await this.gitService.listWorktrees(input.cwd);
    const mainWorktree = worktrees.find((wt) => wt.isMainWorktree);

    const added: string[] = [];
    const removed: string[] = [];
    const warnings: string[] = [];

    // Mutable copy for updates
    const children: ScopeEntry[] = [...rootConfig.children];

    // Check for stale worktree scopes
    const existingWorktreeScopes = children.filter(
      (c) => c.type === "worktree",
    );

    for (const scope of existingWorktreeScopes) {
      const worktree = worktrees.find((wt) => wt.branch === scope.gitRef);
      if (!worktree) {
        warnings.push(
          `Worktree for '${scope.gitRef}' no longer exists. ` +
            `Tasks and traces in this scope have been lost. ` +
            `Consider running 'wl scopes delete ${scope.id}' before removing worktrees.`,
        );
        removed.push(scope.id);

        if (!input.dryRun) {
          const idx = children.indexOf(scope);
          if (idx !== -1) children.splice(idx, 1);
        }
      }
    }

    // Find new worktrees to add
    for (const worktree of worktrees) {
      if (worktree.isMainWorktree || !worktree.branch) continue;

      const existingScope = children.find(
        (c) => c.type === "worktree" && c.gitRef === worktree.branch,
      );

      if (!existingScope) {
        const scopeId = worktree.branch;

        let effectivePath: string;
        if (mainWorktree && worktree.path.startsWith(mainWorktree.path)) {
          effectivePath = worktree.path.slice(mainWorktree.path.length + 1) ||
            ".";
        } else {
          effectivePath = worktree.path;
        }

        added.push(scopeId);

        if (!input.dryRun) {
          const worklogPath = `${worktree.path}/${input.worklogDir}`;

          if (!(await this.fs.exists(worklogPath))) {
            await this.fs.ensureDir(`${worklogPath}/tasks`);
            await this.fs.writeFile(
              `${worklogPath}/index.json`,
              JSON.stringify({ tasks: {} }, null, 2),
            );
          }

          // Configure parent path for the child
          const relPath = this.calculateRelativePath(worktree.path, gitRoot);
          await this.scopeRepo.saveConfig(worklogPath, {
            parent: relPath,
          } as ScopeConfigChild);

          children.push({
            path: effectivePath,
            id: scopeId,
            type: "worktree",
            gitRef: worktree.branch,
          });
        }
      }
    }

    if (!input.dryRun && (added.length > 0 || removed.length > 0)) {
      await this.scopeRepo.saveConfig(rootWorklogPath, {
        children,
      } as ScopeConfigParent);
    }

    return { added, removed, warnings };
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
