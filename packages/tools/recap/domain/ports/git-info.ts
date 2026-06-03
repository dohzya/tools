// GitInfo port — interface for git-specific built-in providers

/** Result of detecting active git operations. */
export type GitOpsResult = {
  /** Human-readable description of current git operation, or null if none. */
  readonly operation: string | null;
};

/** Result of fetching recent git log entries. */
export type GitLogResult = {
  /** Lines of git log output. */
  readonly lines: readonly string[];
};

/** Result of fetching working tree status entries. */
export type GitStatusResult = {
  /** Lines of git status output, already scoped for display. */
  readonly lines: readonly string[];
};

/** Result of fetching stash entries. */
export type GitStashResult = {
  /** Lines of stash summary output. */
  readonly lines: readonly string[];
};

/** Result of detecting subdirectory position within a git repo. */
export type GitSubdirResult = {
  /** Human-readable "(in ./sub/path)" string, or null if at repo root / not in a repo. */
  readonly display: string | null;
};

/** Port for querying git repository state. */
export interface GitInfoProvider {
  /**
   * Detect active git operations (rebase, merge, cherry-pick, etc.).
   * Returns null operation when not in a git repo or no operation in progress.
   */
  getGitOps(cwd: string): Promise<GitOpsResult>;

  /**
   * Get recent git log entries, using upstream detection.
   * Returns empty lines when not in a git repo.
   * When useColor is true, the implementation should request ANSI-colored output
   * (e.g. via `git -c color.ui=always`) so colors survive the piped stdout.
   */
  getGitLog(
    cwd: string,
    maxLines: number,
    useColor: boolean,
  ): Promise<GitLogResult>;

  /**
   * Get working tree status entries.
   * When localOnly is true and cwd is a subdirectory, entries outside that
   * directory are hidden and summarized with a compact note.
   */
  getGitStatus(
    cwd: string,
    localOnly: boolean,
    useColor: boolean,
  ): Promise<GitStatusResult>;

  /**
   * Get stash summary entries.
   * Returns empty lines when no stash exists or cwd is outside a git repo.
   */
  getGitStash(cwd: string): Promise<GitStashResult>;

  /**
   * Detect whether cwd is in a subdirectory of a git repo.
   * Returns a display string like "(in ./sub/path)" or null if at root / not in a repo.
   */
  getGitSubdir(cwd: string): Promise<GitSubdirResult>;
}
