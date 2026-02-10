import { assertEquals, assertExists } from "@std/assert";
import type {
  Document,
  ErrorCode,
  MutationResult,
  SearchMatch,
  SearchSummary,
  Section,
} from "../markdown-surgeon/types.ts";
import {
  deleteNestedValue,
  expandMagic,
  findSection,
  findSectionAtLine,
  formatValue,
  getFrontmatterContent,
  getNestedValue,
  getSectionContent,
  getSectionEndLine,
  isValidId,
  main as mdMain,
  MdError,
  parseDocument,
  parseFrontmatter,
  sectionHash,
  serializeDocument,
  setFrontmatter,
  setNestedValue,
  startsWithHeader,
  stringifyFrontmatter,
} from "../markdown-surgeon/mod.ts";
import type {
  AddOutput,
  Checkpoint,
  Entry,
  ImportOutput,
  ImportTaskResult,
  Index,
  IndexEntry,
  ListOutput,
  ListTaskItem,
  ShowOutput,
  StatusOutput,
  SummaryOutput,
  SummaryTaskItem,
  TaskMeta,
  TaskStatus,
  TraceOutput,
  TracesOutput,
  WtErrorCode,
} from "../worklog/types.ts";
import { main as wlMain, WtError } from "../worklog/mod.ts";

Deno.test("markdown-surgeon: parser functions exist", () => {
  assertExists(parseDocument);
  assertExists(serializeDocument);
  assertExists(findSection);
  assertExists(findSectionAtLine);
  assertExists(getSectionContent);
  assertExists(getSectionEndLine);
  assertExists(getFrontmatterContent);
  assertExists(setFrontmatter);
  assertExists(startsWithHeader);
});

Deno.test("markdown-surgeon: hash functions exist", () => {
  assertExists(sectionHash);
  assertExists(isValidId);
});

Deno.test("markdown-surgeon: yaml functions exist", () => {
  assertExists(parseFrontmatter);
  assertExists(stringifyFrontmatter);
  assertExists(getNestedValue);
  assertExists(setNestedValue);
  assertExists(deleteNestedValue);
  assertExists(formatValue);
});

Deno.test("markdown-surgeon: magic functions exist", () => {
  assertExists(expandMagic);
});

Deno.test("markdown-surgeon: CLI main function exists", () => {
  assertExists(mdMain);
  assertEquals(typeof mdMain, "function");
});

Deno.test("markdown-surgeon: Document type structure", () => {
  const doc: Document = {
    sections: [],
    lines: [],
    frontmatter: null,
    frontmatterEndLine: 0,
  };
  assertExists(doc.sections);
  assertExists(doc.lines);
  assertEquals(doc.frontmatter, null);
  assertEquals(doc.frontmatterEndLine, 0);
});

Deno.test("markdown-surgeon: Section type structure", () => {
  const section: Section = {
    id: "a1b2c3d4",
    level: 1,
    title: "Test",
    line: 1,
    lineEnd: 10,
  };
  assertEquals(section.id, "a1b2c3d4");
  assertEquals(section.level, 1);
  assertEquals(section.title, "Test");
  assertEquals(section.line, 1);
  assertEquals(section.lineEnd, 10);
});

Deno.test("markdown-surgeon: MutationResult type structure", () => {
  const result: MutationResult = {
    action: "updated",
    id: "test-id",
    lineStart: 1,
    lineEnd: 10,
    linesAdded: 5,
    linesRemoved: 3,
  };
  assertEquals(result.action, "updated");
  assertEquals(result.id, "test-id");
  assertEquals(result.lineStart, 1);
  assertEquals(result.lineEnd, 10);
  assertEquals(result.linesAdded, 5);
  assertEquals(result.linesRemoved, 3);
});

Deno.test("markdown-surgeon: SearchMatch type structure", () => {
  const match: SearchMatch = {
    sectionId: "test-id",
    line: 5,
    content: "test content",
  };
  assertEquals(match.sectionId, "test-id");
  assertEquals(match.line, 5);
  assertEquals(match.content, "test content");
});

