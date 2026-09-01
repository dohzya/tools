/**
 * Unit tests for the xxh64 primitive in mrfi-text.ts.
 *
 * Test vectors (seed 0) are the canonical ones used by cespare/xxhash, a
 * mature, widely-depended-on Go port of the reference xxHash implementation.
 */

import { assertEquals, assertNotEquals, assertStrictEquals } from "@std/assert";
import type { HashService } from "../ports/hash-service.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import {
  findFirstSectionAnchor,
  formatSourceRange,
  fullLineRange,
  getDocumentCodepoints,
  getDocumentText,
  getSectionScopeText,
  getStructuralNodeSourceForSection,
  hashSignalFor,
  lineColumnToOffset,
  smh64Value,
  xxh64Hex,
  xxh64PrefixSignal,
} from "./mrfi-text.ts";

class MockHashService implements HashService {
  hash(level: number, title: string, occurrenceIndex: number): Promise<string> {
    return Promise.resolve(`${level}-${title}-${occurrenceIndex}`);
  }
}

const parseDocument = new ParseDocumentUseCase(new MockHashService());

const VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["", "ef46db3751d8e999"],
  ["a", "d24ec4f1a98c6e5b"],
  ["as", "1c330fb2d66be179"],
  ["asd", "631c37ce72a97393"],
  ["asdf", "415872f599cea71e"],
  [
    "Call me Ishmael. Some years ago--never mind how long precisely-",
    "02a2e85470d6fd96",
  ],
];

for (const [input, expectedHex] of VECTORS) {
  Deno.test(`xxh64Hex - matches the canonical vector for ${JSON.stringify(input)}`, () => {
    assertEquals(xxh64Hex(input), expectedHex);
  });
}

Deno.test("xxh64PrefixSignal - tags the signal as xxh64", async () => {
  const signal = await xxh64PrefixSignal("Run the installer.");
  assertEquals(signal.algorithm, "xxh64");
  assertEquals(signal.prefix.length > 0, true);
});

Deno.test("xxh64PrefixSignal - differs between distinct texts", async () => {
  const a = await xxh64PrefixSignal("Run the installer.");
  const b = await xxh64PrefixSignal("Run the uninstaller.");
  assertNotEquals(a.prefix, b.prefix);
});

Deno.test("hashSignalFor - dispatches to sha256", async () => {
  const signal = await hashSignalFor("sha256", "Run the installer.");
  assertEquals(signal?.algorithm, "sha256");
});

Deno.test("hashSignalFor - dispatches to xxh64", async () => {
  const signal = await hashSignalFor("xxh64", "Run the installer.");
  assertEquals(signal?.algorithm, "xxh64");
  assertEquals(
    signal?.prefix,
    (await xxh64PrefixSignal("Run the installer.")).prefix,
  );
});

Deno.test("hashSignalFor - returns undefined for an unsupported algorithm tag", async () => {
  const signal = await hashSignalFor("blake3", "Run the installer.");
  assertEquals(signal, undefined);
});

Deno.test("formatSourceRange - full line:col precision, matching the r= field format", () => {
  assertEquals(
    formatSourceRange({
      startLine: 3,
      startColumn: 1,
      endLine: 5,
      endColumn: 11,
    }),
    "3:1-5:11",
  );
});

Deno.test("fullLineRange - spans the whole line(s), 1-indexed columns", async () => {
  const doc = await parseDocument.execute({
    content: "# Title\n\nFirst line\nSecond line",
  });

  assertEquals(fullLineRange(doc, 3, 3), {
    startLine: 3,
    startColumn: 1,
    endLine: 3,
    endColumn: 11,
  });
  assertEquals(fullLineRange(doc, 3, 4), {
    startLine: 3,
    startColumn: 1,
    endLine: 4,
    endColumn: 12,
  });
});

