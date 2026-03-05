// GitInfo port — interface for git-specific built-in providers

export type GitOpsResult = {
  /** Human-readable description of current git operation, or null if none. */
  readonly operation: string | null;
};

export type GitLogResult = {
  /** Lines of git log output. */
  readonly lines: readonly string[];
};

export interface GitInfoProvider {
  /**
   * Detect active git operations (rebase, merge, cherry-pick, etc.).
   * Returns null operation when not in a git repo or no operation in progress.
   */
  getGitOps(cwd: string): Promise<GitOpsResult>;

  /**
   * Get recent git log entries, using upstream detection.
   * Returns empty lines when not in a git repo.
   */
  getGitLog(cwd: string, maxLines: number): Promise<GitLogResult>;
}
