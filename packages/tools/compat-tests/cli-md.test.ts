import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const CLI_PATH = new URL("../markdown-surgeon/cli.ts", import.meta.url)
  .pathname;

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", CLI_PATH, ...args],
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout, stderr, code } = await cmd.output();
  return {
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    code,
  };
}

function createTempFile(content: string): string {
  const tmpFile = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(tmpFile, content);
  return tmpFile;
}

Deno.test("md: outline command lists sections", async () => {
  const file = createTempFile(`# Section 1\nContent\n## Section 2\nMore`);
  try {
    const result = await runCli(["outline", file]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Section 1");
    assertStringIncludes(result.stdout, "Section 2");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: outline --json outputs valid JSON", async () => {
  const file = createTempFile(`# Section 1\nContent`);
  try {
    const result = await runCli(["outline", file, "--json"]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json), true);
    assertEquals(json[0].title, "Section 1");
    assertEquals(json[0].level, 1);
    assertEquals(typeof json[0].id, "string");
    assertEquals(typeof json[0].line, "number");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: outline --after ID filters sections", async () => {
  const file = createTempFile(`# A\n## B\n## C`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const firstId = sections[0].id;

    const result = await runCli([
      "outline",
      file,
      "--after",
      firstId,
      "--json",
    ]);
    assertEquals(result.code, 0);
    const filtered = JSON.parse(result.stdout);
    assertEquals(filtered.length < sections.length, true);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: outline --last shows only last section", async () => {
  const file = createTempFile(`# A\n## B\n## C`);
  try {
    const result = await runCli(["outline", file, "--last", "--json"]);
    assertEquals(result.code, 0);
    const section = JSON.parse(result.stdout);
    assertEquals(typeof section.id, "string");
    assertEquals(section.title, "C");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: outline --count shows section count", async () => {
  const file = createTempFile(`# A\n## B\n## C`);
  try {
    const result = await runCli(["outline", file, "--count"]);
    assertEquals(result.code, 0);
    assertMatch(result.stdout, /\d+/);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: read command reads section content", async () => {
  const file = createTempFile(`# Test\nSection content here`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["read", file, sectionId]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Section content here");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: read --deep reads section with subsections", async () => {
  const file = createTempFile(`# Test\nContent\n## Sub\nSub content`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["read", "--deep", file, sectionId]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Content");
    assertStringIncludes(result.stdout, "Sub");
    assertStringIncludes(result.stdout, "Sub content");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: read --json outputs valid JSON", async () => {
  const file = createTempFile(`# Test\nContent`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["read", file, sectionId, "--json"]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json.content, "string");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: write command updates section content", async () => {
  const file = createTempFile(`# Test\nOld content`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["write", file, sectionId, "New content"]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "New content");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: write --deep updates section with subsections", async () => {
  const file = createTempFile(`# Test\nContent\n## Sub\nSub content`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli([
      "write",
      "--deep",
      file,
      sectionId,
      "Replaced all",
    ]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "Replaced all");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: write --json outputs mutation result", async () => {
  const file = createTempFile(`# Test\nContent`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli([
      "write",
      file,
      sectionId,
      "New",
      "--json",
    ]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(typeof json.action, "string");
    assertEquals(typeof json.id, "string");
    assertEquals(typeof json.linesAdded, "number");
    assertEquals(typeof json.linesRemoved, "number");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: append command adds content to section", async () => {
  const file = createTempFile(`# Test\nOriginal`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["append", file, sectionId, "Added"]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "Original");
    assertStringIncludes(content, "Added");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: append --before inserts before section", async () => {
  const file = createTempFile(`# Section 1\nContent`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli([
      "append",
      "--before",
      file,
      sectionId,
      "## New Section\nBefore content",
    ]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "New Section");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: append --deep affects subsections", async () => {
  const file = createTempFile(`# Test\nContent\n## Sub\nSub content`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli([
      "append",
      "--deep",
      file,
      sectionId,
      "Appended deep",
    ]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "Appended deep");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: append --json outputs mutation result", async () => {
  const file = createTempFile(`# Test\nOriginal`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli([
      "append",
      file,
      sectionId,
      "Added",
      "--json",
    ]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(json.action, "appended");
    assertEquals(typeof json.id, "string");
    assertEquals(typeof json.linesAdded, "number");
    assertEquals(typeof json.linesRemoved, "number");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: empty command removes section content", async () => {
  const file = createTempFile(`# Test\nContent to remove`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["empty", file, sectionId]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# Test");
    assertEquals(content.includes("Content to remove"), false);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: empty --deep removes all subsection content", async () => {
  const file = createTempFile(`# Test\nContent\n## Sub\nSub content`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["empty", "--deep", file, sectionId]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# Test");
    assertEquals(content.includes("## Sub"), false);
    assertEquals(content.includes("Content"), false);
    assertEquals(content.includes("Sub content"), false);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: empty --json outputs mutation result", async () => {
  const file = createTempFile(`# Test\nContent to remove`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const sectionId = sections[0].id;

    const result = await runCli(["empty", file, sectionId, "--json"]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(json.action, "emptied");
    assertEquals(typeof json.id, "string");
    assertEquals(typeof json.linesAdded, "number");
    assertEquals(typeof json.linesRemoved, "number");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: remove command deletes section", async () => {
  const file = createTempFile(`# Keep\nContent\n# Remove\nThis goes away`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const removeId = sections[1].id;

    const result = await runCli(["remove", file, removeId]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# Keep");
    assertEquals(content.includes("# Remove"), false);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: remove --json outputs mutation result", async () => {
  const file = createTempFile(`# Keep\nContent\n# Remove\nThis goes away`);
  try {
    const outlineResult = await runCli(["outline", file, "--json"]);
    const sections = JSON.parse(outlineResult.stdout);
    const removeId = sections[1].id;

    const result = await runCli(["remove", file, removeId, "--json"]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(json.action, "removed");
    assertEquals(typeof json.id, "string");
    assertEquals(typeof json.linesAdded, "number");
    assertEquals(typeof json.linesRemoved, "number");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: search command finds text in file", async () => {
  const file = createTempFile(`# Test\nSearchable content here`);
  try {
    const result = await runCli(["search", file, "Searchable"]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Searchable content");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: search --summary groups results by section", async () => {
  const file = createTempFile(`# Test\nfoo\n## Sub\nfoo bar`);
  try {
    const result = await runCli(["search", file, "foo", "--summary"]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Test");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: search --json outputs valid JSON", async () => {
  const file = createTempFile(`# Test\nSearchable`);
  try {
    const result = await runCli(["search", file, "Searchable", "--json"]);
    assertEquals(result.code, 0);
    const json = JSON.parse(result.stdout);
    assertEquals(Array.isArray(json), true);
    if (json.length > 0) {
      assertEquals(typeof json[0].line, "number");
      assertEquals(typeof json[0].content, "string");
    }
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: concat command merges files", async () => {
  const file1 = createTempFile(`# File 1\nContent 1`);
  const file2 = createTempFile(`# File 2\nContent 2`);
  try {
    const result = await runCli(["concat", file1, file2]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "File 1");
    assertStringIncludes(result.stdout, "File 2");
  } finally {
    Deno.removeSync(file1);
    Deno.removeSync(file2);
  }
});

Deno.test("md: concat --shift increases header levels", async () => {
  const file1 = createTempFile(`# Header\nContent`);
  const file2 = createTempFile(`# Header 2\nContent 2`);
  try {
    // --shift now requires a value (e.g., --shift 1)
    const result = await runCli(["concat", "--shift", "1", file1, file2]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "## Header");
    assertStringIncludes(result.stdout, "## Header 2");
  } finally {
    Deno.removeSync(file1);
    Deno.removeSync(file2);
  }
});

Deno.test("md: concat --shift=N increases by N levels", async () => {
  const file = createTempFile(`# Header\nContent`);
  try {
    const result = await runCli(["concat", "--shift=2", file]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "### Header");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: meta command shows frontmatter", async () => {
  const file = createTempFile(`---\ntitle: Test\nauthor: Me\n---\n# Content`);
  try {
    const result = await runCli(["meta", file]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "title");
    assertStringIncludes(result.stdout, "Test");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: meta <key> gets specific key", async () => {
  const file = createTempFile(`---\ntitle: Test\n---\n# Content`);
  try {
    const result = await runCli(["meta", file, "title"]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Test");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: meta --set updates frontmatter", async () => {
  const file = createTempFile(`# Content`);
  try {
    const result = await runCli(["meta", file, "--set", "title", "New Title"]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "title: New Title");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: meta --del removes key", async () => {
  const file = createTempFile(`---\ntitle: Test\nauthor: Me\n---\n# Content`);
  try {
    const result = await runCli(["meta", file, "--del", "author"]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertEquals(content.includes("author"), false);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: meta outputs frontmatter as text", async () => {
  const file = createTempFile(`---\ntitle: Test\n---\n# Content`);
  try {
    const result = await runCli(["meta", file]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "title: Test");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: meta --h1 uses H1 as title", async () => {
  const file = createTempFile(`# My Title\nContent`);
  try {
    const result = await runCli(["meta", file, "--h1"]);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.trim(), "My Title");
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: create command creates new file", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const file = join(tmpDir, "new.md");
  try {
    const result = await runCli(["create", file]);
    assertEquals(result.code, 0);

    const exists = await Deno.stat(file).then(() => true).catch(() => false);
    assertEquals(exists, true);
  } finally {
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

Deno.test("md: create --title sets title", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const file = join(tmpDir, "new.md");
  try {
    const result = await runCli(["create", file, "--title", "My Title"]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# My Title");
  } finally {
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

Deno.test("md: create --meta sets metadata", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const file = join(tmpDir, "new.md");
  try {
    const result = await runCli([
      "create",
      file,
      "--meta",
      "author=John",
      "--meta",
      "date=2026-01-23",
    ]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "author: John");
    assertStringIncludes(content, "date:");
    assertStringIncludes(content, "2026-01-23");
  } finally {
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

Deno.test("md: create --force overwrites existing file", async () => {
  const file = createTempFile(`# Existing\nContent`);
  try {
    const result = await runCli([
      "create",
      file,
      "--force",
      "--title",
      "New",
    ]);
    assertEquals(result.code, 0);

    const content = await Deno.readTextFile(file);
    assertStringIncludes(content, "# New");
    assertEquals(content.includes("Existing"), false);
  } finally {
    Deno.removeSync(file);
  }
});

Deno.test("md: error on file_not_found", async () => {
  const result = await runCli(["outline", "/nonexistent/file.md"]);
  assertEquals(result.code !== 0, true);
  assertStringIncludes(result.stderr, "error");
});

Deno.test("md: error on section_not_found", async () => {
  const file = createTempFile(`# Test\nContent`);
  try {
    const result = await runCli(["read", file, "invalid-id"]);
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "error");
  } finally {
    Deno.removeSync(file);
  }
});
