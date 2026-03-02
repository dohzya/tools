// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { InitUseCase } from "./init.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { Index } from "../../entities/index.ts";

// --- Mock implementations ---

function createMockFs(worklogExists: boolean): FileSystem {
  return {
    async readFile() {
      return "";
    },
    async writeFile() {},
    async exists() {
      return worklogExists;
    },
    async ensureDir() {},
    async *readDir() {},
    async remove() {},
  };
}

function createMockIndexRepo(): IndexRepository & {
  savedCalls: Index[];
} {
  const mock = {
    savedCalls: new Array<Index>(),
    async load(): Promise<Index> {
      return { version: 2, tasks: {} };
    },
    async save(index: Index): Promise<void> {
      mock.savedCalls.push(index);
    },
    async addEntry() {},
    async updateEntry() {},
    async removeEntry() {},
    async exists() {
      return true;
    },
  };
  return mock;
}

// --- Tests ---

Deno.test("InitUseCase - creates index with version 2", async () => {
  const fs = createMockFs(false);
  const indexRepo = createMockIndexRepo();

  const useCase = new InitUseCase(fs, indexRepo);

  const result = await useCase.execute({
    worklogDir: ".worklog",
    tasksDir: ".worklog/tasks",
  });

  assertEquals(result.status, "initialized");
  assertEquals(indexRepo.savedCalls.length, 1);
  assertEquals(indexRepo.savedCalls[0], { version: 2, tasks: {} });
});

Deno.test("InitUseCase - returns already_initialized when worklog exists", async () => {
  const fs = createMockFs(true);
  const indexRepo = createMockIndexRepo();

  const useCase = new InitUseCase(fs, indexRepo);

  const result = await useCase.execute({
    worklogDir: ".worklog",
    tasksDir: ".worklog/tasks",
  });

  assertEquals(result.status, "already_initialized");
  assertEquals(indexRepo.savedCalls.length, 0);
});
