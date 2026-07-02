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

async function createPagerCaptureScript(dir: string): Promise<string> {
  const script = join(dir, "pager.sh");
  await Deno.writeTextFile(script, '#!/bin/sh\ncat > "$PAGER_CAPTURE"\n');
  await Deno.chmod(script, 0o755);
  return script;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
    return;
  }

  Deno.env.set(name, value);
}

Deno.test("dz-review agent-instructions - prints AGENTS.md snippet", async () => {
  const output = await captureOutput(() => main(["agent-instructions"]));

  assertEquals(output.startsWith("##"), false);
  assertStringIncludes(output, "DZ Review (`dz-review`):");
  assertStringIncludes(output, "dz-review session start");
  assertStringIncludes(output, "dz-review agent status");
  assertStringIncludes(output, "dz-review session done");
  assertStringIncludes(output, "dz-review ref check");
  assertStringIncludes(output, "dz-review ref list");
  assertStringIncludes(output, "dz-review ref show");
  assertStringIncludes(output, "dz-review ref snapshots");
  assertStringIncludes(output, "--ref <selector>");
  assertStringIncludes(output, "do not rerun `session start`");
  assertStringIncludes(output, "session start --force");
  assertStringIncludes(output, "dz-review --help");
  assertEquals(output.includes("dz-review agent start"), false);
  assertEquals(output.includes("dz-review status"), false);
  assertEquals(output.includes("dz-review ts"), false);
  assertEquals(output.includes("timestamp format: compact"), false);
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
  assertStringIncludes(output, "agent");
  assertStringIncludes(output, "session");
  assertStringIncludes(output, "me");
  assertStringIncludes(output, "-C, --cwd");
  assertStringIncludes(output, "<dir>");
  assertStringIncludes(output, "completions");
  assertEquals(output.includes("Conversation messages may carry"), false);
  assertEquals(output.includes("Review annotations may carry"), false);
});

Deno.test("dz-review agent --help - hides session lifecycle aliases", async () => {
  const output = stripAnsi(
    await captureOutput(() => main(["agent", "--help"])),
  );

  assertStringIncludes(output, "respond");
  assertStringIncludes(output, "status");
  assertStringIncludes(output, "diff");
  assertEquals(output.includes("Record a review snapshot"), false);
  assertEquals(output.includes("Compare against the agent snapshot"), false);
  assertEquals(
    output.includes("Restore files to their pre-agent-start"),
    false,
  );
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

Deno.test("dz-review me status --help - prints human status help", async () => {
  const output = stripAnsi(
    await captureOutput(() => main(["me", "status", "--help"])),
  );

  assertStringIncludes(output, "Usage:");
  assertStringIncludes(output, "dz-review me status");
  assertStringIncludes(output, "things to do for the human");
  assertStringIncludes(output, "--short");
  assertStringIncludes(output, "--recap");
  assertStringIncludes(output, "--template");
  assertStringIncludes(output, "--json");
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
      withCwd(dir, () => main(["status", "--oneline", "file.md"]))
    );

    assertEquals(
      output.trim(),
      "4 conversations (1 open, 1 wip, 1 handled, 1 resolved), 2 additions, 1 highlight, 1 comment",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --oneline --quiet - prints nothing when empty outside a session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "No review items.\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--oneline", "--quiet", "file.md"]))
    );

    assertEquals(output, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --oneline --quiet - reports active empty sessions", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "No review items.\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "file.md"]))
    );
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--oneline", "--quiet"]))
    );

    assertEquals(output.trim(), "active review session - 0 review annotations");
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
        "Review session: none",
        "first.md: 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
        "second.md: 1 conversation (0 open, 0 wip, 0 handled, 1 resolved), 1 addition",
      ],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status - reports active review session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "session.md");
  await Deno.writeTextFile(file, "<!-- @agent open -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "session.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status"]))
    );
    const lines = output.trim().split("\n");

    assertEquals(lines[0], "Review session: active");
    assertStringIncludes(
      lines[1],
      "session.md: 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
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

Deno.test("dz-review status --short - reports active review session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent open -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "file.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--short"]))
    );

    assertStringIncludes(
      output.trim(),
      "file.md: active review session - 1/1",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review session active - prints recap-friendly session state", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "session.md");
  await Deno.writeTextFile(file, "<!-- @agent open -->\n");

  try {
    const inactiveOutput = await captureOutput(() =>
      withCwd(dir, () => main(["session", "active"]))
    );
    const templatedInactiveOutput = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["session", "active", "--template", "review in progress"]),
      )
    );
    await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "session.md"]))
    );
    const activeOutput = await captureOutput(() =>
      withCwd(dir, () => main(["session", "active"]))
    );
    const templatedActiveOutput = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["session", "active", "--template", "review in progress"]),
      )
    );

    assertEquals(inactiveOutput, "");
    assertEquals(activeOutput, "in a review session\n");
    assertEquals(templatedInactiveOutput, "");
    assertEquals(templatedActiveOutput, "review in progress\n");
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

