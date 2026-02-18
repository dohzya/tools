// deno-lint-ignore-file require-await no-explicit-any
import { assertEquals, assertRejects } from "@std/assert";
import { CreateTaskUseCase } from "./create-task.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import type { Index, IndexEntry } from "../../entities/index.ts";
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
      state.tasks = { ...index.tasks } as Record<string, IndexEntry>;
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

function createMockTaskRepo(): TaskRepository & {
  savedContent: Map<string, string>;
} {
  const savedContent = new Map<string, string>();
  return {
    savedContent,
    async findById() {
      return null;
    },
    async save() {},
    async delete() {},
    async exists(taskId: string) {
      return savedContent.has(taskId);
    },
    getTaskFilePath(taskId: string) {
      return `.worklog/tasks/${taskId}.md`;
    },
    async loadContent(taskId: string) {
      return savedContent.get(taskId) ?? "";
    },
    async saveContent(taskId: string, content: string) {
      savedContent.set(taskId, content);
    },
  };
}

function createMockMarkdownService(): MarkdownService {
  return {
    async parseTaskFile() {
      return {
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
    async appendCheckpoint(content: string) {
      return content;
    },
    async updateFrontmatter(content: string) {
      return content;
    },
  };
}

// --- Tests ---

Deno.test("CreateTaskUseCase - creates task with default status", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_1234567890abcdef",
    generateUid: () => "00000000-0000-0000-0000-000000000001",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  const result = await useCase.execute({
    name: "Test task",
    desc: "Test description",
  });

  // Should return a short ID
  assertEquals(typeof result.id, "string");
  assertEquals(result.id.length > 0, true);

  // Should save content
  assertEquals(taskRepo.savedContent.size, 1);
  const savedContent = taskRepo.savedContent.get("test_id_1234567890abcdef")!;
  assertEquals(savedContent.includes('name: "Test task"'), true);
  assertEquals(savedContent.includes('desc: "Test description"'), true);
  assertEquals(savedContent.includes("status: created"), true);
  assertEquals(
    savedContent.includes('created_at: "2025-01-15T10:00:00+01:00"'),
    true,
  );

  // Should add to index
  assertEquals("test_id_1234567890abcdef" in indexRepo.index.tasks, true);
  assertEquals(
    indexRepo.index.tasks["test_id_1234567890abcdef"].name,
    "Test task",
  );
  assertEquals(
    indexRepo.index.tasks["test_id_1234567890abcdef"].status,
    "created",
  );
});

Deno.test("CreateTaskUseCase - creates task with started status", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_started_abcdef01",
    generateUid: () => "00000000-0000-0000-0000-000000000002",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  const result = await useCase.execute({
    name: "Started task",
    initialStatus: "started",
  });

  assertEquals(typeof result.id, "string");

  const savedContent = taskRepo.savedContent.get(
    "test_id_started_abcdef01",
  )!;
  assertEquals(savedContent.includes("status: started"), true);
  assertEquals(
    savedContent.includes('started_at: "2025-01-15T10:00:00+01:00"'),
    true,
  );
  assertEquals(savedContent.includes("ready_at: null"), true);

  assertEquals(
    indexRepo.index.tasks["test_id_started_abcdef01"].status,
    "started",
  );
});

Deno.test("CreateTaskUseCase - creates task with ready status", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_ready_abcdefgh01",
    generateUid: () => "00000000-0000-0000-0000-000000000003",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  await useCase.execute({
    name: "Ready task",
    initialStatus: "ready",
  });

  const savedContent = taskRepo.savedContent.get(
    "test_id_ready_abcdefgh01",
  )!;
  assertEquals(savedContent.includes("status: ready"), true);
  assertEquals(
    savedContent.includes('ready_at: "2025-01-15T10:00:00+01:00"'),
    true,
  );
  assertEquals(savedContent.includes("started_at: null"), true);
});

Deno.test("CreateTaskUseCase - creates task with tags", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_tags_abcdefgh012",
    generateUid: () => "00000000-0000-0000-0000-000000000004",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  await useCase.execute({
    name: "Tagged task",
    tags: ["feat/auth", "priority"],
  });

  const savedContent = taskRepo.savedContent.get(
    "test_id_tags_abcdefgh012",
  )!;
  assertEquals(savedContent.includes("tags:"), true);
  assertEquals(savedContent.includes("  - feat/auth"), true);
  assertEquals(savedContent.includes("  - priority"), true);

  const indexEntry = indexRepo.index.tasks["test_id_tags_abcdefgh012"];
  assertEquals(indexEntry.tags, ["feat/auth", "priority"]);
});

Deno.test("CreateTaskUseCase - creates task with todos", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_todos_abcdefgh01",
    generateUid: () => "00000000-0000-0000-0000-000000000005",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  await useCase.execute({
    name: "Task with todos",
    todos: ["First todo", "Second todo"],
  });

  const savedContent = taskRepo.savedContent.get(
    "test_id_todos_abcdefgh01",
  )!;
  assertEquals(savedContent.includes("# TODO"), true);
  assertEquals(savedContent.includes("First todo"), true);
  assertEquals(savedContent.includes("Second todo"), true);
});

Deno.test("CreateTaskUseCase - rejects invalid tags", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_invalid_tags_abc",
    generateUid: () => "00000000-0000-0000-0000-000000000006",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  await assertRejects(
    () =>
      useCase.execute({
        name: "Bad tags",
        tags: ["valid", "invalid tag with spaces"],
      }),
    WtError,
    "cannot contain whitespace",
  );
});

Deno.test("CreateTaskUseCase - creates task with metadata", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_meta_abcdefgh012",
    generateUid: () => "00000000-0000-0000-0000-000000000007",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  await useCase.execute({
    name: "Task with meta",
    metadata: { priority: "high", sprint: "3" },
  });

  const savedContent = taskRepo.savedContent.get(
    "test_id_meta_abcdefgh012",
  )!;
  assertEquals(savedContent.includes("metadata:"), true);
  assertEquals(savedContent.includes("  priority: high"), true);
  assertEquals(savedContent.includes("  sprint: 3"), true);
});

Deno.test("CreateTaskUseCase - uses custom timestamp", async () => {
  const indexRepo = createMockIndexRepo();
  const taskRepo = createMockTaskRepo();
  const markdownService = createMockMarkdownService();

  const useCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
    generateId: () => "test_id_timestamp_abcdef",
    generateUid: () => "00000000-0000-0000-0000-000000000008",
    getTimestamp: () => "2025-01-15T10:00:00+01:00",
  });

  await useCase.execute({
    name: "Custom timestamp",
    timestamp: "2024-12-25T08:30:00+01:00",
  });

  const savedContent = taskRepo.savedContent.get(
    "test_id_timestamp_abcdef",
  )!;
  assertEquals(
    savedContent.includes('created_at: "2024-12-25T08:30:00+01:00"'),
    true,
  );

  assertEquals(
    indexRepo.index.tasks["test_id_timestamp_abcdef"].created,
    "2024-12-25T08:30:00+01:00",
  );
});
