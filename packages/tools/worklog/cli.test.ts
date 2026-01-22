import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { WtError } from "./types.ts";

// WtError tests
Deno.test("WtError - creates error with code and message", () => {
  const error = new WtError("not_initialized", "Worklog not initialized");
  assertEquals(error.code, "not_initialized");
  assertEquals(error.message, "Worklog not initialized");
  assertEquals(error.name, "WtError");
});

Deno.test("WtError - toJSON returns structured error", () => {
  const error = new WtError("task_not_found", "Task 123 not found");
  const json = error.toJSON();
  assertEquals(json.error, "task_not_found");
  assertEquals(json.code, "task_not_found");
  assertEquals(json.message, "Task 123 not found");
});

Deno.test("WtError - handles different error codes", () => {
  const codes = [
    "not_initialized",
    "already_initialized",
    "task_not_found",
    "task_already_done",
    "invalid_args",
    "io_error",
  ] as const;

  for (const code of codes) {
    const error = new WtError(code, "Test message");
    assertEquals(error.code, code);
  }
});

// Integration tests for wl trace with timestamp
import { main } from "./cli.ts";

Deno.test("worklog trace - uses current timestamp by default", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID from list
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry without timestamp
    await main(["trace", taskId, "Test entry"]);

    // Read task file to verify timestamp is current
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    // Should contain a timestamp close to now (within last minute)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const expectedPrefix = `${year}-${month}-${day}`;

    assertStringIncludes(taskContent, expectedPrefix);
    assertStringIncludes(taskContent, "Test entry");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts custom timestamp in ISO format", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with custom timestamp (ISO format)
    const customTimestamp = "2024-12-15T14:30:00+01:00";
    await main([
      "trace",
      taskId,
      "Historical entry",
      "--timestamp",
      customTimestamp,
    ]);

    // Read task file to verify custom timestamp is used
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    // Should contain the custom timestamp in short format (2024-12-15 14:30)
    assertStringIncludes(taskContent, "2024-12-15 14:30");
    assertStringIncludes(taskContent, "Historical entry");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts timestamp without timezone", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with timestamp without timezone
    const customTimestamp = "2024-12-15T10:45";
    await main([
      "trace",
      taskId,
      "Entry without timezone",
      "--timestamp",
      customTimestamp,
    ]);

    // Read task file to verify custom timestamp is used
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    // Should contain the custom timestamp
    assertStringIncludes(taskContent, "2024-12-15 10:45");
    assertStringIncludes(taskContent, "Entry without timezone");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - rejects invalid timestamp format", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  // Mock Deno.exit to throw and prevent actual exit
  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT"); // Throw to stop execution
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Try to add trace entry with invalid timestamp - should trigger error
    try {
      await main([
        "trace",
        taskId,
        "Entry with bad timestamp",
        "--timestamp",
        "not-a-date",
      ]);
    } catch (_e) {
      // Expected to throw when Deno.exit is called
    }

    // Should have exited with code 1
    assertEquals(exitCode, 1);
    // Error message should mention invalid timestamp
    assertStringIncludes(errorOutput, "Invalid timestamp");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts full ISO format with --timestamp", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with full ISO format
    const customTimestamp = "2024-11-20T09:00:00+01:00";
    await main([
      "trace",
      taskId,
      "Entry with full ISO",
      "--timestamp",
      customTimestamp,
    ]);

    // Read task file to verify timestamp
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    assertStringIncludes(taskContent, "2024-11-20 09:00");
    assertStringIncludes(taskContent, "Entry with full ISO");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts date+time without seconds", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with date+time format (no seconds, no TZ)
    await main([
      "trace",
      taskId,
      "Entry without seconds",
      "-t",
      "2024-10-15T14:30",
    ]);

    // Read task file to verify timestamp
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    assertStringIncludes(taskContent, "2024-10-15 14:30");
    assertStringIncludes(taskContent, "Entry without seconds");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts T prefix for time-only (today)", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with T11:15 format (today at 11:15)
    await main(["trace", taskId, "Entry with T11:15", "-t", "T16:45"]);

    // Read task file to verify timestamp (should be today at 16:45)
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const expectedDate = `${year}-${month}-${day}`;

    assertStringIncludes(taskContent, `${expectedDate} 16:45`);
    assertStringIncludes(taskContent, "Entry with T11:15");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts T prefix with seconds", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with T11:15:30 format
    await main([
      "trace",
      taskId,
      "Entry with seconds",
      "--timestamp",
      "T14:20:45",
    ]);

    // Read task file to verify timestamp
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const expectedDate = `${year}-${month}-${day}`;

    assertStringIncludes(taskContent, `${expectedDate} 14:20`);
    assertStringIncludes(taskContent, "Entry with seconds");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - accepts -t as alias for --timestamp", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entry with -t flag (alias for --timestamp)
    await main([
      "trace",
      taskId,
      "Entry with -t flag",
      "-t",
      "2024-09-10T14:00",
    ]);

    // Read task file to verify timestamp
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    assertStringIncludes(taskContent, "2024-09-10 14:00");
    assertStringIncludes(taskContent, "Entry with -t flag");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// Helper to capture console output
async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  let output = "";
  console.log = (msg: string) => {
    output += msg;
  };
  try {
    await fn();
    return output;
  } finally {
    console.log = originalLog;
  }
}

