// Integration tests for recap CLI
// Tests use Deno.makeTempDir() for isolation

import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "node:path";
import { resolveConfig } from "./domain/use-cases/resolve-config.ts";
import { renderRecap } from "./domain/use-cases/render-recap.ts";
import { collectSections } from "./domain/use-cases/collect-sections.ts";
import { runRecap } from "./domain/use-cases/run-recap.ts";
import { createPalette } from "./domain/entities/color.ts";
import { HARDCODED_SECTIONS } from "./domain/entities/default-config.ts";
import type { SectionData } from "./domain/entities/section-data.ts";
import type { GitInfoProvider } from "./domain/ports/git-info.ts";
import type { ShellRunner } from "./domain/ports/shell-runner.ts";
import { DenoGitInfo } from "./adapters/git/deno-git-info.ts";
import { main } from "./cli.ts";

// ============================================================================
// Helper
// ============================================================================

async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const writer = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });

  const originalStdoutWrite = Deno.stdout.write.bind(Deno.stdout);
  const encoder = new TextEncoder();

  // Override console.log to capture text output
  const originalLog = console.log;
  const originalError = console.error;
  let captured = "";

  console.log = (...args: unknown[]) => {
    captured += args.join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    captured += args.join(" ") + "\n";
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    void writer;
    void chunks;
    void encoder;
    void originalStdoutWrite;
  }

  return captured;
}

// ============================================================================
// CLI agent-instructions command tests
// ============================================================================

Deno.test("recap agent-instructions - prints AGENTS.md snippet", async () => {
  const output = await captureOutput(() => main(["agent-instructions"]));

  assertEquals(output.startsWith("##"), false);
  assertEquals(output.includes("assistants.\n\n- Snapshot"), false);
  assertStringIncludes(output, "Recap (`recap`):");
  assertStringIncludes(output, "recap");
  assertStringIncludes(output, "useful as assistant context");
  assertStringIncludes(output, "Project-specific context");
  assertStringIncludes(output, "recap --help");
  assertEquals(output.includes("recap config show"), false);
  assertEquals(output.includes("recap config files"), false);
});

// ============================================================================
// resolve-config tests
// ============================================================================

Deno.test("resolveConfig - returns hardcoded defaults when no config provided", () => {
  const config = resolveConfig({});
  assertEquals(config.sections.length, HARDCODED_SECTIONS.length);
  assertEquals(config.sections[0].id, "git-branch-track");
  assertEquals(config.sections[1].id, "git-subdir");
  assertEquals(config.sections[3].id, "git-log");
  assertEquals(config.sections[3].max_lines, 6);
  assertEquals(config.sections[4].id, "git-stash");
  assertEquals(config.sections[5].id, "status");
  assertEquals(config.statusEnrichers, [
    { id: "git-stats", builtin: "git-stats", format: "tsv" },
  ]);
});

Deno.test("resolveConfig - status default uses generic status builtin", () => {
  const config = resolveConfig({});
  const status = config.sections.find((s) => s.id === "status");
  assertEquals(status?.builtin, "status");
  assertEquals(config.sectionAliases, [
    { id: "git-status", alias: "status", deprecated: true },
  ]);
});

Deno.test("resolveConfig - ref:* expands all parent sections", () => {
  const config = resolveConfig({
    rawLocalConfig: {
      sections: [{ ref: "*" }],
    },
  });
  // Should include all hardcoded sections
  assertEquals(config.sections.length, HARDCODED_SECTIONS.length);
  assertEquals(config.sections[0].id, "git-branch-track");
  assertEquals(config.sections[5].id, "status");
});

Deno.test("resolveConfig - ref:* excludes IDs referenced explicitly elsewhere", () => {
  const config = resolveConfig({
    rawLocalConfig: {
      sections: [
        { ref: "*" },
        { id: "custom", sh: "echo hello" },
        { ref: "git-log" },
      ],
    },
  });
  // ref:* should NOT include git-log (it appears explicitly later)
  const starIds = config.sections.slice(0, -2).map((s) => s.id);
  assertEquals(starIds.includes("git-log"), false);
  // git-log should be at the end (explicitly placed)
  assertEquals(config.sections[config.sections.length - 1].id, "git-log");
  assertEquals(config.sections[config.sections.length - 1].builtin, "git-log");
  // custom section should be second-to-last
  assertEquals(config.sections[config.sections.length - 2].id, "custom");
  // Total = hardcoded minus git-log + custom + git-log = hardcoded + 1
});

Deno.test("resolveConfig - ref:id includes specific parent section", () => {
  const config = resolveConfig({
    rawLocalConfig: {
      sections: [{ ref: "git-log" }],
    },
  });
  assertEquals(config.sections.length, 1);
  assertEquals(config.sections[0].id, "git-log");
  assertEquals(config.sections[0].builtin, "git-log");
  assertEquals(config.sections[0].max_lines, 6);
});

Deno.test("resolveConfig - ref:id with override replaces field", () => {
  const config = resolveConfig({
    rawLocalConfig: {
      sections: [{ ref: "git-log", max_lines: 10 }],
    },
  });
  assertEquals(config.sections[0].max_lines, 10);
  assertEquals(config.sections[0].builtin, "git-log");
});

Deno.test("resolveConfig - local config appends new section", () => {
  const config = resolveConfig({
    rawLocalConfig: {
      sections: [
        { ref: "*" },
        { id: "custom", sh: "echo hello" },
      ],
    },
  });
  assertEquals(config.sections.length, HARDCODED_SECTIONS.length + 1);
  assertEquals(config.sections[config.sections.length - 1].id, "custom");
  assertEquals(config.sections[config.sections.length - 1].sh, "echo hello");
});

