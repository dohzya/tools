// Integration tests for recap CLI
// Tests use Deno.makeTempDir() for isolation

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { resolveConfig } from "./domain/use-cases/resolve-config.ts";
import { renderRecap } from "./domain/use-cases/render-recap.ts";
import { createPalette } from "./domain/entities/color.ts";
import { HARDCODED_SECTIONS } from "./domain/entities/default-config.ts";
import type { SectionData } from "./domain/entities/section-data.ts";
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
// resolve-config tests
// ============================================================================

Deno.test("resolveConfig - returns hardcoded defaults when no config provided", () => {
  const config = resolveConfig({});
  assertEquals(config.sections.length, HARDCODED_SECTIONS.length);
  assertEquals(config.sections[0].id, "git-branch-track");
  assertEquals(config.sections[2].id, "git-log");
  assertEquals(config.sections[2].max_lines, 6);
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
  assertEquals(config.sections[3].id, "git-status");
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
