// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import type { ScopeConfig } from "../../entities/scope.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { GitService, WorktreeInfo } from "../../ports/git-service.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import { SyncWorktreesUseCase } from "./sync-worktrees.ts";

function createMockScopeRepo(
  configs: Map<string, ScopeConfig>,
): ScopeRepository {
  return {
    async loadConfig(worklogPath: string) {
      return configs.get(worklogPath) ?? null;
    },
    async saveConfig() {},
    async discoverScopes() {
      return [];
    },
  };
}

function createMockFs(existingPaths: Set<string>): FileSystem {
  return {
    async readFile() {
      throw new Error("Unexpected readFile call");
    },
    async writeFile() {},
    async exists(path: string) {
      return existingPaths.has(path);
    },
    async ensureDir() {},
    async *readDir() {},
    async remove() {},
  };
}

function createMockGitService(
  root: string,
  worktrees: readonly WorktreeInfo[],
): GitService {
  return {
    async getRoot() {
      return root;
    },
    async listWorktrees() {
      return [...worktrees];
    },
    async isInRepo() {
      return true;
    },
    async getCurrentBranch() {
      return null;
    },
    async resolveWorktreePath() {
      return null;
    },
  };
}

Deno.test("SyncWorktreesUseCase - does not add current git root as worktree child", async () => {
  const configs = new Map<string, ScopeConfig>();
  configs.set("/repo/trunk/.worklog", { children: [] });

  const useCase = new SyncWorktreesUseCase(
    createMockScopeRepo(configs),
    createMockFs(new Set(["/repo/trunk/.worklog"])),
    createMockGitService("/repo/trunk", [
      {
        path: "/repo/bare.git",
        branch: null,
        isMainWorktree: true,
      },
      {
        path: "/repo/trunk",
        branch: "trunk",
        isMainWorktree: false,
      },
      {
        path: "/repo/feature",
        branch: "feature",
        isMainWorktree: false,
      },
    ]),
  );

  const result = await useCase.execute({
    cwd: "/repo/trunk",
    dryRun: true,
    worklogDir: ".worklog",
  });

  assertEquals(result.added, ["feature"]);
  assertEquals(result.removed, []);
  assertEquals(result.warnings, []);
});
