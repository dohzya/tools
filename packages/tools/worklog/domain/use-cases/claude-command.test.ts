// deno-lint-ignore-file require-await
import { assertEquals, assertRejects } from "@std/assert";
import { ClaudeCommandUseCase } from "./claude-command.ts";
import type { IndexRepository } from "../ports/index-repository.ts";
import type { ProcessOptions, ProcessRunner } from "../ports/process-runner.ts";
import type { ShowOutput } from "../entities/outputs.ts";
import type { Index, IndexEntry } from "../entities/index.ts";
import { WtError } from "../entities/errors.ts";

// --- Mock implementations ---

function createMockIndexRepo(
  tasks: Record<string, IndexEntry> = {},
): IndexRepository {
  const state = { tasks: { ...tasks } };
  return {
    async load(): Promise<Index> {
      return { version: 2, tasks: state.tasks };
    },
    async save(index: Index): Promise<void> {
      Object.assign(state, { tasks: { ...index.tasks } });
    },
    async addEntry(taskId: string, entry: IndexEntry): Promise<void> {
      state.tasks[taskId] = entry;
    },
    async updateEntry(
      taskId: string,
      updates: Partial<IndexEntry>,
    ): Promise<void> {
      state.tasks[taskId] = { ...state.tasks[taskId], ...updates };
    },
    async removeEntry(taskId: string): Promise<void> {
      delete state.tasks[taskId];
    },
    async exists(): Promise<boolean> {
      return true;
    },
  };
}

type CapturedCall = {
  cmd: readonly string[];
  options?: ProcessOptions;
};

function createMockProcessRunner(exitCode = 0): ProcessRunner & {
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  return {
    calls,
    async run(
      cmd: readonly string[],
      options?: ProcessOptions,
    ) {
      calls.push({ cmd, options });
      return { exitCode };
    },
  };
}

function createMockShowTaskFn(
  taskId: string,
): (id: string) => Promise<ShowOutput> {
  return async (_id: string): Promise<ShowOutput> => {
    return {
      task: taskId.slice(0, 6),
      fullId: taskId,
      name: "Test task",
      desc: "Test description",
      status: "started",
      created: "2025-01-15 10:00",
      ready: null,
      started: "2025-01-15 10:01",
      last_checkpoint: null,
      entries_since_checkpoint: [],
      todos: [],
    };
  };
}

const FULL_TASK_ID = "test_id_claude_abcdef01";

const MOCK_INDEX_ENTRY: IndexEntry = {
  name: "Test task",
  desc: "Test description",
  status: "started",
  created: "2025-01-15T10:00:00+01:00",
  status_updated_at: "2025-01-15T10:01:00+01:00",
};

// --- Tests ---

Deno.test("ClaudeCommandUseCase - forwards claudeArgs to process runner", async () => {
  const indexRepo = createMockIndexRepo({
    [FULL_TASK_ID]: MOCK_INDEX_ENTRY,
  });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new ClaudeCommandUseCase({
    indexRepo,
    processRunner,
    showTaskFn,
  });

  await useCase.execute({
    taskId: FULL_TASK_ID,
    claudeArgs: ["--model", "opus", "-c"],
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Should spread claudeArgs at the end of the command
  assertEquals(call.cmd[call.cmd.length - 3], "--model");
  assertEquals(call.cmd[call.cmd.length - 2], "opus");
  assertEquals(call.cmd[call.cmd.length - 1], "-c");
});

Deno.test("ClaudeCommandUseCase - sets WORKLOG_TASK_ID in process env", async () => {
  const indexRepo = createMockIndexRepo({
    [FULL_TASK_ID]: MOCK_INDEX_ENTRY,
  });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new ClaudeCommandUseCase({
    indexRepo,
    processRunner,
    showTaskFn,
  });

  await useCase.execute({ taskId: FULL_TASK_ID });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  assertEquals(call.options?.env?.["WORKLOG_TASK_ID"], FULL_TASK_ID);
});

Deno.test("ClaudeCommandUseCase - returns exitCode from process runner", async () => {
  const indexRepo = createMockIndexRepo({
    [FULL_TASK_ID]: MOCK_INDEX_ENTRY,
  });
  const processRunner = createMockProcessRunner(42);
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new ClaudeCommandUseCase({
    indexRepo,
    processRunner,
    showTaskFn,
  });

  const result = await useCase.execute({ taskId: FULL_TASK_ID });

  assertEquals(result.exitCode, 42);
  assertEquals(result.taskId, FULL_TASK_ID);
});

Deno.test("ClaudeCommandUseCase - throws when taskId not found", async () => {
  const indexRepo = createMockIndexRepo({}); // empty index
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new ClaudeCommandUseCase({
    indexRepo,
    processRunner,
    showTaskFn,
  });

  await assertRejects(
    () => useCase.execute({ taskId: "nonexistent" }),
    WtError,
    "No task found",
  );
});

Deno.test("ClaudeCommandUseCase - resolves task by prefix", async () => {
  const indexRepo = createMockIndexRepo({
    [FULL_TASK_ID]: MOCK_INDEX_ENTRY,
  });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new ClaudeCommandUseCase({
    indexRepo,
    processRunner,
    showTaskFn,
  });

  // Use prefix (first 6 chars)
  const result = await useCase.execute({ taskId: FULL_TASK_ID.slice(0, 6) });

  assertEquals(result.taskId, FULL_TASK_ID);
  assertEquals(
    processRunner.calls[0].options?.env?.["WORKLOG_TASK_ID"],
    FULL_TASK_ID,
  );
});
