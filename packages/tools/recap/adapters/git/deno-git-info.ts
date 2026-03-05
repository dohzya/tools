// DenoGitInfo adapter — implements git-ops and git-log built-ins

import type {
  GitInfoProvider,
  GitLogResult,
  GitOpsResult,
} from "../../domain/ports/git-info.ts";

type GitResult = { success: boolean; stdout: string };

/**
 * Run git with explicit args via Deno.Command, bypassing any shell tokenizer.
 * This avoids issues with special git refspec characters like @{u}, ^, etc.
 */
async function runGit(args: string[]): Promise<GitResult> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    return { success: output.success, stdout };
  } catch {
    return { success: false, stdout: "" };
  }
}

/**
 * Check if path exists relative to a git dir.
 */
async function gitFileExists(
  gitDir: string,
  relativePath: string,
): Promise<boolean> {
  try {
    await Deno.stat(`${gitDir}/${relativePath}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file content from git dir, trimmed. Returns null if not found.
 */
async function readGitFile(
  gitDir: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const content = await Deno.readTextFile(`${gitDir}/${relativePath}`);
    return content.trim();
  } catch {
    return null;
  }
}

/**
 * Find the .git directory from cwd by walking up.
 * Returns null if not in a git repo.
 */
async function findGitDir(cwd: string): Promise<string | null> {
  const result = await runGit(["-C", cwd, "rev-parse", "--git-dir"]);
  if (!result.success) return null;
  const gitDir = result.stdout.trim();
  // git may return relative path — resolve it
  if (gitDir.startsWith("/")) return gitDir;
  return `${cwd}/${gitDir}`;
}

export class DenoGitInfo implements GitInfoProvider {
  async getGitOps(cwd: string): Promise<GitOpsResult> {
    const gitDir = await findGitDir(cwd);
    if (!gitDir) return { operation: null };

    // Check for rebase-merge (interactive rebase)
    if (await gitFileExists(gitDir, "rebase-merge")) {
      const head = await readGitFile(gitDir, "rebase-merge/head-name");
      const onto = await readGitFile(gitDir, "rebase-merge/onto");
      if (head && onto) {
        const shortOnto = onto.slice(0, 7);
        return { operation: `rebasing ${head} onto ${shortOnto}` };
      }
      return { operation: "rebase in progress" };
    }

    // Check for rebase-apply
    if (await gitFileExists(gitDir, "rebase-apply")) {
      return { operation: "rebase-apply in progress" };
    }

    // Check for merge
    if (await gitFileExists(gitDir, "MERGE_HEAD")) {
      const mergeHead = await readGitFile(gitDir, "MERGE_HEAD");
      const short = mergeHead ? mergeHead.slice(0, 7) : "unknown";
      return { operation: `merging ${short}` };
    }

    // Check for cherry-pick
    if (await gitFileExists(gitDir, "CHERRY_PICK_HEAD")) {
      return { operation: "cherry-pick in progress" };
    }

    // Check for revert
    if (await gitFileExists(gitDir, "REVERT_HEAD")) {
      return { operation: "revert in progress" };
    }

    return { operation: null };
  }

  async getGitLog(cwd: string, maxLines: number): Promise<GitLogResult> {
    const gitArgs = (extraArgs: string[]) => runGit(["-C", cwd, ...extraArgs]);

    // Try to resolve upstream: git rev-parse --abbrev-ref @{u}
    const upstreamResult = await gitArgs([
      "rev-parse",
      "--abbrev-ref",
      "@{u}",
    ]);

    let logBaseArgs: string[];

    if (upstreamResult.success) {
      const upstream = upstreamResult.stdout.trim();
      // Show only commits not yet on the upstream branch
      logBaseArgs = ["log", `${upstream}^..HEAD`, `-${maxLines}`];
    } else {
      // No upstream — try origin/HEAD as fallback
      const originResult = await gitArgs([
        "rev-parse",
        "--verify",
        "refs/remotes/origin/HEAD",
      ]);
      if (originResult.success) {
        const originHead = originResult.stdout.trim().slice(0, 7);
        logBaseArgs = ["log", `${originHead}^..HEAD`, `-${maxLines}`];
      } else {
        // No upstream at all — just show recent commits
        logBaseArgs = ["log", `-${maxLines}`];
      }
    }

    const logResult = await gitArgs([
      ...logBaseArgs,
      "--pretty=format:%h %s",
    ]);
    if (!logResult.success && logResult.stdout.trim() === "") {
      return { lines: [] };
    }
    const lines = logResult.stdout
      .split("\n")
      .filter((l) => l.trim().length > 0);
    return { lines };
  }
}
