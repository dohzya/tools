// deno-lint-ignore-file require-await
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { AgentCommandUseCase } from "./agent-command.ts";
import {
  claudeAgentConfig,
  codexAgentConfig,
} from "../entities/agent-config.ts";
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

const FULL_TASK_ID = "test_id_agent_abcdef01";

const MOCK_INDEX_ENTRY: IndexEntry = {
  name: "Test task",
  desc: "Test description",
  status: "started",
  created: "2025-01-15T10:00:00+01:00",
  status_updated_at: "2025-01-15T10:01:00+01:00",
};

// --- Tests with Claude config ---

Deno.test("AgentCommandUseCase (claude) - forwards agentArgs to process runner", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    agentArgs: ["--model", "opus", "-c"],
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Claude: ["claude", "--append-system-prompt", sp, ...args]
  assertEquals(call.cmd[0], "claude");
  assertEquals(call.cmd[1], "--append-system-prompt");
  assertEquals(call.cmd[call.cmd.length - 3], "--model");
  assertEquals(call.cmd[call.cmd.length - 2], "opus");
  assertEquals(call.cmd[call.cmd.length - 1], "-c");
});

Deno.test("AgentCommandUseCase (claude) - sets WORKLOG_TASK_ID in process env", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({ taskId: FULL_TASK_ID });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  assertEquals(call.options?.env?.["WORKLOG_TASK_ID"], FULL_TASK_ID);
});

Deno.test("AgentCommandUseCase (claude) - returns exitCode from process runner", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner(42);
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  const result = await useCase.execute({ taskId: FULL_TASK_ID });

  assertEquals(result.exitCode, 42);
  assertEquals(result.taskId, FULL_TASK_ID);
});

Deno.test("AgentCommandUseCase (claude) - throws when taskId not found", async () => {
  const indexRepo = createMockIndexRepo({});
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await assertRejects(
    () => useCase.execute({ taskId: "nonexistent" }),
    WtError,
    "No task found",
  );
});

Deno.test("AgentCommandUseCase (claude) - resolves task by prefix", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  const result = await useCase.execute({
    taskId: FULL_TASK_ID.slice(0, 6),
  });

  assertEquals(result.taskId, FULL_TASK_ID);
  assertEquals(
    processRunner.calls[0].options?.env?.["WORKLOG_TASK_ID"],
    FULL_TASK_ID,
  );
});

// --- Claude "agents" subcommand tests ---

Deno.test("AgentCommandUseCase (claude) - agents subcommand skips --append-system-prompt", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    agentArgs: ["agents"],
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Should be ["claude", "agents"] with NO --append-system-prompt
  assertEquals(call.cmd[0], "claude");
  assertEquals(call.cmd[1], "agents");
  assertEquals(call.cmd.length, 2);
});

Deno.test("AgentCommandUseCase (claude) - agents subcommand with extra args skips --append-system-prompt", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    agentArgs: ["agents", "--model", "opus"],
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Should be ["claude", "agents", "--model", "opus"] with NO --append-system-prompt
  assertEquals(call.cmd[0], "claude");
  assertEquals(call.cmd[1], "agents");
  assertEquals(call.cmd[2], "--model");
  assertEquals(call.cmd[3], "opus");
  assertEquals(call.cmd.length, 4);
});

Deno.test("AgentCommandUseCase (claude) - agents subcommand still sets WORKLOG_TASK_ID", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    agentArgs: ["agents"],
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  assertEquals(call.options?.env?.["WORKLOG_TASK_ID"], FULL_TASK_ID);
});

// --- Tests with Codex config ---

Deno.test("AgentCommandUseCase (codex) - interactive command injects context as developer instructions", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    codexAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    agentArgs: ["--model", "o3"],
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Codex: ["codex", ...extraArgs, "-c", developer_instructions=<systemPrompt>]
  assertEquals(call.cmd[0], "codex");
  assertEquals(call.cmd[1], "--model");
  assertEquals(call.cmd[2], "o3");
  assertEquals(call.cmd[3], "-c");
  assertStringIncludes(
    call.cmd[4].toString(),
    "Current Worktask Context",
  );
  assertEquals(call.cmd.length, 5);
});

// --- Synthesis mode tests ---

