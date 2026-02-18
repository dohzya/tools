// Git service port - interface for git operations

/**
 * Information about a git worktree.
 */
export type WorktreeInfo = {
  readonly path: string;
  readonly branch: string | null; // null for detached HEAD
  readonly isMainWorktree: boolean;
};

/**
 * Service for interacting with git repositories.
 */
export interface GitService {
  /** Get the git root directory for a given working directory. Returns null if not in a git repo. */
  getRoot(cwd: string): Promise<string | null>;

  /** List all worktrees for the repository containing the given directory. */
  listWorktrees(cwd: string): Promise<WorktreeInfo[]>;

  /** Check if a directory is inside a git repository. */
  isInRepo(cwd: string): Promise<boolean>;

  /** Get the current branch name. Returns null for detached HEAD. */
  getCurrentBranch(cwd: string): Promise<string | null>;

  /** Resolve a branch name to its worktree path. Returns null if not found. */
  resolveWorktreePath(
    branch: string,
    cwd: string,
  ): Promise<string | null>;
}