Deno.test("smh64Value - memoizes repeated calls for the same text", async () => {
  const text = "a repeated block of scope text ".repeat(20);

  let digestCalls = 0;
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  const spyDigest: typeof crypto.subtle.digest = (...args) => {
    digestCalls += 1;
    return originalDigest(...args);
  };
  crypto.subtle.digest = spyDigest;

  try {
    const first = await smh64Value(text);
    const callsForFirstCall = digestCalls;
    assertEquals(callsForFirstCall > 0, true);

    const second = await smh64Value(text);
    assertEquals(second, first);
    assertEquals(digestCalls, callsForFirstCall);
  } finally {
    crypto.subtle.digest = originalDigest;
  }
});

Deno.test("lineColumnToOffset - matches manual line/column offsets", async () => {
  const doc = await parseDocument.execute({
    content: ["Café.", "Line two.", "Third line here."].join("\n"),
  });

  assertEquals(lineColumnToOffset(doc, 1, 1), 0);
  // "Café." has 5 codepoints (é is one codepoint) + 1 for the newline
  assertEquals(lineColumnToOffset(doc, 2, 1), 6);
  assertEquals(lineColumnToOffset(doc, 2, 6), 11);
  assertEquals(lineColumnToOffset(doc, 3, 1), 6 + "Line two.".length + 1);
});

Deno.test("getSectionScopeText - memoizes per section", async () => {
  const doc = await parseDocument.execute({
    content: ["# Title", "", "Body line one.", "Body line two."].join("\n"),
  });
  const section = doc.sections[0];

  const first = getSectionScopeText(doc, section);
  const second = getSectionScopeText(doc, section);
  assertStrictEquals(second, first);
  assertEquals(first, "# Title\n\nBody line one.\nBody line two.");
});

Deno.test("getStructuralNodeSourceForSection - memoizes per section", async () => {
  const doc = await parseDocument.execute({
    content: ["# Title", "", "Body line one.", "Body line two."].join("\n"),
  });
  const section = doc.sections[0];
  const source = getDocumentText(doc);

  const first = getStructuralNodeSourceForSection(doc, section, source);
  const second = getStructuralNodeSourceForSection(doc, section, source);
  assertStrictEquals(second, first);
  assertEquals(first.text, "# Title\n\nBody line one.\nBody line two.");
});

Deno.test("getDocumentText - memoizes per doc, rebuilds for a different doc", async () => {
  const docA = await parseDocument.execute({ content: "Line one.\nLine two." });
  const docB = await parseDocument.execute({ content: "Other doc." });

  const first = getDocumentText(docA);
  const second = getDocumentText(docA);
  assertStrictEquals(second, first);

  const forDocB = getDocumentText(docB);
  assertEquals(forDocB, "Other doc.");
});

Deno.test("getDocumentCodepoints - memoizes per doc, rebuilds for a different doc", async () => {
  const docA = await parseDocument.execute({ content: "Line one.\nLine two." });
  const docB = await parseDocument.execute({ content: "Other doc." });

  const first = getDocumentCodepoints(docA);
  const second = getDocumentCodepoints(docA);
  assertStrictEquals(second, first);

  const forDocB = getDocumentCodepoints(docB);
  assertEquals(forDocB.join(""), "Other doc.");
});

Deno.test("findFirstSectionAnchor - finds an anchor comment inside the section", async () => {
  const doc = await parseDocument.execute({
    content: ["# Title", "", "<!-- ^my-anchor -->", "Body."].join("\n"),
  });
  assertEquals(findFirstSectionAnchor(doc, doc.sections[0]), "my-anchor");
});

Deno.test("findFirstSectionAnchor - ignores an anchor-shaped comment inside a code fence", async () => {
  const doc = await parseDocument.execute({
    content: [
      "# Title",
      "",
      "```",
      "<!-- ^fenced-anchor -->",
      "```",
      "Body.",
    ].join("\n"),
  });
  assertEquals(findFirstSectionAnchor(doc, doc.sections[0]), undefined);
});