// Tests for force flag and uncheckpointed entries
Deno.test("worklog trace - sets has_uncheckpointed_entries flag", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add a trace entry
    await main(["trace", taskId, "Test entry"]);

    // Read task file and verify has_uncheckpointed_entries is true
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "has_uncheckpointed_entries: true");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - rejects completed task without --force", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Complete the task
    await main(["done", taskId, "Done", "Learnings"]);

    // Try to trace without --force
    try {
      await main(["trace", taskId, "Should fail"]);
    } catch (_e) {
      // Expected
    }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "already completed");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog trace - allows completed task with --force", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Complete the task
    await main(["done", taskId, "Done", "Learnings"]);

    // Trace with --force should succeed
    await main(["trace", taskId, "Post-completion entry", "--force"]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "Post-completion entry");
    assertStringIncludes(taskContent, "has_uncheckpointed_entries: true");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog checkpoint - clears has_uncheckpointed_entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add trace entries
    await main(["trace", taskId, "Entry 1"]);
    await main(["trace", taskId, "Entry 2"]);

    // Create checkpoint
    await main(["checkpoint", taskId, "Changes", "Learnings"]);

    // Verify has_uncheckpointed_entries is false
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "has_uncheckpointed_entries: false");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog checkpoint - rejects if no uncheckpointed entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Try to checkpoint without any entries
    try {
      await main(["checkpoint", taskId, "Changes", "Learnings"]);
    } catch (_e) {
      // Expected
    }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "No uncheckpointed entries");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog checkpoint - allows force on completed task", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Complete task
    await main(["done", taskId, "Done", "Learnings"]);

    // Add entry with force
    await main(["trace", taskId, "Post-done entry", "--force"]);

    // Checkpoint with force should work
    await main([
      "checkpoint",
      taskId,
      "Post-completion changes",
      "Post-completion learnings",
      "--force",
    ]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "Post-completion changes");
    assertStringIncludes(taskContent, "has_uncheckpointed_entries: false");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog import - imports new task from source", async () => {
  const tempDirDest = await Deno.makeTempDir();
  const tempDirSource = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Setup destination
    Deno.chdir(tempDirDest);
    await main(["init"]);

    // Setup source with a task
    Deno.chdir(tempDirSource);
    await main(["init"]);
    await main(["add", "--desc", "Source task"]);
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const sourceTaskId = tasks[0].id;
    await main(["trace", sourceTaskId, "Entry from source"]);

    // Import into destination
    Deno.chdir(tempDirDest);
    const importOutput = await captureOutput(() =>
      main(["import", "--path", `${tempDirSource}/.worklog`, "--json"])
    );
    const importResult = JSON.parse(importOutput);

    assertEquals(importResult.imported, 1);
    assertEquals(importResult.merged, 0);
    assertEquals(importResult.skipped, 0);

    // Verify task exists in destination
    const destList = await captureOutput(() => main(["list", "--json"]));
    const destTasks = JSON.parse(destList);
    assertEquals(destTasks.tasks.length, 1);
    assertEquals(destTasks.tasks[0].desc, "Source task");

    // Verify content
    const taskContent = await Deno.readTextFile(
      `.worklog/tasks/${sourceTaskId}.md`,
    );
    assertStringIncludes(taskContent, "Entry from source");
    assertStringIncludes(taskContent, "uid:");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirDest, { recursive: true });
    await Deno.remove(tempDirSource, { recursive: true });
  }
});

