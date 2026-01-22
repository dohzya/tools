import { assertEquals } from "@std/assert";
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
import { assertStringIncludes } from "@std/assert";

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