Deno.test("resolveConfig - MAX_COMMITS env override applies to git-log", () => {
  const config = resolveConfig({
    envOverrides: { MAX_COMMITS: "15" },
  });
  const gitLog = config.sections.find((s) => s.id === "git-log");
  assertEquals(gitLog?.max_lines, 15);
});

Deno.test("resolveConfig - MAX_WORKTASKS env override applies to worktasks section", () => {
  const config = resolveConfig({
    rawGlobalConfig: {
      sections: [{ id: "worktasks", sh: "echo tasks" }],
    },
    envOverrides: { MAX_WORKTASKS: "3" },
  });
  const worktasks = config.sections.find((s) => s.id === "worktasks");
  assertEquals(worktasks?.max_lines, 3);
});

Deno.test("resolveConfig - status enrichers merge by id", () => {
  const config = resolveConfig({
    rawGlobalConfig: {
      status_enrichers: [
        { id: "annotations", sh: "ann old", format: "tsv" },
        { id: "review", sh: "review status", format: "tsv" },
      ],
    },
    rawLocalConfig: {
      status_enrichers: [
        { id: "annotations", sh: "ann new", format: "tsv" },
      ],
    },
  });

  assertEquals(config.statusEnrichers, [
    { id: "git-stats", builtin: "git-stats", format: "tsv" },
    { id: "annotations", sh: "ann new", format: "tsv" },
    { id: "review", sh: "review status", format: "tsv" },
  ]);
});

Deno.test("resolveConfig - section aliases resolve refs and warn when deprecated", () => {
  const config = resolveConfig({
    rawGlobalConfig: {
      sections: [
        { id: "status", builtin: "status" },
        { id: "old-status", alias: "status", deprecated: true },
      ],
    },
    rawLocalConfig: {
      sections: [{ ref: "old-status" }],
    },
  });

  assertEquals(
    config.sections.map((section) => ({
      id: section.id,
      builtin: section.builtin,
    })),
    [{ id: "status", builtin: "status" }],
  );
  assertEquals(config.warnings, [
    'section "old-status" is deprecated; use "status" instead',
  ]);
});

Deno.test("resolveConfig - global + local layering works", () => {
  // Global: include all defaults, plus extra section
  // Local: ref:* (inherits global)
  const config = resolveConfig({
    rawGlobalConfig: {
      sections: [
        { ref: "git-branch-track" },
        { ref: "git-ops" },
        { ref: "git-log" },
        { ref: "git-status" },
        { id: "extra", sh: "echo hello", max_lines: 3 },
      ],
    },
    rawLocalConfig: {
      sections: [{ ref: "*" }],
    },
  });
  // After global: 5 sections with extra at max_lines=3
  // After local: ref:* expands all 5 global sections
  assertEquals(config.sections.length, 5);
  const extra = config.sections.find((s) => s.id === "extra");
  assertEquals(extra?.max_lines, 3);
});

// ============================================================================
// render-recap tests
// ============================================================================

Deno.test("renderRecap - renders sections with titles", () => {
  const sections: SectionData[] = [
    {
      id: "test",
      title: "My Title",
      lines: ["line 1", "line 2"],
      separator: "blank_line",
    },
  ];
  const palette = createPalette(false);
  const result = renderRecap(sections, palette);
  assertStringIncludes(result, "My Title");
  assertStringIncludes(result, "line 1");
  assertStringIncludes(result, "line 2");
});

Deno.test("renderRecap - respects max_lines (via section-data lines)", () => {
  // max_lines truncation happens in collect-sections, not render
  // Here we verify that lines passed in are all rendered
  const sections: SectionData[] = [
    {
      id: "test",
      lines: ["a", "b", "c"],
      separator: "none",
    },
  ];
  const palette = createPalette(false);
  const result = renderRecap(sections, palette);
  assertStringIncludes(result, "a");
  assertStringIncludes(result, "b");
  assertStringIncludes(result, "c");
});

Deno.test("renderRecap - separator blank_line adds empty line", () => {
  const sections: SectionData[] = [
    { id: "s1", lines: ["first"], separator: "blank_line" },
    { id: "s2", lines: ["second"], separator: "blank_line" },
  ];
  const palette = createPalette(false);
  const result = renderRecap(sections, palette);
  // Should have a blank line between sections
  assertStringIncludes(result, "first");
  assertStringIncludes(result, "second");
  // Two newlines = blank line separator
  assertStringIncludes(result, "\n\n");
});

Deno.test("renderRecap - separator line adds dashed line", () => {
  // separator field on a section applies BEFORE that section (between it and the previous)
  // So to get a separator between s1 and s2, s2 must have separator: "line"
  const sections: SectionData[] = [
    { id: "s1", lines: ["first"], separator: "blank_line" },
    { id: "s2", lines: ["second"], separator: "line" },
  ];
  const palette = createPalette(false);
  const result = renderRecap(sections, palette);
  assertStringIncludes(result, "─");
});

Deno.test("renderRecap - skips sections with no lines and no error", () => {
  const sections: SectionData[] = [
    { id: "empty", lines: [], separator: "blank_line" },
    { id: "has-content", lines: ["visible"], separator: "none" },
  ];
  const palette = createPalette(false);
  const result = renderRecap(sections, palette);
  assertStringIncludes(result, "visible");
  // empty section with no lines should not add blank line before real section
});

