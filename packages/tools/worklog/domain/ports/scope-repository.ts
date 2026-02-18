// Scope repository port - persistence interface for monorepo scope management

import type { DiscoveredScope, ScopeConfig } from "../entities/scope.ts";

/**
 * Repository for managing monorepo scope configuration and discovery.
 */
export interface ScopeRepository {
  /** Load scope configuration from a worklog path. Returns null if not found. */
  loadConfig(worklogPath: string): Promise<ScopeConfig | null>;

  /** Save scope configuration to a worklog path. */
  saveConfig(worklogPath: string, config: ScopeConfig): Promise<void>;

  /** Discover all worklog scopes under a git root. */
  discoverScopes(
    gitRoot: string,
    depthLimit: number,
  ): Promise<DiscoveredScope[]>;
}