Deno.test("AgentCommandUseCase (claude) - synthesis mode uses buildSynthesisCmd", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    synthesisPrompt: "Synthesize this",
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Claude synthesis: ["claude", "--append-system-prompt", sp, "-p", synth]
  assertEquals(call.cmd[0], "claude");
  assertEquals(call.cmd[1], "--append-system-prompt");
  assertEquals(call.cmd[call.cmd.length - 2], "-p");
  assertEquals(call.cmd[call.cmd.length - 1], "Synthesize this");
});

Deno.test("AgentCommandUseCase (codex) - synthesis mode uses buildSynthesisCmd", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    codexAgentConfig,
  );

  await useCase.execute({
    taskId: FULL_TASK_ID,
    synthesisPrompt: "Synthesize this",
  });

  assertEquals(processRunner.calls.length, 1);
  const [call] = processRunner.calls;
  // Codex synthesis runs unattended so checkpoint/done automation can execute wl.
  assertEquals(call.cmd[0], "codex");
  assertEquals(call.cmd[1], "exec");
  assertEquals(call.cmd[2], "--dangerously-bypass-approvals-and-sandbox");
  assertEquals(call.cmd[3], "Synthesize this");
  assertEquals(call.cmd.length, 4);
});

// --- System prompt agent-specific content ---

Deno.test("AgentCommandUseCase (claude) - system prompt contains claude-specific references", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    claudeAgentConfig,
  );

  await useCase.execute({ taskId: FULL_TASK_ID });

  const [call] = processRunner.calls;
  // Claude interactive: system prompt is at index 2
  const systemPrompt = call.cmd[2].toString();

  assertStringIncludes(systemPrompt, "wl checkpoint --claude");
  assertStringIncludes(systemPrompt, "wl claude <subtask-id>");
  assertStringIncludes(systemPrompt, "thing done or final state");
  assertStringIncludes(systemPrompt, "belongs in Changes");
  assertStringIncludes(systemPrompt, "lesson learned");
  assertStringIncludes(systemPrompt, "belongs in Learnings");
  assertStringIncludes(systemPrompt, "useful to other projects");
  // Must NOT contain codex references
  assertEquals(systemPrompt.includes("wl checkpoint --codex"), false);
  assertEquals(systemPrompt.includes("wl codex <subtask-id>"), false);
});

Deno.test("AgentCommandUseCase (codex) - system prompt contains codex-specific references", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    { indexRepo, processRunner, showTaskFn },
    codexAgentConfig,
  );

  await useCase.execute({ taskId: FULL_TASK_ID });

  const [call] = processRunner.calls;
  // Codex interactive: system prompt is injected via developer_instructions
  const systemPrompt = call.cmd[call.cmd.length - 1].toString();

  assertStringIncludes(systemPrompt, "wl checkpoint --codex");
  assertStringIncludes(systemPrompt, "wl codex <subtask-id>");
  assertStringIncludes(systemPrompt, "thing done or final state");
  assertStringIncludes(systemPrompt, "belongs in Changes");
  assertStringIncludes(systemPrompt, "lesson learned");
  assertStringIncludes(systemPrompt, "belongs in Learnings");
  assertStringIncludes(systemPrompt, "useful to other projects");
  // Must NOT contain claude references
  assertEquals(systemPrompt.includes("wl checkpoint --claude"), false);
  assertEquals(systemPrompt.includes("wl claude <subtask-id>"), false);
});

Deno.test("AgentCommandUseCase (codex) - concatenates configured developer instructions", async () => {
  const indexRepo = createMockIndexRepo({ [FULL_TASK_ID]: MOCK_INDEX_ENTRY });
  const processRunner = createMockProcessRunner();
  const showTaskFn = createMockShowTaskFn(FULL_TASK_ID);

  const useCase = new AgentCommandUseCase(
    {
      indexRepo,
      processRunner,
      showTaskFn,
      loadCodexDeveloperInstructions: () =>
        Promise.resolve("existing instructions"),
    },
    codexAgentConfig,
  );

  await useCase.execute({ taskId: FULL_TASK_ID });

  const [call] = processRunner.calls;
  const configOverride = call.cmd[call.cmd.length - 1].toString();
  assertStringIncludes(configOverride, "existing instructions");
  assertStringIncludes(configOverride, "Current Worktask Context");
});