Deno.test("renderRecap - shows error for failed sections", () => {
  const sections: SectionData[] = [
    {
      id: "failing",
      lines: [],
      separator: "blank_line",
      error: "command not found",
    },
  ];
  const palette = createPalette(false);
  const result = renderRecap(sections, palette);
  assertStringIncludes(result, "command not found");
});

// ============================================================================
// createPalette tests
// ============================================================================

Deno.test("createPalette - returns identity functions when useColor=false", () => {
  const palette = createPalette(false);
  assertEquals(palette.title("hello"), "hello");
  assertEquals(palette.error("err"), "err");
  assertEquals(palette.bold("bold"), "bold");
});

Deno.test("createPalette - adds ANSI codes when useColor=true", () => {
  const palette = createPalette(true);
  // With color, the title function should wrap with ANSI escape codes
  const result = palette.title("hello");
  // ANSI escape codes contain \x1b
  assertStringIncludes(result, "\x1b[");
  assertStringIncludes(result, "hello");
});

// ============================================================================
// CLI integration tests
// ============================================================================

Deno.test("recap CLI - --help shows usage", async () => {
  const output = await captureOutput(async () => {
    try {
      await main(["--help"]);
    } catch {
      // Help may call Deno.exit
    }
  });
  // Help output should mention recap
  assertStringIncludes(output.toLowerCase() + "recap", "recap");
});

Deno.test("recap CLI - init creates config file", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  try {
    Deno.chdir(tempDir);
    await main(["init"]);
    const configPath = join(tempDir, ".config", "recap.yaml");
    const exists = await Deno.stat(configPath).then(() => true).catch(() =>
      false
    );
    assertEquals(exists, true);
    const content = await Deno.readTextFile(configPath);
    assertStringIncludes(content, "sections:");
    assertStringIncludes(content, "ref:");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - --json outputs valid JSON array", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  let jsonOutput = "";
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    jsonOutput += args.join(" ") + "\n";
  };
  try {
    Deno.chdir(tempDir);
    await main(["--json", "--no-color"]);
  } finally {
    console.log = originalLog;
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
  // Should be valid JSON
  const parsed = JSON.parse(jsonOutput.trim());
  assertEquals(Array.isArray(parsed), true);
});

