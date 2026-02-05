import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const CLI_PATH = new URL("../worklog/cli.ts", import.meta.url).pathname;

async function runCli(
  args: string[],
  cwd?: string,
): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      CLI_PATH,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
    cwd,
  });

  const { stdout, stderr, code } = await cmd.output();
  return {
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    code,
  };
}

function createTestWorkspace(): string {
  const tmpDir = Deno.makeTempDirSync();
  return tmpDir;
}

Deno.test("wl: init command creates .worklog directory", async () => {
  const workspace = createTestWorkspace();
  try {
    const result = await runCli(["init"], workspace);
    assertEquals(result.code, 0);

    const worklogDir = join(workspace, ".worklog");
    const stat = await Deno.stat(worklogDir);
    assertEquals(stat.isDirectory, true);

    const tasksDir = join(worklogDir, "tasks");
    const tasksStat = await Deno.stat(tasksDir);
    assertEquals(tasksStat.isDirectory, true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: init --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    const result = await runCli(["init", "--json"], workspace);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json.status, "string");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: task create command creates task", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli(["task", "create", "Test task"], workspace);
    assertEquals(result.code, 0);
    assertEquals(/^[a-z0-9]{5,}$/i.test(result.stdout.trim()), true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: task create --json outputs task ID", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json.id, "string");
    assertEquals(/^[a-z0-9]{5,}$/i.test(json.id), true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: trace command logs entry", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(["trace", id, "Test message"], workspace);
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: trace --json outputs status", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(
      ["trace", id, "Test message", "--json"],
      workspace,
    );
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json.status, "string");
    assertEquals(["ok", "checkpoint_recommended"].includes(json.status), true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: trace --timestamp accepts custom timestamp", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(
      ["trace", id, "Test", "-t", "T10:30"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: trace --force works on completed tasks", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["done", id, "Done", "Learned"], workspace);

    const result = await runCli(
      ["trace", id, "After done", "-f"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: show command shows task context", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry 1"], workspace);

    const result = await runCli(["show", id], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Test task");
    assertStringIncludes(result.stdout, "Entry 1");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: show --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(["show", id, "--json"], workspace);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(json.task.startsWith(id), true);
    assertEquals(json.desc, "Test task");
    assertEquals(json.status, "active");
    assertEquals(Array.isArray(json.entries_since_checkpoint), true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: checkpoint command creates checkpoint", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["checkpoint", id, "Changes made", "Things learned"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: checkpoint --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["checkpoint", id, "Changes", "Learnings", "--json"],
      workspace,
    );
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json, "object");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: checkpoint --force works on completed tasks", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);
    await runCli(["done", id, "Done", "Learned"], workspace);
    await runCli(["trace", id, "After done", "-f"], workspace);

    const result = await runCli(
      ["checkpoint", id, "More changes", "More learnings", "-f"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: checkpoint --timestamp accepts custom timestamp", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["checkpoint", id, "Changes", "Learnings", "-t", "T10:30"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: done command completes task", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["done", id, "Final changes", "Final learnings"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: done --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["done", id, "Changes", "Learnings", "--json"],
      workspace,
    );
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json, "object");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: done --timestamp accepts custom timestamp", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["done", id, "Changes", "Learnings", "-t", "T11:30"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: list command shows active tasks", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    await runCli(["task", "create", "Task 1"], workspace);
    await runCli(["task", "create", "Task 2"], workspace);

    const result = await runCli(["list"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Task 1");
    assertStringIncludes(result.stdout, "Task 2");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: list --all includes completed tasks", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);
    await runCli(["done", id, "Done", "Learned"], workspace);

    const result = await runCli(["list", "--all"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Task");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: list --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    await runCli(["task", "create", "Task"], workspace);

    const result = await runCli(["list", "--json"], workspace);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json.tasks), true);
    if (json.tasks.length > 0) {
      assertEquals(typeof json.tasks[0].id, "string");
      assertEquals(typeof json.tasks[0].desc, "string");
      assertEquals(typeof json.tasks[0].status, "string");
      assertEquals(typeof json.tasks[0].created, "string");
    }
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: summary command aggregates tasks", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);
    await runCli(["checkpoint", id, "Changes", "Learnings"], workspace);

    const result = await runCli(["summary"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Task");
    assertStringIncludes(result.stdout, "Changes");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: summary --since filters by date", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);

    const result = await runCli(
      ["summary", "--since", "2026-01-01"],
      workspace,
    );
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: summary --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);
    await runCli(["checkpoint", id, "Changes", "Learnings"], workspace);

    const result = await runCli(["summary", "--json"], workspace);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json.tasks), true);
    if (json.tasks.length > 0) {
      assertEquals(typeof json.tasks[0].id, "string");
      assertEquals(typeof json.tasks[0].desc, "string");
      assertEquals(typeof json.tasks[0].status, "string");
      assertEquals(Array.isArray(json.tasks[0].checkpoints), true);
      assertEquals(Array.isArray(json.tasks[0].entries), true);
    }
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: import -p PATH imports from path", async () => {
  const workspace1 = createTestWorkspace();
  const workspace2 = createTestWorkspace();
  try {
    await runCli(["init"], workspace1);
    await runCli(["task", "create", "Task"], workspace1);

    await runCli(["init"], workspace2);

    const worklog1 = join(workspace1, ".worklog");
    const result = await runCli(["import", "-p", worklog1], workspace2);
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace1, { recursive: true });
    Deno.removeSync(workspace2, { recursive: true });
  }
});

Deno.test("wl: import --json outputs valid JSON", async () => {
  const workspace1 = createTestWorkspace();
  const workspace2 = createTestWorkspace();
  try {
    await runCli(["init"], workspace1);
    await runCli(["task", "create", "Task"], workspace1);

    await runCli(["init"], workspace2);

    const worklog1 = join(workspace1, ".worklog");
    const result = await runCli(
      ["import", "-p", worklog1, "--json"],
      workspace2,
    );
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json.imported, "number");
    assertEquals(typeof json.merged, "number");
    assertEquals(typeof json.skipped, "number");
    assertEquals(Array.isArray(json.tasks), true);
  } finally {
    Deno.removeSync(workspace1, { recursive: true });
    Deno.removeSync(workspace2, { recursive: true });
  }
});

Deno.test("wl: import --rm removes imported tasks", async () => {
  const workspace1 = createTestWorkspace();
  const workspace2 = createTestWorkspace();
  try {
    await runCli(["init"], workspace1);
    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace1,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["init"], workspace2);

    const worklog1 = join(workspace1, ".worklog");
    const result = await runCli(
      ["import", "-p", worklog1, "--rm"],
      workspace2,
    );
    assertEquals(result.code, 0);

    const taskFile = join(workspace1, ".worklog", "tasks", `${id}.md`);
    const exists = await Deno.stat(taskFile).then(() => true).catch(() =>
      false
    );
    assertEquals(exists, false);
  } finally {
    Deno.removeSync(workspace1, { recursive: true });
    Deno.removeSync(workspace2, { recursive: true });
  }
});

Deno.test("wl: import -b BRANCH accepts branch option", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli(["import", "-b", "nonexistent"], workspace);
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "error");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: error on task_not_found", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli(["trace", "invalid-id", "Message"], workspace);
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "error");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: error on task_already_done without force", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Entry"], workspace);
    await runCli(["done", id, "Done", "Learned"], workspace);

    const result = await runCli(["trace", id, "After done"], workspace);
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "error");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

