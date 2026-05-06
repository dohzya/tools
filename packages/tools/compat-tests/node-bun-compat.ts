/**
 * Cross-runtime compatibility test for Node.js and Bun.
 *
 * Verifies that the library entrypoints (parser, hash, yaml, types)
 * can be imported and exercised without Deno-specific APIs.
 *
 * Run with:
 *   node --experimental-strip-types packages/tools/compat-tests/node-bun-compat.ts
 *   bun run packages/tools/compat-tests/node-bun-compat.ts
 */

import {
  findSection,
  getSectionEndLine,
  parseDocument,
  serializeDocument,
} from "../markdown-surgeon/parser.ts";
import { sectionHash } from "../markdown-surgeon/hash.ts";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../markdown-surgeon/yaml.ts";
import type { Document, Section } from "../markdown-surgeon/types.ts";
import process from "node:process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    console.error(`FAIL: ${message}`);
  } else {
    passed++;
  }
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    failed++;
    console.error(
      `FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  } else {
    passed++;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SAMPLE_MD = `---
title: Test Document
tags:
  - alpha
  - beta
---
# Section One

Content of section one.

## Subsection A

Nested content.

# Section Two

More content.
`;

// Test: parseDocument
const doc: Document = await parseDocument(SAMPLE_MD);
assert(
  doc.sections.length >= 3,
  "parseDocument should find at least 3 sections",
);
assertEqual(doc.sections[0].title, "Section One", "first section title");
assertEqual(doc.sections[0].level, 1, "first section level");

// Test: findSection
const firstId = doc.sections[0].id;
const found: Section | undefined = findSection(doc, firstId);
assert(found !== undefined, "findSection should locate section by ID");
assertEqual(found?.title, "Section One", "findSection returns correct section");

// Test: getSectionEndLine
const endLine = getSectionEndLine(doc, doc.sections[0], false);
assert(
  typeof endLine === "number" && endLine > doc.sections[0].line,
  "getSectionEndLine returns valid line",
);

// Test: serializeDocument
const serialized = serializeDocument(doc);
assert(
  serialized.includes("# Section One"),
  "serializeDocument preserves content",
);
assert(
  serialized.includes("# Section Two"),
  "serializeDocument preserves all sections",
);

// Test: sectionHash
const hash = await sectionHash(2, "Test Title", 0);
assert(
  typeof hash === "string" && hash.length === 8,
  "sectionHash returns 8-char hex string",
);
// Deterministic: same input => same hash
const hash2 = await sectionHash(2, "Test Title", 0);
assertEqual(hash, hash2, "sectionHash is deterministic");

// Test: parseFrontmatter (takes raw YAML, not full markdown)
const SAMPLE_YAML = `title: Test Document
tags:
  - alpha
  - beta`;
const fm = parseFrontmatter(SAMPLE_YAML);
assertEqual(fm.title, "Test Document", "parseFrontmatter extracts title");
assert(Array.isArray(fm.tags), "parseFrontmatter extracts tags array");
const tags = Array.isArray(fm.tags) ? fm.tags : [];
assertEqual(tags[0], "alpha", "parseFrontmatter first tag");

// Test: stringifyFrontmatter
const yaml = stringifyFrontmatter({ title: "Hello", count: 42 });
assert(yaml.includes("title:"), "stringifyFrontmatter includes keys");
assert(yaml.includes("Hello"), "stringifyFrontmatter includes values");
assert(yaml.includes("42"), "stringifyFrontmatter includes numeric values");

// Test: types are importable (compile-time check — if this file compiles, types work)
const _typeCheck: Document = doc;
const _sectionCheck: Section = doc.sections[0];

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
