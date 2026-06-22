import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import process from "node:process";
import { main } from "./cli.ts";

async function captureOutput(fn: () => Promise<unknown>): Promise<string> {
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  let output = "";
  console.log = (msg: string) => {
    output += `${msg}\n`;
  };
  process.stdout.write = (chunk: string | Uint8Array) => {
    output += typeof chunk === "string"
      ? chunk
      : new TextDecoder().decode(chunk);
    return true;
  };
  try {
    await fn();
    return output;
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(String.raw`\x1b\[[0-9;]*m`, "g"), "");
}

Deno.test("dz-review agent-instructions - prints AGENTS.md snippet", async () => {
  const output = await captureOutput(() => main(["agent-instructions"]));

  assertEquals(output.startsWith("##"), false);
  assertStringIncludes(output, "DZ Review (`dz-review`):");
  assertStringIncludes(output, "dz-review status");
  assertStringIncludes(output, "dz-review ts -i -I");
  assertStringIncludes(output, "existing format reported");
  assertStringIncludes(output, "original/dominant timestamp format");
  assertStringIncludes(output, "hangul `-H`");
  assertStringIncludes(output, "dz-review --help");
  assertEquals(output.includes("Before converting timestamps"), false);
  assertEquals(output.includes("restore compact timestamps"), false);
  assertEquals(output.includes("dz-review status --oneline"), false);
  assertEquals(output.includes("dz-review review"), false);
  assertEquals(output.includes("dz-review stats"), false);
});

Deno.test("dz-review completions - prints shell completions", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["completions", "bash"]))
    );

    assertStringIncludes(output, "dz-review");
    assertStringIncludes(output, "-C");
    assertEquals(output.includes(" stats "), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review --help - prints structured command help", async () => {
  const output = stripAnsi(await captureOutput(() => main(["--help"])));

  assertStringIncludes(output, "Usage:");
  assertStringIncludes(output, "dz-review");
  assertStringIncludes(output, "Options:");
  assertStringIncludes(output, "Commands:");
  assertStringIncludes(output, "review, r");
  assertStringIncludes(output, "status, st");
  assertStringIncludes(output, "timestamp, ts, timestamps");
  assertStringIncludes(output, "-C, --cwd");
  assertStringIncludes(output, "<dir>");
  assertStringIncludes(output, "completions");
  assertEquals(output.includes("Conversation messages may carry"), false);
  assertEquals(output.includes("Review annotations may carry"), false);
});

Deno.test("dz-review status --help - prints subcommand options", async () => {
  const output = stripAnsi(
    await captureOutput(() => main(["status", "--help"])),
  );

  assertStringIncludes(output, "Usage:");
  assertStringIncludes(output, "dz-review status");
  assertStringIncludes(output, "Options:");
  assertStringIncludes(output, "--oneline");
  assertStringIncludes(output, "--short");
  assertStringIncludes(output, "--recap");
  assertStringIncludes(output, "--template");
});

Deno.test("dz-review errors - format stderr with code and color", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await runDzReview(
      dir,
      ["unknown-command"],
      "",
      { FORCE_COLOR: "1" },
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.stderr, "\x1b[");
    assertStringIncludes(result.stderr, "error: invalid_args");
    assertStringIncludes(result.stderr, 'Unknown command "unknown-command"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review stats - rejects removed command", async () => {
  await assertRejects(
    () => main(["stats"]),
    Error,
    "dz-review stats was removed; use dz-review status --oneline.",
  );
});

