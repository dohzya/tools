import { assertEquals, assertStringIncludes } from "@std/assert";
import { MdError } from "./types.ts";
import { main } from "./cli.ts";
import { ExplicitCast } from "../explicit-cast.ts";

// ============================================================================
// MdError tests
// ============================================================================

Deno.test("MdError - creates error with code and message", () => {
  const error = new MdError("file_not_found", "File not found: test.md");
  assertEquals(error.code, "file_not_found");
  assertEquals(error.message, "File not found: test.md");
  assertEquals(error.name, "MdError");
});

Deno.test("MdError - has correct properties", () => {
  const error = new MdError(
    "section_not_found",
    "No section with id 'abc123' in test.md",
    "test.md",
    "abc123",
  );
  assertEquals(error.code, "section_not_found");
  assertEquals(error.message, "No section with id 'abc123' in test.md");
  assertEquals(error.file, "test.md");
  assertEquals(error.id, "abc123");
});

Deno.test("MdError - format returns human-readable string", () => {
  const error = new MdError("parse_error", "Usage: md outline <file>");
  const formatted = error.format();
  assertStringIncludes(formatted, "parse_error");
  assertStringIncludes(formatted, "Usage: md outline <file>");
});

// ============================================================================
// Helper functions
// ============================================================================

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

async function createTempFile(content: string): Promise<string> {
  const tmpFile = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmpFile, content);
  return tmpFile;
}

// ============================================================================
// CLI agent-instructions command tests
// ============================================================================

Deno.test("md agent-instructions - prints AGENTS.md snippet", async () => {
  const output = await captureOutput(() => main(["agent-instructions"]));

  assertEquals(output.startsWith("##"), false);
  assertEquals(output.includes("editing.\n\n- Outline"), false);
  assertStringIncludes(output, "Markdown Surgeon (`md`):");
  assertStringIncludes(output, "md outline");
  assertStringIncludes(output, "md read");
  assertStringIncludes(output, "md write");
  assertStringIncludes(output, "section IDs");
  assertStringIncludes(output, "md --help");
});

// ============================================================================
// CLI outline command tests
// ============================================================================

