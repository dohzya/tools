// deno-lint-ignore-file require-await
import { assertEquals, assertRejects } from "@std/assert";
import { ListTasksUseCase } from "./list-tasks.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { Index, IndexEntry } from "../../entities/index.ts";
import type { DiscoveredScope, ScopeConfig } from "../../entities/scope.ts";
import { WtError } from "../../entities/errors.ts";

// --- Mock implementations ---

function createMockIndexRepo(
  tasks: Record<string, IndexEntry>,
): IndexRepository {
  return {
    async load(): Promise<Index> {
      return { version: 2, tasks };
    },
    async save() {},
    async addEntry() {},
    async updateEntry() {},
    async removeEntry() {},
    async exists() {
      return true;
    },
  };
}

function createMockScopeRepo(
  scopes: DiscoveredScope[] = [],
  configs: Map<string, ScopeConfig> = new Map(),
): ScopeRepository {
  return {
    async loadConfig(worklogPath: string) {
      return configs.get(worklogPath) ?? null;
    },
    async saveConfig() {},
    async discoverScopes() {
      return scopes;
    },
  };
}

function createMockFs(
  files: Map<string, string>,
): FileSystem {
  return {
    async readFile(path: string) {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    },
    async writeFile() {},
    async exists(path: string) {
      return files.has(path);
    },
    async ensureDir() {},
    async *readDir() {},
    async remove() {},
  };
}

// --- Tests ---

Deno.test("ListTasksUseCase - lists tasks from single worklog", async () => {
  const tasks: Record<string, IndexEntry> = {
    task1: {
      name: "First task",
      desc: "First",
      status: "started",
      created: "2025-01-15T10:00:00+01:00",
      status_updated_at: "2025-01-15T10:00:00+01:00",
    },
    task2: {
      name: "Second task",
      desc: "Second",
      status: "done",
      created: "2025-01-14T10:00:00+01:00",
      status_updated_at: "2025-01-14T10:00:00+01:00",
      done_at: "2025-01-15T10:00:00+01:00",
    },
    task3: {
      name: "Third task",
      desc: "Third",
      status: "created",
      created: "2025-01-16T10:00:00+01:00",
      status_updated_at: "2025-01-16T10:00:00+01:00",
    },
  };

  const indexRepo = createMockIndexRepo(tasks);
  const scopeRepo = createMockScopeRepo();
  const fs = createMockFs(new Map());

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: false,
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  // Should only show active tasks (not done)
  assertEquals(result.tasks.length, 2);
  assertEquals(result.tasks.map((t) => t.id).sort(), ["task1", "task3"]);
});

Deno.test("ListTasksUseCase - showAll includes done tasks", async () => {
  const tasks: Record<string, IndexEntry> = {
    task1: {
      name: "Active",
      desc: "Active",
      status: "started",
      created: "2025-01-15T10:00:00+01:00",
      status_updated_at: "2025-01-15T10:00:00+01:00",
    },
    task2: {
      name: "Done",
      desc: "Done",
      status: "done",
      created: "2025-01-14T10:00:00+01:00",
      status_updated_at: "2025-01-14T10:00:00+01:00",
      done_at: "2025-01-15T10:00:00+01:00",
    },
  };

  const indexRepo = createMockIndexRepo(tasks);
  const scopeRepo = createMockScopeRepo();
  const fs = createMockFs(new Map());

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: true,
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  assertEquals(result.tasks.length, 2);
});

Deno.test("ListTasksUseCase - filters by status", async () => {
  const tasks: Record<string, IndexEntry> = {
    task1: {
      name: "Created",
      desc: "Created",
      status: "created",
      created: "2025-01-15T10:00:00+01:00",
      status_updated_at: "2025-01-15T10:00:00+01:00",
    },
    task2: {
      name: "Started",
      desc: "Started",
      status: "started",
      created: "2025-01-14T10:00:00+01:00",
      status_updated_at: "2025-01-14T10:00:00+01:00",
    },
    task3: {
      name: "Ready",
      desc: "Ready",
      status: "ready",
      created: "2025-01-16T10:00:00+01:00",
      status_updated_at: "2025-01-16T10:00:00+01:00",
    },
  };

  const indexRepo = createMockIndexRepo(tasks);
  const scopeRepo = createMockScopeRepo();
  const fs = createMockFs(new Map());

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: false,
    statusFilters: ["started"],
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  assertEquals(result.tasks.length, 1);
  assertEquals(result.tasks[0].id, "task2");
  assertEquals(result.tasks[0].status, "started");
});