// ============================================================================
// Metadata management tests
// ============================================================================

Deno.test("wl: meta displays task metadata", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task with metadata", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    // Set some metadata
    await runCli(["meta", id, "commit", "abc123"], workspace);
    await runCli(["meta", id, "pr", "456"], workspace);

    // View metadata
    const result = await runCli(["meta", id], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "commit");
    assertStringIncludes(result.stdout, "abc123");
    assertStringIncludes(result.stdout, "pr");
    assertStringIncludes(result.stdout, "456");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: meta sets task metadata", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(["meta", id, "author", "alice"], workspace);
    assertEquals(result.code, 0);

    // Verify metadata was set
    const metaResult = await runCli(["meta", id, "--json"], workspace);
    const json = JSON.parse(metaResult.stdout);
    assertEquals(json.metadata.author, "alice");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: meta --delete removes metadata key", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    // Set and then delete metadata
    await runCli(["meta", id, "temp", "value"], workspace);
    const result = await runCli(["meta", id, "--delete", "temp"], workspace);
    assertEquals(result.code, 0);

    // Verify metadata was deleted
    const metaResult = await runCli(["meta", id, "--json"], workspace);
    const json = JSON.parse(metaResult.stdout);
    assertEquals(json.metadata.temp, undefined);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: meta --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["meta", id, "branch", "feature-x"], workspace);

    const result = await runCli(["meta", id, "--json"], workspace);
    assertEquals(result.code, 0);

    const json = JSON.parse(result.stdout);
    assertEquals(json.metadata.branch, "feature-x");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