Deno.test("dz-review status --oneline - summarizes review annotations", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++one++}",
      "{++two++}",
      "{==highlight==}",
      "{>>comment<<}",
      "<!-- @agent open -->",
      "<!-- @agent handled @me answer -->",
      "<!-- @agent resolved @me ok -->",
      "<!-- @agent wip @me -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      main(["status", "--oneline", file])
    );

    assertEquals(
      output.trim(),
      "4 conversations (1 open, 1 wip, 1 handled, 1 resolved), 2 additions, 1 highlight, 1 comment",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status - lists one line per file by default", async () => {
  const dir = await Deno.makeTempDir();
  const first = join(dir, "first.md");
  const second = join(dir, "second.md");
  await Deno.writeTextFile(first, "<!-- @agent open -->\n");
  await Deno.writeTextFile(
    second,
    "{++one++}\n<!-- @agent handled @me ok -->\n",
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "first.md", "second.md"]))
    );

    assertEquals(
      output.trim().split("\n"),
      [
        "first.md: 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
        "second.md: 1 conversation (0 open, 0 wip, 0 handled, 1 resolved), 1 addition",
      ],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --short - renders compact per-file statuses", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--short", "file.md"]))
    );

    assertEquals(output.trim(), "file.md: 1/1 +1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --recap - renders tab-separated recap statuses", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--recap", "file.md"]))
    );

    assertEquals(output.trim(), "file.md\t1/1 +1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review list - lists review items", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() => main(["list", file]));

    assertStringIncludes(output, `${file}:1`);
    assertEquals(/addition [0-9A-Za-z]{6} .*file\.md:1-1/.test(output), true);
    assertEquals(output.includes("rvw_"), false);
    assertStringIncludes(output, "addition");
    assertStringIncludes(output, "open conversation");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review list --conversation - keeps legacy singular alias", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() =>
      main(["list", "--conversation", file])
    );

    assertStringIncludes(output, "open conversation");
    assertEquals(output.includes("addition"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review review - applies an annotation from stdin", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "Before {++after++}\n");

  try {
    const result = await runDzReview(
      dir,
      ["review", "--no-color", "file.md"],
      "a\n",
    );
    const updated = await Deno.readTextFile(file);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "addition");
    assertEquals(updated, "Before after\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review review --list --diff - keeps legacy diff listing flags", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(file, "Intro\n");
    await runGit(dir, ["add", "file.md"]);
    await runGit(dir, ["commit", "-m", "initial"]);
    await Deno.writeTextFile(file, "Intro\n{++new++}\n");

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["review", "--list", "--diff"]))
    );

    assertStringIncludes(output, "file.md:2");
    assertEquals(/addition [0-9A-Za-z]{6} file\.md:2-2/.test(output), true);
    assertEquals(output.includes("rvw_"), false);
    assertStringIncludes(output, "addition");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review review --context-before/after - keeps legacy context flags", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "Before\n{++after++}\nAfter\n");

  try {
    const result = await runDzReview(
      dir,
      [
        "review",
        "--no-color",
        "--context-before",
        "1",
        "--context-after",
        "1",
        "file.md",
      ],
      "n\n",
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Before");
    assertStringIncludes(result.stdout, "After");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --oneline - uses Git diff when no files are provided", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(file, "Intro\n");
    await runGit(dir, ["add", "file.md"]);
    await runGit(dir, ["commit", "-m", "initial"]);

    await Deno.writeTextFile(
      file,
      [
        "Intro",
        "{++new++}",
        "<!-- @agent open -->",
        "",
      ].join("\n"),
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--oneline"]))
    );

    assertEquals(
      output.trim(),
      "1 conversation (1 open, 0 wip, 0 handled, 0 resolved), 1 addition",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --oneline - includes Git-ignored paths re-included by .dz-review-ignore", async () => {
  const dir = await Deno.makeTempDir();
  const docsDir = join(dir, "docs");
  const file = join(docsDir, "review.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(join(dir, "tracked.md"), "Intro\n");
    await runGit(dir, ["add", "tracked.md"]);
    await runGit(dir, ["commit", "-m", "initial"]);

    await Deno.writeTextFile(join(dir, ".git", "info", "exclude"), "docs/\n");
    await Deno.writeTextFile(join(dir, ".dz-review-ignore"), "!docs/\n");
    await Deno.mkdir(docsDir);
    await Deno.writeTextFile(file, "<!-- @agent open -->\n");

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--oneline"]))
    );

    assertEquals(
      output.trim(),
      "1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review diff - lists only review items on added lines", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(file, "Intro\n");
    await runGit(dir, ["add", "file.md"]);
    await runGit(dir, ["commit", "-m", "initial"]);
    await Deno.writeTextFile(file, "Intro\n{++new++}\n");

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["diff"]))
    );

    assertStringIncludes(output, "file.md:2");
    assertStringIncludes(output, "addition");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review timestamp - adds timestamps inline", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() => main(["timestamp", "-i", file]));
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "2 timestamps updated");
    assertStringIncludes(updated, "{++%");
    assertStringIncludes(updated, "@agent%");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review timestamp --format-info reports dominant timestamp format", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++%2026-06-16T17:35:35+02:00|one++}",
      "<!-- @agent%2026-06-16T17:35:35+02:00 open -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      main(["timestamp", "--format-info", file])
    );

    assertStringIncludes(output.trim(), "file.md: iso 100%");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review timestamp --format-info reports mixed below threshold", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++%2026-06-16T17:35:35+02:00|one++}",
      "<!-- @agent%1WzvP91W open -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      main(["timestamp", "--format-info", file])
    );

    assertStringIncludes(output.trim(), "file.md: mixed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review timestamp --format-info reports dominant hangul format", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++%\uada8\ub22d\ub147\uac78|one++}",
      "<!-- @agent%\uada8\ub22d\ub147\uac78 open -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      main(["timestamp", "--format-info", file])
    );

    assertStringIncludes(output.trim(), "file.md: hangul 100%");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review timestamp -i logs existing dominant format", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++%2026-06-16T17:35:35+02:00|one++}",
      "<!-- @agent%2026-06-16T17:35:35+02:00 open -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() => main(["timestamp", "-i", file]));

    assertStringIncludes(output, "2 timestamps updated");
    assertStringIncludes(output, "existing format: iso 100%");
    assertStringIncludes(output, "output format: compact");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review now - prints a review timestamp", async () => {
  const output = await captureOutput(() => main(["now"]));

  assertEquals(/^[A-Za-z0-9]{8}$/.test(output.trim()), true);
});

