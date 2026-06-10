import { assertEquals, assertStringIncludes } from "@std/assert";
import type { ShowOutput } from "./domain/entities/outputs.ts";
import {
  buildCheckpointPrompt,
  type CheckpointPromptMode,
} from "./checkpoint-prompt.ts";

const baseShow: ShowOutput = {
  task: "abc",
  fullId: "abc123def456",
  name: "Test task",
  desc: "A test task description",
  status: "started",
  created: "2025-01-15 10:00",
  ready: null,
  started: "2025-01-15 10:05",
  last_checkpoint: null,
  entries_since_checkpoint: [],
  todos: [],
};

Deno.test("checkpoint prompt — with entries + previous checkpoint", () => {
  const show: ShowOutput = {
    ...baseShow,
    last_checkpoint: {
      ts: "2025-01-15 11:00",
      changes: "Implemented initial parser",
      learnings: "YAML roundtrip loses quote style",
    },
    entries_since_checkpoint: [
      { ts: "2025-01-15 11:05", msg: "Started refactoring parser" },
      { ts: "2025-01-15 11:30", msg: "Extracted helper functions" },
      { ts: "2025-01-15 12:00", msg: "All tests green after refactor" },
    ],
  };

  const prompt = buildCheckpointPrompt("abc123def456", show);

  // Task identity
  assertStringIncludes(prompt, "Test task");
  assertStringIncludes(prompt, "A test task description");

  // All entry messages present
  assertStringIncludes(prompt, "Started refactoring parser");
  assertStringIncludes(prompt, "Extracted helper functions");
  assertStringIncludes(prompt, "All tests green after refactor");

  // All entry timestamps present
  assertStringIncludes(prompt, "2025-01-15 11:05");
  assertStringIncludes(prompt, "2025-01-15 11:30");
  assertStringIncludes(prompt, "2025-01-15 12:00");

  // Previous checkpoint content
  assertStringIncludes(prompt, "Implemented initial parser");
  assertStringIncludes(prompt, "YAML roundtrip loses quote style");

  // Quality guidelines
  assertStringIncludes(prompt, "A checkpoint is cumulative");
  assertStringIncludes(
    prompt,
    "after this checkpoint, previous traces and checkpoints could be deleted",
  );
  assertStringIncludes(prompt, "first argument");
  assertStringIncludes(prompt, "second argument");
  assertStringIncludes(prompt, "Root causes");
  assertStringIncludes(prompt, "Rejected alternatives");
  assertStringIncludes(prompt, "Validation");
  assertStringIncludes(prompt, "Final state");
  assertStringIncludes(prompt, "ordinary agent");
  assertStringIncludes(prompt, "wl checkpoint --agent");
  assertEquals(prompt.includes("wl done --agent"), false);
  assertStringIncludes(prompt, "dedicated synthesis agent");

  // Command with exact taskId
  assertStringIncludes(prompt, "wl checkpoint abc123def456");
});

Deno.test("checkpoint prompt — with entries but no previous checkpoint", () => {
  const show: ShowOutput = {
    ...baseShow,
    last_checkpoint: null,
    entries_since_checkpoint: [
      { ts: "2025-01-15 10:10", msg: "Started work on feature" },
    ],
  };

  const prompt = buildCheckpointPrompt("abc123def456", show);

  // Entry present
  assertStringIncludes(prompt, "Started work on feature");

  // No "previous checkpoint" section header
  assertEquals(prompt.includes("Previous checkpoint"), false);

  // Guidelines still present
  assertStringIncludes(prompt, "changes");
  assertStringIncludes(prompt, "learnings");

  // Command present
  assertStringIncludes(prompt, "wl checkpoint abc123def456");
});

Deno.test("checkpoint prompt — with empty entries", () => {
  const show: ShowOutput = {
    ...baseShow,
    entries_since_checkpoint: [],
  };

  const prompt = buildCheckpointPrompt("abc123def456", show);

  // Still produces a valid string
  assertEquals(typeof prompt, "string");
  assertEquals(prompt.length > 0, true);

  // Command still present
  assertStringIncludes(prompt, "wl checkpoint abc123def456");
});

Deno.test("checkpoint prompt — with active TODOs", () => {
  const show: ShowOutput = {
    ...baseShow,
    entries_since_checkpoint: [
      { ts: "2025-01-15 10:10", msg: "Working on feature" },
    ],
    todos: [
      { id: "todo001", text: "Write unit tests", status: "todo", metadata: {} },
      {
        id: "todo002",
        text: "Update docs",
        status: "wip",
        metadata: {},
      },
      {
        id: "todo003",
        text: "Old cleanup",
        status: "done",
        metadata: {},
      },
      {
        id: "todo004",
        text: "Abandoned idea",
        status: "cancelled",
        metadata: {},
      },
      {
        id: "todo005",
        text: "Waiting on review",
        status: "blocked",
        metadata: {},
      },
    ],
  };

  const prompt = buildCheckpointPrompt("abc123def456", show);

  // Active TODOs (todo, wip, blocked) appear
  assertStringIncludes(prompt, "Write unit tests");
  assertStringIncludes(prompt, "Update docs");
  assertStringIncludes(prompt, "Waiting on review");

  // Completed/cancelled TODOs do NOT appear
  assertEquals(prompt.includes("Old cleanup"), false);
  assertEquals(prompt.includes("Abandoned idea"), false);
});

Deno.test("checkpoint prompt — command format includes exact taskId", () => {
  const show: ShowOutput = {
    ...baseShow,
    entries_since_checkpoint: [
      { ts: "2025-01-15 10:10", msg: "trace message" },
    ],
  };

  const taskId = "xyz789unique42";
  const prompt = buildCheckpointPrompt(taskId, show);

  assertStringIncludes(prompt, `wl checkpoint ${taskId}`);
  // Verify it tells Claude to run directly
  assertStringIncludes(prompt, "without asking");
});

// --- done mode tests ---

Deno.test("done mode — uses wl done command", () => {
  const show: ShowOutput = {
    ...baseShow,
    entries_since_checkpoint: [
      { ts: "2025-01-15 10:10", msg: "Final work done" },
    ],
  };

  const taskId = "abc123def456";
  const mode: CheckpointPromptMode = "done";
  const prompt = buildCheckpointPrompt(taskId, show, mode);

  assertStringIncludes(prompt, `wl done ${taskId}`);
  assertEquals(prompt.includes("wl checkpoint"), false);
});

Deno.test("done mode — opening directive mentions closing", () => {
  const show: ShowOutput = {
    ...baseShow,
    entries_since_checkpoint: [
      { ts: "2025-01-15 10:10", msg: "Wrapping up" },
    ],
  };

  const prompt = buildCheckpointPrompt("abc123def456", show, "done");

  // Should mention final/closing in the opening directive
  assertStringIncludes(prompt, "final");
  assertStringIncludes(prompt, "closes");
  assertStringIncludes(prompt, "wl done --agent");
  assertEquals(prompt.includes("wl checkpoint --agent"), false);
});

Deno.test("default mode — still uses checkpoint command", () => {
  const show: ShowOutput = {
    ...baseShow,
    entries_since_checkpoint: [
      { ts: "2025-01-15 10:10", msg: "Some work" },
    ],
  };

  const taskId = "abc123def456";
  // No mode argument — defaults to "checkpoint"
  const prompt = buildCheckpointPrompt(taskId, show);

  assertStringIncludes(prompt, `wl checkpoint ${taskId}`);
  assertEquals(prompt.includes("wl done"), false);
});