// ============================================================================
// UUID prefix resolution tests
// ============================================================================

Deno.test("wl: resolves unambiguous task ID prefix", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    // Use a prefix (first 5 chars should work)
    const prefix = id.substring(0, 5);
    const result = await runCli(["trace", prefix, "Testing prefix"], workspace);
    assertEquals(result.code, 0);

    // Verify entry was added
    const logsResult = await runCli(["show", prefix], workspace);
    assertStringIncludes(logsResult.stdout, "Testing prefix");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: errors on ambiguous task ID prefix", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    // Create two tasks - they'll have different UUIDs but we need to test
    // ambiguous prefix behavior. Since we can't control UUID generation,
    // this test verifies the error handling exists even if rarely triggered.
    const result1 = await runCli(
      ["task", "create", "Task 1", "--json"],
      workspace,
    );
    const { id: id1 } = JSON.parse(result1.stdout);

    const result2 = await runCli(
      ["task", "create", "Task 2", "--json"],
      workspace,
    );
    const { id: id2 } = JSON.parse(result2.stdout);

    // Find a common prefix (if any)
    let commonPrefix = "";
    for (let i = 0; i < Math.min(id1.length, id2.length); i++) {
      if (id1[i].toLowerCase() === id2[i].toLowerCase()) {
        commonPrefix += id1[i];
      } else {
        break;
      }
    }

    // If there's a common prefix, test it produces an error
    if (commonPrefix.length > 0) {
      const result = await runCli(
        ["trace", commonPrefix, "Should fail"],
        workspace,
      );
      assertEquals(result.code !== 0, true);
      assertStringIncludes(result.stderr.toLowerCase(), "ambiguous");
    }
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

// ============================================================================
// TODO management tests
// ============================================================================

Deno.test("wl: task create --todo creates task with TODOs", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli([
      "task",
      "create",
      "Feature X",
      "--todo",
      "Analyze code",
      "--todo",
      "Write tests",
      "--json",
    ], workspace);
    assertEquals(result.code, 0);

    const { id } = JSON.parse(result.stdout);

    // Verify TODOs were created
    const listResult = await runCli(["todo", "list", id], workspace);
    assertEquals(listResult.code, 0);
    assertStringIncludes(listResult.stdout, "Analyze code");
    assertStringIncludes(listResult.stdout, "Write tests");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: todo list shows all TODOs", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    await runCli([
      "task",
      "create",
      "Task 1",
      "--todo",
      "First todo",
    ], workspace);

    await runCli([
      "task",
      "create",
      "Task 2",
      "--todo",
      "Second todo",
    ], workspace);

    const result = await runCli(["todo", "list"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Task 1");
    assertStringIncludes(result.stdout, "First todo");
    assertStringIncludes(result.stdout, "Task 2");
    assertStringIncludes(result.stdout, "Second todo");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: todo list <task-id> shows task TODOs", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "My task",
      "--todo",
      "Todo 1",
      "--todo",
      "Todo 2",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(["todo", "list", id], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Todo 1");
    assertStringIncludes(result.stdout, "Todo 2");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: todo add adds a TODO to task", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli([
      "todo",
      "add",
      id,
      "New todo item",
    ], workspace);
    assertEquals(result.code, 0);

    // Verify TODO was added
    const listResult = await runCli(["todo", "list", id], workspace);
    assertStringIncludes(listResult.stdout, "New todo item");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: todo set updates TODO status", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--todo",
      "Test todo",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    // Get todo ID
    const listResult = await runCli(["todo", "list", id, "--json"], workspace);
    const listJson = JSON.parse(listResult.stdout);
    const todoId = listJson.todos[0].id;

    // Update status
    const result = await runCli([
      "todo",
      "set",
      "status=done",
      todoId,
    ], workspace);
    assertEquals(result.code, 0);

    // Verify status changed
    const verifyResult = await runCli(["todo", "list", id], workspace);
    assertStringIncludes(verifyResult.stdout, "[x]");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: todo next shows next available TODO", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--todo",
      "First",
      "--todo",
      "Second",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(["todo", "next", id], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "First");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: done fails if pending TODOs exist", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--todo",
      "Pending todo",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Work done"], workspace);

    const result = await runCli([
      "done",
      id,
      "Changes",
      "Learnings",
    ], workspace);
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "pending");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: done --force completes task with pending TODOs", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--todo",
      "Pending todo",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    await runCli(["trace", id, "Work done"], workspace);

    const result = await runCli([
      "done",
      id,
      "Changes",
      "Learnings",
      "--force",
    ], workspace);
    assertEquals(result.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: todo list --json outputs valid JSON", async () => {
  const workspace = createTestWorkspace();
  try {
    await runCli(["init"], workspace);

    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--todo",
      "Todo 1",
      "--json",
    ], workspace);
    const { id } = JSON.parse(addResult.stdout);

    const result = await runCli(["todo", "list", id, "--json"], workspace);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json.todos), true);
    assertEquals(json.todos.length > 0, true);
    assertEquals(typeof json.todos[0].id, "string");
    assertEquals(typeof json.todos[0].text, "string");
    assertEquals(typeof json.todos[0].status, "string");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});