Deno.test("dz-review now --compact - keeps legacy format alias", async () => {
  const output = await captureOutput(() => main(["now", "--compact"]));

  assertEquals(/^[A-Za-z0-9]{8}$/.test(output.trim()), true);
});

Deno.test("dz-review now --timestamp-format hangul - prints a hangul timestamp", async () => {
  const output = await captureOutput(() =>
    main([
      "now",
      "--timestamp-format",
      "hangul",
      "--date",
      "2026-06-16T17:35:35+02:00",
    ])
  );

  assertEquals(/^[\uac00-\ub3ff]{4}$/.test(output.trim()), true);
});

Deno.test("dz-review now -H - prints a hangul timestamp", async () => {
  const output = await captureOutput(() =>
    main(["now", "-H", "--date", "2026-06-16T17:35:35+02:00"])
  );

  assertEquals(/^[\uac00-\ub3ff]{4}$/.test(output.trim()), true);
});

Deno.test("dz-review timestamp -H - converts timestamps to hangul", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++%1WzvP91W|one++}\n");

  try {
    const output = await captureOutput(() =>
      main(["timestamp", "-H", "--stdout", file])
    );

    assertEquals(output, "{++%\uada8\ub22d\ub147\uac78|one++}\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review -C status --oneline - runs from another directory", async () => {
  const repo = await Deno.makeTempDir();
  const other = await Deno.makeTempDir();
  const file = join(repo, "file.md");

  try {
    await runGit(repo, ["init"]);
    await runGit(repo, ["config", "user.email", "test@example.invalid"]);
    await runGit(repo, ["config", "user.name", "Test User"]);
    await runGit(repo, ["config", "commit.gpgsign", "false"]);
    await runGit(repo, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(file, "Intro\n");
    await runGit(repo, ["add", "file.md"]);
    await runGit(repo, ["commit", "-m", "initial"]);
    await Deno.writeTextFile(file, "Intro\n<!-- @agent open -->\n");

    const output = await captureOutput(() =>
      withCwd(other, () => main(["-C", repo, "status", "--oneline"]))
    );

    assertEquals(
      output.trim(),
      "1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
    );
  } finally {
    await Deno.remove(repo, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});

async function withCwd<T>(
  cwd: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = Deno.cwd();
  Deno.chdir(cwd);
  try {
    return await fn();
  } finally {
    Deno.chdir(previous);
  }
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

async function runDzReview(
  cwd: string,
  args: string[],
  stdin: string,
  env: Record<string, string> = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      new URL("./cli.ts", import.meta.url).pathname,
      ...args,
    ],
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env,
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const result = await child.output();
  return {
    success: result.success,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