Deno.test("markdown-surgeon: SearchSummary type structure", () => {
  const summary: SearchSummary = {
    id: "test-id",
    level: 2,
    title: "Test Section",
    lines: [1, 2, 3],
    matchCount: 3,
  };
  assertEquals(summary.id, "test-id");
  assertEquals(summary.level, 2);
  assertEquals(summary.title, "Test Section");
  assertEquals(summary.lines.length, 3);
  assertEquals(summary.matchCount, 3);
});

Deno.test("markdown-surgeon: ErrorCode type values", () => {
  const codes: ErrorCode[] = [
    "file_not_found",
    "section_not_found",
    "parse_error",
    "invalid_id",
    "io_error",
  ];
  codes.forEach((code) => {
    const _validCode: ErrorCode = code;
  });
});

Deno.test("markdown-surgeon: MdError class structure", () => {
  const error = new MdError("file_not_found", "Test message", "test.md", "id");
  assertEquals(error.name, "MdError");
  assertEquals(error.code, "file_not_found");
  assertEquals(error.message, "Test message");
  assertEquals(error.file, "test.md");
  assertEquals(error.id, "id");
  assertExists(error.format);
  assertEquals(typeof error.format, "function");
});

Deno.test("worklog: CLI main function exists", () => {
  assertExists(wlMain);
  assertEquals(typeof wlMain, "function");
});

Deno.test("worklog: TaskStatus type values", () => {
  const statuses: TaskStatus[] = [
    "created",
    "ready",
    "started",
    "done",
    "cancelled",
  ];
  statuses.forEach((status) => {
    const _validStatus: TaskStatus = status;
  });
});

Deno.test("worklog: TaskMeta type structure", () => {
  const meta: TaskMeta = {
    id: "260123a",
    uid: "uuid-string",
    name: "Test",
    desc: "Test task",
    status: "started",
    created_at: "2026-01-23T10:00:00Z",
    done_at: null,
    last_checkpoint: null,
    has_uncheckpointed_entries: false,
  };
  assertEquals(meta.id, "260123a");
  assertEquals(meta.uid, "uuid-string");
  assertEquals(meta.desc, "Test task");
  assertEquals(meta.status, "started");
  assertExists(meta.created_at);
  assertEquals(meta.done_at, null);
  assertEquals(meta.last_checkpoint, null);
  assertEquals(meta.has_uncheckpointed_entries, false);
});

Deno.test("worklog: IndexEntry type structure", () => {
  const entry: IndexEntry = {
    name: "Test",
    desc: "Test task",
    status: "started",
    created: "2026-01-23T10:00:00Z",
    status_updated_at: "2026-01-23T10:00:00Z",
    done_at: null,
  };
  assertEquals(entry.desc, "Test task");
  assertEquals(entry.status, "started");
  assertExists(entry.created);
  assertEquals(entry.done_at, null);
});

Deno.test("worklog: Index type structure", () => {
  const index: Index = {
    tasks: {
      "260123a": {
        name: "Test",
        desc: "Test",
        status: "started",
        created: "2026-01-23T10:00:00Z",
        status_updated_at: "2026-01-23T10:00:00Z",
        done_at: null,
      },
    },
  };
  assertExists(index.tasks);
  assertEquals(typeof index.tasks, "object");
});

Deno.test("worklog: Entry type structure", () => {
  const entry: Entry = {
    ts: "2026-01-23 10:00",
    msg: "Test message",
  };
  assertEquals(entry.ts, "2026-01-23 10:00");
  assertEquals(entry.msg, "Test message");
});

Deno.test("worklog: Checkpoint type structure", () => {
  const checkpoint: Checkpoint = {
    ts: "2026-01-23 10:00",
    changes: "Changes made",
    learnings: "Things learned",
  };
  assertEquals(checkpoint.ts, "2026-01-23 10:00");
  assertEquals(checkpoint.changes, "Changes made");
  assertEquals(checkpoint.learnings, "Things learned");
});

Deno.test("worklog: AddOutput type structure", () => {
  const output: AddOutput = {
    id: "260123a",
  };
  assertEquals(output.id, "260123a");
});

Deno.test("worklog: TraceOutput type structure", () => {
  const output1: TraceOutput = {
    status: "ok",
  };
  assertEquals(output1.status, "ok");

  const output2: TraceOutput = {
    status: "checkpoint_recommended",
    entries_since_checkpoint: 10,
  };
  assertEquals(output2.status, "checkpoint_recommended");
  assertEquals(output2.entries_since_checkpoint, 10);
});