Deno.test("dz-review status --recap - does not report active review session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent open -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "file.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--recap"]))
    );

    assertStringIncludes(output.trim(), "file.md\t1/1");
    assertEquals(output.includes("active review session"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --recap --quiet - prints nothing when empty outside a session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "No review items.\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--recap", "--quiet", "file.md"]))
    );

    assertEquals(output, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me status --quiet - prints nothing when empty outside a session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "No review items.\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["me", "status", "--quiet", "file.md"]))
    );

    assertEquals(output, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me status - reuses status format options", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const shortOutput = await captureOutput(() =>
      withCwd(dir, () => main(["me", "status", "--short", "file.md"]))
    );
    const recapOutput = await captureOutput(() =>
      withCwd(dir, () =>
        main([
          "me",
          "status",
          "--recap",
          "--template",
          "[%(status)]",
          "file.md",
        ]))
    );

    assertEquals(shortOutput.trim(), "file.md: 1/1 +1");
    assertEquals(recapOutput.trim(), "file.md\t[1/1 +1]");
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

Deno.test("dz-review list - sends text output to pager when forced", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const previousPager = Deno.env.get("PAGER");
  const previousPagerCapture = Deno.env.get("PAGER_CAPTURE");
  const previousForcePager = Deno.env.get("FORCE_PAGER");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const pager = await createPagerCaptureScript(dir);
    const pagerCapture = join(dir, "pager-output.txt");
    Deno.env.set("PAGER", pager);
    Deno.env.set("PAGER_CAPTURE", pagerCapture);
    Deno.env.set("FORCE_PAGER", "1");

    const output = await captureOutput(() => main(["list", file]));

    assertEquals(output, "");
    const paged = await Deno.readTextFile(pagerCapture);
    assertStringIncludes(paged, `${file}:1`);
    assertStringIncludes(paged, "addition");
  } finally {
    restoreEnv("PAGER", previousPager);
    restoreEnv("PAGER_CAPTURE", previousPagerCapture);
    restoreEnv("FORCE_PAGER", previousForcePager);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review list --no-pager overrides FORCE_PAGER", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const previousPager = Deno.env.get("PAGER");
  const previousPagerCapture = Deno.env.get("PAGER_CAPTURE");
  const previousForcePager = Deno.env.get("FORCE_PAGER");
  await Deno.writeTextFile(file, "{++one++}\n");

  try {
    const pager = await createPagerCaptureScript(dir);
    const pagerCapture = join(dir, "pager-output.txt");
    Deno.env.set("PAGER", pager);
    Deno.env.set("PAGER_CAPTURE", pagerCapture);
    Deno.env.set("FORCE_PAGER", "1");

    const output = await captureOutput(() =>
      main(["list", "--no-pager", file])
    );

    assertStringIncludes(output, `${file}:1`);
    await assertRejects(() => Deno.stat(pagerCapture), Deno.errors.NotFound);
  } finally {
    restoreEnv("PAGER", previousPager);
    restoreEnv("PAGER_CAPTURE", previousPagerCapture);
    restoreEnv("FORCE_PAGER", previousForcePager);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me list - reuses list command", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() => main(["me", "list", file]));

    assertStringIncludes(output, `${file}:1`);
    assertStringIncludes(output, "addition");
    assertStringIncludes(output, "open conversation");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me review --list - reuses review command options", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "{++one++}\n<!-- @agent open -->\n");

  try {
    const output = await captureOutput(() =>
      main(["me", "review", "--list", file])
    );

    assertStringIncludes(output, `${file}:1`);
    assertStringIncludes(output, "addition");
    assertStringIncludes(output, "open conversation");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me diff - reuses diff command", async () => {
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
    await Deno.writeTextFile(file, "Intro\n<!-- @agent open -->\n");

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["me", "diff"]))
    );

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

