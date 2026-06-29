// deno-lint-ignore-file require-await no-explicit-any
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { AddTraceUseCase } from "./add-trace.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type {
  TaskFileData,
  TaskRepository,
} from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import type { Index, IndexEntry } from "../../entities/index.ts";
import type { TaskMeta } from "../../entities/task.ts";
import { WtError } from "../../entities/errors.ts";

// --- Mock implementations ---

function createMockIndexRepo(
  initialTasks: Record<string, IndexEntry> = {},
): IndexRepository {
  const state = { tasks: { ...initialTasks } };
  return {
    async load(): Promise<Index> {
      return { version: 2, tasks: state.tasks };
    },
    async save(index: Index): Promise<void> {
      state.tasks = { ...index.tasks };
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

function createMockTaskRepo(
  taskData: Record<string, TaskFileData>,
): TaskRepository & { savedContent: Map<string, string> } {
  const savedContent = new Map<string, string>();
  return {
    savedContent,
    async findById(taskId: string) {
      return taskData[taskId] ?? null;
    },
    async save() {},
    async delete() {},
    async exists(taskId: string) {
      return taskId in taskData;
    },
    getTaskFilePath(taskId: string) {
      return `.worklog/tasks/${taskId}.md`;
    },
    async loadContent(taskId: string) {
      return savedContent.get(taskId) ?? `content-for-${taskId}`;
    },
    async saveContent(taskId: string, content: string) {
      savedContent.set(taskId, content);
    },
  };
}

function createMockMarkdownService(): MarkdownService & {
  lastFrontmatterUpdates: Record<string, unknown>[];
  appendedEntries: unknown[];
} {
  const lastFrontmatterUpdates: Record<string, unknown>[] = [];
  const appendedEntries: unknown[] = [];
  return {
    lastFrontmatterUpdates,
    appendedEntries,
    async parseTaskFile() {
      return {
        // deno-lint-ignore dz-tools/no-type-assertion
        meta: {} as any,
        entries: [],
        checkpoints: [],
        todos: [],
      };
    },
    serializeTask() {
      return "";
    },
    async appendEntry(content: string, entry: unknown) {
      appendedEntries.push(entry);
      return content;
    },
    async appendCheckpoint(content: string) {
      return content + "\n## Checkpoint";
    },
    async updateFrontmatter(content: string, updates: Record<string, unknown>) {
      lastFrontmatterUpdates.push(updates);
      return content;
    },
  };
}

function makeTaskFileData(
  overrides: Partial<TaskMeta> = {},
): TaskFileData {
  return {
    meta: {
      id: "test_task_short",
      uid: "00000000-0000-0000-0000-000000000001",
      name: "Test task",
      desc: ["A test task"],
      status: "started",
      created_at: "2025-01-15T10:00:00+01:00",
      last_checkpoint: null,
      has_uncheckpointed_entries: false,
      ...overrides,
    },
    entries: [],
    checkpoints: [],
    todos: [],
  };
}

function makeIndexEntry(
  overrides: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    name: "Test task",
    desc: ["A test task"],
    status: "started",
    created: "2025-01-15T10:00:00+01:00",
    status_updated_at: "2025-01-15T10:00:00+01:00",
    ...overrides,
  };
}

const TASK_ID = "test_task_abcdefghijklmnop";
const SHORT_ID = "test_task_short";

// --- Tests ---

Deno.test("AddTraceUseCase - adds trace to started task", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    message: "Working on feature",
  });

  assertEquals(result.status, "ok");
  assertEquals(markdownService.appendedEntries.length, 1);
});

Deno.test("AddTraceUseCase - rejects trace on done task without force", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "done" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      id: SHORT_ID,
      status: "done",
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: TASK_ID,
        message: "Post-completion note",
      }),
    WtError,
    `Task is done. Use --force to add post-completion traces.`,
  );
});

Deno.test("AddTraceUseCase - allows trace on done task with force and warns to checkpoint", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "done" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "done" }),
  });
  const markdownService = createMockMarkdownService();
  const warnings: string[] = [];

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
    (msg) => warnings.push(msg),
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    message: "Post-completion note",
    force: true,
  });

  assertEquals(result.status, "ok");
  assertEquals(markdownService.appendedEntries.length, 1);
  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "Task is done");
  assertStringIncludes(warnings[0], "wl checkpoint");
});

Deno.test("AddTraceUseCase - rejects trace on cancelled task without force", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "cancelled" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      id: SHORT_ID,
      status: "cancelled",
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: TASK_ID,
        message: "Note on cancelled task",
      }),
    WtError,
    `Task is cancelled. Reopen it with 'wl start ${SHORT_ID}', or use --force to add traces.`,
  );
});

