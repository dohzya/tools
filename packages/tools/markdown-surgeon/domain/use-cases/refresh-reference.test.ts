/**
 * Unit tests for RefreshReferenceUseCase.
 *
 * Uses a mock HashService (no real Deno/@std dependencies) — MRFI's own
 * hashing (smh64/SHA-256 fragment signals) runs directly through
 * `crypto.subtle`, independent of section-id hashing.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import type { HashService } from "../ports/hash-service.ts";
import type { Document } from "../entities/document.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import { GenerateReferenceUseCase } from "./generate-reference.ts";
import { RefreshReferenceUseCase } from "./refresh-reference.ts";
import { parseDebugMrfi } from "./mrfi-codec.ts";

class MockHashService implements HashService {
  async hash(
    level: number,
    title: string,
    occurrenceIndex: number,
  ): Promise<string> {
    const input = `${level}:${title.toLowerCase().trim()}:${occurrenceIndex}`;
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 8);
  }
}

const parseDocument = new ParseDocumentUseCase(new MockHashService());
const generateReference = new GenerateReferenceUseCase();
const refreshReference = new RefreshReferenceUseCase();

/** Full-line source range for a single 1-indexed line of a parsed document */
function lineRange(doc: Document, line: number) {
  return {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: doc.lines[line - 1].length + 1,
  };
}

Deno.test("RefreshReferenceUseCase - idempotent when content is unchanged", async () => {
  const content = [
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
  const doc = await parseDocument.execute({ content });

  const ref = await generateReference.execute({
    doc,
    target: { kind: "range", range: lineRange(doc, 7) },
    format: "debug",
    profile: "full",
    quote: false,
    quoteMax: 80,
  });

  const result = await refreshReference.execute({
    doc,
    ref,
    format: "debug",
    profile: "full",
  });

  assertEquals(result, { kind: "refreshed", ref });
});

Deno.test("RefreshReferenceUseCase - returns updated range when the physical range moved but content is still findable", async () => {
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

  const ref = await generateReference.execute({
    doc: originalDoc,
    target: { kind: "range", range: lineRange(originalDoc, 7) },
    format: "debug",
    profile: "full",
    quote: false,
    quoteMax: 80,
  });

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

  const result = await refreshReference.execute({
    doc: movedDoc,
    ref,
    format: "debug",
    profile: "full",
  });

  if (result.kind !== "refreshed") {
    throw new Error(`expected refreshed, got ${JSON.stringify(result)}`);
  }
  assertNotEquals(result.ref, ref);

  const original = parseDebugMrfi(ref);
  const refreshed = parseDebugMrfi(result.ref);
  assertEquals(original?.exactHash, refreshed?.exactHash);
  assertEquals(refreshed?.range?.startLine, 11);
});

Deno.test("RefreshReferenceUseCase - surfaces the resolve status instead of a reference when not found", async () => {
  const content = [
    "# Section A",
    "",
    "Some content here.",
  ].join("\n");
  const doc = await parseDocument.execute({ content });

  // Hand-crafted ref pointing far outside the document, with no other
  // locator signal (no fh=/ctx=/hh=) to fall back on.
  const ref = "~{v0;r=999:1-999:5}";

  const result = await refreshReference.execute({
    doc,
    ref,
    format: "debug",
    profile: "full",
  });

  assertEquals(result.kind, "unresolved");
  if (result.kind === "unresolved") {
    assertEquals(result.result.status, "not_found");
  }
});