Deno.test("dz-review list -c keeps source timestamps in context and ISO in clarified view", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "Before",
      "<!-- @agent%1WzvP91W open -->",
      "After",
      "",
    ].join("\n"),
  );

  try {
    const result = await runDzReview(dir, ["list", "-c", "1", "file.md"], "");

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Before");
    assertStringIncludes(result.stdout, "@agent%1WzvP91W open");
    assertStringIncludes(result.stdout, "After");
    assertStringIncludes(
      result.stdout,
      "@agent 2026-06-16T17:35:35+02:00 open",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start - stores a snapshot and prints an inbox", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "# Spec",
      "Keep {==%1WzvP91W|this==} phrasing.",
      "<!-- @agent%1WzvP91W Should this change? -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const updated = await Deno.readTextFile(file);
    const snapshot = JSON.parse(
      await Deno.readTextFile(join(dir, ".dz-review", "agent-session.json")),
    );

    assertStringIncludes(output, "Agent inbox");
    assertStringIncludes(output, "file.md:2");
    assertStringIncludes(output, "file.md:3");
    assertEquals(/id: [0-9A-Za-z]{6}\nlocation: file\.md:2/.test(output), true);
    assertEquals(output.includes("id: rvw_"), false);
    assertStringIncludes(output, "suggested action:");
    assertStringIncludes(updated, "2026-06-16T17:35:35+02:00");
    assertEquals(snapshot.version, 1);
    assertEquals(snapshot.files[0].path, "file.md");
    assertEquals(snapshot.files[0].timestampFormat, "compact");
    assertEquals(snapshot.items.length, 2);
    assertEquals(/^rvw_[0-9A-Za-z]{1,11}$/.test(snapshot.items[0].id), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review session start - stores a snapshot and prints an inbox", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "file.md"]))
    );
    const snapshot = JSON.parse(
      await Deno.readTextFile(join(dir, ".dz-review", "agent-session.json")),
    );

    assertStringIncludes(output, "Agent inbox");
    assertEquals(snapshot.files[0].path, "file.md");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start --json - prints structured review items", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent open @me answer -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "--json", "file.md"]))
    );
    const data = JSON.parse(output);

    assertEquals(data.version, 1);
    assertEquals(data.items.length, 1);
    assertEquals(data.items[0].file, "file.md");
    assertEquals(data.items[0].lineStart, 1);
    assertEquals(data.items[0].state, "handled");
    assertEquals(data.items[0].lastMessage.author, "@me");
    assertEquals(data.items[0].suggestedAction, "reply");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start --dry-run - prints inbox without side effects", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const sessionFile = join(dir, ".dz-review", "agent-session.json");
  const original = "<!-- @agent%1WzvP91W Question? -->\n";
  await Deno.writeTextFile(file, original);

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "--dry-run", "file.md"]))
    );

    let sessionExists = true;
    try {
      await Deno.stat(sessionFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      sessionExists = false;
    }

    assertStringIncludes(output, "Agent inbox");
    assertStringIncludes(output, "not written");
    assertStringIncludes(output, "file.md:1");
    assertEquals(await Deno.readTextFile(file), original);
    assertEquals(sessionExists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent add-file - adds explicit ignored file to session", async () => {
  const dir = await Deno.makeTempDir();
  const first = join(dir, "first.md");
  const second = join(dir, "second.md");
  await Deno.writeTextFile(join(dir, ".dz-review-ignore"), "second.md\n");
  await Deno.writeTextFile(first, "<!-- @agent first -->\n");
  await Deno.writeTextFile(second, "<!-- @agent second -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "first.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "add-file", "second.md"]))
    );
    const snapshot = JSON.parse(
      await Deno.readTextFile(join(dir, ".dz-review", "agent-session.json")),
    );

    assertStringIncludes(output, "Agent inbox");
    assertStringIncludes(output, "second.md:1");
    assertEquals(snapshot.files.map((file: { path: string }) => file.path), [
      "first.md",
      "second.md",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start --state-dir - writes snapshot to custom state directory", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const customSessionFile = join(
    dir,
    ".cache",
    "dz-review",
    "agent-session.json",
  );
  await Deno.writeTextFile(file, "<!-- @agent custom state -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(
        dir,
        () =>
          main([
            "--state-dir",
            ".cache/dz-review",
            "agent",
            "start",
            "file.md",
          ]),
      )
    );

    assertStringIncludes(
      output,
      "Snapshot: .cache/dz-review/agent-session.json",
    );
    assertEquals(await exists(customSessionFile), true);
    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review -C --state-dir - resolves state directory after cwd change", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent cwd state -->\n");

  try {
    const output = await captureOutput(() =>
      main([
        "-C",
        dir,
        "--state-dir",
        ".agent-state",
        "agent",
        "start",
        "file.md",
      ])
    );

    assertStringIncludes(output, "Snapshot: .agent-state/agent-session.json");
    assertEquals(
      await exists(join(dir, ".agent-state", "agent-session.json")),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review session start - writes default state at Git root from subdir", async () => {
  const dir = await Deno.makeTempDir();
  const subdir = join(dir, "docs");
  const file = join(subdir, "file.md");
  await Deno.mkdir(subdir);
  await Deno.writeTextFile(file, "<!-- @agent root state -->\n");

  try {
    await runGit(dir, ["init"]);
    await captureOutput(() =>
      withCwd(subdir, () => main(["session", "start", "file.md"]))
    );

    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      true,
    );
    assertEquals(
      await exists(join(subdir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review session start --state-dir - stays relative to cwd from subdir", async () => {
  const dir = await Deno.makeTempDir();
  const subdir = join(dir, "docs");
  const file = join(subdir, "file.md");
  await Deno.mkdir(subdir);
  await Deno.writeTextFile(file, "<!-- @agent local state -->\n");

  try {
    await runGit(dir, ["init"]);
    await captureOutput(() =>
      withCwd(
        subdir,
        () =>
          main([
            "--state-dir",
            ".state",
            "session",
            "start",
            "file.md",
          ]),
      )
    );

    assertEquals(
      await exists(join(subdir, ".state", "agent-session.json")),
      true,
    );
    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start reads DZ_REVIEW_STATE_DIR", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent env state -->\n");

  try {
    const result = await runDzReview(dir, ["agent", "start", "file.md"], "", {
      DZ_REVIEW_STATE_DIR: ".state/dz-review",
    });

    assertEquals(result.success, true);
    assertStringIncludes(
      result.stdout,
      "Snapshot: .state/dz-review/agent-session.json",
    );
    assertEquals(
      await exists(join(dir, ".state", "dz-review", "agent-session.json")),
      true,
    );
    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start - refuses to overwrite active session without force", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const sessionFile = join(dir, ".dz-review", "agent-session.json");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const originalSnapshot = await Deno.readTextFile(sessionFile);

    const result = await runDzReview(dir, ["agent", "start", "file.md"], "");
    const unchangedSnapshot = await Deno.readTextFile(sessionFile);

    assertEquals(result.success, false);
    assertStringIncludes(result.stderr, "agent session already exists");
    assertStringIncludes(result.stderr, "dz-review agent status");
    assertStringIncludes(result.stderr, "dz-review session start --force");
    assertEquals(unchangedSnapshot, originalSnapshot);

    const forcedOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "--force", "file.md"]))
    );
    const forcedSnapshot = JSON.parse(await Deno.readTextFile(sessionFile));

    assertStringIncludes(forcedOutput, "Agent inbox");
    assertEquals(forcedSnapshot.files[0].timestampFormat, "iso");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent done - restores timestamps and reports handoff", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question?\n@agent%2026-06-16T17:35:35+02:00 Done. -->\n",
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "done", "file.md"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "Agent handoff");
    assertStringIncludes(output, "files annotated: 1");
    assertStringIncludes(output, "files modified: 1");
    assertStringIncludes(output, "conversations answered: 1");
    assertStringIncludes(output, "guardrail failures: 0");
    assertStringIncludes(updated, "@agent%1WzvP91W Question?");
    assertEquals(updated.includes("2026-06-16T17:35:35+02:00"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent start - normalizes bare human markers", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "<!-- @agent%1WzvP91W Question? @ Answer. -->\n",
  );

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(updated, "@me%");
    assertEquals(updated.includes(" @ Answer."), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent done - normalizes bare human markers before guardrails", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question?\n@ Answer. -->\n",
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "done", "file.md"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "Agent handoff");
    assertStringIncludes(output, "guardrail failures: 0");
    assertStringIncludes(updated, "@me%");
    assertEquals(updated.includes("@ Answer."), false);
    assertEquals(updated.includes("2026-06-16T17:35:35+02:00"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent done - rejects timestamped bare human markers", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question?\n@%2026-06-16T17:36:35+02:00 Answer. -->\n",
    );

    const result = await runDzReview(dir, ["agent", "done", "file.md"], "");
    const updated = await Deno.readTextFile(file);

    assertEquals(result.success, false);
    assertStringIncludes(result.stdout, "guardrail failures: 1");
    assertStringIncludes(
      result.stdout,
      "timestamped bare @ marker should be @me",
    );
    assertStringIncludes(result.stderr, "session done guardrails failed");
    assertStringIncludes(updated, "@%1WzvQ71W Answer.");
    assertEquals(updated.includes("@me%1WzvQ71W Answer."), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent status - reports current session without restoring timestamps", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question?\n@agent%2026-06-16T17:35:35+02:00 Done. -->\n",
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "status"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "Agent status");
    assertStringIncludes(output, "files annotated: 1");
    assertStringIncludes(output, "files modified: 1");
    assertStringIncludes(output, "conversations answered: 1");
    assertStringIncludes(output, "guardrail failures: 0");
    assertEquals(/id: [0-9A-Za-z]{6} file\.md:1/.test(output), true);
    assertEquals(output.includes("id: rvw_"), false);
    assertStringIncludes(updated, "2026-06-16T17:35:35+02:00");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent status --json - prints structured session status", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "status", "--json"]))
    );
    const data = JSON.parse(output);

    assertEquals(data.version, 1);
    assertEquals(data.filesAnnotated, 1);
    assertEquals(data.filesModified, 0);
    assertEquals(data.items.length, 1);
    assertEquals(data.items[0].state, "open");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me status - focuses on human actions", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "<!-- @agent%1WzvP91W Question? -->",
      "<!-- @agent%1WzvP91X Validate cleanup? -->",
      "",
    ].join("\n"),
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const firstId = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1];
    if (!firstId) {
      throw new Error("missing first review id in agent start output");
    }
    await captureOutput(() =>
      withCwd(dir, () =>
        main([
          "agent",
          "respond",
          firstId,
          "--message",
          "I changed the wording.",
        ]))
    );
    const updated = await Deno.readTextFile(file);
    await Deno.writeTextFile(
      file,
      updated.replace(
        "Validate cleanup? -->",
        "Validate cleanup? @me%2026-06-16T17:37:35+02:00 ok -->",
      ),
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["me", "status"]))
    );

    assertStringIncludes(output, "In review session");
    assertStringIncludes(
      output,
      "1 to review - 1 to clean - 1 still open - 0 issues",
    );
    assertStringIncludes(output, "Open conversations:");
    assertStringIncludes(output, "I changed the wording.");
    assertStringIncludes(output, "Clean validated conversations:");
    assertStringIncludes(output, "dz-review agent clean --validated");
    assertStringIncludes(output, "file.md:1");
    assertStringIncludes(output, "file.md:2");
    assertEquals(output.includes("files modified:"), false);
    assertEquals(output.includes("Agent status"), false);
    assertEquals(output.includes("Human status"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me status - keeps empty state concise", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "No review items.\n");

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["me", "status"]))
    );

    assertStringIncludes(output, "Nothing to do.");
    assertStringIncludes(output, "In review session");
    assertStringIncludes(
      output,
      "0 to review - 0 to clean - 0 still open - 0 issues",
    );
    assertEquals(output.includes("Nothing for the human to do."), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent done - fails on guardrail violations", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(file, "<!-- @agent%1WzvP91W Question? -->\n");

  try {
    await runDzReview(dir, ["agent", "start", "file.md"], "");
    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question? @ ok -->\n",
    );

    const result = await runDzReview(dir, ["agent", "done", "file.md"], "");
    const updated = await Deno.readTextFile(file);

    assertEquals(result.success, false);
    assertStringIncludes(result.stdout, "Agent handoff");
    assertStringIncludes(result.stdout, "guardrail failures: 1");
    assertStringIncludes(
      result.stdout,
      "validated conversation remains cleanable",
    );
    assertStringIncludes(result.stderr, "session done guardrails failed");
    assertStringIncludes(updated, "@agent%1WzvP91W Question?");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent list --json - reports current actionable items", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++%2026-06-16T17:35:35+02:00|new++}",
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->",
      "<!-- @agent%2026-06-16T17:36:35+02:00 Done? @me%2026-06-16T17:36:35+02:00 ok -->",
      "",
    ].join("\n"),
  );

  try {
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "list", "--json"]))
    );
    const data = JSON.parse(output);

    assertEquals(data.version, 1);
    assertEquals(data.items.length, 2);
    assertEquals(data.items.map((item: { state: string }) => item.state), [
      "annotation",
      "open",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent show - displays one item by stable id", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "Before",
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->",
      "After",
      "",
    ].join("\n"),
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "show", id, "-c", "1"]))
    );

    assertStringIncludes(output, "file.md:2-2");
    assertStringIncludes(output, "Before");
    assertStringIncludes(output, "@agent");
    assertStringIncludes(output, "After");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent show --json - reports one item by stable id", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->\n",
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "show", id, "--json"]))
    );
    const data = JSON.parse(output);

    assertEquals(data.version, 1);
    assertEquals(data.item.file, "file.md");
    assertEquals(data.item.state, "open");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent respond - appends an agent reply by stable id", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->\n",
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);

    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["agent", "respond", id, "--message", "Done."]),
      )
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "responded");
    assertStringIncludes(updated, "@agent%");
    assertStringIncludes(updated, "Done.");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent apply - replaces an annotation by stable id", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "Use {==%2026-06-16T17:35:35+02:00|old wording==}.\n",
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);

    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["agent", "apply", id, "--replace", "new wording"]),
      )
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "applied");
    assertEquals(updated, "Use new wording.\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent clean --validated --dry-run - previews resolved conversations", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "<!-- @agent%2026-06-16T17:35:35+02:00 Done? @me%2026-06-16T17:35:35+02:00 ok -->\n",
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);

    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["agent", "clean", id, "--validated", "--dry-run"]),
      )
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "would clean 1 conversation");
    assertStringIncludes(updated, "@agent%");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent clean --validated - removes resolved conversations", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "Text\n<!-- @agent%2026-06-16T17:35:35+02:00 Done? @me%2026-06-16T17:35:35+02:00 ok -->\n",
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "clean", id, "--validated"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "cleaned 1 conversation");
    assertEquals(updated, "Text\n\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent diff - prints semantic action summary", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->\n",
  );

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);
    await captureOutput(() =>
      withCwd(
        dir,
        () => main(["agent", "respond", id, "--message", "Done."]),
      )
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "diff"]))
    );

    assertStringIncludes(output, "Agent action diff");
    assertStringIncludes(output, "conversations answered: 1");
    assertStringIncludes(output, "remaining open items: 1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent rollback - restores pre-start content", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const original = "<!-- @agent%1WzvP91W Question? -->\n";
  await Deno.writeTextFile(file, original);

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);
    await captureOutput(() =>
      withCwd(
        dir,
        () => main(["agent", "respond", id, "--message", "Done."]),
      )
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["agent", "rollback"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "rolled back 1 file");
    assertStringIncludes(output, "session closed");
    assertEquals(updated, original);
    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review session rollback - restores pre-start content and closes session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const original = "<!-- @agent%1WzvP91W Question? -->\n";
  await Deno.writeTextFile(file, original);

  try {
    const startOutput = await captureOutput(() =>
      withCwd(dir, () => main(["session", "start", "file.md"]))
    );
    const id = startOutput.match(/id: ([0-9A-Za-z]+)/)?.[1] ?? "";
    assertEquals(id.length > 0, true);
    await captureOutput(() =>
      withCwd(
        dir,
        () => main(["agent", "respond", id, "--message", "Done."]),
      )
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["session", "rollback"]))
    );
    const updated = await Deno.readTextFile(file);

    assertStringIncludes(output, "rolled back 1 file");
    assertStringIncludes(output, "session closed");
    assertEquals(updated, original);
    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review review - applies an annotation from stdin", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "Before {++%2026-06-23T17:47:47+02:00|after++}\n",
  );

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
    await Deno.writeTextFile(
      file,
      "Intro\n{++%2026-06-23T17:47:47+02:00|new++}\n",
    );

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
  await Deno.writeTextFile(
    file,
    "Before\n{++%2026-06-23T17:47:47+02:00|after++}\nAfter\n",
  );

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