Deno.test("worklog import - merges entries for same uid", async () => {
  const tempDirDest = await Deno.makeTempDir();
  const tempDirSource = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Create task in destination
    Deno.chdir(tempDirDest);
    await main(["init"]);
    await main(["add", "--desc", "Shared task"]);
    const listDest = await captureOutput(() => main(["list", "--json"]));
    const { tasks: destTasks } = JSON.parse(listDest);
    const taskId = destTasks[0].id;
    await main(["trace", taskId, "Entry from dest"]);

    // Get the uid from destination task
    const destTaskContent = await Deno.readTextFile(
      `.worklog/tasks/${taskId}.md`,
    );
    const uidMatch = destTaskContent.match(/uid: (.+)/);
    const uid = uidMatch![1];

    // Create same task in source with same uid
    Deno.chdir(tempDirSource);
    await main(["init"]);
    const sourceTaskPath = `${tempDirSource}/.worklog/tasks/${taskId}.md`;
    await Deno.mkdir(`${tempDirSource}/.worklog/tasks`, { recursive: true });
    const now = new Date().toISOString();
    await Deno.writeTextFile(
      sourceTaskPath,
      `---
id: ${taskId}
uid: ${uid}
desc: "Shared task"
status: active
created: "${now}"
done_at: null
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

## 2026-01-22 10:00

Entry from source

# Checkpoints
`,
    );

    // Update source index
    await Deno.writeTextFile(
      `${tempDirSource}/.worklog/index.json`,
      JSON.stringify({
        tasks: {
          [taskId]: {
            desc: "Shared task",
            status: "active",
            created: now,
            done_at: null,
          },
        },
      }),
    );

    // Import into destination
    Deno.chdir(tempDirDest);
    const importOutput = await captureOutput(() =>
      main(["import", "--path", `${tempDirSource}/.worklog`, "--json"])
    );
    const importResult = JSON.parse(importOutput);

    assertEquals(importResult.imported, 0);
    assertEquals(importResult.merged, 1);
    assertEquals(importResult.skipped, 0);

    // Verify both entries exist
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "Entry from dest");
    assertStringIncludes(taskContent, "Entry from source");
    assertStringIncludes(taskContent, "has_uncheckpointed_entries: true");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirDest, { recursive: true });
    await Deno.remove(tempDirSource, { recursive: true });
  }
});

Deno.test("worklog import - renames task on id collision", async () => {
  const tempDirDest = await Deno.makeTempDir();
  const tempDirSource = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Create task in destination
    Deno.chdir(tempDirDest);
    await main(["init"]);
    await main(["add", "--desc", "Dest task"]);
    const listDest = await captureOutput(() => main(["list", "--json"]));
    const { tasks: destTasks } = JSON.parse(listDest);
    const taskId = destTasks[0].id; // e.g., 260122a

    // Create different task with same ID in source (different uid)
    Deno.chdir(tempDirSource);
    await main(["init"]);
    const sourceTaskPath = `${tempDirSource}/.worklog/tasks/${taskId}.md`;
    await Deno.mkdir(`${tempDirSource}/.worklog/tasks`, { recursive: true });
    const now = new Date().toISOString();
    await Deno.writeTextFile(
      sourceTaskPath,
      `---
id: ${taskId}
uid: different-uid-12345
desc: "Source task"
status: active
created: "${now}"
done_at: null
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

## 2026-01-22 10:00

Entry from source task

# Checkpoints
`,
    );

    // Update source index
    await Deno.writeTextFile(
      `${tempDirSource}/.worklog/index.json`,
      JSON.stringify({
        tasks: {
          [taskId]: {
            desc: "Source task",
            status: "active",
            created: now,
            done_at: null,
          },
        },
      }),
    );

    // Import into destination
    Deno.chdir(tempDirDest);
    const importOutput = await captureOutput(() =>
      main(["import", "--path", `${tempDirSource}/.worklog`, "--json"])
    );
    const importResult = JSON.parse(importOutput);

    assertEquals(importResult.imported, 1);
    assertEquals(importResult.merged, 0);

    // Verify task was renamed
    const newTaskId = importResult.tasks[0].id;
    assert(newTaskId !== taskId, "Task should have been renamed");
    assert(
      importResult.tasks[0].warnings?.some((w: string) =>
        w.includes("Renamed from")
      ),
    );

    // Verify both tasks exist
    const destList = await captureOutput(() => main(["list", "--json"]));
    const finalTasks = JSON.parse(destList);
    assertEquals(finalTasks.tasks.length, 2);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirDest, { recursive: true });
    await Deno.remove(tempDirSource, { recursive: true });
  }
});