// ============================================================================
// Scopes subcommands tests
// ============================================================================

function createGitWorkspace(): string {
  const tmpDir = Deno.makeTempDirSync();
  // Initialize git repo
  const gitInit = new Deno.Command("git", {
    args: ["init"],
    cwd: tmpDir,
    stdout: "null",
    stderr: "null",
  });
  gitInit.outputSync();
  return tmpDir;
}

Deno.test("wl: scopes list shows all scopes", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    const result = await runCli(["scopes", "list"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "(root)");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes list --json outputs valid JSON", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    const result = await runCli(["scopes", "list", "--json"], workspace);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json.scopes), true);
    assertEquals(json.scopes.length > 0, true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes add creates new scope", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    const result = await runCli(
      ["scopes", "add", "lib", "packages/tools"],
      workspace,
    );
    assertEquals(result.code, 0);

    const scopeDir = join(workspace, "packages/tools/.worklog");
    const stat = await Deno.stat(scopeDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes add with same path as ID", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    const result = await runCli(["scopes", "add", "homebrew"], workspace);
    assertEquals(result.code, 0);

    const scopeDir = join(workspace, "homebrew/.worklog");
    const stat = await Deno.stat(scopeDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes list <scope-id> shows details", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib", "packages/tools"], workspace);

    const result = await runCli(["scopes", "list", "lib"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "lib");
    assertStringIncludes(result.stdout, "packages/tools");
    assertStringIncludes(result.stdout, "Tasks:");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes rename changes scope ID", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib", "packages/tools"], workspace);

    const renameResult = await runCli(
      ["scopes", "rename", "lib", "tooling"],
      workspace,
    );
    assertEquals(renameResult.code, 0);

    const listResult = await runCli(["scopes", "list"], workspace);
    assertStringIncludes(listResult.stdout, "tooling");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes assign moves task between scopes", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib", "packages/tools"], workspace);

    // Create task in root
    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    // Assign to lib
    const assignResult = await runCli(
      ["scopes", "assign", "lib", id],
      workspace,
    );
    assertEquals(assignResult.code, 0);
    assertStringIncludes(assignResult.stdout, "Assigned: 1");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes assign --json outputs valid JSON", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib", "packages/tools"], workspace);

    const addResult = await runCli(
      ["task", "create", "Test task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    const assignResult = await runCli(
      ["scopes", "assign", "lib", id, "--json"],
      workspace,
    );
    assertEquals(assignResult.code, 0);
    const json = JSON.parse(assignResult.stdout);
    assertEquals(typeof json.assigned, "number");
    assertEquals(typeof json.merged, "number");
    assertEquals(Array.isArray(json.errors), true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes delete with --delete-tasks removes scope", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "temp"], workspace);

    const deleteResult = await runCli([
      "scopes",
      "delete",
      "temp",
      "--delete-tasks",
    ], workspace);
    assertEquals(deleteResult.code, 0);

    const listResult = await runCli(["scopes", "list"], workspace);
    assertEquals(listResult.stdout.includes("temp"), false);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes delete fails without flags if scope has tasks", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib"], workspace);

    // Create task in lib scope
    await runCli(["task", "create", "Task", "--scope", "lib"], workspace);

    const deleteResult = await runCli(["scopes", "delete", "lib"], workspace);
    assertEquals(deleteResult.code !== 0, true);
    assertStringIncludes(deleteResult.stderr, "scope_has_tasks");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

