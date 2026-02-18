/**
 * Adapter: JsonScopeRepository
 *
 * Implements the ScopeRepository port using JSON file storage.
 * Reads/writes {worklogDir}/scope.json and discovers scopes.
 *
 * Replicates the exact behavior from cli.ts:
 *   - loadOrCreateScopeJson / saveScopeJson -> loadConfig / saveConfig
 *   - discoverScopes (via scanForWorklogs) -> discoverScopes
 *
 * Dependencies:
 *   - FileSystem (port) for file operations
 */

import type {
  DiscoveredScope,
  ScopeConfig,
} from "../../domain/entities/scope.ts";
import type { FileSystem } from "../../domain/ports/filesystem.ts";
import type { ScopeRepository } from "../../domain/ports/scope-repository.ts";

// Default worklog directory name
const DEFAULT_WORKLOG_DIR = ".worklog";

// Common directories to skip during scope scanning
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
]);

export class JsonScopeRepository implements ScopeRepository {
  constructor(
    private readonly fs: FileSystem,
    private readonly worklogDirName: string = DEFAULT_WORKLOG_DIR,
  ) {}

  async loadConfig(worklogPath: string): Promise<ScopeConfig | null> {
    const scopeJsonPath = `${worklogPath}/scope.json`;

    if (!(await this.fs.exists(scopeJsonPath))) {
      return null;
    }

    try {
      const content = await this.fs.readFile(scopeJsonPath);
      return JSON.parse(content) as ScopeConfig;
    } catch {
      return null; // Corrupted file
    }
  }

  async saveConfig(worklogPath: string, config: ScopeConfig): Promise<void> {
    const scopeJsonPath = `${worklogPath}/scope.json`;
    await this.fs.writeFile(scopeJsonPath, JSON.stringify(config, null, 2));
  }

  async discoverScopes(
    gitRoot: string,
    depthLimit: number,
  ): Promise<DiscoveredScope[]> {
    const worklogPaths = await this.scanForWorklogs(
      gitRoot,
      gitRoot,
      0,
      depthLimit,
    );
    const scopes: DiscoveredScope[] = [];

    // Load custom IDs from root scope.json if it exists
    const idMap = new Map<string, string>(); // path -> custom ID
    const rootScopeJsonPath = `${gitRoot}/${this.worklogDirName}/scope.json`;
    if (await this.fs.exists(rootScopeJsonPath)) {
      try {
        const content = await this.fs.readFile(rootScopeJsonPath);
        const config = JSON.parse(content) as ScopeConfig;
        if ("children" in config) {
          for (const child of config.children) {
            idMap.set(child.path, child.id);
          }
        }
      } catch {
        // Ignore errors, will use default IDs
      }
    }

    for (const absolutePath of worklogPaths) {
      const relativePath = absolutePath.slice(gitRoot.length + 1);
      const isParent = relativePath === this.worklogDirName;
      const scopePath = isParent
        ? ""
        : relativePath.slice(0, -this.worklogDirName.length - 1); // Remove /.worklog

      // Use custom ID if available, otherwise use path
      const defaultId = scopePath || "(root)";
      const customId = idMap.get(scopePath);

      scopes.push({
        absolutePath,
        relativePath: scopePath || ".",
        id: customId ?? defaultId,
        isParent,
      });
    }

    return scopes;
  }

  // =========================================================================
  // Private: Directory scanning
  // Exact replica of scanForWorklogs() from cli.ts
  // =========================================================================

  private async scanForWorklogs(
    dir: string,
    gitRoot: string,
    currentDepth: number,
    maxDepth: number,
  ): Promise<string[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const results: string[] = [];

    try {
      for await (const entryName of this.fs.readDir(dir)) {
        // Skip hidden dirs except .worklog
        if (
          entryName.startsWith(".") && entryName !== this.worklogDirName
        ) {
          continue;
        }

        // Skip common ignore patterns
        if (SKIP_DIRS.has(entryName)) {
          continue;
        }

        const fullPath = `${dir}/${entryName}`;

        if (entryName === this.worklogDirName) {
          // Check if it's a directory by checking for index.json inside
          // (we can't check isDirectory via the port, but we check existence)
          if (await this.fs.exists(`${fullPath}/index.json`)) {
            results.push(fullPath);
          }
        } else {
          // Recurse into subdirectory
          // We attempt recursion; if it's a file the readDir will fail silently
          try {
            const nested = await this.scanForWorklogs(
              fullPath,
              gitRoot,
              currentDepth + 1,
              maxDepth,
            );
            results.push(...nested);
          } catch {
            // Ignore - likely a file, not a directory
          }
        }
      }
    } catch {
      // Ignore permission errors
    }

    return results;
  }
}