Deno.test("worklog import - removes source tasks with --rm", async () => {
  const tempDirDest = await Deno.makeTempDir();
  const tempDirSource = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Setup destination
    Deno.chdir(tempDirDest);
    await main(["init"]);

    // Setup source with a task
    Deno.chdir(tempDirSource);
    await main(["init"]);
    await main(["add", "--desc", "Task to remove"]);

    // Import with --rm
    Deno.chdir(tempDirDest);
    await main(["import", "--path", `${tempDirSource}/.worklog`, "--rm"]);

    // Verify source .worklog was removed
    const sourceExists = await Deno.stat(`${tempDirSource}/.worklog`).then(
      () => true,
      () => false,
    );
    assertEquals(sourceExists, false, "Source .worklog should be removed");

    // Verify task exists in destination
    const destList = await captureOutput(() => main(["list", "--json"]));
    const destTasks = JSON.parse(destList);
    assertEquals(destTasks.tasks.length, 1);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirDest, { recursive: true });
    if (
      await Deno.stat(tempDirSource).then(() => true, () => false)
    ) {
      await Deno.remove(tempDirSource, { recursive: true });
    }
  }
});

Deno.test("worklog import - generates uid for tasks without uid", async () => {
  const tempDirDest = await Deno.makeTempDir();
  const tempDirSource = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Setup destination
    Deno.chdir(tempDirDest);
    await main(["init"]);

    // Create task in source WITHOUT uid (backward compatibility)
    Deno.chdir(tempDirSource);
    await main(["init"]);
    const taskId = "260122a";
    const sourceTaskPath = `${tempDirSource}/.worklog/tasks/${taskId}.md`;
    await Deno.mkdir(`${tempDirSource}/.worklog/tasks`, { recursive: true });
    const now = new Date().toISOString();
    await Deno.writeTextFile(
      sourceTaskPath,
      `---
id: ${taskId}
desc: "Old task without uid"
status: active
created: "${now}"
done_at: null
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints
`,
    );

    await Deno.writeTextFile(
      `${tempDirSource}/.worklog/index.json`,
      JSON.stringify({
        tasks: {
          [taskId]: {
            desc: "Old task without uid",
            status: "active",
            created: now,
            done_at: null,
          },
        },
      }),
    );

    // Import
    Deno.chdir(tempDirDest);
    await main(["import", "--path", `${tempDirSource}/.worklog`]);

    // Verify uid was generated in destination
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "uid:");
    const uidMatch = taskContent.match(/uid: (.+)/);
    assert(uidMatch, "UID should be present");
    assert(uidMatch[1].length > 0, "UID should not be empty");

    // Also verify source was updated with uid
    const sourceTaskContent = await Deno.readTextFile(sourceTaskPath);
    assertStringIncludes(sourceTaskContent, "uid:");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirDest, { recursive: true });
    await Deno.remove(tempDirSource, { recursive: true });
  }
});