Deno.test("md outline - lists sections in a file", async () => {
  const file = await createTempFile(`# Section 1\nContent\n## Section 2\nMore`);
  try {
    const output = await captureOutput(() => main(["outline", file]));
    assertStringIncludes(output, "Section 1");
    assertStringIncludes(output, "Section 2");
    assertStringIncludes(output, "^"); // Section IDs
    assertStringIncludes(output, "L"); // Line numbers
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --json - outputs valid JSON", async () => {
  const file = await createTempFile(`# Test\nContent`);
  try {
    const output = await captureOutput(() => main(["outline", file, "--json"]));
    const sections = JSON.parse(output);
    assertEquals(Array.isArray(sections), true);
    assertEquals(sections.length, 1);
    assertEquals(sections[0].title, "Test");
    assertEquals(sections[0].level, 1);
    assertEquals(typeof sections[0].id, "string");
    assertEquals(typeof sections[0].line, "number");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --mrfi - includes resolvable MRFI references", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const output = await captureOutput(() => main(["outline", file, "--mrfi"]));

    assertStringIncludes(output, "# Installation ^");
    assertEquals(/~[\uAC00-\uB3FF]+/.test(output), true);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --mrfi --format debug - includes debug MRFI references", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--mrfi", "--format", "debug"])
    );

    assertStringIncludes(output, "~{v0;");
    assertStringIncludes(output, "a=install_sdk");
    assertStringIncludes(output, "hh=smh64:");
    assertEquals(output.includes("q=Installation"), false);
    assertEquals(output.includes("/8"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --mrfi --format debug - computes smh64 with SHA-256 feature hashes", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--mrfi", "--format", "debug"])
    );

    assertStringIncludes(output, "hh=smh64:1cfbb49a5e5ddc6b");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --mrfi --format debug - ignores anchors inside fenced code blocks", async () => {
  const file = await createTempFile(
    [
      "# Example",
      "",
      "```markdown",
      "<!-- ^not_real -->",
      "```",
    ].join("\n"),
  );
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--mrfi", "--format", "debug"])
    );

    assertStringIncludes(output, "~{v0;");
    assertEquals(output.includes("a=not_real"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --mrfi --json - includes MRFI references", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--mrfi", "--json"])
    );
    const sections = JSON.parse(output);

    assertEquals(typeof sections[0].mrfi, "string");
    assertEquals(/^~[\uAC00-\uB3FF]+$/.test(sections[0].mrfi), true);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --mrfi --format debug --quote - includes q when explicitly requested", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--mrfi", "--format", "debug", "--quote"])
    );

    assertStringIncludes(output, "q=Installation");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --fuzzy - is not a supported alias", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    let exitCode: number | undefined;
    const originalExit = Deno.exit;
    const originalError = console.error;
    let errorOutput = "";

    Deno.exit = ExplicitCast.from<unknown>((code?: number) => {
      exitCode = code;
      throw new Error("Deno.exit");
    }).dangerousCast<typeof Deno.exit>();
    console.error = (msg: string) => {
      errorOutput += msg;
    };

    try {
      await main(["outline", file, "--fuzzy"]);
    } catch (error) {
      assertEquals(
        ExplicitCast.from<unknown>(error).dangerousCast<Error>().message,
        "Deno.exit",
      );
    } finally {
      Deno.exit = originalExit;
      console.error = originalError;
    }

    assertEquals(exitCode, 2);
    assertStringIncludes(errorOutput, "Unknown option");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --count - shows section count", async () => {
  const file = await createTempFile(`# A\n## B\n## C`);
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--count"])
    );
    assertEquals(output.trim(), "3");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --last - shows only last section", async () => {
  const file = await createTempFile(`# A\n## B\n## C`);
  try {
    const output = await captureOutput(() =>
      main(["outline", file, "--last", "--json"])
    );
    const section = JSON.parse(output);
    assertEquals(section.title, "C");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md outline --after - shows subsections only", async () => {
  const file = await createTempFile(`# Parent\n## Child 1\n## Child 2`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const parentId = sections[0].id;

    const output = await captureOutput(() =>
      main(["outline", file, "--after", parentId, "--json"])
    );
    const filtered = JSON.parse(output);
    assertEquals(filtered.length, 2);
    assertEquals(filtered[0].title, "Child 1");
    assertEquals(filtered[1].title, "Child 2");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI resolve command tests
// ============================================================================

Deno.test("md resolve - resolves a stable anchor to its containing section", async () => {
  const file = await createTempFile(
    [
      "# Installation",
      "",
      "Run the installer.",
      "<!-- ^install_sdk -->",
      "",
      "# Configuration",
      "",
      "Set the option.",
    ].join("\n"),
  );
  try {
    const output = await captureOutput(() =>
      main(["resolve", file, "^install_sdk"])
    );

    assertStringIncludes(output, "^install_sdk exact 1.00 1:1-4:22");
    assertStringIncludes(output, "    # Installation");
    assertStringIncludes(output, "    Run the installer.");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - ignores anchors inside fenced code blocks", async () => {
  const file = await createTempFile(
    [
      "# Example",
      "",
      "```markdown",
      "<!-- ^not_real -->",
      "```",
    ].join("\n"),
  );
  try {
    const output = await captureOutput(() =>
      main(["resolve", file, "^not_real", "--json"])
    );
    const results = JSON.parse(output);

    assertEquals(results[0].status, "not_found");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve --json - resolves multiple references with passages", async () => {
  const file = await createTempFile(
    [
      "# Installation",
      "",
      "Run the installer.",
      "<!-- ^install_sdk -->",
      "",
      "# Configuration",
      "",
      "Set the option.",
    ].join("\n"),
  );
  try {
    const output = await captureOutput(() =>
      main([
        "resolve",
        file,
        "^install_sdk",
        "~{v0;r=6:1-8:16;q=Set%20the%20option.}::Set the option.",
        "--json",
      ])
    );
    const results = JSON.parse(output);

    assertEquals(results.length, 2);
    assertEquals(results[0].ref, "^install_sdk");
    assertEquals(results[0].status, "exact");
    assertStringIncludes(results[0].passage, "# Installation");
    assertEquals(results[1].ref, "~{v0;r=6:1-8:16;q=Set%20the%20option.}");
    assertEquals(results[1].status, "confident");
    assertStringIncludes(results[1].passage, "# Configuration");
    assertEquals("witness" in results[1], false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - uses hh to recover a moved section when range is stale", async () => {
  const originalFile = await createTempFile(
    "# Installation rapide\n\nRun the installer.",
  );
  const movedFile = await createTempFile(
    [
      "# Intro",
      "",
      "Different text.",
      "",
      "# Installation rapide!",
      "",
      "Run the installer.",
    ].join("\n"),
  );
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", originalFile, "--mrfi", "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const mrfi = sections[0].mrfi;

    const output = await captureOutput(() =>
      main(["resolve", movedFile, mrfi])
    );

    assertStringIncludes(output, `${mrfi} confident`);
    assertStringIncludes(output, "5:1-7:19");
    assertStringIncludes(output, "fuzzy heading match");
    assertStringIncludes(output, "    # Installation rapide");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - keeps the last content line from outline section MRFI ranges", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--mrfi", "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const mrfi = sections[0].mrfi;

    const output = await captureOutput(() => main(["resolve", file, mrfi]));

    assertStringIncludes(output, "1:1-3:19");
    assertStringIncludes(output, "    # Installation");
    assertStringIncludes(output, "    Run the installer.");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - accepts compact Hangul MRFI references", async () => {
  const originalFile = await createTempFile(
    "# Installation rapide\n\nRun the installer.",
  );
  const movedFile = await createTempFile(
    [
      "# Intro",
      "",
      "Different text.",
      "",
      "# Installation rapide!",
      "",
      "Run the installer.",
    ].join("\n"),
  );
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", originalFile, "--mrfi", "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const mrfi = sections[0].mrfi;

    assertEquals(/^~[\uAC00-\uB3FF]+$/.test(mrfi), true);

    const output = await captureOutput(() =>
      main(["resolve", movedFile, mrfi])
    );

    assertStringIncludes(output, `${mrfi} confident`);
    assertStringIncludes(output, "5:1-7:19");
    assertStringIncludes(output, "fuzzy heading match");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - does not let a stale range beat exact and context evidence", async () => {
  const originalFile = await createTempFile(
    ["# Section", "", "Alpha", "Target sentence.", "Beta"].join("\n"),
  );
  const editedFile = await createTempFile(
    ["# Section", "", "Alpha", "", "Target sentence.", "Beta"].join("\n"),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "4:1-4:17", "--format", "debug"])
    );

    const output = await captureOutput(() =>
      main(["resolve", editedFile, ref])
    );

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "5:1-5:17");
    assertStringIncludes(output, "exact fragment hash match");
    assertStringIncludes(output, "    Target sentence.");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(editedFile);
  }
});

Deno.test("md resolve - recovers exact hash matches when normalization changes source length", async () => {
  const originalFile = await createTempFile(
    ["# Section", "", "Foo   bar", "end"].join("\n"),
  );
  const editedFile = await createTempFile(
    ["# Section", "", "Foo bar", "end"].join("\n"),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "3:1-3:10", "--format", "debug"])
    );

    const output = await captureOutput(() =>
      main(["resolve", editedFile, ref])
    );

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "3:1-3:8");
    assertStringIncludes(output, "exact fragment hash match");
    assertStringIncludes(output, "    Foo bar");
    assertEquals(output.includes("oo bar\nen"), false);
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(editedFile);
  }
});