Deno.test("worklog: ShowOutput type structure", () => {
  const output: ShowOutput = {
    task: "260123a",
    fullId: "260123a-full-uuid",
    name: "Test",
    desc: "Test task",
    status: "started",
    created: "2026-01-23 10:00",
    ready: null,
    started: "2026-01-23 10:15",
    last_checkpoint: null,
    entries_since_checkpoint: [],
    todos: [],
  };
  assertEquals(output.task, "260123a");
  assertEquals(output.desc, "Test task");
  assertEquals(output.status, "started");
  assertEquals(output.last_checkpoint, null);
  assertEquals(output.entries_since_checkpoint.length, 0);
  assertEquals(output.todos.length, 0);
});

Deno.test("worklog: TracesOutput type structure", () => {
  const output: TracesOutput = {
    task: "260123a",
    desc: "Test task",
    entries: [{ ts: "2026-01-23 10:00", msg: "Test entry" }],
  };
  assertEquals(output.task, "260123a");
  assertEquals(output.desc, "Test task");
  assertEquals(output.entries.length, 1);
  assertEquals(output.entries[0].ts, "2026-01-23 10:00");
});

Deno.test("worklog: ListTaskItem type structure", () => {
  const item: ListTaskItem = {
    id: "260123a",
    name: "Test",
    desc: "Test task",
    status: "started",
    created: "2026-01-23T10:00:00Z",
  };
  assertEquals(item.id, "260123a");
  assertEquals(item.desc, "Test task");
  assertEquals(item.status, "started");
  assertExists(item.created);
});

Deno.test("worklog: ListOutput type structure", () => {
  const output: ListOutput = {
    tasks: [],
  };
  assertExists(output.tasks);
  assertEquals(Array.isArray(output.tasks), true);
});

Deno.test("worklog: SummaryTaskItem type structure", () => {
  const item: SummaryTaskItem = {
    id: "260123a",
    desc: "Test task",
    status: "started",
    checkpoints: [],
    entries: [],
  };
  assertEquals(item.id, "260123a");
  assertEquals(item.desc, "Test task");
  assertEquals(item.status, "started");
  assertEquals(Array.isArray(item.checkpoints), true);
  assertEquals(Array.isArray(item.entries), true);
});

Deno.test("worklog: SummaryOutput type structure", () => {
  const output: SummaryOutput = {
    tasks: [],
  };
  assertExists(output.tasks);
  assertEquals(Array.isArray(output.tasks), true);
});

Deno.test("worklog: StatusOutput type structure", () => {
  const output: StatusOutput = {
    status: "initialized",
  };
  assertEquals(output.status, "initialized");
});

Deno.test("worklog: ImportTaskResult type structure", () => {
  const result: ImportTaskResult = {
    id: "260123a",
    status: "imported",
    warnings: ["warning1"],
  };
  assertEquals(result.id, "260123a");
  assertEquals(result.status, "imported");
  assertEquals(result.warnings?.length, 1);
});

Deno.test("worklog: ImportOutput type structure", () => {
  const output: ImportOutput = {
    imported: 1,
    merged: 2,
    skipped: 3,
    tasks: [],
  };
  assertEquals(output.imported, 1);
  assertEquals(output.merged, 2);
  assertEquals(output.skipped, 3);
  assertEquals(Array.isArray(output.tasks), true);
});

Deno.test("worklog: WtErrorCode type values", () => {
  const codes: WtErrorCode[] = [
    "not_initialized",
    "already_initialized",
    "task_not_found",
    "task_already_done",
    "no_uncheckpointed_entries",
    "invalid_args",
    "io_error",
    "worktree_not_found",
    "import_source_not_found",
  ];
  codes.forEach((code) => {
    const _validCode: WtErrorCode = code;
  });
});

Deno.test("worklog: WtError class structure", () => {
  const error = new WtError("task_not_found", "Test message");
  assertEquals(error.name, "WtError");
  assertEquals(error.code, "task_not_found");
  assertEquals(error.message, "Test message");
  assertExists(error.toJSON);
  assertEquals(typeof error.toJSON, "function");

  const json = error.toJSON();
  assertEquals(json.error, "task_not_found");
  assertEquals(json.code, "task_not_found");
  assertEquals(json.message, "Test message");
});