Deno.test("worklog import - warns when entry older than checkpoint", async () => {
  const tempDirDest = await Deno.makeTempDir();
  const tempDirSource = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Create task with checkpoint in destination
    Deno.chdir(tempDirDest);
    await main(["init"]);
    await main(["add", "--desc", "Task with checkpoint"]);
    const listDest = await captureOutput(() => main(["list", "--json"]));
    const { tasks: destTasks } = JSON.parse(listDest);
    const taskId = destTasks[0].id;
    await main(["trace", taskId, "Entry 1"]);
    await main(["checkpoint", taskId, "First checkpoint", "Learnings"]);

    // Get uid from destination
    const destTaskContent = await Deno.readTextFile(
      `.worklog/tasks/${taskId}.md`,
    );
    const uidMatch = destTaskContent.match(/uid: (.+)/);
    const uid = uidMatch![1];

    // Create source task with old entry (before checkpoint)
    Deno.chdir(tempDirSource);
    await main(["init"]);
    const sourceTaskPath = `${tempDirSource}/.worklog/tasks/${taskId}.md`;
    await Deno.mkdir(`${tempDirSource}/.worklog/tasks`, { recursive: true });
    const now = new Date().toISOString();
    await Deno.writeTextFile(
      sourceTaskPath,
      `---
id: ${taskId}
uid: ${uid}
desc: "Task with checkpoint"
status: active
created: "${now}"
done_at: null
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

## 2020-01-01 10:00

Very old entry

# Checkpoints
`,
    );

    await Deno.writeTextFile(
      `${tempDirSource}/.worklog/index.json`,
      JSON.stringify({
        tasks: {
          [taskId]: {
            desc: "Task with checkpoint",
            status: "active",
            created: now,
            done_at: null,
          },
        },
      }),
    );

    // Import
    Deno.chdir(tempDirDest);
    const importOutput = await captureOutput(() =>
      main(["import", "--path", `${tempDirSource}/.worklog`, "--json"])
    );
    const importResult = JSON.parse(importOutput);

    // When all entries are skipped, task is marked as skipped, not merged
    assertEquals(importResult.merged, 0);
    assertEquals(importResult.skipped, 1);
    assert(
      importResult.tasks[0].warnings?.some((w: string) =>
        w.includes("No new entries")
      ),
      "Should warn about no new entries",
    );

    // Verify old entry was NOT added
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assert(
      !taskContent.includes("Very old entry"),
      "Old entry should be skipped",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirDest, { recursive: true });
    await Deno.remove(tempDirSource, { recursive: true });
  }
});

