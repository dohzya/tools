import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { WtError } from "./domain/entities/errors.ts";

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

Deno.test("worklog - shows help when no arguments provided", async () => {
  const output = await captureOutput(() => main([]));
  assertStringIncludes(output, "Core workflow:");
  assertStringIncludes(output, "wl task create");
  assertStringIncludes(output, "wl trace");
  assertStringIncludes(output, "Key principles:");
});

Deno.test("worklog trace - uses current timestamp by default", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize and create a task
    await main(["init"]);
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    assertStringIncludes(errorOutput, "is completed");
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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Source task"]);
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
    await main(["task", "create", "Shared task"]);
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
    await main(["task", "create", "Dest task"]);
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
name: "Source task"
desc: "Source task"
status: started
created_at: "${now}"
ready_at: null
started_at: "${now}"
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
        version: 2,
        tasks: {
          [taskId]: {
            name: "Source task",
            desc: "Source task",
            status: "started",
            created: now,
            status_updated_at: now,
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
    await main(["task", "create", "Task to remove"]);

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
    await main(["task", "create", "Task with checkpoint"]);
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

Deno.test("worklog import - handles external worktree with --scope-to-tag", async () => {
  const tempDirRoot = await Deno.makeTempDir();
  const tempDirExternal = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    // Setup git repo in root directory
    Deno.chdir(tempDirRoot);
    await new Deno.Command("git", { args: ["init"] }).output();
    await new Deno.Command("git", {
      args: ["config", "user.email", "test@example.com"],
    }).output();
    await new Deno.Command("git", {
      args: ["config", "user.name", "Test User"],
    }).output();

    // Initialize worklog in root
    await main(["init"]);

    // Setup external worktree (outside git root)
    Deno.chdir(tempDirExternal);
    await main(["init"]);
    await main(["task", "create", "External task"]);
    await captureOutput(() => main(["list", "--json"]));

    // Import from external worktree with --scope-to-tag
    Deno.chdir(tempDirRoot);
    const importOutput = await captureOutput(() =>
      main([
        "import",
        "--path",
        `${tempDirExternal}/.worklog`,
        "--scope-to-tag",
        "--json",
      ])
    );
    const importResult = JSON.parse(importOutput);

    assertEquals(importResult.imported, 1);

    // Tag should be the basename of the external directory
    const expectedTag = tempDirExternal.split("/").pop()!;
    assertEquals(importResult.tag, expectedTag);

    // Verify task has the tag
    const destList = await captureOutput(() => main(["list", "--json"]));
    const destTasks = JSON.parse(destList);
    assertEquals(destTasks.tasks.length, 1);
    assert(
      destTasks.tasks[0].tags?.includes(expectedTag),
      `Task should have tag ${expectedTag}`,
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDirRoot, { recursive: true });
    await Deno.remove(tempDirExternal, { recursive: true });
  }
});

Deno.test("worklog trace - recommends checkpoint at 50 entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Old task"]);

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
    await main(["task", "create", "Old task with changes"]);

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
    await main(["task", "create", "Task 1"]);
    await main(["task", "create", "Task 2"]);

    const output = await captureOutput(() => main(["list", "--json"]));
    const result = JSON.parse(output);

    assertEquals(result.tasks.length, 2);
    const descs = result.tasks.map((t: { desc: string }) => t.desc).sort();
    assertEquals(descs, ["Task 1", "Task 2"]);
    assert(
      result.tasks.every((t: { status: string }) => t.status === "started"),
    );
    assert(result.tasks.every((t: { id: string }) => t.id));
    assert(result.tasks.every((t: { created: string }) => t.created));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog - JSON output for show command", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);
    await main(["task", "create", "Test task"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    await main(["trace", taskId, "Entry 1"]);
    await main(["trace", taskId, "Entry 2"]);

    const output = await captureOutput(() => main(["show", taskId, "--json"]));
    const result = JSON.parse(output);

    assertEquals(result.fullId, taskId);
    assert(taskId.startsWith(result.task));
    assertEquals(result.name, "Test task");
    assertEquals(result.desc, "Test task");
    assertEquals(result.status, "started");
    assert(result.created);
    assertEquals(result.ready, null);
    assert(result.started);
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
      await main(["task", "create", "Test"]);
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
    await main(["task", "create", "Test task"]);

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
    await main(["task", "create", "Test task"]);

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

// Integration tests for wl task create with timestamp
Deno.test("worklog task create - accepts custom timestamp in ISO format", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with custom timestamp
    const customTimestamp = "2024-12-15T14:30:00+01:00";
    await main([
      "task",
      "create",
      "Historical task",
      "--timestamp",
      customTimestamp,
    ]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Read task file to verify custom timestamp is used in created field
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    // Should contain the custom timestamp in the created field
    assertStringIncludes(
      taskContent,
      'created_at: "2024-12-15T14:30:00+01:00"',
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog task create - accepts -t as alias for --timestamp", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with -t flag
    const customTimestamp = "2024-11-20T09:00:00+01:00";
    await main(["task", "create", "Task with -t", "-t", customTimestamp]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Read task file to verify timestamp
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    assertStringIncludes(
      taskContent,
      'created_at: "2024-11-20T09:00:00+01:00"',
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog task create - accepts flexible timestamp T format", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with flexible timestamp (T16:45 format)
    await main(["task", "create", "Task with T format", "-t", "T16:45"]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Read task file to verify timestamp has today's date and the specified time
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    // Should contain today's date at 16:45
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const expectedPrefix = `created_at: "${year}-${month}-${day}T16:45:00`;

    assertStringIncludes(taskContent, expectedPrefix);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog task create - adds local timezone when missing", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with timestamp without timezone
    await main([
      "task",
      "create",
      "Task without tz",
      "-t",
      "2024-12-15T10:45",
    ]);

    // Get task ID
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Read task file
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);

    // Should contain the date/time with a timezone appended
    assertStringIncludes(taskContent, 'created_at: "2024-12-15T10:45:00');
    // Should have a timezone (+ or - followed by HH:MM)
    assert(
      /created_at: "2024-12-15T10:45:00[+-]\d{2}:\d{2}"/.test(taskContent),
      "Timestamp should have timezone",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("worklog task create - rejects invalid timestamp format", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  let _exitCode = 0;
  let errorOutput = "";
  const originalExit = Deno.exit;
  const originalError = console.error;

  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      _exitCode = code;
    }) as typeof Deno.exit;
    console.error = (msg: string) => {
      errorOutput += msg;
    };

    await main(["init"]);

    // Try to create task with invalid timestamp
    try {
      await main([
        "task",
        "create",
        "Task with bad timestamp",
        "--timestamp",
        "not-a-valid-timestamp",
      ]);
    } catch (_e) {
      // Expected
    }

    // Error message should mention invalid timestamp
    assertStringIncludes(errorOutput, "Invalid timestamp");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Migration tests (v1 to v2)
// ============================================================================

Deno.test("migration - detects version 1 index without version field", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    // Initialize
    await main(["init"]);

    // Manually create a v1 index (no version field)
    const v1Index = {
      tasks: {
        "a": {
          desc: "Test task",
          status: "active",
          created: "2024-01-01T10:00:00+00:00",
        },
      },
    };
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(v1Index, null, 2),
    );

    // Create corresponding task file in v1 format
    const taskContent = `---
id: a
uid: test-uuid-1
desc: Test task
status: active
created: 2024-01-01T10:00:00+00:00
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints

# Todos
`;
    await Deno.writeTextFile(".worklog/tasks/a.md", taskContent);

    // Trigger migration by loading index (via list command)
    await main(["list", "--json"]);

    // Check index was migrated
    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.version, 2);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("migration - converts active to created status", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create v1 index with active task
    const v1Index = {
      tasks: {
        "a": {
          desc: "Active task",
          status: "active",
          created: "2024-01-01T10:00:00+00:00",
        },
      },
    };
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(v1Index, null, 2),
    );

    const taskContent = `---
id: a
uid: test-uuid-1
desc: Active task
status: active
created: 2024-01-01T10:00:00+00:00
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints

# Todos
`;
    await Deno.writeTextFile(".worklog/tasks/a.md", taskContent);

    // Trigger migration
    await main(["list", "--json"]);

    // Check status was converted to created
    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks.a.status, "created");

    const migratedTaskContent = await Deno.readTextFile(".worklog/tasks/a.md");
    assertStringIncludes(migratedTaskContent, "status: created");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("migration - preserves done and cancelled tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create v1 index with done and cancelled tasks (use recent dates to avoid purging)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const createdDate = yesterday.toISOString();
    const doneDate = now.toISOString();

    const v1Index = {
      tasks: {
        "a": {
          desc: "Done task",
          status: "done",
          created: createdDate,
          done_at: doneDate,
        },
        "b": {
          desc: "Cancelled task",
          status: "cancelled",
          created: createdDate,
          cancelled_at: doneDate,
        },
      },
    };
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(v1Index, null, 2),
    );

    const doneTaskContent = `---
id: a
uid: test-uuid-1
desc: Done task
status: done
created: ${createdDate}
done_at: ${doneDate}
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints

# Todos
`;
    await Deno.writeTextFile(".worklog/tasks/a.md", doneTaskContent);

    const cancelledTaskContent = `---
id: b
uid: test-uuid-2
desc: Cancelled task
status: cancelled
created: ${createdDate}
cancelled_at: ${doneDate}
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints

# Todos
`;
    await Deno.writeTextFile(".worklog/tasks/b.md", cancelledTaskContent);

    // Trigger migration via any command that loads the index
    await main(["list", "--all", "--json"]);

    // Check statuses are preserved in the index file directly
    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks.a.status, "done");
    assertEquals(index.tasks.b.status, "cancelled");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("migration - renames created to created_at", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create v1 index
    const v1Index = {
      tasks: {
        "a": {
          desc: "Test task",
          status: "active",
          created: "2024-01-01T10:00:00+00:00",
        },
      },
    };
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(v1Index, null, 2),
    );

    const taskContent = `---
id: a
uid: test-uuid-1
desc: Test task
status: active
created: 2024-01-01T10:00:00+00:00
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints

# Todos
`;
    await Deno.writeTextFile(".worklog/tasks/a.md", taskContent);

    // Trigger migration
    await main(["list", "--json"]);

    // Check created was renamed to created_at (timestamp format may vary due to YAML serialization)
    const migratedTaskContent = await Deno.readTextFile(".worklog/tasks/a.md");
    assertStringIncludes(migratedTaskContent, "created_at:");
    assertStringIncludes(migratedTaskContent, "2024-01-01");
    // Should NOT have the old 'created:' field (check it's not there as a standalone field)
    assert(!migratedTaskContent.match(/^created: /m));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("migration - extracts name from desc for all tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create v1 index with multiline desc
    const v1Index = {
      tasks: {
        "a": {
          desc: "Fix bug in login\nThis is a detailed description",
          status: "active",
          created: "2024-01-01T10:00:00+00:00",
        },
      },
    };
    await Deno.writeTextFile(
      ".worklog/index.json",
      JSON.stringify(v1Index, null, 2),
    );

    const taskContent = `---
id: a
uid: test-uuid-1
desc: "Fix bug in login\\nThis is a detailed description"
status: active
created: 2024-01-01T10:00:00+00:00
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints

# Todos
`;
    await Deno.writeTextFile(".worklog/tasks/a.md", taskContent);

    // Trigger migration
    await main(["list", "--json"]);

    // Check name was extracted
    const migratedTaskContent = await Deno.readTextFile(".worklog/tasks/a.md");
    assertStringIncludes(migratedTaskContent, "name: Fix bug in login");

    // Check index entry has name
    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks.a.name, "Fix bug in login");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Create command tests
// ============================================================================

Deno.test("create - creates task in 'created' state by default", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with name only
    await main(["create", "Fix login bug", "--json"]);

    // Get task ID from list
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Check task file
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, 'name: "Fix login bug"');
    assertStringIncludes(taskContent, 'desc: ""');
    assertStringIncludes(taskContent, "status: created");
    assertStringIncludes(taskContent, "ready_at: null");
    assertStringIncludes(taskContent, "started_at: null");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("create - accepts name and detailed description", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with name and description
    await main([
      "create",
      "Fix bug",
      "User cannot login to the system",
      "--json",
    ]);

    // Get task ID from list
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Check task file
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, 'name: "Fix bug"');
    assertStringIncludes(
      taskContent,
      'desc: "User cannot login to the system"',
    );
    assertStringIncludes(taskContent, "status: created");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("create --ready - creates task in 'ready' state", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with --ready flag
    await main(["create", "Ready task", "--ready", "--json"]);

    // Get task ID from list
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Check task file
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "status: ready");
    assertStringIncludes(taskContent, "ready_at:");
    // Should have a timestamp for ready_at
    assert(taskContent.match(/ready_at:.*\d{4}-\d{2}-\d{2}/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("create --started - creates task in 'started' state", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);

    await main(["init"]);

    // Create task with --started flag
    await main(["create", "Started task", "--started", "--json"]);

    // Get task ID from list
    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Check task file
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "status: started");
    assertStringIncludes(taskContent, "started_at:");
    // Should have a timestamp for started_at
    assert(taskContent.match(/started_at:.*\d{4}-\d{2}-\d{2}/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("create - rejects both --ready and --started flags", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = (msg: string) => {
      errorOutput += msg;
    };

    await main(["init"]);

    // Try to create task with both flags
    try {
      await main(["create", "Task", "--ready", "--started", "--json"]);
    } catch (_e) {
      // Expected
    }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "ready");
    assertStringIncludes(errorOutput, "started");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Ready command tests
// ============================================================================

Deno.test("ready - transitions created to ready", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Task"]);
    const _ls1 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls1).tasks[0].id;

    await main(["ready", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: ready");
    assert(taskContent.match(/ready_at:.*\d{4}-\d{2}-\d{2}/));

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks[id].status, "ready");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ready - transitions started back to ready", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls2 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls2).tasks[0].id;

    await main(["ready", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: ready");
    // started_at should remain (history)
    assert(taskContent.match(/started_at:.*\d{4}-\d{2}-\d{2}/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ready - rejects done tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = () => {};

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "--started", "Task", "--json"])
    );
    const { id } = JSON.parse(output);
    await main(["done", id, "changes", "learnings"]);

    try {
      await main(["ready", id]);
    } catch (_e) { /* expected */ }

    assertEquals(exitCode, 1);
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ready - rejects cancelled tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = () => {};

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "Task", "--json"])
    );
    const { id } = JSON.parse(output);
    await main(["cancel", id]);

    try {
      await main(["ready", id]);
    } catch (_e) { /* expected */ }

    assertEquals(exitCode, 1);
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Start command tests
// ============================================================================

Deno.test("start - transitions created to started", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Task"]);
    const _ls3 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls3).tasks[0].id;

    await main(["start", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: started");
    assert(taskContent.match(/started_at:.*\d{4}-\d{2}-\d{2}/));

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks[id].status, "started");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("start - transitions ready to started", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--ready", "Task"]);
    const _ls4 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls4).tasks[0].id;

    await main(["start", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: started");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("start - reopens done task", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls5 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls5).tasks[0].id;

    await main(["done", id, "changes", "learnings"]);

    // Reopen
    await main(["start", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: started");
    assertStringIncludes(taskContent, "done_at: null");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("start - rejects cancelled tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = () => {};

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "Task", "--json"])
    );
    const { id } = JSON.parse(output);
    await main(["cancel", id]);

    try {
      await main(["start", id]);
    } catch (_e) { /* expected */ }

    assertEquals(exitCode, 1);
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Update command tests
// ============================================================================

Deno.test("update --name - updates task name", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Old name"]);
    const _ls6 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls6).tasks[0].id;

    await main(["update", id, "--name", "New name"]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assert(taskContent.match(/name:.*New name/));

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks[id].name, "New name");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("update --desc - updates task description", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Name"]);
    const _ls7 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls7).tasks[0].id;

    await main(["update", id, "--desc", "New detailed description"]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assert(taskContent.match(/desc:.*New detailed description/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("update --name --desc - updates both fields", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Old", "Old desc"]);
    const _ls8 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls8).tasks[0].id;

    await main(["update", id, "--name", "New name", "--desc", "New desc"]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assert(taskContent.match(/name:.*New name/));
    assert(taskContent.match(/desc:.*New desc/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("update - rejects when no options provided", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";
  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = (msg: string) => {
      errorOutput += msg;
    };

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "Task", "--json"])
    );
    const { id } = JSON.parse(output);

    try {
      await main(["update", id]);
    } catch (_e) { /* expected */ }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "--name");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// List filter tests
// ============================================================================

Deno.test("list - default shows created, ready, and started tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    await main(["create", "--ready", "Ready task"]);
    await main(["create", "--started", "Started task"]);
    const doneOutput = await captureOutput(() =>
      main(["create", "--started", "Done task", "--json"])
    );
    const doneId = JSON.parse(doneOutput).id;
    await main(["done", doneId, "changes", "learnings"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);

    assertEquals(tasks.length, 3);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("list --ready - shows only ready tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    await main(["create", "--ready", "Ready task"]);
    await main(["create", "--started", "Started task"]);

    const listOutput = await captureOutput(() =>
      main(["list", "--ready", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);

    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].status, "ready");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("list --created --ready - cumulative filter", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    await main(["create", "--ready", "Ready task"]);
    await main(["create", "--started", "Started task"]);

    const listOutput = await captureOutput(() =>
      main(["list", "--created", "--ready", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);

    assertEquals(tasks.length, 2);
    const statuses = tasks.map((t: { status: string }) => t.status).sort();
    assertEquals(statuses, ["created", "ready"]);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("list --done - shows only done tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    const output = await captureOutput(() =>
      main(["create", "--started", "Done task", "--json"])
    );
    const doneId = JSON.parse(output).id;
    await main(["done", doneId, "changes", "learnings"]);

    const listOutput = await captureOutput(() =>
      main(["list", "--done", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);

    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].status, "done");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("list - human-readable shows name not desc", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);
    await main(["create", "Short name", "Very long detailed description here"]);

    const listOutput = await captureOutput(() => main(["list"]));

    assertStringIncludes(listOutput, "Short name");
    assert(!listOutput.includes("Very long detailed"));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Trace warning tests
// ============================================================================

Deno.test("trace - warns when task is created (but records trace)", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalError = console.error;
  let errorOutput = "";
  try {
    Deno.chdir(tempDir);
    console.error = (...args: unknown[]) => {
      errorOutput += args.join(" ") + "\n";
    };

    await main(["init"]);
    await main(["create", "Task"]);
    const _ls9 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls9).tasks[0].id;

    await main(["trace", id, "Some trace"]);

    assertStringIncludes(errorOutput, "not started");
    assertStringIncludes(errorOutput, "Trace recorded");

    // Verify trace was actually stored
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "Some trace");
  } finally {
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("trace - no warning when task is started", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalError = console.error;
  let errorOutput = "";
  try {
    Deno.chdir(tempDir);
    console.error = (...args: unknown[]) => {
      errorOutput += args.join(" ") + "\n";
    };

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "--started", "Task", "--json"])
    );
    const { id } = JSON.parse(output);

    await main(["trace", id, "Some trace"]);

    assert(!errorOutput.includes("not started"));
  } finally {
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("trace - throws error when task is done (without --force)", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = () => {};

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "--started", "Task", "--json"])
    );
    const { id } = JSON.parse(output);
    await main(["done", id, "changes", "learnings"]);

    try {
      await main(["trace", id, "Post-done trace"]);
    } catch (_e) { /* expected */ }

    assertEquals(exitCode, 1);
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("trace --force - warns when task is done but records trace", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalError = console.error;
  let errorOutput = "";
  try {
    Deno.chdir(tempDir);
    console.error = (...args: unknown[]) => {
      errorOutput += args.join(" ") + "\n";
    };

    await main(["init"]);
    await main(["create", "--started", "Task"]);
    const _ls10 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls10).tasks[0].id;
    await main(["done", id, "changes", "learnings"]);

    await main(["trace", id, "-f", "Post-done trace"]);

    assertStringIncludes(errorOutput, "not started");

    // Verify trace was stored
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "Post-done trace");
  } finally {
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Done optional args tests
// ============================================================================

Deno.test("done - allows no args when no uncheckpointed entries", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls11 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls11).tasks[0].id;

    await main(["trace", id, "Work"]);
    await main(["checkpoint", id, "changes", "learnings"]);

    // No new entries since checkpoint
    await main(["done", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: done");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("done - rejects no args when uncheckpointed entries exist", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";
  try {
    Deno.chdir(tempDir);
    Deno.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof Deno.exit;
    console.error = (msg: string) => {
      errorOutput += msg;
    };

    await main(["init"]);
    const output = await captureOutput(() =>
      main(["create", "--started", "Task", "--json"])
    );
    const { id } = JSON.parse(output);
    await main(["trace", id, "Some work"]);

    try {
      await main(["done", id]);
    } catch (_e) { /* expected */ }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "uncheckpointed");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("done - allows no args when task has no entries at all", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls12 = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls12).tasks[0].id;

    // No entries at all - should be able to done without args
    await main(["done", id]);

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: done");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Show format tests
// ============================================================================

Deno.test("show - displays new format with history and name", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main([
      "create",
      "--started",
      "Fix login bug",
      "User cannot login due to session timeout",
    ]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main(["trace", id, "Investigating session handling"]);

    const showOutput = await captureOutput(() => main(["show", id]));

    // Header
    assertStringIncludes(showOutput, "id:");
    assertStringIncludes(showOutput, "full id:");
    assertStringIncludes(showOutput, "name: Fix login bug");
    assertStringIncludes(showOutput, "status: started");

    // History section
    assertStringIncludes(showOutput, "history:");
    assertStringIncludes(showOutput, "  created:");
    assertStringIncludes(showOutput, "  started:");

    // Description section
    assertStringIncludes(showOutput, "desc:");
    assertStringIncludes(
      showOutput,
      "  User cannot login due to session timeout",
    );

    // Entries
    assertStringIncludes(showOutput, "entries since checkpoint: 1");
    assertStringIncludes(showOutput, "Investigating session handling");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("show - displays multiline checkpoint formatting", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main(["trace", id, "Work done"]);
    await main(["checkpoint", id, "Line 1\nLine 2", "Learning 1\nLearning 2"]);

    const showOutput = await captureOutput(() => main(["show", id]));

    assertStringIncludes(showOutput, "last checkpoint:");
    assertStringIncludes(showOutput, "  CHANGES");
    assertStringIncludes(showOutput, "    Line 1");
    assertStringIncludes(showOutput, "    Line 2");
    assertStringIncludes(showOutput, "  LEARNINGS");
    assertStringIncludes(showOutput, "    Learning 1");
    assertStringIncludes(showOutput, "    Learning 2");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("show - parses checkpoint with markdown headers in content", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task with structured checkpoint"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main(["trace", id, "Work done"]);

    // Checkpoint content with markdown headers (simulates LLM-generated content)
    const changes = `Implementation complete

## Summary
Added new feature with ports & adapters

## Files Modified
- src/main.ts
- src/adapter.ts

## Metrics
- Tests: 100%`;

    const learnings = `Key discoveries

## Performance
System is 2x faster

### 1. Caching helped
Added LRU cache

### 2. Lazy loading
Reduced startup time`;

    await main(["checkpoint", id, changes, learnings]);

    const showOutput = await captureOutput(() => main(["show", id]));

    // Verify all content including markdown headers is preserved
    assertStringIncludes(showOutput, "last checkpoint:");
    assertStringIncludes(showOutput, "Implementation complete");
    assertStringIncludes(showOutput, "## Summary");
    assertStringIncludes(showOutput, "Added new feature");
    assertStringIncludes(showOutput, "## Files Modified");
    assertStringIncludes(showOutput, "- src/main.ts");
    assertStringIncludes(showOutput, "## Metrics");
    assertStringIncludes(showOutput, "Tests: 100%");

    assertStringIncludes(showOutput, "Key discoveries");
    assertStringIncludes(showOutput, "## Performance");
    assertStringIncludes(showOutput, "System is 2x faster");
    assertStringIncludes(showOutput, "### 1. Caching helped");
    assertStringIncludes(showOutput, "### 2. Lazy loading");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Critical coverage: list --cancelled
// ============================================================================

Deno.test("list --cancelled - shows only cancelled tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Active task"]);
    await main(["create", "To cancel"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const tasks = JSON.parse(_ls).tasks;
    // Cancel the second task (sorted alphabetically, pick whichever)
    await main(["cancel", tasks[1].id]);

    const listOutput = await captureOutput(() =>
      main(["list", "--cancelled", "--json"])
    );
    const { tasks: filtered } = JSON.parse(listOutput);

    assertEquals(filtered.length, 1);
    assertEquals(filtered[0].status, "cancelled");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Critical coverage: trace on ready task
// ============================================================================

Deno.test("trace - warns when task is ready (but records trace)", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalError = console.error;
  let errorOutput = "";
  try {
    Deno.chdir(tempDir);
    console.error = (...args: unknown[]) => {
      errorOutput += args.join(" ") + "\n";
    };

    await main(["init"]);
    await main(["create", "--ready", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main(["trace", id, "Some trace on ready task"]);

    assertStringIncludes(errorOutput, "not started");
    assertStringIncludes(errorOutput, "Trace recorded");

    // Verify trace was stored
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "Some trace on ready task");
  } finally {
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Critical coverage: start idempotent
// ============================================================================

Deno.test("start - idempotent on already started task", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    // Start again - should not throw
    await main(["start", id]);

    // Status still started
    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: started");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Critical coverage: migration idempotent
// ============================================================================

Deno.test("migration - idempotent (v2 index not re-migrated)", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalError = console.error;
  let migrationCount = 0;
  try {
    Deno.chdir(tempDir);
    console.error = (...args: unknown[]) => {
      const msg = args.join(" ");
      if (msg.includes("Migrating worklog to v2")) migrationCount++;
    };

    await main(["init"]);
    // First command triggers migration (init creates v1 index)
    await main(["create", "Task 1"]);
    assertEquals(migrationCount, 1);

    // Second command should NOT trigger migration
    await main(["create", "Task 2"]);
    assertEquals(migrationCount, 1);

    // List should also NOT trigger migration
    const output = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(output);
    assertEquals(tasks.length, 2);
    assertEquals(migrationCount, 1);
  } finally {
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Critical coverage: show on each status
// ============================================================================

Deno.test("show - created task has no ready/started in history", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const showOutput = await captureOutput(() => main(["show", id]));

    assertStringIncludes(showOutput, "status: created");
    assertStringIncludes(showOutput, "history:");
    assertStringIncludes(showOutput, "  created:");
    // ready and started should NOT appear in history
    assert(!showOutput.includes("  ready:"));
    assert(!showOutput.includes("  started:"));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("show - ready task shows created and ready in history", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--ready", "Ready task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const showOutput = await captureOutput(() => main(["show", id]));

    assertStringIncludes(showOutput, "status: ready");
    assertStringIncludes(showOutput, "  created:");
    assertStringIncludes(showOutput, "  ready:");
    assert(!showOutput.includes("  started:"));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("show - done task JSON has all timestamps", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Done task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;
    await main(["done", id]);

    const showOutput = await captureOutput(() => main(["show", id, "--json"]));
    const result = JSON.parse(showOutput);

    assertEquals(result.status, "done");
    assert(result.created);
    assert(result.started);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("show - cancelled task displays correctly", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Cancelled task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;
    await main(["cancel", id]);

    const showOutput = await captureOutput(() => main(["show", id]));

    assertStringIncludes(showOutput, "status: cancelled");
    assertStringIncludes(showOutput, "name: Cancelled task");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Minor coverage: special characters in name/desc
// ============================================================================

Deno.test("create - handles quotes in name", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", 'Fix "double quotes" issue']);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    // Name should be escaped in YAML
    assertStringIncludes(taskContent, "double quotes");

    // Index should store unescaped name
    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks[id].name, 'Fix "double quotes" issue');
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("update - handles YAML special chars in desc", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main([
      "update",
      id,
      "--desc",
      "Fix: handle #tags and key: value pairs",
    ]);

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(
      index.tasks[id].desc,
      "Fix: handle #tags and key: value pairs",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Minor coverage: create with no desc
// ============================================================================

Deno.test("create - no desc results in empty desc", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Just a name"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);
    assertEquals(index.tasks[id].name, "Just a name");
    assertEquals(index.tasks[id].desc, "");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Minor coverage: status_updated_at in index
// ============================================================================

Deno.test("ready - sets status_updated_at in index", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const indexBefore = JSON.parse(
      await Deno.readTextFile(".worklog/index.json"),
    );
    const createdAt = indexBefore.tasks[id].status_updated_at;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 50));

    await main(["ready", id]);

    const indexAfter = JSON.parse(
      await Deno.readTextFile(".worklog/index.json"),
    );
    assertEquals(indexAfter.tasks[id].status, "ready");
    // status_updated_at should have changed
    assert(indexAfter.tasks[id].status_updated_at >= createdAt);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("start - sets status_updated_at in index", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main(["start", id]);

    const index = JSON.parse(await Deno.readTextFile(".worklog/index.json"));
    assertEquals(index.tasks[id].status, "started");
    assert(index.tasks[id].status_updated_at);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Minor coverage: done_at in index
// ============================================================================

Deno.test("done - sets done_at in index", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    await main(["done", id]);

    const index = JSON.parse(await Deno.readTextFile(".worklog/index.json"));
    assertEquals(index.tasks[id].status, "done");
    assert(index.tasks[id].done_at);
    assert(index.tasks[id].done_at.match(/\d{4}-\d{2}-\d{2}/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Minor coverage: create initial status timestamps
// ============================================================================

Deno.test("create --ready - sets ready_at, not started_at", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--ready", "Ready task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: ready");
    assert(taskContent.match(/ready_at: "\d{4}-\d{2}-\d{2}/));
    assertStringIncludes(taskContent, "started_at: null");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("create --started - sets started_at, not ready_at", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "--started", "Started task"]);
    const _ls = await captureOutput(() => main(["list", "--all", "--json"]));
    const id = JSON.parse(_ls).tasks[0].id;

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${id}.md`);
    assertStringIncludes(taskContent, "status: started");
    assertStringIncludes(taskContent, "ready_at: null");
    assert(taskContent.match(/started_at: "\d{4}-\d{2}-\d{2}/));
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Minor coverage: list individual filters
// ============================================================================

Deno.test("list --created - shows only created tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    await main(["create", "--ready", "Ready task"]);
    await main(["create", "--started", "Started task"]);

    const listOutput = await captureOutput(() =>
      main(["list", "--created", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);

    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].status, "created");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("list --started - shows only started tasks", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Created task"]);
    await main(["create", "--ready", "Ready task"]);
    await main(["create", "--started", "Started task"]);

    const listOutput = await captureOutput(() =>
      main(["list", "--started", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);

    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].status, "started");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Tests for -C and --worklog-dir global options
// ============================================================================

Deno.test("-C basic - operates on remote directory", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    // Init worklog in tempDir
    Deno.chdir(tempDir);
    await main(["init"]);
    await main(["create", "Remote task"]);
    Deno.chdir(originalCwd);

    // From original cwd, use -C to list tasks in tempDir
    const listOutput = await captureOutput(() =>
      main(["-C", tempDir, "list", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);
    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].name, "Remote task");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("-C + create - creates task in remote directory", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    // Init worklog in tempDir first
    Deno.chdir(tempDir);
    await main(["init"]);
    Deno.chdir(originalCwd);

    // Create a task using -C from a different directory
    await main(["-C", tempDir, "create", "Remote created task"]);

    // Verify the task file exists in tempDir
    const listOutput = await captureOutput(() =>
      main(["-C", tempDir, "list", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);
    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].name, "Remote created task");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("--worklog-dir basic - operates on non-standard worklog path", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    // Create a worklog in a non-standard directory name
    Deno.chdir(tempDir);
    Deno.mkdirSync(".wl");
    Deno.mkdirSync(".wl/tasks");
    Deno.writeTextFileSync(
      ".wl/index.json",
      JSON.stringify({ version: 2, tasks: {} }),
    );
    Deno.chdir(originalCwd);

    // Use --worklog-dir to point to the non-standard path
    const listOutput = await captureOutput(() =>
      main(["--worklog-dir", `${tempDir}/.wl`, "list", "--all", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);
    assertEquals(tasks.length, 0);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("-C + --worklog-dir - combined usage", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    // Create a non-standard worklog dir inside tempDir
    Deno.mkdirSync(`${tempDir}/.wl`);
    Deno.mkdirSync(`${tempDir}/.wl/tasks`);
    Deno.writeTextFileSync(
      `${tempDir}/.wl/index.json`,
      JSON.stringify({ version: 2, tasks: {} }),
    );

    // Use -C to change to tempDir, then --worklog-dir for the relative .wl
    const listOutput = await captureOutput(() =>
      main(["-C", tempDir, "--worklog-dir", ".wl", "list", "--all", "--json"])
    );
    const { tasks } = JSON.parse(listOutput);
    assertEquals(tasks.length, 0);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("--worklog-dir + --scope conflict - throws error", async () => {
  const originalCwd = Deno.cwd();
  const originalExit = Deno.exit;
  try {
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (_code: number) => {};
    let caught: Error | undefined;
    try {
      await main(["--worklog-dir", "/tmp", "list", "--scope", "foo", "--json"]);
    } catch (e) {
      caught = e as Error;
    }
    assert(caught instanceof WtError);
    assertEquals(caught.code, "invalid_args");
    assertStringIncludes(
      caught.message,
      "Cannot use --scope with --worklog-dir",
    );
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = originalExit;
    Deno.chdir(originalCwd);
  }
});

Deno.test("--worklog-dir + init - creates non-standard worklog dir", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    // Use --worklog-dir to init a non-standard worklog
    await main(["--worklog-dir", `${tempDir}/.custom-wl`, "init"]);

    // Verify it was created
    const stat = await Deno.stat(`${tempDir}/.custom-wl`);
    assert(stat.isDirectory);
    const indexStat = await Deno.stat(`${tempDir}/.custom-wl/index.json`);
    assert(indexStat.isFile);

    // Verify we can list from it
    const listOutput = await captureOutput(() =>
      main([
        "--worklog-dir",
        `${tempDir}/.custom-wl`,
        "list",
        "--all",
        "--json",
      ])
    );
    const { tasks } = JSON.parse(listOutput);
    assertEquals(tasks.length, 0);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Tag System Tests
// ============================================================================

Deno.test("tags - create task with tags", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main([
      "create",
      "Test task",
      "--tag",
      "feat/auth",
      "--tag",
      "urgent",
    ]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].tags, ["feat/auth", "urgent"]);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("tags - add and remove tags", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Test task", "--tag", "feat/test"]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    // Add tags
    await main(["tags", taskId, "--add", "backend/api", "--add", "urgent"]);

    let updatedOutput = await captureOutput(() => main(["list", "--json"]));
    let updatedTasks = JSON.parse(updatedOutput).tasks;
    assertEquals(updatedTasks[0].tags, ["backend/api", "feat/test", "urgent"]);

    // Remove tag
    await main(["tags", taskId, "--remove", "urgent"]);

    updatedOutput = await captureOutput(() => main(["list", "--json"]));
    updatedTasks = JSON.parse(updatedOutput).tasks;
    assertEquals(updatedTasks[0].tags, ["backend/api", "feat/test"]);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("tags - list all tags with counts", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Task 1", "--tag", "feat/auth"]);
    await main(["create", "Task 2", "--tag", "feat/auth", "--tag", "urgent"]);
    await main(["create", "Task 3", "--tag", "bug/fix"]);

    const output = await captureOutput(() => main(["tags"]));
    assertStringIncludes(output, "feat/auth (2 tasks)");
    assertStringIncludes(output, "urgent (1 task)");
    assertStringIncludes(output, "bug/fix (1 task)");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("tags - display in show command", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main([
      "create",
      "Test task",
      "--tag",
      "feat/test",
      "--tag",
      "urgent",
    ]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    const output = await captureOutput(() => main(["show", taskId]));
    assertStringIncludes(output, "tags: #feat/test #urgent");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("tags - persist in task file frontmatter", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main([
      "create",
      "Test task",
      "--tag",
      "feat/test",
      "--tag",
      "urgent",
    ]);

    const listOutput = await captureOutput(() => main(["list", "--json"]));
    const { tasks } = JSON.parse(listOutput);
    const taskId = tasks[0].id;

    const taskContent = await Deno.readTextFile(`.worklog/tasks/${taskId}.md`);
    assertStringIncludes(taskContent, "tags:");
    assertStringIncludes(taskContent, "- feat/test");
    assertStringIncludes(taskContent, "- urgent");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("tags - persist in index for fast filtering", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);

    await main(["create", "Test task", "--tag", "feat/test"]);

    const indexContent = await Deno.readTextFile(".worklog/index.json");
    const index = JSON.parse(indexContent);

    const taskIds = Object.keys(index.tasks);
    assertEquals(taskIds.length, 1);
    assertEquals(index.tasks[taskIds[0]].tags, ["feat/test"]);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Cross-scope task resolution tests
// ============================================================================

/**
 * Helper: set up a git repo with parent + child scope, each with a task.
 * Returns { gitRoot, parentTaskId, childTaskId, childScopeId }.
 */
async function setupCrossScopeFixture(
  tempDir: string,
): Promise<{
  gitRoot: string;
  parentTaskId: string;
  childTaskId: string;
  childScopeId: string;
}> {
  // Initialize git repo
  await new Deno.Command("git", { args: ["init"], cwd: tempDir }).output();
  await new Deno.Command("git", {
    args: ["config", "user.email", "test@example.com"],
    cwd: tempDir,
  }).output();
  await new Deno.Command("git", {
    args: ["config", "user.name", "Test User"],
    cwd: tempDir,
  }).output();

  // Create parent worklog at root
  Deno.chdir(tempDir);
  await main(["init"]);
  await main(["create", "Parent task"]);

  // Get parent task ID
  const parentListOutput = await captureOutput(() =>
    main(["list", "--all", "--json"])
  );
  const parentTasks = JSON.parse(parentListOutput).tasks;
  const parentTaskId = parentTasks[0].id;

  // Create child directory and worklog
  const childDir = `${tempDir}/packages/api`;
  await Deno.mkdir(childDir, { recursive: true });
  Deno.chdir(childDir);
  await main(["init"]);
  await main(["create", "Child API task"]);

  // Get child task ID
  const childListOutput = await captureOutput(() =>
    main(["list", "--all", "--json"])
  );
  const childTasks = JSON.parse(childListOutput).tasks;
  const childTaskId = childTasks[0].id;

  // Link child to parent: wl scopes add-parent <parent-path> --id api
  await main(["scopes", "add-parent", tempDir, "--id", "api"]);

  return {
    gitRoot: tempDir,
    parentTaskId,
    childTaskId,
    childScopeId: "api",
  };
}

Deno.test("cross-scope - show child task from parent scope", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, childTaskId } = await setupCrossScopeFixture(tempDir);

    // Go to parent scope
    Deno.chdir(gitRoot);

    // Show child task using its prefix from the parent scope
    const shortPrefix = childTaskId.slice(0, 6);
    const showOutput = await captureOutput(() =>
      main(["show", shortPrefix, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assertEquals(showResult.fullId, childTaskId);
    assertEquals(showResult.name, "Child API task");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - explicit scope:prefix syntax resolves child task", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, childTaskId, childScopeId } = await setupCrossScopeFixture(
      tempDir,
    );

    // Go to parent scope
    Deno.chdir(gitRoot);

    // Show child task using explicit scope:prefix
    const shortPrefix = childTaskId.slice(0, 6);
    const showOutput = await captureOutput(() =>
      main(["show", `${childScopeId}:${shortPrefix}`, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assertEquals(showResult.fullId, childTaskId);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - start child task from parent scope", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, childTaskId } = await setupCrossScopeFixture(tempDir);

    Deno.chdir(gitRoot);

    // Start child task from parent scope
    const shortPrefix = childTaskId.slice(0, 6);
    const startOutput = await captureOutput(() =>
      main(["start", shortPrefix, "--json"])
    );
    const startResult = JSON.parse(startOutput);
    assertEquals(startResult.status, "task_started");

    // Verify it's actually started by checking in child scope
    Deno.chdir(`${gitRoot}/packages/api`);
    const showOutput = await captureOutput(() =>
      main(["show", shortPrefix, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assertEquals(showResult.status, "started");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - cancel child task from parent scope", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, childTaskId } = await setupCrossScopeFixture(tempDir);

    Deno.chdir(gitRoot);

    // Cancel child task from parent scope
    const shortPrefix = childTaskId.slice(0, 6);
    const output = await captureOutput(() =>
      main(["cancel", shortPrefix, "--json"])
    );
    const result = JSON.parse(output);
    assertEquals(result.status, "task_cancelled");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - parent task still resolves locally (no cross-scope needed)", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, parentTaskId } = await setupCrossScopeFixture(tempDir);

    Deno.chdir(gitRoot);

    // Show parent task - should resolve locally without cross-scope search
    const shortPrefix = parentTaskId.slice(0, 6);
    const showOutput = await captureOutput(() =>
      main(["show", shortPrefix, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assertEquals(showResult.fullId, parentTaskId);
    assertEquals(showResult.name, "Parent task");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - nonexistent task fails with clear error", async () => {
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
    const { gitRoot } = await setupCrossScopeFixture(tempDir);

    Deno.chdir(gitRoot);

    try {
      await main(["show", "zzzzzzz", "--json"]);
    } catch (_e) {
      // Expected exit
    }

    assertEquals(exitCode, 1);
    assertStringIncludes(errorOutput, "task_not_found");
    assertStringIncludes(errorOutput, "searched all scopes");
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - show parent task from child scope using ^:prefix", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, parentTaskId } = await setupCrossScopeFixture(tempDir);

    // Go to child scope
    Deno.chdir(`${gitRoot}/packages/api`);

    // Show parent task using ^:prefix syntax
    const shortPrefix = parentTaskId.slice(0, 6);
    const showOutput = await captureOutput(() =>
      main(["show", `^:${shortPrefix}`, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assertEquals(showResult.fullId, parentTaskId);
    assertEquals(showResult.name, "Parent task");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - trace child task from parent scope", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    const { gitRoot, childTaskId } = await setupCrossScopeFixture(tempDir);

    Deno.chdir(gitRoot);

    // Trace child task from parent scope
    const shortPrefix = childTaskId.slice(0, 6);
    const output = await captureOutput(() =>
      main(["trace", shortPrefix, "Cross-scope trace entry", "--json"])
    );
    const result = JSON.parse(output);
    assertEquals(result.status, "ok");

    // Verify trace was written in the child scope's task file
    Deno.chdir(`${gitRoot}/packages/api`);
    const showOutput = await captureOutput(() =>
      main(["show", shortPrefix, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assert(showResult.entries_since_checkpoint.length > 0);
    assertEquals(
      showResult.entries_since_checkpoint[0].msg,
      "Cross-scope trace entry",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("cross-scope - resolves task in worktree scope outside git root", async () => {
  // Simulates worktree-based scopes where children are sibling directories
  // of the git root (like git worktrees), not subdirectories.
  const rootDir = await Deno.makeTempDir();
  const siblingDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    // Initialize git repo in rootDir
    await new Deno.Command("git", { args: ["init"], cwd: rootDir }).output();
    await new Deno.Command("git", {
      args: ["config", "user.email", "test@example.com"],
      cwd: rootDir,
    }).output();
    await new Deno.Command("git", {
      args: ["config", "user.name", "Test User"],
      cwd: rootDir,
    }).output();

    // Create parent worklog at root
    Deno.chdir(rootDir);
    await main(["init"]);
    await main(["create", "Parent task"]);

    // Create sibling worklog (simulating a worktree)
    Deno.chdir(siblingDir);
    await main(["init"]);
    await main(["create", "Sibling worktree task"]);

    // Get sibling task ID
    const siblingList = await captureOutput(() =>
      main(["list", "--all", "--json"])
    );
    const siblingTasks = JSON.parse(siblingList).tasks;
    const siblingTaskId = siblingTasks[0].id;

    // Manually configure scope.json in root to reference the sibling
    const scopeJson = {
      children: [
        {
          path: siblingDir,
          id: "sibling-wt",
          type: "worktree",
        },
      ],
    };
    await Deno.writeTextFile(
      `${rootDir}/.worklog/scope.json`,
      JSON.stringify(scopeJson, null, 2),
    );

    // Now try to show the sibling task from root scope
    Deno.chdir(rootDir);
    const shortPrefix = siblingTaskId.slice(0, 6);
    const showOutput = await captureOutput(() =>
      main(["show", shortPrefix, "--json"])
    );
    const showResult = JSON.parse(showOutput);
    assertEquals(showResult.fullId, siblingTaskId);
    assertEquals(showResult.name, "Sibling worktree task");

    // Return to root (implicit resolution may have chdir'd)
    Deno.chdir(rootDir);

    // Also test explicit scope:prefix syntax
    const showOutput2 = await captureOutput(() =>
      main(["show", `sibling-wt:${shortPrefix}`, "--json"])
    );
    const showResult2 = JSON.parse(showOutput2);
    assertEquals(showResult2.fullId, siblingTaskId);
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(rootDir, { recursive: true });
    await Deno.remove(siblingDir, { recursive: true });
  }
});
