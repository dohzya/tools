// deno-lint-ignore-file require-await no-explicit-any
import { assertEquals, assertRejects } from "@std/assert";
import { UpdateStatusUseCase } from "./update-status.ts";
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
): IndexRepository & { index: { tasks: Record<string, IndexEntry> } } {
  const state = { tasks: { ...initialTasks } };
  return {
    index: state,
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
  lastCheckpoints: unknown[];
} {
  const lastFrontmatterUpdates: Record<string, unknown>[] = [];
  const lastCheckpoints: unknown[] = [];
  return {
    lastFrontmatterUpdates,
    lastCheckpoints,
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
    async appendEntry(content: string) {
      return content;
    },
    async appendCheckpoint(content: string, checkpoint: unknown) {
      lastCheckpoints.push(checkpoint);
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
  options: {
    todos?: TaskFileData["todos"];
    entries?: TaskFileData["entries"];
  } = {},
): TaskFileData {
  return {
    meta: {
      id: "test_task_abcdefghijklmnop",
      uid: "00000000-0000-0000-0000-000000000001",
      name: "Test task",
      desc: "A test task",
      status: "created",
      created_at: "2025-01-15T10:00:00+01:00",
      last_checkpoint: null,
      has_uncheckpointed_entries: false,
      ...overrides,
    },
    entries: options.entries ?? [],
    checkpoints: [],
    todos: options.todos ?? [],
  };
}

const TASK_ID = "test_task_abcdefghijklmnop";
const FIXED_TIMESTAMP = "2025-01-20T14:00:00+01:00";

function makeIndexEntry(
  overrides: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    name: "Test task",
    desc: "A test task",
    status: "created",
    created: "2025-01-15T10:00:00+01:00",
    status_updated_at: "2025-01-15T10:00:00+01:00",
    ...overrides,
  };
}

// --- Tests ---

Deno.test("UpdateStatusUseCase - toReady from created", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry(),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "created" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "ready",
  });

  assertEquals(result.status, "task_ready");

  // Verify frontmatter was updated with ready status and timestamp
  assertEquals(markdownService.lastFrontmatterUpdates.length, 1);
  assertEquals(markdownService.lastFrontmatterUpdates[0].status, "ready");
  assertEquals(
    markdownService.lastFrontmatterUpdates[0].ready_at,
    FIXED_TIMESTAMP,
  );

  // Verify index was updated
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "ready");
  assertEquals(
    indexRepo.index.tasks[TASK_ID].status_updated_at,
    FIXED_TIMESTAMP,
  );
});

Deno.test("UpdateStatusUseCase - toReady from started (allowed)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "ready",
  });

  assertEquals(result.status, "task_ready");
});

Deno.test("UpdateStatusUseCase - toReady from done (rejected)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "done" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "done" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: TASK_ID,
        targetStatus: "ready",
      }),
    WtError,
    "Cannot transition from 'done' to 'ready'",
  );
});

Deno.test("UpdateStatusUseCase - toStarted from created", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry(),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "created" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "started",
  });

  assertEquals(result.status, "task_started");

  // Verify frontmatter updates
  assertEquals(markdownService.lastFrontmatterUpdates.length, 1);
  assertEquals(markdownService.lastFrontmatterUpdates[0].status, "started");
  assertEquals(
    markdownService.lastFrontmatterUpdates[0].started_at,
    FIXED_TIMESTAMP,
  );

  // Verify index was updated
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "started");
});

Deno.test("UpdateStatusUseCase - toStarted when already started returns already_started", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "started",
  });

  assertEquals(result.status, "task_already_started");

  // Should NOT have updated frontmatter or index (no-op)
  assertEquals(markdownService.lastFrontmatterUpdates.length, 0);
});

Deno.test("UpdateStatusUseCase - toStarted from cancelled (reopen)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "cancelled" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      status: "cancelled",
      cancelled_at: "2025-01-18T10:00:00+01:00",
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "started",
  });

  assertEquals(result.status, "task_reopened");

  // Verify index was updated
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "started");
});

Deno.test("UpdateStatusUseCase - toStarted from cancelled clears cancelled_at", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "cancelled" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      status: "cancelled",
      cancelled_at: "2025-01-18T10:00:00+01:00",
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "started",
  });

  // Verify cancelled_at is cleared in frontmatter updates
  assertEquals(markdownService.lastFrontmatterUpdates[0].cancelled_at, null);
  assertEquals(markdownService.lastFrontmatterUpdates[0].status, "started");
});

Deno.test("UpdateStatusUseCase - toStarted from done (reopening) returns task_reopened", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({
      status: "done",
      done_at: "2025-01-18T12:00:00+01:00",
    }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      status: "done",
      done_at: "2025-01-18T12:00:00+01:00",
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "started",
  });

  assertEquals(result.status, "task_reopened");

  // Verify done_at is cleared in frontmatter updates
  assertEquals(markdownService.lastFrontmatterUpdates[0].done_at, null);
  assertEquals(markdownService.lastFrontmatterUpdates[0].status, "started");
});