Deno.test("worklog trace - recommends checkpoint at 50 entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add 49 entries - should not recommend
    for (let i = 0; i < 49; i++) {
      const output = await captureOutput(() =>
        main(["trace", taskId, `Entry ${i + 1}`])
      );
      assertEquals(output.trim(), "ok");
    }

    // 50th entry should recommend checkpoint
    const output = await captureOutput(() =>
      main(["trace", taskId, "Entry 50"])
    );
    assertStringIncludes(output, "checkpoint recommended");
    assertStringIncludes(output, "50 entries");

    // Verify JSON output
    const jsonOutput = await captureOutput(() =>
      main(["trace", taskId, "Entry 51", "--json"])
    );
    const result = JSON.parse(jsonOutput);
    assertEquals(result.status, "checkpoint_recommended");
    assertEquals(result.entries_since_checkpoint, 51);

    // After checkpoint, count resets
    await main(["checkpoint", taskId, "Changes", "Learnings"]);
    const afterCheckpoint = await captureOutput(() =>
      main(["trace", taskId, "Entry after checkpoint"])
    );
    assertEquals(afterCheckpoint.trim(), "ok");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog purge - deletes tasks older than 30 days", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Old task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Mark as done with old timestamp
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31); // 31 days ago
    const oldISOString = oldDate.toISOString();

    // Manually update task to be old
    const taskPath = `.worklog/tasks/${taskId}.md`;
    let content = await Deno.readTextFile(taskPath);
    content = content.replace(/status: active/, "status: done");
    content = content.replace(/done_at: null/, `done_at: "${oldISOString}"`);
    await Deno.writeTextFile(taskPath, content);

    // Update index
    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    index.tasks[taskId].status = "done";
    index.tasks[taskId].done_at = oldISOString;
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(index, null, 2),
    );

    // Run any command that triggers purge
    await main(["list"]);

    // Task should be purged
    const taskExists = await Deno.stat(taskPath).then(() => true, () => false);
    assertEquals(taskExists, false, "Old task should be purged");

    // Verify not in index
    const finalIndex = JSON.parse(
      await Deno.readTextFile(".worklog/index.json"),
    );
    assertEquals(finalIndex.tasks[taskId], undefined);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog purge - preserves tasks with uncheckpointed entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalError = console.error;
  let errorOutput = "";

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Old task with changes"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add entry and mark as done
    await main(["done", taskId, "Done", "Learnings"]);

    // Add post-completion entry with force
    await main(["trace", taskId, "Post-completion change", "--force"]);

    // Make it old
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31);
    const oldISOString = oldDate.toISOString();

    const taskPath = `.worklog/tasks/${taskId}.md`;
    let content = await Deno.readTextFile(taskPath);
    content = content.replace(
      /done_at: ".+"/,
      `done_at: "${oldISOString}"`,
    );
    await Deno.writeTextFile(taskPath, content);

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    index.tasks[taskId].done_at = oldISOString;
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(index, null, 2),
    );

    // Run command that triggers purge
    await main(["list"]);

    // Task should NOT be purged
    const taskExists = await Deno.stat(taskPath).then(() => true, () => false);
    assertEquals(
      taskExists,
      true,
      "Task with uncheckpointed entries should be preserved",
    );

    // Should have warning
    assertStringIncludes(errorOutput, "not purged");
    assertStringIncludes(errorOutput, "uncheckpointed entries");
  } finally {
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog - JSON output for list command", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Task 1"]);
    await main(["add", "--desc", "Task 2"]);

    const output = await captureOutput(() => main(["list", "--json"]));
    const result = JSON.parse(output);

    assertEquals(result.tasks.length, 2);
    assertEquals(result.tasks[0].desc, "Task 1");
    assertEquals(result.tasks[1].desc, "Task 2");
    assertEquals(result.tasks[0].status, "active");
    assert(result.tasks[0].id);
    assert(result.tasks[0].created);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog - JSON output for logs command", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    await main(["trace", taskId, "Entry 1"]);
    await main(["trace", taskId, "Entry 2"]);

    const output = await captureOutput(() => main(["logs", taskId, "--json"]));
    const result = JSON.parse(output);

    assertEquals(result.task, taskId);
    assertEquals(result.desc, "Test task");
    assertEquals(result.status, "active");
    assertEquals(result.last_checkpoint, null);
    assertEquals(result.entries_since_checkpoint.length, 2);
    assertEquals(result.entries_since_checkpoint[0].msg, "Entry 1");
    assertEquals(result.entries_since_checkpoint[1].msg, "Entry 2");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog - handles missing index.json", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    Deno.chdir(tempDir);

    // Create .worklog directory but no index
    await Deno.mkdir(".worklog");

    // Try to add task
    try {
      await main(["add", "--desc", "Test"]);
    } catch (_e) {
      // Expected
    }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "not_initialized");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog - handles corrupted frontmatter gracefully", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Corrupt the frontmatter (but keep valid structure)
    const taskPath = `.worklog/tasks/${taskId}.md`;
    await Deno.writeTextFile(
      taskPath,
      `---
this is not valid yaml: [broken
---

# Entries

# Checkpoints
`,
    );

    // Parser should handle gracefully and return empty frontmatter
    // The task will be missing required fields, so trace should succeed
    // (it will just have default/empty values)
    await main(["trace", taskId, "Entry with bad frontmatter"]);

    // Task file should now have the new entry
    const content = await Deno.readTextFile(taskPath);
    assertStringIncludes(content, "Entry with bad frontmatter");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog - handles malformed task file", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["add", "--desc", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Create malformed file (no frontmatter, no sections)
    const taskPath = `.worklog/tasks/${taskId}.md`;
    await Deno.writeTextFile(taskPath, "Just some random text\n");

    // Try to trace
    try {
      await main(["trace", taskId, "Should fail"]);
    } catch (_e) {
      // Expected
    }

    // Should have exited with error
    assertEquals(exitCode, 1);
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});
