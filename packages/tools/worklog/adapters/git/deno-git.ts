/**
 * Adapter: DenoGitService
 *
 * Concrete GitService implementation that shells out to the git CLI.
 * All logic is copied exactly from the original cli.ts functions:
 *   - findGitRoot -> getRoot()
 *   - listAllWorktrees -> listWorktrees()
 *   - getCurrentBranch -> getCurrentBranch()
 *   - resolveWorktreePath -> resolveWorktreePath()
 *
 * Dependencies: Deno.Command (git CLI).
 */

import type {
  GitService,
  WorktreeInfo,
} from "../../domain/ports/git-service.ts";

export class DenoGitService implements GitService {
  async getRoot(cwd: string): Promise<string | null> {
    try {
      const process = new Deno.Command("git", {
        args: ["rev-parse", "--show-toplevel"],
        cwd,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout } = await process.output();
      if (code !== 0) {
        return null;
      }

      return new TextDecoder().decode(stdout).trim();
    } catch {
      return null;
    }
  }

  async listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
    const process = new Deno.Command("git", {
      args: ["worktree", "list", "--porcelain"],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await process.output();

    if (code !== 0) {
      const error = new TextDecoder().decode(stderr);
      throw new Error(`Failed to list worktrees: ${error}`);
    }

    const output = new TextDecoder().decode(stdout);
    const lines = output.trim().split("\n");

    const worktrees: WorktreeInfo[] = [];
    let current: {
      path?: string;
      branch?: string | null;
      isMainWorktree?: boolean;
    } = {};
    let isFirst = true;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? null,
            isMainWorktree: current.isMainWorktree ?? false,
          });
        }
        current = {
          path: line.slice(9),
          isMainWorktree: isFirst,
        };
        isFirst = false;
      } else if (line.startsWith("branch ")) {
        // Extract branch name from refs/heads/xxx
        const branchRef = line.slice(7);
        current.branch = branchRef.startsWith("refs/heads/")
          ? branchRef.slice(11)
          : branchRef;
      } else if (line === "detached") {
        current.branch = null;
      }
    }

    // Push the last worktree
    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? null,
        isMainWorktree: current.isMainWorktree ?? false,
      });
    }

    return worktrees;
  }

  async isInRepo(cwd: string): Promise<boolean> {
    const root = await this.getRoot(cwd);
    return root !== null;
  }

  async getCurrentBranch(cwd: string): Promise<string | null> {
    const process = new Deno.Command("git", {
      args: ["rev-parse", "--abbrev-ref", "HEAD"],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout } = await process.output();
    if (code !== 0) {
      return null;
    }

    const branch = new TextDecoder().decode(stdout).trim();
    return branch === "HEAD" ? null : branch; // HEAD means detached
  }

  async resolveWorktreePath(
    branch: string,
    cwd: string,
  ): Promise<string | null> {
    const worktrees = await this.listWorktrees(cwd);
    const match = worktrees.find((wt) => wt.branch === branch);
    return match ? match.path : null;
  }
}