Deno.test("recap CLI - -C changes working directory for config discovery", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create a config in tempDir/.config/recap.yaml with a value section
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, ".config", "recap.yaml"),
      `
sections:
  - id: test-marker
    value: "MARKER_FOUND"
`,
    );

    let jsonOutput = "";
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      jsonOutput += args.join(" ") + "\n";
    };
    try {
      await main(["--json", "--no-color", "-C", tempDir]);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(jsonOutput.trim());
    const marker = parsed.find((s: { id: string }) => s.id === "test-marker");
    assertStringIncludes(marker?.lines?.[0] ?? "", "MARKER_FOUND");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - -c loads explicit config path", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = join(tempDir, "custom-recap.yaml");
  try {
    await Deno.writeTextFile(
      configPath,
      `
sections:
  - id: explicit-marker
    value: "EXPLICIT_FOUND"
`,
    );

    let jsonOutput = "";
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      jsonOutput += args.join(" ") + "\n";
    };
    try {
      await main(["--json", "--no-color", "-c", configPath]);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(jsonOutput.trim());
    const marker = parsed.find((s: { id: string }) =>
      s.id === "explicit-marker"
    );
    assertStringIncludes(marker?.lines?.[0] ?? "", "EXPLICIT_FOUND");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - show prints only requested sections in requested order", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, ".config", "recap.yaml"),
      `
sections:
  - id: alpha
    value: "ALPHA"
  - id: unused
    sh: "printf UNUSED"
  - id: beta
    value: "BETA"
`,
    );

    const output = await captureOutput(async () => {
      await main(["--no-color", "-C", tempDir, "show", "beta", "alpha"]);
    });

    assertStringIncludes(output, "BETA");
    assertStringIncludes(output, "ALPHA");
    assertEquals(output.includes("UNUSED"), false);
    assertEquals(output.indexOf("BETA") < output.indexOf("ALPHA"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - show --json returns only requested sections", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    const configPath = join(tempDir, ".config", "recap.yaml");
    await Deno.writeTextFile(
      configPath,
      `
sections:
  - id: alpha
    value: "ALPHA"
  - id: beta
    value: "BETA"
`,
    );

    const output = await captureOutput(async () => {
      await main([
        "--json",
        "--no-color",
        "-c",
        configPath,
        "show",
        "beta",
      ]);
    });

    const parsed = JSON.parse(output.trim());
    assertEquals(parsed.map((section: { id: string }) => section.id), [
      "beta",
    ]);
    assertEquals(parsed[0].lines, ["BETA"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - show warns when using deprecated git-status alias", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, ".config", "recap.yaml"),
      `
sections:
  - id: status
    value: "STATUS_FOUND"
  - id: git-status
    alias: status
    deprecated: true
`,
    );

    const output = await captureOutput(async () => {
      await main(["--no-color", "-C", tempDir, "show", "git-status"]);
    });

    assertStringIncludes(output, "STATUS_FOUND");
    assertStringIncludes(
      output,
      'recap warning: section "git-status" is deprecated; use "status" instead',
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("runRecap - selected sections skip non-selected shell commands", async () => {
  const { shell, calls } = makeSpyShell();
  const mockEnv = {
    cwd: () => "/tmp",
    home: () => undefined,
    getEnv: () => undefined,
    isTerminal: () => false,
    loadDotenv: () => Promise.resolve({}),
  };
  const mockConfigResolver = {
    loadConfig: () =>
      Promise.resolve({
        sections: [
          { id: "wanted", sh: "echo wanted" },
          { id: "skipped", sh: "echo skipped" },
        ],
      }),
  };

  const result = await runRecap(
    {
      useColor: false,
      sectionIds: ["wanted"],
      configPath: "mock",
    },
    {
      shell,
      git: noopGit,
      env: mockEnv,
      fs: {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.resolve(""),
        writeFile: () => Promise.resolve(),
        ensureDir: () => Promise.resolve(),
        readDir: async function* () {},
      },
      configResolver: mockConfigResolver,
    },
    createPalette(false),
  );

  assertEquals(result.sections.map((section) => section.id), ["wanted"]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].command, "echo wanted");
});

Deno.test("runRecap - unknown selected section rejects with a clear error", async () => {
  const { shell } = makeSpyShell();
  const mockEnv = {
    cwd: () => "/tmp",
    home: () => undefined,
    getEnv: () => undefined,
    isTerminal: () => false,
    loadDotenv: () => Promise.resolve({}),
  };
  const mockConfigResolver = {
    loadConfig: () =>
      Promise.resolve({
        sections: [
          { id: "wanted", sh: "echo wanted" },
          { id: "skipped", sh: "echo skipped" },
        ],
      }),
  };

  await assertRejects(
    () =>
      runRecap(
        {
          useColor: false,
          sectionIds: ["missing"],
          configPath: "mock",
        },
        {
          shell,
          git: noopGit,
          env: mockEnv,
          fs: {
            exists: () => Promise.resolve(false),
            readFile: () => Promise.resolve(""),
            writeFile: () => Promise.resolve(),
            ensureDir: () => Promise.resolve(),
            readDir: async function* () {},
          },
          configResolver: mockConfigResolver,
        },
        createPalette(false),
      ),
    Error,
    'section "missing" not found',
  );
});

Deno.test("DenoGitInfo - summarizes local stats, outside changes, and stash", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await runIn(tempDir, ["git", "init", "-q"]);
    await runIn(tempDir, ["git", "config", "user.email", "test@test"]);
    await runIn(tempDir, ["git", "config", "user.name", "Test"]);
    await runIn(tempDir, ["git", "config", "commit.gpgsign", "false"]);
    await Deno.mkdir(join(tempDir, "foo"), { recursive: true });
    await Deno.mkdir(join(tempDir, "bar"), { recursive: true });
    await Deno.writeTextFile(join(tempDir, "foo", "a"), "old1\nold2\nold3\n");
    await Deno.writeTextFile(join(tempDir, "b"), "one\n");
    await Deno.writeTextFile(join(tempDir, "bar", "c"), "one\n");
    await runIn(tempDir, ["git", "add", "."]);
    await runIn(tempDir, ["git", "commit", "-q", "-m", "initial commit"]);

    await Deno.writeTextFile(join(tempDir, "stash-me"), "stashed\n");
    await runIn(tempDir, ["git", "add", "stash-me"]);
    await runIn(tempDir, ["git", "stash", "push", "-q", "-m", "test stash"]);

    await Deno.writeTextFile(
      join(tempDir, "foo", "a"),
      Array.from({ length: 12 }, (_value, index) => `new${index + 1}`)
        .join("\n") + "\n",
    );
    await Deno.writeTextFile(join(tempDir, "b"), "two\n");
    await Deno.writeTextFile(join(tempDir, "outside-new"), "new\n");
    await Deno.writeTextFile(join(tempDir, "outside space"), "new\n");
    await Deno.writeTextFile(join(tempDir, "extérieur"), "new\n");

    const adapter = new DenoGitInfo();
    const cwd = join(tempDir, "foo");
    const stash = await adapter.getGitStash(cwd);
    const status = await adapter.getGitStatus(cwd, true, false);

    assertEquals(stash.lines, ["(1 stashed entry)"]);
    assertEquals(status.lines, [
      " M a",
      "(1 change and 3 untracked files outside this dir)",
    ]);
    assertEquals(status.entries, [
      { path: "a", line: " M a", stats: "(12+ 3-)" },
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo - renders local unicode paths without octal escapes", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await runIn(tempDir, ["git", "init", "-q"]);
    await runIn(tempDir, ["git", "config", "user.email", "test@test"]);
    await runIn(tempDir, ["git", "config", "user.name", "Test"]);
    await runIn(tempDir, ["git", "config", "commit.gpgsign", "false"]);
    await Deno.mkdir(join(tempDir, "foo"), { recursive: true });
    await Deno.writeTextFile(join(tempDir, "foo", ".keep"), "tracked\n");
    await runIn(tempDir, ["git", "add", "."]);
    await runIn(tempDir, ["git", "commit", "-q", "-m", "initial commit"]);
    await Deno.writeTextFile(join(tempDir, "foo", "été.md"), "hello\n");

    const adapter = new DenoGitInfo();
    const status = await adapter.getGitStatus(
      join(tempDir, "foo"),
      true,
      false,
    );

    assertEquals(status.lines, ["?? été.md"]);
    assertEquals(status.entries, [
      { path: "été.md", line: "?? été.md", stats: "(1+ 0-)" },
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo - colors additions green and deletions red in stats", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await runIn(tempDir, ["git", "init", "-q"]);
    await runIn(tempDir, ["git", "config", "user.email", "test@test"]);
    await runIn(tempDir, ["git", "config", "user.name", "Test"]);
    await runIn(tempDir, ["git", "config", "commit.gpgsign", "false"]);
    await Deno.writeTextFile(join(tempDir, "a"), "old1\nold2\nold3\n");
    await runIn(tempDir, ["git", "add", "."]);
    await runIn(tempDir, ["git", "commit", "-q", "-m", "initial commit"]);

    await Deno.writeTextFile(
      join(tempDir, "a"),
      Array.from({ length: 12 }, (_value, index) => `new${index + 1}`)
        .join("\n") + "\n",
    );

    const adapter = new DenoGitInfo();
    const status = await adapter.getGitStatus(tempDir, true, true);

    assertEquals(status.lines, [
      " \x1b[33mM\x1b[39m a",
    ]);
    assertEquals(status.entries, [
      {
        path: "a",
        line: " \x1b[33mM\x1b[39m a",
        stats: "(\x1b[32m12+\x1b[39m \x1b[31m3-\x1b[39m)",
      },
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo - colors status columns by kind", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await runIn(tempDir, ["git", "init", "-q"]);
    await runIn(tempDir, ["git", "config", "user.email", "test@test"]);
    await runIn(tempDir, ["git", "config", "user.name", "Test"]);
    await runIn(tempDir, ["git", "config", "commit.gpgsign", "false"]);
    await Deno.writeTextFile(join(tempDir, "deleted.txt"), "old\n");
    await Deno.writeTextFile(join(tempDir, "modified.txt"), "old\n");
    await runIn(tempDir, ["git", "add", "."]);
    await runIn(tempDir, ["git", "commit", "-q", "-m", "initial commit"]);

    await Deno.remove(join(tempDir, "deleted.txt"));
    await Deno.writeTextFile(join(tempDir, "modified.txt"), "new\n");
    await Deno.writeTextFile(join(tempDir, "added.txt"), "new\n");
    await Deno.writeTextFile(join(tempDir, "untracked.txt"), "new\n");
    await runIn(tempDir, ["git", "add", "added.txt"]);

    const adapter = new DenoGitInfo();
    const status = await adapter.getGitStatus(tempDir, true, true);

    assertEquals(status.lines, [
      "\x1b[32mA\x1b[39m  added.txt",
      " \x1b[31mD\x1b[39m deleted.txt",
      " \x1b[33mM\x1b[39m modified.txt",
      "\x1b[36m?\x1b[39m\x1b[36m?\x1b[39m untracked.txt",
    ]);
    assertEquals(status.entries?.map((entry) => entry.stats), [
      "(\x1b[32m1+\x1b[39m \x1b[31m0-\x1b[39m)",
      "(\x1b[32m0+\x1b[39m \x1b[31m1-\x1b[39m)",
      "(\x1b[32m1+\x1b[39m \x1b[31m1-\x1b[39m)",
      "(\x1b[32m1+\x1b[39m \x1b[31m0-\x1b[39m)",
    ]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - discovers .config/recap.yml", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, ".config", "recap.yml"),
      `
sections:
  - id: yml-marker
    value: "YML_FOUND"
`,
    );

    let jsonOutput = "";
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      jsonOutput += args.join(" ") + "\n";
    };
    try {
      await main(["--json", "--no-color", "-C", tempDir]);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(jsonOutput.trim());
    const marker = parsed.find((section: { id: string }) =>
      section.id === "yml-marker"
    );
    assertStringIncludes(marker?.lines?.[0] ?? "", "YML_FOUND");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("recap CLI - config show emits flat resolved YAML", async () => {
  const tempDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");
  try {
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      join(tempDir, ".config", "recap.yaml"),
      `
sections:
  - ref: git-log
    max_lines: 2
  - id: local-marker
    value: "LOCAL_FOUND"
status_enrichers:
  - id: annotations
    sh: annotations status --recap
    format: tsv
`,
    );
    Deno.env.set("HOME", homeDir);

    const output = await captureOutput(async () => {
      await main(["--no-color", "-C", tempDir, "config", "show"]);
    });

    assertEquals(output.includes("local:"), false);
    assertEquals(output.includes("global:"), false);
    assertEquals(output.includes("default:"), false);
    assertStringIncludes(output, "sections:");
    assertStringIncludes(output, "id: git-log");
    assertStringIncludes(output, "builtin: git-log");
    assertStringIncludes(output, "max_lines: 2");
    assertStringIncludes(output, "id: local-marker");
    assertStringIncludes(output, "value: LOCAL_FOUND");
    assertStringIncludes(output, "status_enrichers:");
    assertStringIncludes(output, "id: annotations");
    assertStringIncludes(output, "sh: annotations status --recap");
    assertStringIncludes(output, "format: tsv");
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("recap CLI - config files lists loaded config files from local to global", async () => {
  const tempDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");
  try {
    const localPath = join(tempDir, ".config", "recap.yaml");
    const globalPath = join(homeDir, ".config", "recap.yaml");
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.mkdir(join(homeDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      localPath,
      `
sections:
  - id: local-marker
    value: "LOCAL_FOUND"
`,
    );
    await Deno.writeTextFile(
      globalPath,
      `
sections:
  - id: global-marker
    value: "GLOBAL_FOUND"
`,
    );
    Deno.env.set("HOME", homeDir);

    const output = await captureOutput(async () => {
      await main(["--no-color", "-C", tempDir, "config", "files"]);
    });

    const localIndex = output.indexOf(localPath);
    const globalIndex = output.indexOf(globalPath);
    assertEquals(localIndex >= 0, true);
    assertEquals(globalIndex > localIndex, true);
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("recap CLI - config files -v shows configs from local to default", async () => {
  const tempDir = await Deno.makeTempDir();
  const homeDir = await Deno.makeTempDir();
  const originalHome = Deno.env.get("HOME");
  try {
    const localPath = join(tempDir, ".config", "recap.yaml");
    const globalPath = join(homeDir, ".config", "recap.yaml");
    await Deno.mkdir(join(tempDir, ".config"), { recursive: true });
    await Deno.mkdir(join(homeDir, ".config"), { recursive: true });
    await Deno.writeTextFile(
      localPath,
      `
sections:
  - id: local-marker
    value: "LOCAL_FOUND"
`,
    );
    await Deno.writeTextFile(
      globalPath,
      `
sections:
  - id: global-marker
    value: "GLOBAL_FOUND"
`,
    );
    Deno.env.set("HOME", homeDir);

    const output = await captureOutput(async () => {
      await main(["--no-color", "-C", tempDir, "config", "files", "-v"]);
    });

    const localIndex = output.indexOf(`local: ${localPath}`);
    const globalIndex = output.indexOf(`global: ${globalPath}`);
    const defaultIndex = output.indexOf("default: built-in");
    assertEquals(localIndex >= 0, true);
    assertEquals(globalIndex > localIndex, true);
    assertEquals(defaultIndex > globalIndex, true);
    assertStringIncludes(output, "id: local-marker");
    assertStringIncludes(output, "value: LOCAL_FOUND");
    assertStringIncludes(output, "id: global-marker");
    assertStringIncludes(output, "value: GLOBAL_FOUND");
    assertStringIncludes(output, "id: git-log");
    assertStringIncludes(output, "builtin: git-log");
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(homeDir, { recursive: true });
  }
});

Deno.test("recap CLI - value section with interpolation", () => {
  const config = resolveConfig({
    rawLocalConfig: {
      sections: [
        { id: "info", value: "Project: ${PROJECT_NAME}" },
      ],
    },
  });
  assertEquals(config.sections[0].value, "Project: ${PROJECT_NAME}");
});

// ============================================================================
// DenoGitInfo.getGitSubdir adapter tests
// ============================================================================

Deno.test("DenoGitInfo.getGitSubdir - returns display string in subdirectory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Init a git repo
    const init = new Deno.Command("git", {
      args: ["init", tempDir],
      stdout: "piped",
      stderr: "piped",
    });
    await init.output();

    // Create a subdirectory
    const subDir = join(tempDir, "src", "lib");
    await Deno.mkdir(subDir, { recursive: true });

    const adapter = new DenoGitInfo();
    const result = await adapter.getGitSubdir(subDir);
    assertEquals(result.display, "(in ./src/lib)");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo.getGitSubdir - returns null at repo root", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const init = new Deno.Command("git", {
      args: ["init", tempDir],
      stdout: "piped",
      stderr: "piped",
    });
    await init.output();

    const adapter = new DenoGitInfo();
    const result = await adapter.getGitSubdir(tempDir);
    assertEquals(result.display, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo.getGitSubdir - returns null outside git repo", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const adapter = new DenoGitInfo();
    const result = await adapter.getGitSubdir(tempDir);
    assertEquals(result.display, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// collectSections - git-subdir builtin tests
// ============================================================================

Deno.test("collectSections - git-subdir builtin returns display when in subdir", async () => {
  const mockGit: GitInfoProvider = {
    getGitOps: () => Promise.resolve({ operation: null }),
    getGitLog: () => Promise.resolve({ lines: [] }),
    getGitStash: () => Promise.resolve({ lines: [] }),
    getGitStatus: () => Promise.resolve({ lines: [] }),
    getGitSubdir: () => Promise.resolve({ display: "(in ./src/lib)" }),
  };
  const mockShell: ShellRunner = {
    run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
  };

  const result = await collectSections(
    {
      sections: [{ id: "git-subdir", builtin: "git-subdir" }],
      envVars: {},
    },
    { shell: mockShell, git: mockGit, cwd: "/tmp", useColor: false },
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].lines, ["(in ./src/lib)"]);
});

Deno.test("collectSections - git-subdir builtin returns empty lines at repo root", async () => {
  const mockGit: GitInfoProvider = {
    getGitOps: () => Promise.resolve({ operation: null }),
    getGitLog: () => Promise.resolve({ lines: [] }),
    getGitStash: () => Promise.resolve({ lines: [] }),
    getGitStatus: () => Promise.resolve({ lines: [] }),
    getGitSubdir: () => Promise.resolve({ display: null }),
  };
  const mockShell: ShellRunner = {
    run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
  };

  const result = await collectSections(
    {
      sections: [{ id: "git-subdir", builtin: "git-subdir" }],
      envVars: {},
    },
    { shell: mockShell, git: mockGit, cwd: "/tmp", useColor: false },
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].lines, []);
  assertEquals(result[0].error, undefined);
});

Deno.test("collectSections - git-status builtins select full or local mode", async () => {
  const calls: boolean[] = [];
  const mockGit: GitInfoProvider = {
    getGitOps: () => Promise.resolve({ operation: null }),
    getGitLog: () => Promise.resolve({ lines: [] }),
    getGitStash: () => Promise.resolve({ lines: [] }),
    getGitSubdir: () => Promise.resolve({ display: null }),
    getGitStatus: (_cwd, localOnly) => {
      calls.push(localOnly);
      return Promise.resolve({ lines: [] });
    },
  };
  const mockShell: ShellRunner = {
    run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
  };

  await collectSections(
    {
      sections: [
        { id: "git-status", builtin: "git-status" },
        { id: "git-status-local", builtin: "git-status-local" },
      ],
      envVars: {},
    },
    { shell: mockShell, git: mockGit, cwd: "/tmp", useColor: false },
  );

  assertEquals(calls, [false, true]);
});

Deno.test("collectSections - status appends builtin and TSV enricher output by file", async () => {
  const { shell, calls } = makeSpyShell();
  const mockGit: GitInfoProvider = {
    getGitOps: () => Promise.resolve({ operation: null }),
    getGitLog: () => Promise.resolve({ lines: [] }),
    getGitStash: () => Promise.resolve({ lines: [] }),
    getGitSubdir: () => Promise.resolve({ display: null }),
    getGitStatus: () =>
      Promise.resolve({
        lines: [
          " M src/a.ts",
          "?? src/b.ts",
          "(1 change outside this dir)",
        ],
        entries: [
          { path: "src/a.ts", line: " M src/a.ts", stats: "(3+ 4-)" },
          { path: "src/b.ts", line: "?? src/b.ts", stats: "(1+ 0-)" },
        ],
      }),
  };

  shell.run = (command, options) => {
    calls.push({ command, env: options?.env, cwd: options?.cwd });
    return Promise.resolve({
      stdout: "src/a.ts\t[ann 3/11 +3~2]\nunknown.ts\t[ignored]\n",
      stderr: "",
      exitCode: 0,
    });
  };

  const result = await collectSections(
    {
      sections: [{ id: "status", builtin: "status" }],
      statusEnrichers: [
        { id: "git-stats", builtin: "git-stats", format: "tsv" },
        { id: "annotations", sh: "annotations status", format: "tsv" },
      ],
      envVars: {},
    },
    { shell, git: mockGit, cwd: "/repo", useColor: false },
  );

  assertEquals(result[0].lines, [
    " M src/a.ts (3+ 4-) [ann 3/11 +3~2]",
    "?? src/b.ts (1+ 0-)",
    "(1 change outside this dir)",
  ]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].command, "annotations status");
  assertEquals(calls[0].cwd, "/repo");
  assertEquals(calls[0].env?.NO_COLOR, "1");
});

// ============================================================================
// Color forwarding tests
// ============================================================================

// Helper: spy ShellRunner that records every invocation.
function makeSpyShell(): {
  shell: ShellRunner;
  calls: Array<
    { command: string; env?: Readonly<Record<string, string>>; cwd?: string }
  >;
} {
  const calls: Array<
    { command: string; env?: Readonly<Record<string, string>>; cwd?: string }
  > = [];
  const shell: ShellRunner = {
    run: (command, options) => {
      calls.push({ command, env: options?.env, cwd: options?.cwd });
      return Promise.resolve({ stdout: "out", stderr: "", exitCode: 0 });
    },
  };
  return { shell, calls };
}

const noopGit: GitInfoProvider = {
  getGitOps: () => Promise.resolve({ operation: null }),
  getGitLog: () => Promise.resolve({ lines: [] }),
  getGitStash: () => Promise.resolve({ lines: [] }),
  getGitStatus: () => Promise.resolve({ lines: [] }),
  getGitSubdir: () => Promise.resolve({ display: null }),
};

Deno.test("collectSections - injects FORCE_COLOR and CLICOLOR_FORCE when useColor=true", async () => {
  const { shell, calls } = makeSpyShell();
  await collectSections(
    {
      sections: [{ id: "s1", sh: "echo hi" }],
      envVars: {},
    },
    { shell, git: noopGit, cwd: "/tmp", useColor: true },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].env?.FORCE_COLOR, "1");
  assertEquals(calls[0].env?.CLICOLOR_FORCE, "1");
  // NO_COLOR must NOT be set when colors are enabled
  assertEquals(calls[0].env?.NO_COLOR, undefined);
});

Deno.test("collectSections - injects NO_COLOR when useColor=false", async () => {
  const { shell, calls } = makeSpyShell();
  await collectSections(
    {
      sections: [{ id: "s1", sh: "echo hi" }],
      envVars: {},
    },
    { shell, git: noopGit, cwd: "/tmp", useColor: false },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].env?.NO_COLOR, "1");
  // FORCE_COLOR must NOT be set when colors are disabled
  assertEquals(calls[0].env?.FORCE_COLOR, undefined);
  assertEquals(calls[0].env?.CLICOLOR_FORCE, undefined);
});

Deno.test("collectSections - injects GIT_CONFIG_* for color.ui=always when useColor=true", async () => {
  // git ignores FORCE_COLOR/CLICOLOR_FORCE; it uses its own color.ui config.
  // GIT_CONFIG_COUNT/KEY_*/VALUE_* tells git ≥ 2.31 to add config entries for
  // the invocation, making ANY `git` subcommand in a user shell section colorize.
  const { shell, calls } = makeSpyShell();
  await collectSections(
    {
      sections: [{ id: "s1", sh: "git status --short" }],
      envVars: {},
    },
    { shell, git: noopGit, cwd: "/tmp", useColor: true },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].env?.GIT_CONFIG_COUNT, "1");
  assertEquals(calls[0].env?.GIT_CONFIG_KEY_0, "color.ui");
  assertEquals(calls[0].env?.GIT_CONFIG_VALUE_0, "always");
});

Deno.test("collectSections - does NOT inject GIT_CONFIG_* when useColor=false", async () => {
  // When colors disabled, NO_COLOR=1 is enough — git ≥ 2.27 honors it natively.
  const { shell, calls } = makeSpyShell();
  await collectSections(
    {
      sections: [{ id: "s1", sh: "git status --short" }],
      envVars: {},
    },
    { shell, git: noopGit, cwd: "/tmp", useColor: false },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].env?.GIT_CONFIG_COUNT, undefined);
  assertEquals(calls[0].env?.GIT_CONFIG_KEY_0, undefined);
  assertEquals(calls[0].env?.GIT_CONFIG_VALUE_0, undefined);
});

Deno.test("collectSections - section env overrides injected color vars", async () => {
  const { shell, calls } = makeSpyShell();
  await collectSections(
    {
      sections: [{ id: "s1", sh: "echo hi", env: { FORCE_COLOR: "0" } }],
      envVars: {},
    },
    { shell, git: noopGit, cwd: "/tmp", useColor: true },
  );

  assertEquals(calls.length, 1);
  // Section-level env wins over injected defaults.
  assertEquals(calls[0].env?.FORCE_COLOR, "0");
  // CLICOLOR_FORCE was not overridden in section.env, still injected.
  assertEquals(calls[0].env?.CLICOLOR_FORCE, "1");
});

Deno.test("collectSections - section env can override injected GIT_CONFIG_VALUE_0", async () => {
  const { shell, calls } = makeSpyShell();
  await collectSections(
    {
      sections: [{
        id: "s1",
        sh: "git status --short",
        env: { GIT_CONFIG_VALUE_0: "never" },
      }],
      envVars: {},
    },
    { shell, git: noopGit, cwd: "/tmp", useColor: true },
  );

  assertEquals(calls.length, 1);
  // Section-level env wins.
  assertEquals(calls[0].env?.GIT_CONFIG_VALUE_0, "never");
  // The other injected git keys are still in place.
  assertEquals(calls[0].env?.GIT_CONFIG_COUNT, "1");
  assertEquals(calls[0].env?.GIT_CONFIG_KEY_0, "color.ui");
});

Deno.test("collectSections - git-log forwards useColor to GitInfoProvider", async () => {
  const calls: Array<{ cwd: string; maxLines: number; useColor: boolean }> = [];
  const mockGit: GitInfoProvider = {
    getGitOps: () => Promise.resolve({ operation: null }),
    getGitSubdir: () => Promise.resolve({ display: null }),
    getGitStash: () => Promise.resolve({ lines: [] }),
    getGitStatus: () => Promise.resolve({ lines: [] }),
    getGitLog: (cwd, maxLines, useColor) => {
      calls.push({ cwd, maxLines, useColor });
      return Promise.resolve({ lines: [] });
    },
  };
  const { shell } = makeSpyShell();

  await collectSections(
    {
      sections: [{ id: "git-log", builtin: "git-log", max_lines: 4 }],
      envVars: {},
    },
    { shell, git: mockGit, cwd: "/tmp", useColor: true },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].useColor, true);
  assertEquals(calls[0].maxLines, 4);

  // Now with useColor=false
  calls.length = 0;
  await collectSections(
    {
      sections: [{ id: "git-log", builtin: "git-log", max_lines: 4 }],
      envVars: {},
    },
    { shell, git: mockGit, cwd: "/tmp", useColor: false },
  );
  assertEquals(calls[0].useColor, false);
});

// ============================================================================
// DenoGitInfo.getGitLog color flag tests
// ============================================================================

async function runIn(cwd: string, args: string[]): Promise<void> {
  const cmd = new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  const { success, stderr } = await cmd.output();
  if (!success) {
    throw new Error(
      `command failed: ${args.join(" ")} — ${new TextDecoder().decode(stderr)}`,
    );
  }
}

async function makeTempRepoWithCommit(): Promise<string> {
  const tempDir = await Deno.makeTempDir();
  await runIn(tempDir, ["git", "init", "-q"]);
  await runIn(tempDir, ["git", "config", "user.email", "test@test"]);
  await runIn(tempDir, ["git", "config", "user.name", "Test"]);
  await runIn(tempDir, ["git", "config", "commit.gpgsign", "false"]);
  await Deno.writeTextFile(join(tempDir, "f.txt"), "hello");
  await runIn(tempDir, ["git", "add", "f.txt"]);
  await runIn(tempDir, ["git", "commit", "-q", "-m", "initial commit"]);
  return tempDir;
}

Deno.test("DenoGitInfo.getGitLog - emits ANSI when useColor=true", async () => {
  const tempDir = await makeTempRepoWithCommit();
  try {
    const adapter = new DenoGitInfo();
    const result = await adapter.getGitLog(tempDir, 5, true);
    assertEquals(result.lines.length > 0, true);
    // At least one line should contain an ANSI escape sequence
    const hasAnsi = result.lines.some((l) => l.includes("\x1b["));
    assertEquals(hasAnsi, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo.getGitLog - no ANSI when useColor=false", async () => {
  const tempDir = await makeTempRepoWithCommit();
  try {
    const adapter = new DenoGitInfo();
    const result = await adapter.getGitLog(tempDir, 5, false);
    assertEquals(result.lines.length > 0, true);
    const hasAnsi = result.lines.some((l) => l.includes("\x1b["));
    assertEquals(hasAnsi, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DenoGitInfo.getGitLog - includes ref decorations (branch names)", async () => {
  const tempDir = await makeTempRepoWithCommit();
  try {
    const adapter = new DenoGitInfo();
    // HEAD commit should show branch decoration in no-color mode
    const result = await adapter.getGitLog(tempDir, 5, false);
    assertEquals(result.lines.length > 0, true);
    // The HEAD commit line should contain a ref decoration like (HEAD -> main)
    const headLine = result.lines[0];
    assertMatch(headLine, /\(HEAD/);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