Deno.test("ListTasksUseCase - lists from baseDir", async () => {
  const indexContent = JSON.stringify({
    version: 2,
    tasks: {
      remote1: {
        name: "Remote task",
        desc: "Remote",
        status: "started",
        created: "2025-01-15T10:00:00+01:00",
        status_updated_at: "2025-01-15T10:00:00+01:00",
      },
    },
  });

  const files = new Map<string, string>();
  files.set("/other/.worklog/index.json", indexContent);

  const indexRepo = createMockIndexRepo({});
  const scopeRepo = createMockScopeRepo();
  const fs = createMockFs(files);

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: false,
    baseDir: "/other/.worklog",
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  assertEquals(result.tasks.length, 1);
  assertEquals(result.tasks[0].id, "remote1");
  assertEquals(result.tasks[0].name, "Remote task");
});

Deno.test("ListTasksUseCase - all scopes listing", async () => {
  const scope1Index = JSON.stringify({
    version: 2,
    tasks: {
      root1: {
        name: "Root task",
        desc: "Root",
        status: "started",
        created: "2025-01-15T10:00:00+01:00",
        status_updated_at: "2025-01-15T10:00:00+01:00",
      },
    },
  });

  const scope2Index = JSON.stringify({
    version: 2,
    tasks: {
      child1: {
        name: "Child task",
        desc: "Child",
        status: "created",
        created: "2025-01-16T10:00:00+01:00",
        status_updated_at: "2025-01-16T10:00:00+01:00",
      },
    },
  });

  const files = new Map<string, string>();
  files.set("/repo/.worklog/index.json", scope1Index);
  files.set(
    "/repo/.worklog/scope.json",
    JSON.stringify({ children: [{ path: "packages/api", id: "api" }] }),
  );
  files.set("/repo/packages/api/.worklog/index.json", scope2Index);

  const scopes: DiscoveredScope[] = [
    {
      absolutePath: "/repo/.worklog",
      relativePath: ".",
      id: "(root)",
      isParent: true,
    },
    {
      absolutePath: "/repo/packages/api/.worklog",
      relativePath: "packages/api",
      id: "api",
      isParent: false,
    },
  ];

  const indexRepo = createMockIndexRepo({});
  const scopeRepo = createMockScopeRepo(scopes);
  const fs = createMockFs(files);

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: false,
    allScopes: true,
    gitRoot: "/repo",
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  assertEquals(result.tasks.length, 2);

  const rootTask = result.tasks.find((t) => t.id === "root1");
  assertEquals(rootTask?.scopePrefix, "(root)");

  const childTask = result.tasks.find((t) => t.id === "child1");
  assertEquals(childTask?.scopePrefix, "api");
});

Deno.test("ListTasksUseCase - throws on missing baseDir", async () => {
  const files = new Map<string, string>();

  const indexRepo = createMockIndexRepo({});
  const scopeRepo = createMockScopeRepo();
  const fs = createMockFs(files);

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  await assertRejects(
    () =>
      useCase.execute({
        showAll: false,
        baseDir: "/nonexistent/.worklog",
        worklogDir: ".worklog",
        depthLimit: 5,
      }),
    WtError,
    "Worklog not found",
  );
});

Deno.test("ListTasksUseCase - formats created date as short", async () => {
  const tasks: Record<string, IndexEntry> = {
    task1: {
      name: "Task",
      desc: "Desc",
      status: "started",
      created: "2025-01-15T10:30:00+01:00",
      status_updated_at: "2025-01-15T10:30:00+01:00",
    },
  };

  const indexRepo = createMockIndexRepo(tasks);
  const scopeRepo = createMockScopeRepo();
  const fs = createMockFs(new Map());

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: false,
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  assertEquals(result.tasks[0].created, "2025-01-15 10:30");
});

Deno.test("ListTasksUseCase - tag filtering with filter pattern", async () => {
  const indexContent = JSON.stringify({
    version: 2,
    tasks: {
      tagged1: {
        name: "Tagged task",
        desc: "Tagged",
        status: "started",
        created: "2025-01-15T10:00:00+01:00",
        status_updated_at: "2025-01-15T10:00:00+01:00",
        tags: ["feat/auth"],
      },
      untagged1: {
        name: "Untagged task",
        desc: "Untagged",
        status: "started",
        created: "2025-01-15T10:00:00+01:00",
        status_updated_at: "2025-01-15T10:00:00+01:00",
      },
    },
  });

  const files = new Map<string, string>();
  files.set("/repo/.worklog/index.json", indexContent);

  const scopes: DiscoveredScope[] = [
    {
      absolutePath: "/repo/.worklog",
      relativePath: ".",
      id: "(root)",
      isParent: true,
    },
  ];

  const indexRepo = createMockIndexRepo({});
  const scopeRepo = createMockScopeRepo(scopes);
  const fs = createMockFs(files);

  const useCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);

  const result = await useCase.execute({
    showAll: false,
    filterPattern: "feat",
    gitRoot: "/repo",
    cwd: "/repo",
    worklogDir: ".worklog",
    depthLimit: 5,
  });

  assertEquals(result.tasks.length, 1);
  assertEquals(result.tasks[0].id, "tagged1");
  assertEquals(result.tasks[0].filterPattern, "feat");
});