Deno.test("md resolve - uses fh to recover a moved exact passage", async () => {
  const originalFile = await createTempFile(
    "# Installation\n\nRun the installer.",
  );
  const movedFile = await createTempFile(
    [
      "# Intro",
      "",
      "Different text.",
      "",
      "# Setup",
      "",
      "Run the installer.",
    ].join("\n"),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "3:1-3:18", "--format", "debug"])
    );

    const output = await captureOutput(() => main(["resolve", movedFile, ref]));

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "7:1-7:18");
    assertStringIncludes(output, "exact fragment hash match");
    assertStringIncludes(output, "    Run the installer");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - uses fh to recover a moved multi-line exact passage", async () => {
  const originalFile = await createTempFile(
    ["# Source", "", "First line", "Second line", "Third line"].join("\n"),
  );
  const movedFile = await createTempFile(
    [
      "# Intro",
      "",
      "Different text.",
      "",
      "# Destination",
      "",
      "First line",
      "Second line",
      "Third line",
    ].join("\n"),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "3:1-5:11", "--format", "debug"])
    );

    const output = await captureOutput(() => main(["resolve", movedFile, ref]));

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "7:1-9:11");
    assertStringIncludes(output, "exact fragment hash match");
    assertStringIncludes(output, "    First line");
    assertStringIncludes(output, "    Third line");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - uses context to disambiguate duplicate exact hash matches", async () => {
  const originalFile = await createTempFile(
    ["before", "Target sentence.", "after"].join("\n"),
  );
  const duplicateFile = await createTempFile(
    [
      "other",
      "Target sentence.",
      "noise",
      "",
      "before",
      "Target sentence.",
      "after",
    ].join(
      "\n",
    ),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "2:1-2:17", "--format", "debug"])
    );

    const output = await captureOutput(() =>
      main(["resolve", duplicateFile, ref])
    );

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "6:1-6:17");
    assertStringIncludes(output, "exact fragment hash match");
    assertStringIncludes(output, "context suffix match");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(duplicateFile);
  }
});

Deno.test("md resolve - uses ctx to recover a changed passage with a different length", async () => {
  const originalFile = await createTempFile(
    ["before", "Alpha", "after"].join("\n"),
  );
  const movedFile = await createTempFile(
    ["intro", "before", "Charlie", "after"].join("\n"),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "2:1-2:6", "--format", "debug"])
    );

    const output = await captureOutput(() => main(["resolve", movedFile, ref]));

    assertStringIncludes(output, `${ref} confident`);
    assertStringIncludes(output, "3:1-3:8");
    assertStringIncludes(output, "context prefix match");
    assertStringIncludes(output, "context suffix match");
    assertStringIncludes(output, "    Charlie");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - uses ctx to recover a changed passage between stable neighbors", async () => {
  const originalFile = await createTempFile(
    ["before", "Alpha", "after"].join("\n"),
  );
  const movedFile = await createTempFile(
    ["intro", "before", "Bravo", "after"].join("\n"),
  );
  try {
    const ref = await captureOutput(() =>
      main(["ref", originalFile, "2:1-2:6", "--format", "debug"])
    );

    const output = await captureOutput(() => main(["resolve", movedFile, ref]));

    assertStringIncludes(output, `${ref} confident`);
    assertStringIncludes(output, "3:1-3:6");
    assertStringIncludes(output, "context suffix match");
    assertStringIncludes(output, "    Bravo");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - uses p to recover a changed passage in the same structural path", async () => {
  const originalFile = await createTempFile(
    ["# Intro", "one", "", "# Target", "Alpha"].join("\n"),
  );
  const movedFile = await createTempFile(
    ["Preface", "more", "", "# Intro", "one", "", "# Target", "Bravo"].join(
      "\n",
    ),
  );
  try {
    const generatedRef = await captureOutput(() =>
      main(["ref", originalFile, "5:1-5:6", "--format", "debug"])
    );
    const path = generatedRef.match(/;p=([^;]+);/)?.[1];
    if (path === undefined) {
      throw new Error(`Expected generated MRFI to include p: ${generatedRef}`);
    }
    const ref = `~{v0;p=${path}}`;

    const output = await captureOutput(() => main(["resolve", movedFile, ref]));

    assertStringIncludes(output, `${ref} confident`);
    assertStringIncludes(output, "8:1-8:6");
    assertStringIncludes(output, "structural path match");
    assertStringIncludes(output, "    Bravo");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - lets a unique MRFI anchor beat stale exact hash evidence", async () => {
  const oldFile = await createTempFile("Duplicate text.");
  const currentFile = await createTempFile(
    [
      "# Old",
      "",
      "Duplicate text.",
      "",
      "# Target",
      "<!-- ^target -->",
      "",
      "Different text.",
    ].join("\n"),
  );
  try {
    const hashRef = await captureOutput(() =>
      main(["ref", oldFile, "1:1-1:16", "--format", "debug"])
    );
    const hash = hashRef.match(/;fh=([^;]+)/)?.[1];
    if (hash === undefined) {
      throw new Error(`Expected generated MRFI to include fh: ${hashRef}`);
    }
    const ref = `~{v0;a=target;fh=${hash}}`;

    const output = await captureOutput(() =>
      main(["resolve", currentFile, ref])
    );

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "MRFI anchor signal");
    assertStringIncludes(output, "5:1-8:16");
    assertStringIncludes(output, "    Different text.");
  } finally {
    await Deno.remove(oldFile);
    await Deno.remove(currentFile);
  }
});