// ============================================================================
// Scope aliases tests
// ============================================================================

Deno.test("wl: alias '/' refers to root scope", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib", "packages/tools"], workspace);

    // Create task in root
    const addResult = await runCli(
      ["task", "create", "Root task", "--json"],
      workspace,
    );
    const { id } = JSON.parse(addResult.stdout);

    // Assign to root using '/' alias
    const assignResult = await runCli(["scopes", "assign", "/", id], workspace);
    assertEquals(assignResult.code, 0);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: alias '.' refers to current scope", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);
    await runCli(["scopes", "add", "lib", "packages/tools"], workspace);

    // Create task using '.' from root
    const addResult = await runCli([
      "task",
      "create",
      "Task",
      "--scope",
      ".",
      "--json",
    ], workspace);
    assertEquals(addResult.code, 0);
    const { id } = JSON.parse(addResult.stdout);

    // Verify task is in root
    const listResult = await runCli(["list", "--json"], workspace);
    const { tasks } = JSON.parse(listResult.stdout);
    assertEquals(tasks.some((t: { id: string }) => t.id.startsWith(id)), true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

Deno.test("wl: scopes list '/' shows root details", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli(["scopes", "list", "/"], workspace);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Scope: /");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});

// Helper to create a git workspace with a worktree
function createGitWorkspaceWithWorktree(): {
  main: string;
  worktree: string;
  branch: string;
} {
  const tmpDir = Deno.makeTempDirSync();
  const mainDir = join(tmpDir, "main");
  const worktreeDir = join(tmpDir, "feature-branch");
  const branch = "feature/test";

  Deno.mkdirSync(mainDir);

  // Initialize git repo with initial commit
  new Deno.Command("git", {
    args: ["init"],
    cwd: mainDir,
    stdout: "null",
    stderr: "null",
  }).outputSync();

  new Deno.Command("git", {
    args: ["config", "user.email", "test@test.com"],
    cwd: mainDir,
    stdout: "null",
    stderr: "null",
  }).outputSync();

  new Deno.Command("git", {
    args: ["config", "user.name", "Test"],
    cwd: mainDir,
    stdout: "null",
    stderr: "null",
  }).outputSync();

  // Create initial commit (required for worktrees)
  Deno.writeTextFileSync(join(mainDir, "README.md"), "# Test");
  new Deno.Command("git", {
    args: ["add", "."],
    cwd: mainDir,
    stdout: "null",
    stderr: "null",
  }).outputSync();

  new Deno.Command("git", {
    args: ["commit", "-m", "Initial commit"],
    cwd: mainDir,
    stdout: "null",
    stderr: "null",
  }).outputSync();

  // Create worktree
  new Deno.Command("git", {
    args: ["worktree", "add", "-b", branch, worktreeDir],
    cwd: mainDir,
    stdout: "null",
    stderr: "null",
  }).outputSync();

  return { main: mainDir, worktree: worktreeDir, branch };
}

function cleanupWorktreeWorkspace(mainDir: string): void {
  // Get parent directory (tmpDir)
  const tmpDir = join(mainDir, "..");
  Deno.removeSync(tmpDir, { recursive: true });
}

Deno.test("wl: scopes add --worktree creates worktree scope", async () => {
  const { main, worktree, branch } = createGitWorkspaceWithWorktree();
  try {
    await runCli(["init"], main);

    // Add worktree scope from main
    const result = await runCli(
      ["scopes", "add", branch, "--worktree"],
      main,
    );
    assertEquals(result.code, 0);

    // Verify worklog was created in worktree
    const worklogDir = join(worktree, ".worklog");
    const stat = await Deno.stat(worklogDir);
    assertEquals(stat.isDirectory, true);

    // Verify scope.json has worktree type
    const scopeJson = JSON.parse(
      Deno.readTextFileSync(join(main, ".worklog", "scope.json")),
    );
    const child = scopeJson.children.find(
      (c: { gitRef?: string }) => c.gitRef === branch,
    );
    assertEquals(child?.type, "worktree");
    assertEquals(child?.id, branch);
  } finally {
    cleanupWorktreeWorkspace(main);
  }
});

Deno.test("wl: scopes add --worktree --ref with different id", async () => {
  const { main, worktree, branch } = createGitWorkspaceWithWorktree();
  try {
    await runCli(["init"], main);

    // Add worktree scope with custom id
    const result = await runCli(
      ["scopes", "add", "my-feature", "--worktree", "--ref", branch],
      main,
    );
    assertEquals(result.code, 0);

    // Verify scope.json has correct id and ref
    const scopeJson = JSON.parse(
      Deno.readTextFileSync(join(main, ".worklog", "scope.json")),
    );
    const child = scopeJson.children.find(
      (c: { gitRef?: string }) => c.gitRef === branch,
    );
    assertEquals(child?.type, "worktree");
    assertEquals(child?.id, "my-feature");
    assertEquals(child?.gitRef, branch);

    // Verify worklog was created
    const worklogDir = join(worktree, ".worklog");
    const stat = await Deno.stat(worklogDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    cleanupWorktreeWorkspace(main);
  }
});

Deno.test("wl: scopes sync-worktrees adds missing worktrees", async () => {
  const { main, worktree, branch } = createGitWorkspaceWithWorktree();
  try {
    await runCli(["init"], main);

    // Sync worktrees
    const result = await runCli(["scopes", "sync-worktrees"], main);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Added:");
    assertStringIncludes(result.stdout, branch);

    // Verify worklog was created in worktree
    const worklogDir = join(worktree, ".worklog");
    const stat = await Deno.stat(worklogDir);
    assertEquals(stat.isDirectory, true);

    // Verify scope.json has worktree entry
    const scopeJson = JSON.parse(
      Deno.readTextFileSync(join(main, ".worklog", "scope.json")),
    );
    const child = scopeJson.children.find(
      (c: { gitRef?: string }) => c.gitRef === branch,
    );
    assertEquals(child?.type, "worktree");
  } finally {
    cleanupWorktreeWorkspace(main);
  }
});

Deno.test("wl: scopes sync-worktrees --dry-run doesn't modify", async () => {
  const { main, worktree, branch } = createGitWorkspaceWithWorktree();
  try {
    await runCli(["init"], main);

    // Sync with dry-run
    const result = await runCli(
      ["scopes", "sync-worktrees", "--dry-run"],
      main,
    );
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Added:");
    assertStringIncludes(result.stdout, branch);
    assertStringIncludes(result.stdout, "dry-run");

    // Verify worklog was NOT created in worktree
    try {
      await Deno.stat(join(worktree, ".worklog"));
      throw new Error("Worklog should not exist in dry-run mode");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw e;
      }
      // Expected: NotFound
    }

    // Verify scope.json doesn't exist (not created in dry-run)
    try {
      await Deno.stat(join(main, ".worklog", "scope.json"));
      throw new Error("scope.json should not exist in dry-run mode");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw e;
      }
      // Expected: NotFound
    }
  } finally {
    cleanupWorktreeWorkspace(main);
  }
});

Deno.test("wl: scopes sync-worktrees removes stale worktree entries", async () => {
  const { main, worktree, branch } = createGitWorkspaceWithWorktree();
  try {
    await runCli(["init"], main);

    // First sync to add the worktree
    await runCli(["scopes", "sync-worktrees"], main);

    // Remove the worktree (--force needed because .worklog has untracked files)
    new Deno.Command("git", {
      args: ["worktree", "remove", "--force", worktree],
      cwd: main,
      stdout: "null",
      stderr: "null",
    }).outputSync();

    // Sync again - should remove stale entry
    const result = await runCli(["scopes", "sync-worktrees"], main);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Removed:");
    assertStringIncludes(result.stdout, branch);

    // Verify scope.json no longer has the worktree entry
    const scopeJson = JSON.parse(
      Deno.readTextFileSync(join(main, ".worklog", "scope.json")),
    );
    const child = scopeJson.children.find(
      (c: { gitRef?: string }) => c.gitRef === branch,
    );
    assertEquals(child, undefined);
  } finally {
    cleanupWorktreeWorkspace(main);
  }
});

Deno.test("wl: scopes add rejects --path and --worktree together", async () => {
  const workspace = createGitWorkspace();
  try {
    await runCli(["init"], workspace);

    const result = await runCli(
      ["scopes", "add", "test", "--path", "foo", "--worktree"],
      workspace,
    );
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "Cannot use");
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});
