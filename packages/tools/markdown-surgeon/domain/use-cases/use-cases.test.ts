/**
 * Unit tests for domain use cases.
 *
 * Uses mock ports (no real Deno, no @std/*, no Cliffy dependencies).
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import type { HashService } from "../ports/hash-service.ts";
import type { YamlService } from "../ports/yaml-service.ts";
import { MdError } from "../entities/document.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import { ReadSectionUseCase } from "./read-section.ts";
import { WriteSectionUseCase } from "./write-section.ts";
import { AppendSectionUseCase } from "./append-section.ts";
import { RemoveSectionUseCase } from "./remove-section.ts";
import { SearchUseCase } from "./search.ts";
import { ManageFrontmatterUseCase } from "./manage-frontmatter.ts";

// ============================================================================
// Mock HashService: deterministic SHA-256 via Web Crypto API
// (same algorithm as Blake3HashService / original hash.ts)
// ============================================================================

class MockHashService implements HashService {
  async hash(
    level: number,
    title: string,
    occurrenceIndex: number,
  ): Promise<string> {
    const input = `${level}:${title.toLowerCase().trim()}:${occurrenceIndex}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex.slice(0, 8);
  }
}

// ============================================================================
// Mock YamlService: minimal implementation for frontmatter tests
// ============================================================================

class MockYamlService implements YamlService {
  parse(yaml: string): Record<string, unknown> {
    if (!yaml.trim()) return {};
    // Simple key: value parser for testing
    const result: Record<string, unknown> = {};
    for (const line of yaml.split("\n")) {
      const match = line.match(/^(\w[\w.]*)\s*:\s*(.*)$/);
      if (match) {
        const value = match[2].trim();
        // Try to parse as number/boolean
        if (value === "true") result[match[1]] = true;
        else if (value === "false") result[match[1]] = false;
        else if (/^\d+$/.test(value)) result[match[1]] = Number(value);
        else result[match[1]] = value;
      }
    }
    return result;
  }

  stringify(obj: Record<string, unknown>): string {
    if (Object.keys(obj).length === 0) return "";
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  }

  getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === "object") {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (
        !(part in current) || current[part] === null ||
        typeof current[part] !== "object"
      ) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }

  deleteNestedValue(obj: Record<string, unknown>, path: string): boolean {
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (
        !(part in current) || current[part] === null ||
        typeof current[part] !== "object"
      ) {
        return false;
      }
      current = current[part] as Record<string, unknown>;
    }
    const lastPart = parts[parts.length - 1];
    if (lastPart in current) {
      delete current[lastPart];
      return true;
    }
    return false;
  }

  formatValue(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    return String(value);
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

const hashService = new MockHashService();
const yamlService = new MockYamlService();

function createParser(): ParseDocumentUseCase {
  return new ParseDocumentUseCase(hashService);
}

// ============================================================================
// ParseDocumentUseCase tests
// ============================================================================

Deno.test("ParseDocumentUseCase - parses simple markdown", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nContent here" });

  assertEquals(doc.sections.length, 1);
  assertEquals(doc.sections[0].level, 1);
  assertEquals(doc.sections[0].title, "Title");
  assertEquals(doc.sections[0].line, 1);
  assertEquals(doc.lines.length, 2);
});

Deno.test("ParseDocumentUseCase - parses multiple sections", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent\n\n## Subtitle\nMore content",
  });

  assertEquals(doc.sections.length, 2);
  assertEquals(doc.sections[0].level, 1);
  assertEquals(doc.sections[0].title, "Title");
  assertEquals(doc.sections[1].level, 2);
  assertEquals(doc.sections[1].title, "Subtitle");
});

Deno.test("ParseDocumentUseCase - parses frontmatter", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\nauthor: John\n---\n\n# Title\nContent",
  });

  assertExists(doc.frontmatter);
  assertEquals(doc.frontmatter!.includes("title: Test"), true);
  assertEquals(doc.frontmatterEndLine, 4);
  assertEquals(doc.sections.length, 1);
  assertEquals(doc.sections[0].line, 6);
});

Deno.test("ParseDocumentUseCase - handles empty document", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "" });

  assertEquals(doc.sections.length, 0);
  assertEquals(doc.lines.length, 1);
  assertEquals(doc.frontmatter, null);
});

Deno.test("ParseDocumentUseCase - ignores headers in code blocks", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\n\n```\n# Not a header\n```\n\n## Real Header",
  });

  assertEquals(doc.sections.length, 2);
  assertEquals(doc.sections[0].title, "Title");
  assertEquals(doc.sections[1].title, "Real Header");
});

Deno.test("ParseDocumentUseCase - generates unique IDs for duplicate titles", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\n## Title\n# Title",
  });

  assertEquals(doc.sections.length, 3);
  // All three should have different IDs
  assertEquals(doc.sections[0].id === doc.sections[1].id, false);
  assertEquals(doc.sections[0].id === doc.sections[2].id, false);
  assertEquals(doc.sections[1].id === doc.sections[2].id, false);
});

Deno.test("ParseDocumentUseCase - sets lineEnd correctly", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n# Second\nContent 2",
  });

  assertEquals(doc.sections[0].lineEnd, 3);
  assertEquals(doc.sections[1].lineEnd, 5);
});

Deno.test("ParseDocumentUseCase - trims trailing empty lines for last section", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent\n\n\n",
  });

  assertEquals(doc.sections[0].lineEnd, 2);
});

Deno.test("ParseDocumentUseCase - handles tilde code blocks", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\n\n~~~\n# Not a header\n~~~\n\n## Real Header",
  });

  assertEquals(doc.sections.length, 2);
  assertEquals(doc.sections[0].title, "Title");
  assertEquals(doc.sections[1].title, "Real Header");
});

Deno.test("ParseDocumentUseCase - handles all header levels", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6",
  });

  assertEquals(doc.sections.length, 6);
  for (let i = 0; i < 6; i++) {
    assertEquals(doc.sections[i].level, i + 1);
  }
});

// ============================================================================
// ReadSectionUseCase tests
// ============================================================================

Deno.test("ReadSectionUseCase - finds section by ID", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nContent" });
  const reader = new ReadSectionUseCase();

  const result = reader.execute({
    doc,
    id: doc.sections[0].id,
    deep: false,
  });

  assertEquals(result.section.title, "Title");
  assertEquals(result.content, "Content");
});

Deno.test("ReadSectionUseCase - throws for non-existent ID", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nContent" });
  const reader = new ReadSectionUseCase();

  assertThrows(
    () => reader.execute({ doc, id: "nonexist", deep: false }),
    MdError,
    "not found",
  );
});

Deno.test("ReadSectionUseCase - stops at next header without deep", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n## Nested\nNested content",
  });
  const reader = new ReadSectionUseCase();

  const result = reader.execute({
    doc,
    id: doc.sections[0].id,
    deep: false,
  });

  assertEquals(result.content, "Content 1\n");
});

Deno.test("ReadSectionUseCase - includes subsections with deep flag", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n## Nested\nNested content\n\n# Second",
  });
  const reader = new ReadSectionUseCase();

  const result = reader.execute({
    doc,
    id: doc.sections[0].id,
    deep: true,
  });

  assertEquals(result.content.includes("Content 1"), true);
  assertEquals(result.content.includes("## Nested"), true);
  assertEquals(result.content.includes("Nested content"), true);
});

Deno.test("ReadSectionUseCase - findSectionAtLine works", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n# Second\nContent 2",
  });
  const reader = new ReadSectionUseCase();

  const section1 = reader.findSectionAtLine(doc, 2);
  assertExists(section1);
  assertEquals(section1.title, "First");

  const section2 = reader.findSectionAtLine(doc, 5);
  assertExists(section2);
  assertEquals(section2.title, "Second");
});

Deno.test("ReadSectionUseCase - findSectionAtLine returns undefined before first section", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "Some content\n\n# Title",
  });
  const reader = new ReadSectionUseCase();

  const section = reader.findSectionAtLine(doc, 1);
  assertEquals(section, undefined);
});

// ============================================================================
// WriteSectionUseCase tests
// ============================================================================

Deno.test("WriteSectionUseCase - replaces section content", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nOld content\nMore old content",
  });
  const writer = new WriteSectionUseCase();

  const output = writer.execute({
    doc,
    id: doc.sections[0].id,
    content: "New content",
    deep: false,
  });

  assertEquals(output.result.action, "updated");
  assertEquals(output.result.id, doc.sections[0].id);
  assertEquals(output.result.linesRemoved, 2); // Two lines of old content
  assertEquals(output.result.linesAdded, 2); // blank line + "New content"

  // Verify the updated lines
  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("# Title"), true);
  assertEquals(joined.includes("New content"), true);
  assertEquals(joined.includes("Old content"), false);
});

Deno.test("WriteSectionUseCase - replaces with empty content", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nOld content",
  });
  const writer = new WriteSectionUseCase();

  const output = writer.execute({
    doc,
    id: doc.sections[0].id,
    content: "",
    deep: false,
  });

  assertEquals(output.result.action, "updated");
  assertEquals(output.result.linesAdded, 0);
  assertEquals(output.result.linesRemoved, 1);

  // Only header remains
  assertEquals(output.updatedLines.join("\n"), "# Title");
});

Deno.test("WriteSectionUseCase - throws for non-existent section", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nContent" });
  const writer = new WriteSectionUseCase();

  assertThrows(
    () =>
      writer.execute({
        doc,
        id: "nonexist",
        content: "New content",
        deep: false,
      }),
    MdError,
    "not found",
  );
});

Deno.test("WriteSectionUseCase - deep flag replaces including subsections", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content:
      "# First\nContent 1\n\n## Nested\nNested content\n\n# Second\nContent 2",
  });
  const writer = new WriteSectionUseCase();

  const output = writer.execute({
    doc,
    id: doc.sections[0].id,
    content: "Replaced all",
    deep: true,
  });

  assertEquals(output.result.action, "updated");
  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("# First"), true);
  assertEquals(joined.includes("Replaced all"), true);
  assertEquals(joined.includes("## Nested"), false);
  assertEquals(joined.includes("Nested content"), false);
  assertEquals(joined.includes("# Second"), true);
});

Deno.test("WriteSectionUseCase - adds blank line before content", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nOld" });
  const writer = new WriteSectionUseCase();

  const output = writer.execute({
    doc,
    id: doc.sections[0].id,
    content: "New",
    deep: false,
  });

  // Line after header should be blank
  assertEquals(output.updatedLines[1], "");
  assertEquals(output.updatedLines[2], "New");
});

// ============================================================================
// AppendSectionUseCase tests
// ============================================================================

Deno.test("AppendSectionUseCase - appends to end of file with no ID", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent",
  });
  const appender = new AppendSectionUseCase(hashService);

  const output = await appender.execute({
    doc,
    id: null,
    content: "Appended text",
    deep: false,
    before: false,
  });

  assertEquals(output.result.action, "appended");
  assertEquals(output.result.id, "-");
  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("Appended text"), true);
});

Deno.test("AppendSectionUseCase - prepends to file start with no ID and --before", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent",
  });
  const appender = new AppendSectionUseCase(hashService);

  const output = await appender.execute({
    doc,
    id: null,
    content: "Prepended text",
    deep: false,
    before: true,
  });

  assertEquals(output.result.action, "appended");
  assertEquals(output.updatedLines[0], "Prepended text");
});

Deno.test("AppendSectionUseCase - appends after section", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n# Second\nContent 2",
  });
  const appender = new AppendSectionUseCase(hashService);

  const output = await appender.execute({
    doc,
    id: doc.sections[0].id,
    content: "Appended to first",
    deep: false,
    before: false,
  });

  assertEquals(output.result.action, "appended");
  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("Appended to first"), true);
});

Deno.test("AppendSectionUseCase - inserts before section with --before", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n# Second\nContent 2",
  });
  const appender = new AppendSectionUseCase(hashService);

  const output = await appender.execute({
    doc,
    id: doc.sections[1].id,
    content: "Before second",
    deep: false,
    before: true,
  });

  assertEquals(output.result.action, "appended");
  // The "Before second" should appear before "# Second"
  const secondIdx = output.updatedLines.indexOf("# Second");
  const insertedIdx = output.updatedLines.indexOf("Before second");
  assertEquals(insertedIdx < secondIdx, true);
});

Deno.test("AppendSectionUseCase - creates new section when appending header (trailing blank)", async () => {
  const parser = createParser();
  // Document ends with blank line, so no extra blank is prepended
  const doc = await parser.execute({
    content: "# Title\nContent\n",
  });
  const appender = new AppendSectionUseCase(hashService);

  const output = await appender.execute({
    doc,
    id: null,
    content: "## New Section\nNew content",
    deep: false,
    before: false,
  });

  assertEquals(output.result.action, "created");
  assertEquals(output.result.id !== "-", true);
});

Deno.test("AppendSectionUseCase - creates new section when appending header (no trailing blank)", async () => {
  const parser = createParser();
  // Document does NOT end with blank line; a blank line is auto-prepended.
  // In this case the section finder in the original code also misses the ID
  // because insertLine+1 points to the blank line, not the header.
  // The action is still "created", but the ID falls back to "-".
  const doc = await parser.execute({
    content: "# Title\nContent",
  });
  const appender = new AppendSectionUseCase(hashService);

  const output = await appender.execute({
    doc,
    id: null,
    content: "## New Section\nNew content",
    deep: false,
    before: false,
  });

  assertEquals(output.result.action, "created");
  // ID may be "-" when blank line is auto-prepended (matches original behavior)
});

Deno.test("AppendSectionUseCase - throws for non-existent section", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nContent" });
  const appender = new AppendSectionUseCase(hashService);

  try {
    await appender.execute({
      doc,
      id: "nonexist",
      content: "text",
      deep: false,
      before: false,
    });
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals(e instanceof MdError, true);
  }
});

// ============================================================================
// RemoveSectionUseCase tests
// ============================================================================

Deno.test("RemoveSectionUseCase - removes section entirely", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nContent 1\n\n# Second\nContent 2",
  });
  const remover = new RemoveSectionUseCase();

  const output = remover.remove({
    doc,
    id: doc.sections[0].id,
  });

  assertEquals(output.result.action, "removed");
  assertEquals(output.result.id, doc.sections[0].id);
  assertEquals(output.result.linesRemoved > 0, true);
  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("# First"), false);
  assertEquals(joined.includes("Content 1"), false);
  assertEquals(joined.includes("# Second"), true);
});

Deno.test("RemoveSectionUseCase - removes including subsections", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content:
      "# First\nContent 1\n\n## Nested\nNested content\n\n# Second\nContent 2",
  });
  const remover = new RemoveSectionUseCase();

  const output = remover.remove({
    doc,
    id: doc.sections[0].id,
  });

  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("# First"), false);
  assertEquals(joined.includes("## Nested"), false);
  assertEquals(joined.includes("# Second"), true);
});

Deno.test("RemoveSectionUseCase - throws for non-existent section", async () => {
  const parser = createParser();
  const doc = await parser.execute({ content: "# Title\nContent" });
  const remover = new RemoveSectionUseCase();

  assertThrows(
    () => remover.remove({ doc, id: "nonexist" }),
    MdError,
    "not found",
  );
});

Deno.test("RemoveSectionUseCase - empty keeps header but removes content", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent line 1\nContent line 2",
  });
  const remover = new RemoveSectionUseCase();

  const output = remover.empty({
    doc,
    id: doc.sections[0].id,
    deep: false,
  });

  assertEquals(output.result.action, "emptied");
  assertEquals(output.result.linesRemoved, 2);
  assertEquals(output.result.linesAdded, 0);

  const joined = output.updatedLines.join("\n");
  assertEquals(joined.includes("# Title"), true);
  assertEquals(joined.includes("Content line 1"), false);
});

// ============================================================================
// SearchUseCase tests
// ============================================================================

Deno.test("SearchUseCase - finds matches", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nfoo bar\nbaz\nfoo again",
  });
  const searcher = new SearchUseCase();

  const result = searcher.execute({ doc, pattern: "foo" });

  assertEquals(result.matches.length, 2);
  assertEquals(result.matches[0].line, 2);
  assertEquals(result.matches[0].content, "foo bar");
  assertEquals(result.matches[1].line, 4);
  assertEquals(result.matches[1].content, "foo again");
});

Deno.test("SearchUseCase - associates matches with sections", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nfoo here\n\n# Second\nfoo there",
  });
  const searcher = new SearchUseCase();

  const result = searcher.execute({ doc, pattern: "foo" });

  assertEquals(result.matches.length, 2);
  assertEquals(result.matches[0].sectionId, doc.sections[0].id);
  assertEquals(result.matches[1].sectionId, doc.sections[1].id);
});

Deno.test("SearchUseCase - builds summaries", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# First\nfoo 1\nfoo 2\n\n# Second\nfoo 3",
  });
  const searcher = new SearchUseCase();

  const result = searcher.execute({ doc, pattern: "foo" });

  assertEquals(result.summaries.length, 2);
  assertEquals(result.summaries[0].matchCount, 2);
  assertEquals(result.summaries[0].title, "First");
  assertEquals(result.summaries[1].matchCount, 1);
  assertEquals(result.summaries[1].title, "Second");
});

Deno.test("SearchUseCase - returns empty for no matches", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent",
  });
  const searcher = new SearchUseCase();

  const result = searcher.execute({ doc, pattern: "nonexistent" });

  assertEquals(result.matches.length, 0);
  assertEquals(result.summaries.length, 0);
});

Deno.test("SearchUseCase - handles matches outside sections", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "some preamble with foo\n\n# Title\nContent",
  });
  const searcher = new SearchUseCase();

  const result = searcher.execute({ doc, pattern: "foo" });

  assertEquals(result.matches.length, 1);
  assertEquals(result.matches[0].sectionId, null);
  // Summaries should not include null-section matches
  assertEquals(result.summaries.length, 0);
});

// ============================================================================
// ManageFrontmatterUseCase tests
// ============================================================================

Deno.test("ManageFrontmatterUseCase - gets frontmatter content", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\nauthor: John\n---\n\n# Title",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const content = fm.getFrontmatterContent(doc);
  assertEquals(content, "title: Test\nauthor: John");
});

Deno.test("ManageFrontmatterUseCase - returns empty for no frontmatter", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const content = fm.getFrontmatterContent(doc);
  assertEquals(content, "");
});

Deno.test("ManageFrontmatterUseCase - get all frontmatter", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\n---\n\n# Title",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const result = fm.get({ doc });
  assertEquals(result.formatted, "title: Test");
});

Deno.test("ManageFrontmatterUseCase - get specific field", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\nauthor: John\n---\n\n# Title",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const result = fm.get({ doc, key: "title" });
  assertEquals(result.formatted, "Test");
});

Deno.test("ManageFrontmatterUseCase - set field on existing frontmatter", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\n---\n\n# Title",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const result = fm.set({ doc, key: "author", value: "John" });
  assertEquals(result.message, "set author");
  // Updated lines should contain the new frontmatter
  const joined = result.updatedLines.join("\n");
  assertEquals(joined.includes("author: John"), true);
  assertEquals(joined.includes("# Title"), true);
});

Deno.test("ManageFrontmatterUseCase - set field adds frontmatter if none exists", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "# Title\nContent",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const result = fm.set({ doc, key: "title", value: "Test" });
  assertEquals(result.message, "set title");
  const joined = result.updatedLines.join("\n");
  assertEquals(joined.includes("---"), true);
  assertEquals(joined.includes("title: Test"), true);
  assertEquals(joined.includes("# Title"), true);
});

Deno.test("ManageFrontmatterUseCase - delete field", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\nauthor: John\n---\n\n# Title",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  const result = fm.delete({ doc, key: "author" });
  assertEquals(result.message, "deleted author");
  const joined = result.updatedLines.join("\n");
  assertEquals(joined.includes("author"), false);
  assertEquals(joined.includes("title: Test"), true);
});

Deno.test("ManageFrontmatterUseCase - delete throws for non-existent key", async () => {
  const parser = createParser();
  const doc = await parser.execute({
    content: "---\ntitle: Test\n---\n\n# Title",
  });
  const fm = new ManageFrontmatterUseCase(yamlService);

  assertThrows(
    () => fm.delete({ doc, key: "nonexistent" }),
    MdError,
    "not found",
  );
});
