/**
 * Unit tests for MrfiAdapter.
 *
 * Proves the wiring between dz-review's ReferenceLocatorService port and
 * markdown-surgeon's MRFI use cases — not a re-test of the resolution
 * algorithm itself (that's covered by
 * markdown-surgeon/domain/use-cases/refresh-reference.test.ts and friends).
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { MrfiAdapter } from "./mrfi-adapter.ts";
import { Blake3HashService } from "../../../markdown-surgeon/adapters/services/blake3-hash.ts";
import { ParseDocumentUseCase } from "../../../markdown-surgeon/domain/use-cases/parse-document.ts";
import type { Document } from "../../domain/ports/reference-locator.ts";

const parseDocument = new ParseDocumentUseCase(new Blake3HashService());

/** Full-line source range for a single 1-indexed line of a parsed document */
function lineRange(doc: Document, line: number) {
  return {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: doc.lines[line - 1].length + 1,
  };
}

Deno.test("MrfiAdapter.generateReference - builds a debug MRFI for a range", async () => {
  const adapter = new MrfiAdapter();
  const content = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
  ].join("\n");
  const doc = await parseDocument.execute({ content });

  const ref = await adapter.generateReference(
    doc,
    lineRange(doc, 7),
    { format: "debug", profile: "full", quote: false, quoteMax: 80 },
  );

  assertEquals(ref.startsWith("~{v0;"), true);
});

Deno.test("MrfiAdapter.resolveReference - resolves a generated reference back to the same range", async () => {
  const adapter = new MrfiAdapter();
  const content = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
  ].join("\n");
  const doc = await parseDocument.execute({ content });

  const ref = await adapter.generateReference(
    doc,
    lineRange(doc, 7),
    { format: "debug", profile: "full", quote: false, quoteMax: 80 },
  );

  const result = await adapter.resolveReference(doc, ref);

  // "confident" (not "exact") is expected here: "exact" is reserved for
  // anchor-based (`^id`) resolution, whereas a `~mrfi` range reference that
  // still matches its physical range resolves as "confident".
  assertEquals(result.status, "confident");
  assertEquals(result.range, "7:1-7:35");
});

Deno.test("MrfiAdapter.refreshReference - re-points a reference whose content moved", async () => {
  const adapter = new MrfiAdapter();
  const originalContent = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
    "",
    "# Section C",
    "",
    "Trailing content.",
  ].join("\n");
  const originalDoc = await parseDocument.execute({ content: originalContent });

  const ref = await adapter.generateReference(
    originalDoc,
    lineRange(originalDoc, 7),
    { format: "debug", profile: "full", quote: false, quoteMax: 80 },
  );

  // Same passage, shifted down by inserting lines above it — the physical
  // r= range in `ref` now points at different content.
  const movedContent = [
    "# Intro",
    "",
    "Extra text that was not here before.",
    "",
    originalContent,
  ].join("\n");
  const movedDoc = await parseDocument.execute({ content: movedContent });

  const result = await adapter.refreshReference(movedDoc, ref, "debug", "full");

  if (result.kind !== "refreshed") {
    throw new Error(`expected refreshed, got ${JSON.stringify(result)}`);
  }
  assertNotEquals(result.ref, ref);
});