Deno.test("md resolve - treats a valid range as stale when it conflicts with a unique MRFI anchor", async () => {
  const file = await createTempFile(
    [
      "# Old",
      "",
      "Duplicate text.",
      "",
      "# Target",
      "<!-- ^target -->",
      "",
      "Different text.",
    ].join("\n"),
  );
  try {
    const ref = "~{v0;a=target;r=3:1-3:16}";

    const output = await captureOutput(() => main(["resolve", file, ref]));

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "MRFI anchor signal");
    assertStringIncludes(output, "5:1-8:16");
    assertEquals(output.includes("    Duplicate text."), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - uses fh to recover min-profile multi-line passages", async () => {
  const originalFile = await createTempFile(
    ["# Source", "", "First line", "Second line", "Third line"].join("\n"),
  );
  const movedFile = await createTempFile(
    [
      "# Intro",
      "",
      "Other",
      "Other",
      "Other",
      "",
      "First line",
      "Second line",
      "Third line",
    ].join("\n"),
  );
  try {
    const generatedRef = await captureOutput(() =>
      main([
        "ref",
        originalFile,
        "3:1-5:11",
        "--format",
        "debug",
        "--profile",
        "min",
      ])
    );
    const hash = generatedRef.match(/;fh=([^;]+)/)?.[1];
    if (hash === undefined) {
      throw new Error(`Expected generated MRFI to include fh: ${generatedRef}`);
    }
    const ref = `~{v0;r=3:1-5:11;fh=${hash}}`;

    const output = await captureOutput(() => main(["resolve", movedFile, ref]));

    assertStringIncludes(output, `${ref} exact`);
    assertStringIncludes(output, "7:1-9:11");
    assertStringIncludes(output, "exact fragment hash match");
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(movedFile);
  }
});

Deno.test("md resolve - uses comparison-view structural path offsets", async () => {
  const originalFile = await createTempFile(
    ["# Section", "", "Foo   bar", "end"].join("\n"),
  );
  const editedFile = await createTempFile(
    ["# Section", "", "Foo bar", "end"].join("\n"),
  );
  try {
    const generatedRef = await captureOutput(() =>
      main(["ref", originalFile, "3:1-3:10", "--format", "debug"])
    );
    const path = generatedRef.match(/;p=([^;]+);/)?.[1];
    if (path === undefined) {
      throw new Error(`Expected generated MRFI to include p: ${generatedRef}`);
    }
    const ref = `~{v0;p=${path}}`;

    const output = await captureOutput(() =>
      main(["resolve", editedFile, ref])
    );

    assertStringIncludes(output, `${ref} confident`);
    assertStringIncludes(output, "3:1-3:8");
    assertStringIncludes(output, "structural path match");
    assertStringIncludes(output, "    Foo bar");
    assertEquals(output.includes("L3-L4"), false);
    assertEquals(output.includes("    e"), false);
    assertEquals(output.includes("end"), false);
  } finally {
    await Deno.remove(originalFile);
    await Deno.remove(editedFile);
  }
});

Deno.test("md resolve - preserves a compact range selection inside a matching section", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const ref = await captureOutput(() => main(["ref", file, "3:1-3:18"]));

    const output = await captureOutput(() => main(["resolve", file, ref]));

    assertStringIncludes(output, `${ref} confident`);
    assertStringIncludes(output, "3:1-3:18");
    assertStringIncludes(output, "    Run the installer");
    assertEquals(output.includes("    # Installation"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - does not clamp range-only MRFI beyond EOF to the last line", async () => {
  const file = await createTempFile("# Short\n\nOnly content.");
  try {
    const output = await captureOutput(() =>
      main(["resolve", file, "~{v0;r=999:1-999:5}"])
    );

    assertStringIncludes(output, "~{v0;r=999:1-999:5} not_found 0.00");
    assertStringIncludes(output, "range is outside the document");
    assertEquals(output.includes("Only content"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - rejects empty or reversed debug MRFI ranges", async () => {
  const file = await createTempFile("# Short\n\nOnly content.");
  try {
    const emptyOutput = await captureOutput(() =>
      main(["resolve", file, "~{v0;r=1:1-1:1}"])
    );
    const reversedOutput = await captureOutput(() =>
      main(["resolve", file, "~{v0;r=1:5-1:2}"])
    );

    assertStringIncludes(emptyOutput, "~{v0;r=1:1-1:1} invalid 0.00");
    assertStringIncludes(reversedOutput, "~{v0;r=1:5-1:2} invalid 0.00");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - rejects malformed debug MRFI syntax", async () => {
  const file = await createTempFile("# Short\n\nOnly content.");
  try {
    const malformedPercent = await captureOutput(() =>
      main(["resolve", file, "~{v0;q=%ZZ;r=1:1-1:8}"])
    );
    const duplicateField = await captureOutput(() =>
      main(["resolve", file, "~{v0;r=1:1-1:8;r=3:1-3:14}"])
    );
    const requiredExtension = await captureOutput(() =>
      main(["resolve", file, "~{v0;r=1:1-1:8;!profile=custom-mdx}"])
    );

    assertStringIncludes(malformedPercent, "invalid 0.00");
    assertStringIncludes(malformedPercent, "malformed percent-encoding");
    assertStringIncludes(duplicateField, "invalid 0.00");
    assertStringIncludes(duplicateField, "duplicate MRFI field");
    assertStringIncludes(requiredExtension, "invalid 0.00");
    assertStringIncludes(requiredExtension, "unsupported mandatory MRFI field");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve --json - returns invalid results per input for malformed compact MRFI", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    const output = await captureOutput(() =>
      main(["resolve", file, "^missing", "~abc", "--json"])
    );
    const results = JSON.parse(output);

    assertEquals(results.length, 2);
    assertEquals(results[0].ref, "^missing");
    assertEquals(results[0].status, "not_found");
    assertEquals(results[1].ref, "~abc");
    assertEquals(results[1].status, "invalid");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - keeps :: inside debug MRFI values instead of treating it as CLI witness", async () => {
  const file = await createTempFile(
    ["# Installation", "<!-- ^foo::bar -->", "", "Run the installer."].join(
      "\n",
    ),
  );
  try {
    const output = await captureOutput(() =>
      main(["resolve", file, "~{v0;a=foo::bar;r=1:1-4:19}"])
    );

    assertStringIncludes(output, "~{v0;a=foo::bar;r=1:1-4:19} confident");
    assertStringIncludes(output, "^foo::bar");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md resolve - keeps :: inside anchor references rather than treating it as CLI witness", async () => {
  const file = await createTempFile(
    ["# Installation", "<!-- ^foo::bar -->", "", "Run the installer."].join(
      "\n",
    ),
  );
  try {
    const output = await captureOutput(() =>
      main(["resolve", file, "^foo::bar"])
    );

    assertStringIncludes(output, "^foo::bar exact");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI read command tests
// ============================================================================

Deno.test("md read - reads section content", async () => {
  const file = await createTempFile(`# Test\n\nSection content here`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    const output = await captureOutput(() => main(["read", file, sectionId]));
    assertStringIncludes(output, "Section content here");
    assertStringIncludes(output, "# Test");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md read - reads section by heading selector", async () => {
  const file = await createTempFile(`# Intro\n\nNope\n\n## Test\n\nWanted`);
  try {
    const output = await captureOutput(() => main(["read", file, "## Test"]));
    assertStringIncludes(output, "## Test");
    assertStringIncludes(output, "Wanted");
    assertEquals(output.includes("Nope"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md read - errors on ambiguous heading selector", async () => {
  const file = await createTempFile(`# Test\n\nOne\n\n# Test\n\nTwo`);
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  // deno-lint-ignore dz-tools/no-type-assertion
  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    await main(["read", file, "# Test"]);
  } catch (_e) {
    // Expected
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    await Deno.remove(file);
  }

  assertEquals(exitCode, 1);
  assertStringIncludes(errorOutput, "ambiguous_section");
});

Deno.test("md read --deep - includes subsections", async () => {
  const file = await createTempFile(
    `# Parent\n\nContent\n\n## Child\n\nChild content`,
  );
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const parentId = sections[0].id;

    const output = await captureOutput(() =>
      main(["read", file, parentId, "--deep"])
    );
    assertStringIncludes(output, "Content");
    assertStringIncludes(output, "## Child");
    assertStringIncludes(output, "Child content");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md read --json - outputs structured JSON", async () => {
  const file = await createTempFile(`# Test\n\nContent`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    const output = await captureOutput(() =>
      main(["read", file, sectionId, "--json"])
    );
    const result = JSON.parse(output);
    assertEquals(result.title, "Test");
    assertEquals(result.level, 1);
    assertEquals(typeof result.content, "string");
    assertEquals(typeof result.lineStart, "number");
    assertEquals(typeof result.lineEnd, "number");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI ref command tests
// ============================================================================

Deno.test("md ref - generates an MRFI reference from a line-column range", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const output = await captureOutput(() => main(["ref", file, "3:1-3:18"]));

    assertEquals(/^~[\uAC00-\uB3FF]+$/.test(output), true);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md ref --format debug - generates a debug MRFI reference from a line-column range", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const output = await captureOutput(() =>
      main(["ref", file, "3:1-3:18", "--format", "debug"])
    );

    assertEquals(output.startsWith("~{v0;r=3:1-3:18;"), true);
    assertStringIncludes(output, "a=install_sdk");
    assertStringIncludes(output, "p=h1[1]/chars:");
    assertStringIncludes(output, "fh=xxh64:");
    assertStringIncludes(output, "hh=smh64:");
    assertStringIncludes(output, "ctx=pre:");
    assertStringIncludes(output, "suf:");
    assertStringIncludes(output, "doc=smh64:");
    assertEquals(output.includes(";o="), false);
    assertEquals(output.includes(";ph="), false);
    assertEquals(output.includes("q=Run"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md ref --profile min - generates the minimum useful locator fields", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const output = await captureOutput(() =>
      main(["ref", file, "3:1-3:18", "--format", "debug", "--profile", "min"])
    );

    assertStringIncludes(output, "r=3:1-3:18");
    assertStringIncludes(output, "a=install_sdk");
    assertStringIncludes(output, "fh=xxh64:");
    assertStringIncludes(output, "hh=smh64:");
    assertEquals(output.includes(";p="), false);
    assertEquals(output.includes(";ctx="), false);
    assertEquals(output.includes(";ph="), false);
    assertEquals(output.includes(";doc="), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md ref --profile full - generates all supported locator fields", async () => {
  const file = await createTempFile(
    "# Installation\n\nRun the installer.\n<!-- ^install_sdk -->",
  );
  try {
    const output = await captureOutput(() =>
      main(["ref", file, "3:1-3:18", "--format", "debug", "--profile", "full"])
    );

    assertStringIncludes(output, "o=");
    assertStringIncludes(output, "p=h1[1]/chars:");
    assertStringIncludes(output, "fh=xxh64:");
    assertStringIncludes(output, "ph=smh64:");
    assertStringIncludes(output, "ctx=pre:");
    assertStringIncludes(output, "suf:");
    assertStringIncludes(output, "doc=smh64:");
    assertEquals(output.includes("q=Run"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md ref --quote - includes selected text as q", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  try {
    const output = await captureOutput(() =>
      main(["ref", file, "3:1-3:18", "--format", "debug", "--quote"])
    );

    assertStringIncludes(output, "q=Run%20the%20installer");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md ref --quote-max - truncates q with beginning, middle, and end", async () => {
  const file = await createTempFile(
    "# Installation\n\nabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  );
  try {
    const output = await captureOutput(() =>
      main([
        "ref",
        file,
        "3:1-3:63",
        "--format",
        "debug",
        "--quote",
        "--quote-max",
        "24",
      ])
    );

    assertStringIncludes(output, "q=abcdef...234567...UVWXYZ");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md ref --format debug - normalizes a debug MRFI reference", async () => {
  const output = await captureOutput(() =>
    main([
      "ref",
      "~{v0;q=Run%20the%20installer;doc=smh64:2222222222222222;r=3:1-3:18;ctx=suf:SufHash,pre:PreHash;ph=smh64:1111111111111111;p=h1[1]/chars:0-17;fh=sha256:FragHash;hh=smh64:0123456789abcdef;o=24-41}",
      "--format",
      "debug",
    ])
  );

  assertEquals(
    output,
    "~{v0;r=3:1-3:18;o=24-41;p=h1[1]/chars:0-17;fh=sha256:FragHash;hh=smh64:0123456789abcdef;ph=smh64:1111111111111111;ctx=pre:PreHash,suf:SufHash;doc=smh64:2222222222222222;q=Run%20the%20installer}",
  );
});

Deno.test("md ref --format base62 - converts a debug MRFI reference", async () => {
  const output = await captureOutput(() =>
    main([
      "ref",
      "~{v0;r=3:1-3:18;hh=smh64:0123456789abcdef}",
      "--format",
      "base62",
    ])
  );

  assertEquals(/^~[0-9A-Za-z]+$/.test(output), true);
});

Deno.test("md ref --format debug - converts a Hangul MRFI reference", async () => {
  const hangul = await captureOutput(() =>
    main([
      "ref",
      "~{v0;r=3:1-3:18;o=24-41;p=h1[1]/chars:0-17;fh=sha256:FragHash;hh=smh64:0123456789abcdef;ph=smh64:1111111111111111;ctx=pre:PreHash,suf:SufHash;doc=smh64:2222222222222222;q=Run%20the%20installer}",
      "--format",
      "hangul",
    ])
  );

  const debug = await captureOutput(() =>
    main(["ref", hangul, "--format", "debug"])
  );

  assertEquals(
    debug,
    "~{v0;r=3:1-3:18;o=24-41;p=h1[1]/chars:0-17;fh=sha256:FragHash;hh=smh64:0123456789abcdef;ph=smh64:1111111111111111;ctx=pre:PreHash,suf:SufHash;doc=smh64:2222222222222222;q=Run%20the%20installer}",
  );
});

Deno.test("md ref --format debug - preserves unknown fields under their own name", async () => {
  const output = await captureOutput(() =>
    main([
      "ref",
      "~{v0;r=3:1-3:18;_kind=script;_file=foo.md}",
      "--format",
      "debug",
    ])
  );

  assertEquals(output, "~{v0;r=3:1-3:18;_kind=script;_file=foo.md}");
});

Deno.test("md ref --format base62 - preserves named fields through compact conversion", async () => {
  const base62 = await captureOutput(() =>
    main([
      "ref",
      "~{v0;r=3:1-3:18;_kind=script;_file=foo.md}",
      "--format",
      "base62",
    ])
  );

  const debug = await captureOutput(() =>
    main(["ref", base62, "--format", "debug"])
  );

  // Compact form is a canonical CBOR map, sorted by key; extra field order
  // is normalized alphabetically like known fields are normalized to their
  // fixed positions.
  assertEquals(debug, "~{v0;r=3:1-3:18;_file=foo.md;_kind=script}");
});

Deno.test("md ref --format base62 - preserves a preserved field value with characters requiring percent-encoding", async () => {
  const base62 = await captureOutput(() =>
    main([
      "ref",
      "~{v0;r=3:1-3:18;_kind=script%3Bfoo}",
      "--format",
      "base62",
    ])
  );

  const debug = await captureOutput(() =>
    main(["ref", base62, "--format", "debug"])
  );

  assertEquals(debug, "~{v0;r=3:1-3:18;_kind=script%3Bfoo}");
});

Deno.test("md ref - rejects a range outside the document", async () => {
  const file = await createTempFile("# Installation\n\nRun the installer.");
  let exitCode: number | undefined;
  const originalExit = Deno.exit;
  const originalError = console.error;
  let errorOutput = "";

  Deno.exit = ExplicitCast.from<unknown>((code?: number) => {
    exitCode = code;
    throw new Error("Deno.exit");
  }).dangerousCast<typeof Deno.exit>();
  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    await main(["ref", file, "9:1-9:10"]);
  } catch (error) {
    assertEquals(
      ExplicitCast.from<unknown>(error).dangerousCast<Error>().message,
      "Deno.exit",
    );
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    await Deno.remove(file);
  }

  assertEquals(exitCode, 1);
  assertStringIncludes(errorOutput, "invalid_id");
  assertStringIncludes(errorOutput, "Range is outside the document");
});

// ============================================================================
// CLI write command tests
// ============================================================================

Deno.test("md write - updates section content", async () => {
  const file = await createTempFile(`# Test\n\nOld content`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    await main(["write", file, sectionId, "New content"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "New content");
    assertEquals(content.includes("Old content"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md write --json - outputs mutation result", async () => {
  const file = await createTempFile(`# Test\n\nOld content`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    const output = await captureOutput(() =>
      main(["write", file, sectionId, "New content", "--json"])
    );
    const result = JSON.parse(output);
    assertEquals(result.action, "updated");
    assertEquals(result.id, sectionId);
    assertEquals(typeof result.linesAdded, "number");
    assertEquals(typeof result.linesRemoved, "number");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI append command tests
// ============================================================================

Deno.test("md append - adds content to section", async () => {
  const file = await createTempFile(`# Test\n\nOriginal`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    await main(["append", file, sectionId, "Appended"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "Original");
    assertStringIncludes(content, "Appended");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md append - adds content to section by heading selector", async () => {
  const file = await createTempFile(`# One\n\nA\n\n## Two\n\nB`);
  try {
    await main(["append", file, "## Two", "C"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "## Two\n\nB\n\nC");
    assertEquals(content.includes("# One\n\nA\n\nC"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md append --before - inserts before section", async () => {
  const file = await createTempFile(`# Section\n\nContent`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    await main(["append", "--before", file, sectionId, "Before text"]);

    const content = await Deno.readTextFile(file);
    const beforeIndex = content.indexOf("Before text");
    const sectionIndex = content.indexOf("# Section");
    assertEquals(beforeIndex < sectionIndex, true);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md append without ID - appends to end of file", async () => {
  const file = await createTempFile(`# Test\n\nContent`);
  try {
    await main(["append", file, "End of file"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "End of file");
    assertEquals(
      content.endsWith("End of file\n") || content.endsWith("End of file"),
      true,
    );
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md append --before without ID - prepends after frontmatter", async () => {
  const file = await createTempFile(
    `---\ntitle: Test\n---\n\n# Section\n\nContent`,
  );
  try {
    await main(["append", "--before", file, "Prepended"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "Prepended");
    // Should be after frontmatter but before section
    const prependedIndex = content.indexOf("Prepended");
    const frontmatterEndIndex = content.indexOf("---\n\n") + 5;
    assertEquals(prependedIndex >= frontmatterEndIndex, true);
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI empty command tests
// ============================================================================

Deno.test("md empty - removes section content but keeps header", async () => {
  const file = await createTempFile(`# Test\n\nContent to remove`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    await main(["empty", file, sectionId]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# Test");
    assertEquals(content.includes("Content to remove"), false);
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI remove command tests
// ============================================================================

Deno.test("md remove - deletes section entirely", async () => {
  const file = await createTempFile(
    `# Keep\n\nContent\n\n# Remove\n\nTo delete`,
  );
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const removeId = sections[1].id;

    await main(["remove", file, removeId]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# Keep");
    assertEquals(content.includes("# Remove"), false);
    assertEquals(content.includes("To delete"), false);
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI search command tests
// ============================================================================

Deno.test("md search - finds text in file", async () => {
  const file = await createTempFile(`# Test\n\nSearchable content here`);
  try {
    const output = await captureOutput(() =>
      main(["search", file, "Searchable"])
    );
    assertStringIncludes(output, "Searchable content");
    assertStringIncludes(output, "L"); // Line number
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md search --summary - groups by section", async () => {
  const file = await createTempFile(
    `# Section A\n\nfoo bar\n\n# Section B\n\nfoo baz`,
  );
  try {
    const output = await captureOutput(() =>
      main(["search", file, "foo", "--summary"])
    );
    assertStringIncludes(output, "Section A");
    assertStringIncludes(output, "Section B");
    assertStringIncludes(output, "match");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md search --json - outputs JSON array", async () => {
  const file = await createTempFile(`# Test\n\nfoo bar`);
  try {
    const output = await captureOutput(() =>
      main(["search", file, "foo", "--json"])
    );
    const results = JSON.parse(output);
    assertEquals(Array.isArray(results), true);
    assertEquals(results.length, 1);
    assertEquals(typeof results[0].line, "number");
    assertEquals(typeof results[0].content, "string");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI concat command tests
// ============================================================================

Deno.test("md concat - merges multiple files", async () => {
  const file1 = await createTempFile(`# File 1\n\nContent 1`);
  const file2 = await createTempFile(`# File 2\n\nContent 2`);
  try {
    const output = await captureOutput(() => main(["concat", file1, file2]));
    assertStringIncludes(output, "# File 1");
    assertStringIncludes(output, "# File 2");
    assertStringIncludes(output, "Content 1");
    assertStringIncludes(output, "Content 2");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md concat --shift - increases header levels", async () => {
  const file = await createTempFile(`# Header\n\nContent`);
  try {
    const output = await captureOutput(() =>
      main(["concat", "--shift", "1", file])
    );
    assertStringIncludes(output, "## Header");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md concat --shift=2 - increases by 2 levels", async () => {
  const file = await createTempFile(`# Header\n\nContent`);
  try {
    const output = await captureOutput(() =>
      main(["concat", "--shift", "2", file])
    );
    assertStringIncludes(output, "### Header");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI meta command tests
// ============================================================================

Deno.test("md meta - shows all frontmatter", async () => {
  const file = await createTempFile(
    `---\ntitle: Test\nauthor: Me\n---\n\n# Content`,
  );
  try {
    const output = await captureOutput(() => main(["meta", file]));
    assertStringIncludes(output, "title: Test");
    assertStringIncludes(output, "author: Me");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md meta <key> - gets specific key", async () => {
  const file = await createTempFile(`---\ntitle: Test\n---\n\n# Content`);
  try {
    const output = await captureOutput(() => main(["meta", file, "title"]));
    assertEquals(output.trim(), "Test");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md meta --set - sets frontmatter key", async () => {
  const file = await createTempFile(`# Content`);
  try {
    await main(["meta", file, "--set", "title", "New Title"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "---");
    assertStringIncludes(content, "title: New Title");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md meta --del - deletes frontmatter key", async () => {
  const file = await createTempFile(
    `---\ntitle: Test\nauthor: Me\n---\n\n# Content`,
  );
  try {
    await main(["meta", file, "--del", "author"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "title: Test");
    assertEquals(content.includes("author"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md meta --h1 - gets H1 title", async () => {
  const file = await createTempFile(`# My Title\n\nContent`);
  try {
    const output = await captureOutput(() => main(["meta", file, "--h1"]));
    assertEquals(output.trim(), "My Title");
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// CLI meta aggregation tests
// ============================================================================

Deno.test("md meta --aggregate - aggregates unique tags with counts from multiple files", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar, baz]\n---\n# File 2`);
  const file3 = await createTempFile(`---\ntags: [qux]\n---\n# File 3`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2, file3])
    );
    // Now shows counts: "2 bar", "1 foo", "1 baz", "1 qux"
    assertStringIncludes(output, "2 bar");
    assertStringIncludes(output, "1 foo");
    assertStringIncludes(output, "1 baz");
    assertStringIncludes(output, "1 qux");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
    await Deno.remove(file3);
  }
});

Deno.test("md meta --list - aggregates tags with duplicates", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar, baz]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--list", "tags", file1, file2])
    );
    const lines = output.trim().split("\n");
    assertEquals(lines.length, 4); // foo, bar, bar, baz
    assertEquals(lines.filter((l) => l === "bar").length, 2); // bar appears twice
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate - aggregates multiple fields with counts", async () => {
  const file1 = await createTempFile(
    `---\ntags: [foo]\ncategories: [tech]\n---\n# File 1`,
  );
  const file2 = await createTempFile(
    `---\ntags: [bar]\ncategories: [science]\n---\n# File 2`,
  );
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags,categories", file1, file2])
    );
    // Groups by field with counts
    assertStringIncludes(output, "tags:");
    assertStringIncludes(output, "1 foo");
    assertStringIncludes(output, "1 bar");
    assertStringIncludes(output, "categories:");
    assertStringIncludes(output, "1 tech");
    assertStringIncludes(output, "1 science");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate --json - outputs JSON with counts", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [baz]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2, "--json"])
    );
    const counts = JSON.parse(output);
    assertEquals(typeof counts, "object");
    assertEquals(counts.foo, 1);
    assertEquals(counts.bar, 1);
    assertEquals(counts.baz, 1);
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate - skips files without frontmatter", async () => {
  const file1 = await createTempFile(`---\ntags: [foo]\n---\n# File 1`);
  const file2 = await createTempFile(`# File 2 without frontmatter`);
  const file3 = await createTempFile(`---\ntags: [bar]\n---\n# File 3`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2, file3])
    );
    // Now shows counts
    assertStringIncludes(output, "1 foo");
    assertStringIncludes(output, "1 bar");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
    await Deno.remove(file3);
  }
});

Deno.test("md meta --aggregate - skips files where field doesn't exist", async () => {
  const file1 = await createTempFile(`---\ntags: [foo]\n---\n# File 1`);
  const file2 = await createTempFile(
    `---\ncategories: [tech]\n---\n# File 2`,
  );
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2])
    );
    assertEquals(output.trim(), "1 foo");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate - handles non-array values", async () => {
  const file1 = await createTempFile(`---\ntags: single-tag\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [array-tag]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2])
    );
    // Now shows counts
    assertStringIncludes(output, "1 single-tag");
    assertStringIncludes(output, "1 array-tag");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate - works with glob patterns", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const file1 = `${tmpDir}/a.md`;
    const file2 = `${tmpDir}/b.md`;
    await Deno.writeTextFile(file1, `---\ntags: [foo]\n---\n# A`);
    await Deno.writeTextFile(file2, `---\ntags: [bar]\n---\n# B`);

    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", `${tmpDir}/*.md`])
    );
    // Now shows counts
    assertStringIncludes(output, "1 foo");
    assertStringIncludes(output, "1 bar");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("md meta --aggregate - handles nested field access", async () => {
  const file1 = await createTempFile(
    `---\nmeta:\n  tags: [foo]\n---\n# File 1`,
  );
  const file2 = await createTempFile(
    `---\nmeta:\n  tags: [bar]\n---\n# File 2`,
  );
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "meta.tags", file1, file2])
    );
    // Now shows counts
    assertStringIncludes(output, "1 foo");
    assertStringIncludes(output, "1 bar");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate - shows values with counts", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar, baz]\n---\n# File 2`);
  const file3 = await createTempFile(`---\ntags: [foo]\n---\n# File 3`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2, file3])
    );
    // Should show counts in descending order: 2 foo, 2 bar, 1 baz
    assertStringIncludes(output, "2 foo");
    assertStringIncludes(output, "2 bar");
    assertStringIncludes(output, "1 baz");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
    await Deno.remove(file3);
  }
});

Deno.test("md meta --aggregate --json - outputs counts as JSON", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar, baz]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", "--json", file1, file2])
    );
    const result = JSON.parse(output);
    assertEquals(result.foo, 1);
    assertEquals(result.bar, 2);
    assertEquals(result.baz, 1);
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate - groups by field when multiple", async () => {
  const file1 = await createTempFile(
    `---\ntags: [foo]\ncategory: tech\n---\n# File 1`,
  );
  const file2 = await createTempFile(
    `---\ntags: [foo, bar]\ncategory: tech\n---\n# File 2`,
  );
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags,category", file1, file2])
    );
    assertStringIncludes(output, "tags:");
    assertStringIncludes(output, "  2 foo");
    assertStringIncludes(output, "  1 bar");
    assertStringIncludes(output, "category:");
    assertStringIncludes(output, "  2 tech");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --count - shows total count only", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar, baz]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--count", "tags", file1, file2])
    );
    assertEquals(output.trim(), "4"); // foo, bar, bar, baz (total)
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --count --json - outputs total as JSON", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--count", "tags", "--json", file1, file2])
    );
    const result = JSON.parse(output);
    assertEquals(result, 3); // foo, bar, bar
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --count - groups by field when multiple", async () => {
  const file1 = await createTempFile(
    `---\ntags: [foo]\ncategory: tech\n---\n# File 1`,
  );
  const file2 = await createTempFile(
    `---\ntags: [bar]\ncategory: tech\n---\n# File 2`,
  );
  try {
    const output = await captureOutput(() =>
      main(["meta", "--count", "tags,category", file1, file2])
    );
    assertStringIncludes(output, "tags: 2");
    assertStringIncludes(output, "category: 2");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

// ============================================================================
// CLI create command tests
// ============================================================================

Deno.test("md create - creates new file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const file = `${tmpDir}/new.md`;
  try {
    await main(["create", file]);

    const exists = await Deno.stat(file).then(() => true).catch(() => false);
    assertEquals(exists, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("md create --title - sets H1 title", async () => {
  const tmpDir = await Deno.makeTempDir();
  const file = `${tmpDir}/new.md`;
  try {
    await main(["create", file, "--title", "My Document"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# My Document");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("md create --meta - sets frontmatter", async () => {
  const tmpDir = await Deno.makeTempDir();
  const file = `${tmpDir}/new.md`;
  try {
    await main([
      "create",
      file,
      "--meta",
      "author=John",
      "--meta",
      "date=2026-01-23",
    ]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "---");
    assertStringIncludes(content, "author: John");
    assertStringIncludes(content, "date:");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("md create with content - adds initial content", async () => {
  const tmpDir = await Deno.makeTempDir();
  const file = `${tmpDir}/new.md`;
  try {
    await main(["create", file, "--title", "Doc", "Initial content here"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# Doc");
    assertStringIncludes(content, "Initial content here");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("md create --force - overwrites existing file", async () => {
  const file = await createTempFile(`# Old\n\nOld content`);
  try {
    await main(["create", file, "--force", "--title", "New"]);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# New");
    assertEquals(content.includes("Old"), false);
  } finally {
    await Deno.remove(file);
  }
});

// ============================================================================
// Error handling tests
// ============================================================================

Deno.test("md - error on file not found", async () => {
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  // deno-lint-ignore dz-tools/no-type-assertion
  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    await main(["outline", "/nonexistent/path/file.md"]);
  } catch (_e) {
    // Expected
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
  }

  assertEquals(exitCode, 1);
  assertStringIncludes(errorOutput, "file_not_found");
});

Deno.test("md - error on invalid section ID", async () => {
  const file = await createTempFile(`# Test\n\nContent`);
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  // deno-lint-ignore dz-tools/no-type-assertion
  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    await main(["read", file, "notvalid"]);
  } catch (_e) {
    // Expected
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    await Deno.remove(file);
  }

  assertEquals(exitCode, 1);
  assertStringIncludes(errorOutput, "invalid_id");
});

Deno.test("md - error on section not found", async () => {
  const file = await createTempFile(`# Test\n\nContent`);
  const originalExit = Deno.exit;
  const originalError = console.error;
  let exitCode = 0;
  let errorOutput = "";

  // deno-lint-ignore dz-tools/no-type-assertion
  Deno.exit = ((code: number) => {
    exitCode = code;
    throw new Error("EXIT");
  }) as typeof Deno.exit;

  console.error = (msg: string) => {
    errorOutput += msg;
  };

  try {
    await main(["read", file, "00000000"]); // Valid ID format but doesn't exist
  } catch (_e) {
    // Expected
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
    await Deno.remove(file);
  }

  assertEquals(exitCode, 1);
  assertStringIncludes(errorOutput, "section_not_found");
});

// ============================================================================
// Magic expression tests
// ============================================================================

Deno.test("md write - expands {date} magic expression", async () => {
  const file = await createTempFile(`# Test\n\nOld content`);
  try {
    const outlineOutput = await captureOutput(() =>
      main(["outline", file, "--json"])
    );
    const sections = JSON.parse(outlineOutput);
    const sectionId = sections[0].id;

    await main(["write", file, sectionId, "Updated on {date}"]);

    const content = await Deno.readTextFile(file);
    // Should contain a date like 2026-02-04
    const dateMatch = content.match(/\d{4}-\d{2}-\d{2}/);
    assertEquals(dateMatch !== null, true);
    assertEquals(content.includes("{date}"), false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("md meta --set - expands magic expressions", async () => {
  const file = await createTempFile(`# Content`);
  try {
    await main(["meta", file, "--set", "updated", "{dt:short}"]);

    const content = await Deno.readTextFile(file);
    // Should contain a datetime like 2026-02-04 11:30
    const dtMatch = content.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assertEquals(dtMatch !== null, true);
  } finally {
    await Deno.remove(file);
  }
});
