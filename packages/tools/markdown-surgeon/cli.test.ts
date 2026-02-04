import { assertEquals, assertStringIncludes } from "@std/assert";
import { MdError } from "./types.ts";
import { main } from "./cli.ts";

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

Deno.test("md meta --aggregate - aggregates unique tags from multiple files", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [bar, baz]\n---\n# File 2`);
  const file3 = await createTempFile(`---\ntags: [qux]\n---\n# File 3`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2, file3])
    );
    const lines = output.trim().split("\n").sort();
    assertEquals(lines, ["bar", "baz", "foo", "qux"]);
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

Deno.test("md meta --aggregate - aggregates multiple fields", async () => {
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
    const lines = output.trim().split("\n").sort();
    assertEquals(lines, ["bar", "foo", "science", "tech"]);
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("md meta --aggregate --json - outputs JSON array", async () => {
  const file1 = await createTempFile(`---\ntags: [foo, bar]\n---\n# File 1`);
  const file2 = await createTempFile(`---\ntags: [baz]\n---\n# File 2`);
  try {
    const output = await captureOutput(() =>
      main(["meta", "--aggregate", "tags", file1, file2, "--json"])
    );
    const values = JSON.parse(output);
    assertEquals(Array.isArray(values), true);
    assertEquals(values.sort(), ["bar", "baz", "foo"]);
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
    const lines = output.trim().split("\n").sort();
    assertEquals(lines, ["bar", "foo"]);
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
    const lines = output.trim().split("\n");
    assertEquals(lines, ["foo"]);
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
    const lines = output.trim().split("\n").sort();
    assertEquals(lines, ["array-tag", "single-tag"]);
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
    const lines = output.trim().split("\n").sort();
    assertEquals(lines, ["bar", "foo"]);
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
    const lines = output.trim().split("\n").sort();
    assertEquals(lines, ["bar", "foo"]);
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
