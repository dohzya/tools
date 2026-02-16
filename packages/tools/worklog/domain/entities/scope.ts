// Scope entity - monorepo scope management types

export type ScopeType = "path" | "worktree";

/**
 * Immutable scope entry representing a child scope in a monorepo.
 */
export type ScopeEntry = {
  readonly path: string; // Relative to git root (or absolute for worktrees outside repo)
  readonly id: string; // Display ID (defaults to path or git ref)
  readonly type?: ScopeType; // "path" (default) or "worktree"
  readonly gitRef?: string; // Git ref for worktree scopes (e.g., "feature/xyz")
  readonly tags?: readonly string[]; // Worktree-level tags inherited by all tasks in this scope
};

/**
 * Parent scope configuration with child entries.
 */
export type ScopeConfigParent = {
  readonly children: readonly ScopeEntry[];
};

/**
 * Child scope configuration pointing to parent.
 */
export type ScopeConfigChild = {
  readonly parent: string;
};

/**
 * Scope configuration - either parent or child.
 */
export type ScopeConfig = ScopeConfigParent | ScopeConfigChild;

/**
 * A discovered scope found during monorepo scanning.
 */
export type DiscoveredScope = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly id: string;
  readonly isParent: boolean;
};