Deno.test("dz-review status --oneline - uses Git status files when no files are provided", async () => {
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
        "{++%2026-06-23T17:47:47+02:00|new++}",
        "<!-- @agent%2026-06-23T17:47:47+02:00 open -->",
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
    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
    );

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

Deno.test("dz-review status --oneline - includes untracked Git status files", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "test.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
    );

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

Deno.test("dz-review me status --short - includes untracked Git status files", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "test.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["me", "status", "--short"]))
    );

    assertStringIncludes(output.trim(), "test.md: 1/1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review me status - works without an agent session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "test.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["me", "status"]))
    );

    assertStringIncludes(
      output.trim(),
      "test.md: 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
    );
    assertStringIncludes(output, "Review session: none");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status --oneline - falls back to agent session files before Git status", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "session.md");

  try {
    await runGit(dir, ["init"]);
    await runGit(dir, ["config", "user.email", "test@example.invalid"]);
    await runGit(dir, ["config", "user.name", "Test User"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await runGit(dir, ["config", "core.hooksPath", "/dev/null"]);

    await Deno.writeTextFile(
      file,
      "<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
    );
    await runGit(dir, ["add", "session.md"]);
    await runGit(dir, ["commit", "-m", "session"]);
    await captureOutput(() =>
      withCwd(dir, () => main(["agent", "start", "session.md"]))
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status", "--oneline"]))
    );

    assertEquals(
      output.trim(),
      "active review session - 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status - ignores auto-discovered internal .dz-review files by default", async () => {
  const dir = await Deno.makeTempDir();
  const reviewDir = join(dir, ".dz-review");
  const file = join(reviewDir, "internal.md");
  await Deno.mkdir(reviewDir);
  await Deno.writeTextFile(file, "<!-- @agent internal -->\n");

  try {
    await runGit(dir, ["init"]);

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["status"]))
    );

    assertEquals(
      output,
      "Review session: none\nNo review annotations found.\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status - explicit files bypass custom ignore file", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "ignored.md");
  await Deno.writeTextFile(join(dir, "review.ignore"), "ignored.md\n");
  await Deno.writeTextFile(file, "<!-- @agent ignored -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["--ignore-file", "review.ignore", "status", "ignored.md"]),
      )
    );

    assertEquals(
      output,
      "Review session: none\nignored.md: 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review list - explicit files bypass custom ignore file", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "ignored.md");
  await Deno.writeTextFile(join(dir, "review.ignore"), "ignored.md\n");
  await Deno.writeTextFile(file, "<!-- @agent ignored -->\n");

  try {
    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["--ignore-file", "review.ignore", "list", "ignored.md"]),
      )
    );

    assertStringIncludes(output, "ignored.md:1");
    assertStringIncludes(output, "open conversation");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review status reads DZ_REVIEW_IGNORE_FILE", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "ignored.md");
  await Deno.writeTextFile(join(dir, "review.ignore"), "ignored.md\n");
  await Deno.writeTextFile(file, "<!-- @agent ignored -->\n");

  try {
    const result = await runDzReview(dir, ["status", "ignored.md"], "", {
      DZ_REVIEW_IGNORE_FILE: "review.ignore",
    });

    assertEquals(result.success, true);
    assertEquals(
      result.stdout,
      "Review session: none\nignored.md: 1 conversation (1 open, 0 wip, 0 handled, 0 resolved)\n",
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
    await Deno.writeTextFile(
      file,
      "Intro\n{++%2026-06-23T17:47:47+02:00|new++}\n",
    );

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["diff"]))
    );

    assertStringIncludes(output, "file.md:2");
    assertStringIncludes(output, "addition");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review diff --context shows surrounding source lines", async () => {
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
      "Intro\nBefore\n{++%2026-06-23T17:47:47+02:00|new++}\nAfter\n",
    );

    const result = await runDzReview(
      dir,
      ["diff", "--context", "1", "file.md"],
      "",
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Before");
    assertStringIncludes(result.stdout, "{++%2026-06-23T17:47:47+02:00|new++}");
    assertStringIncludes(result.stdout, "After");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review list --json - reports review items without an agent session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    [
      "{++%2026-06-16T17:35:35+02:00|new++}",
      "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->",
      "",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["list", "--json", "file.md"]))
    );
    const data = JSON.parse(output);

    assertEquals(data.version, 1);
    assertEquals(data.items.length, 2);
    assertEquals(data.items[0].file, "file.md");
    assertEquals(data.items[1].state, "open");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review timestamp - adds timestamps inline", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "{++%2026-06-23T17:47:47+02:00|one++}\n<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
  );

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
      "{++%1WzvP91W|one++}",
      "<!-- @agent%2026-06-16T17:35:35+02:00 open -->",
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
  await Deno.writeTextFile(file, "{++%2026-06-16T17:35:35+02:00|one++}\n");

  try {
    const output = await captureOutput(() =>
      main(["timestamp", "-H", "--stdout", file])
    );

    assertEquals(output, "{++%\uada8\ub22d\ub147\uac78|one++}\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref check - validates line refs, ids, and snapshots", async () => {
  const dir = await Deno.makeTempDir();
  const doc = join(dir, "doc.md");
  const source = join(dir, "source.md");
  await Deno.writeTextFile(
    source,
    [
      "# Source",
      "<!-- ^sas-ines -->",
      "<!-- @agent%2026-06-16T17:35:35+02:00 SAS source -->",
      "SAS : permet d'envoyer/récupérer des fichiers depuis le cloud.",
      "",
    ].join("\n"),
  );
  await Deno.writeTextFile(
    doc,
    [
      "# Doc",
      "<!-- ref%궩거깇걸: source.md:4~{v0;r=4:1-4:60}^sas-ines {&&rFZEOtB",
      "SAS : permet d'envoyer/récupérer des fichiers depuis le cloud.",
      "rFZEOtB&&} -->",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "check", "doc.md"]))
    );

    assertEquals(output.trim(), "ref check ok");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref check - rejects legacy bare tilde ids as invalid MRFI refs", async () => {
  const dir = await Deno.makeTempDir();
  const doc = join(dir, "doc.md");
  const source = join(dir, "source.md");
  await Deno.writeTextFile(
    source,
    [
      "# Source",
      "<!-- ^sas-ines -->",
      "SAS : permet d'envoyer/récupérer des fichiers depuis le cloud.",
      "",
    ].join("\n"),
  );
  await Deno.writeTextFile(
    doc,
    "<!-- ref: source.md:3~K2mmpo^sas-ines -->\n",
  );

  try {
    const result = await runDzReview(dir, ["ref", "check", "doc.md"], "");

    assertEquals(result.success, false);
    assertStringIncludes(result.stdout, "invalid MRFI reference ~K2mmpo");
    assertStringIncludes(result.stderr, "ref check failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref check - rejects mixed line prefix and stale snapshot", async () => {
  const dir = await Deno.makeTempDir();
  const doc = join(dir, "doc.md");
  const source = join(dir, "source.md");
  await Deno.writeTextFile(source, "one\ntwo\n");
  await Deno.writeTextFile(
    doc,
    [
      "<!-- ref: source.md:1-L2 {&&rBad",
      "changed",
      "rBad&&} -->",
    ].join("\n"),
  );

  try {
    const result = await runDzReview(dir, ["ref", "check", "doc.md"], "");

    assertEquals(result.success, false);
    assertStringIncludes(result.stdout, "invalid target");
    assertStringIncludes(result.stderr, "ref check failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref list - lists references with resolved passages", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "source.md"),
    ["one", "two", "three", ""].join("\n"),
  );
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    "<!-- ref: source.md:2; source.md:L1-L2 -->\n",
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "list", "doc.md"]))
    );

    assertStringIncludes(output, "doc.md:1 -> source.md:2");
    assertStringIncludes(output, "two");
    assertStringIncludes(output, "doc.md:1 -> source.md:1-2");
    assertStringIncludes(output, "one\n  two");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref list - sends text output to pager when forced", async () => {
  const dir = await Deno.makeTempDir();
  const previousPager = Deno.env.get("PAGER");
  const previousPagerCapture = Deno.env.get("PAGER_CAPTURE");
  const previousForcePager = Deno.env.get("FORCE_PAGER");
  await Deno.writeTextFile(join(dir, "source.md"), "one\ntwo\n");
  await Deno.writeTextFile(join(dir, "doc.md"), "<!-- ref: source.md:2 -->\n");

  try {
    const pager = await createPagerCaptureScript(dir);
    const pagerCapture = join(dir, "pager-output.txt");
    Deno.env.set("PAGER", pager);
    Deno.env.set("PAGER_CAPTURE", pagerCapture);
    Deno.env.set("FORCE_PAGER", "1");

    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "list", "doc.md"]))
    );

    assertEquals(output, "");
    const paged = await Deno.readTextFile(pagerCapture);
    assertStringIncludes(paged, "doc.md:1 -> source.md:2");
    assertStringIncludes(paged, "two");
  } finally {
    restoreEnv("PAGER", previousPager);
    restoreEnv("PAGER_CAPTURE", previousPagerCapture);
    restoreEnv("FORCE_PAGER", previousForcePager);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref show - emits source-replaceable refs with snapshots", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "source.md"), "one\ntwo\n");
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    ["# Doc", "<!-- ref: source.md:2 -->", "Body"].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "show", "doc.md"]))
    );

    assertStringIncludes(output, "<!-- ref:");
    assertStringIncludes(output, "source.md:2 {&&");
    assertStringIncludes(output, "two");
    assertStringIncludes(output, "&&}");
    assertEquals(output.includes("ref-content"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref show - preserves existing snapshots", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "source.md"), "one\ntwo\n");
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    [
      "# Doc",
      "<!-- ref: source.md:2 {&&rKeep",
      "two",
      "rKeep&&} -->",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "show", "doc.md"]))
    );

    assertEquals((output.match(/\{&&rKeep/g) ?? []).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref show - limits generated snapshots by default", async () => {
  const dir = await Deno.makeTempDir();
  const sourceLines = Array.from(
    { length: 12 },
    (_, index) => `line ${index + 1}`,
  );
  await Deno.writeTextFile(
    join(dir, "source.md"),
    `${sourceLines.join("\n")}\n`,
  );
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    "<!-- ref: source.md:1-12 -->\n",
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "show", "doc.md"]))
    );

    assertStringIncludes(output, "line 10");
    assertEquals(output.includes("line 11"), false);
    assertStringIncludes(output, "[ref snapshot truncated: 2 lines omitted]");

    await Deno.writeTextFile(join(dir, "doc.md"), output);
    const checkOutput = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "check", "doc.md"]))
    );

    assertEquals(checkOutput.trim(), "ref check ok");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref show --snapshot-lines changes snapshot size", async () => {
  const dir = await Deno.makeTempDir();
  const sourceLines = Array.from(
    { length: 12 },
    (_, index) => `line ${index + 1}`,
  );
  await Deno.writeTextFile(
    join(dir, "source.md"),
    `${sourceLines.join("\n")}\n`,
  );
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    "<!-- ref: source.md:1-12 -->\n",
  );

  try {
    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["ref", "show", "--snapshot-lines", "12", "doc.md"]),
      )
    );

    assertStringIncludes(output, "line 12");
    assertEquals(output.includes("[ref snapshot truncated:"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref snapshots - prints only reference snapshots", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "source.md"), "one\ntwo\nthree\n");
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    ["# Doc", "<!-- ref: source.md:2; source.md:3 -->", "Body"].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(dir, () => main(["ref", "snapshots", "doc.md"]))
    );

    assertStringIncludes(output, "doc.md:2 -> source.md:2 r211");
    assertStringIncludes(output, "{&&r211\ntwo\nr211&&}");
    assertStringIncludes(output, "doc.md:2 -> source.md:3 r212");
    assertStringIncludes(output, "{&&r212\nthree\nr212&&}");
    assertEquals(output.includes("# Doc"), false);
    assertEquals(output.includes("Body"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review ref snapshots --ref filters selected snapshots", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(dir, "source.md"), "one\ntwo\nthree\n");
  await Deno.writeTextFile(
    join(dir, "doc.md"),
    [
      "<!-- ref: source.md:2 {&&rKeep",
      "old two",
      "rKeep&&}; source.md:3 -->",
    ].join("\n"),
  );

  try {
    const output = await captureOutput(() =>
      withCwd(
        dir,
        () => main(["ref", "snapshots", "--ref", "rKeep", "doc.md"]),
      )
    );

    assertStringIncludes(output, "doc.md:1 -> source.md:2 rKeep");
    assertStringIncludes(output, "{&&rKeep\nold two\nrKeep&&}");
    assertEquals(output.includes("three"), false);
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
    await Deno.writeTextFile(
      file,
      "Intro\n<!-- @agent%2026-06-23T17:47:47+02:00 open -->\n",
    );

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

async function exists(file: string): Promise<boolean> {
  try {
    await Deno.stat(file);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
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