Deno.test("AddTraceUseCase - allows trace on cancelled task with force", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "cancelled" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "cancelled" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    message: "Note on cancelled task",
    force: true,
  });

  assertEquals(result.status, "ok");
  assertEquals(markdownService.appendedEntries.length, 1);
});

Deno.test("AddTraceUseCase - done warning includes short ID and checkpoint hint", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "done" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      id: "myshortid",
      status: "done",
    }),
  });
  const markdownService = createMockMarkdownService();
  const warnings: string[] = [];

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
    (msg) => warnings.push(msg),
  );

  await useCase.execute({ taskId: TASK_ID, message: "trace", force: true });

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "wl checkpoint myshortid");
  assertStringIncludes(warnings[0], "post-completion traces");
});

Deno.test("AddTraceUseCase - cancelled error message includes short ID and reopen hint", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "cancelled" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      id: "myshortid",
      status: "cancelled",
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2025-01-20 14:00",
  );

  let errorMessage = "";
  try {
    await useCase.execute({ taskId: TASK_ID, message: "trace" });
  } catch (e) {
    if (e instanceof WtError) {
      errorMessage = e.message;
    }
  }

  assertEquals(
    errorMessage.includes("wl start myshortid"),
    true,
  );
  assertEquals(
    errorMessage.includes("--force"),
    true,
  );
});

// --- Tests for added_at feature ---

Deno.test("AddTraceUseCase - sets added_at when custom timestamp is provided", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2026-05-22 14:00",
  );

  await useCase.execute({
    taskId: TASK_ID,
    message: "Backdated entry",
    timestamp: "2026-05-20T10:00:00+02:00",
  });

  assertEquals(markdownService.appendedEntries.length, 1);
  // deno-lint-ignore dz-tools/no-type-assertion
  const appended = markdownService.appendedEntries[0] as {
    ts: string;
    msg: string;
    added_at?: string;
  };
  assertEquals(appended.ts, "2026-05-20 10:00");
  assertEquals(appended.added_at, "2026-05-22 14:00");
});

Deno.test("AddTraceUseCase - does not set added_at when no custom timestamp", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2026-05-22 14:00",
  );

  await useCase.execute({
    taskId: TASK_ID,
    message: "Normal entry",
  });

  assertEquals(markdownService.appendedEntries.length, 1);
  // deno-lint-ignore dz-tools/no-type-assertion
  const appended = markdownService.appendedEntries[0] as {
    ts: string;
    msg: string;
    added_at?: string;
  };
  assertEquals(appended.ts, "2026-05-22 14:00");
  assertEquals(appended.added_at, undefined);
});

Deno.test("AddTraceUseCase - sets trace kind when provided", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2026-05-22 14:00",
  );

  await useCase.execute({
    taskId: TASK_ID,
    message: "Root cause found",
    kind: "finding",
  });

  assertEquals(markdownService.appendedEntries.length, 1);
  // deno-lint-ignore dz-tools/no-type-assertion
  const appended = markdownService.appendedEntries[0] as {
    kind?: string;
  };
  assertEquals(appended.kind, "finding");
});

Deno.test("AddTraceUseCase - getEntriesAfterCheckpoint uses added_at for filtering", async () => {
  // Checkpoint at 2026-05-21 12:00.
  // 50 entries all have ts BEFORE checkpoint (2026-05-20) but added_at AFTER (2026-05-22).
  // Old code filters by ts → 0 entries → status "ok".
  // New code filters by (added_at ?? ts) → 50 entries → status "checkpoint_recommended".
  const backdatedEntries = Array.from({ length: 50 }, (_, i) => ({
    ts: `2026-05-20 ${String(Math.floor(i / 60)).padStart(2, "0")}:${
      String(i % 60).padStart(2, "0")
    }`,
    msg: `entry ${i}`,
    added_at: "2026-05-22 14:00",
  }));

  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      status: "started",
      last_checkpoint: "2026-05-21T12:00:00+02:00",
    }),
  });
  const markdownService = createMockMarkdownService();
  // Override parseTaskFile to return our backdated entries
  markdownService.parseTaskFile = async () => ({
    // deno-lint-ignore dz-tools/no-type-assertion
    meta: {} as any,
    entries: backdatedEntries,
    checkpoints: [],
    todos: [],
  });

  const useCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => "2026-05-22 14:00",
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    message: "One more backdated entry",
    timestamp: "2026-05-20T10:00:00+02:00",
  });

  assertEquals(result.status, "checkpoint_recommended");
  assertEquals(result.entries_since_checkpoint, 50);
});