Deno.test("UpdateStatusUseCase - toDone with changes and learnings", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      status: "started",
      has_uncheckpointed_entries: true,
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "done",
    changes: "Implemented the feature",
    learnings: "Learned about hexagonal architecture",
  });

  assertEquals(result.status, "task_completed");

  // Should have created a checkpoint AND marked done
  // Checkpoint: updateFrontmatter for last_checkpoint + has_uncheckpointed_entries
  // Done: updateFrontmatter for status + done_at
  assertEquals(markdownService.lastCheckpoints.length, 1);

  // Verify index was updated to done
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "done");
  assertEquals(indexRepo.index.tasks[TASK_ID].done_at, FIXED_TIMESTAMP);
});

Deno.test("UpdateStatusUseCase - toDone with pending todos (rejected without force)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData(
      { status: "started" },
      {
        todos: [
          { id: "todo001", text: "Pending todo", status: "todo", metadata: {} },
          { id: "todo002", text: "Done todo", status: "done", metadata: {} },
        ],
      },
    ),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: TASK_ID,
        targetStatus: "done",
      }),
    WtError,
    "pending todo",
  );
});

Deno.test("UpdateStatusUseCase - toDone with pending todos (allowed with force)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData(
      { status: "started" },
      {
        todos: [
          { id: "todo001", text: "Pending todo", status: "todo", metadata: {} },
        ],
      },
    ),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "done",
    force: true,
  });

  assertEquals(result.status, "task_completed");
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "done");
});

Deno.test("UpdateStatusUseCase - toDone without changes when uncheckpointed entries exist (rejected)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({
      status: "started",
      has_uncheckpointed_entries: true,
    }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: TASK_ID,
        targetStatus: "done",
      }),
    WtError,
    "uncheckpointed entries",
  );
});

Deno.test("UpdateStatusUseCase - toDone with metadata", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "done",
    metadata: { reviewer: "alice", release: "v2.0" },
  });

  assertEquals(result.status, "task_completed");

  // Verify metadata was included in frontmatter updates
  const doneUpdate = markdownService.lastFrontmatterUpdates.find(
    (u) => u.status === "done",
  );
  assertEquals(doneUpdate?.metadata, { reviewer: "alice", release: "v2.0" });
});

Deno.test("UpdateStatusUseCase - toCancelled with reason", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "started" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "started" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "cancelled",
    reason: "No longer needed",
  });

  assertEquals(result.status, "task_cancelled");

  // Verify frontmatter includes cancellation reason as metadata
  assertEquals(markdownService.lastFrontmatterUpdates.length, 1);
  assertEquals(markdownService.lastFrontmatterUpdates[0].status, "cancelled");
  // deno-lint-ignore dz-tools/no-type-assertion
  const metaMap = markdownService.lastFrontmatterUpdates[0].metadata as Record<
    string,
    string
  >;
  assertEquals(metaMap.cancellation_reason, "No longer needed");
  // Verify index was updated
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "cancelled");
  assertEquals(indexRepo.index.tasks[TASK_ID].cancelled_at, FIXED_TIMESTAMP);
});

Deno.test("UpdateStatusUseCase - toCancelled without reason", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry({ status: "created" }),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "created" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  const result = await useCase.execute({
    taskId: TASK_ID,
    targetStatus: "cancelled",
  });

  assertEquals(result.status, "task_cancelled");

  // No metadata when no reason is provided
  assertEquals(markdownService.lastFrontmatterUpdates[0].metadata, undefined);
});

Deno.test("UpdateStatusUseCase - resolves task ID by prefix", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry(),
  });
  const taskRepo = createMockTaskRepo({
    [TASK_ID]: makeTaskFileData({ status: "created" }),
  });
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  // Use just a prefix of the task ID
  const result = await useCase.execute({
    taskId: "test_task",
    targetStatus: "ready",
  });

  assertEquals(result.status, "task_ready");
  assertEquals(indexRepo.index.tasks[TASK_ID].status, "ready");
});

Deno.test("UpdateStatusUseCase - rejects unknown task ID prefix", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry(),
  });
  const taskRepo = createMockTaskRepo({});
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: "nonexistent",
        targetStatus: "ready",
      }),
    WtError,
    "No task found matching prefix",
  );
});

Deno.test("UpdateStatusUseCase - rejects ambiguous task ID prefix", async () => {
  const indexRepo = createMockIndexRepo({
    test_task_abcdefghijklmnop: makeIndexEntry(),
    test_task_zyxwvutsrqponmlk: makeIndexEntry({ name: "Another task" }),
  });
  const taskRepo = createMockTaskRepo({});
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: "test_task",
        targetStatus: "ready",
      }),
    WtError,
    "Ambiguous task ID prefix",
  );
});

Deno.test("UpdateStatusUseCase - task not found by taskRepo (after index resolve)", async () => {
  const indexRepo = createMockIndexRepo({
    [TASK_ID]: makeIndexEntry(),
  });
  // TaskRepo does NOT have this task (inconsistency between index and files)
  const taskRepo = createMockTaskRepo({});
  const markdownService = createMockMarkdownService();

  const useCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    () => FIXED_TIMESTAMP,
  );

  await assertRejects(
    () =>
      useCase.execute({
        taskId: TASK_ID,
        targetStatus: "ready",
      }),
    WtError,
    "Task not found",
  );
});
