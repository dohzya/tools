import { assertEquals, assertRejects } from "@std/assert";
import type { HashService } from "../ports/hash-service.ts";
import { MdError } from "../entities/document.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import { GenerateReferenceUseCase } from "./generate-reference.ts";
import { parseDebugMrfi } from "./mrfi-codec.ts";
import { CommonmarkBlockTreeParser } from "../../adapters/services/commonmark-block-tree-parser.ts";

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
const generateReference = new GenerateReferenceUseCase(
  new CommonmarkBlockTreeParser(),
);

async function structuralPathFor(
  content: string,
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  },
): Promise<string | undefined> {
  const doc = await parseDocument.execute({ content });
  const ref = await generateReference.execute({
    doc,
    target: { kind: "range", range },
    format: "debug",
    profile: "full",
    quote: false,
    quoteMax: 0,
  });
  return parseDebugMrfi(ref)?.structuralPath;
}

Deno.test("scope reference includes x field in debug output", async () => {
  const doc = await parseDocument.execute({
    content: "# Section A\n\nContent here.\n",
  });
  const section = doc.sections[0];
  const ref = await generateReference.execute({
    doc,
    target: { kind: "section", section },
    format: "debug",
    profile: "min",
    quote: false,
    quoteMax: 0,
    extentSelector: "sec",
  });
  const parsed = parseDebugMrfi(ref);
  assertEquals(parsed?.extentSelector, "sec");
});

Deno.test("scope reference captures evidence on heading line only", async () => {
  const doc = await parseDocument.execute({
    content: "# Section A\n\nContent here.\n\n# Section B\n\nMore content.\n",
  });
  const section = doc.sections[0];
  const ref = await generateReference.execute({
    doc,
    target: { kind: "section", section },
    format: "debug",
    profile: "full",
    quote: true,
    quoteMax: 100,
    extentSelector: "body",
  });
  const parsed = parseDebugMrfi(ref);
  assertEquals(parsed?.range?.startLine, 1);
  assertEquals(parsed?.range?.endLine, 1);
  assertEquals(parsed?.quote, "Section A");
});

Deno.test("extentSelector is preserved through all profiles", async () => {
  const doc = await parseDocument.execute({
    content: "# Section A\n\nContent.\n",
  });
  const section = doc.sections[0];
  for (const profile of ["min", "default", "full"] as const) {
    const ref = await generateReference.execute({
      doc,
      target: { kind: "section", section },
      format: "debug",
      profile,
      quote: false,
      quoteMax: 0,
      extentSelector: "lead",
    });
    const parsed = parseDebugMrfi(ref);
    assertEquals(
      parsed?.extentSelector,
      "lead",
      `extentSelector lost in profile ${profile}`,
    );
  }
});

Deno.test("scope reference on range target throws", async () => {
  const doc = await parseDocument.execute({
    content: "# Section A\n\nContent.\n",
  });
  await assertRejects(
    () =>
      generateReference.execute({
        doc,
        target: {
          kind: "range",
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
        },
        format: "debug",
        profile: "min",
        quote: false,
        quoteMax: 0,
        extentSelector: "sec",
      }),
    MdError,
  );
});

Deno.test("scope ref hh hashes parent heading scope, not identity", async () => {
  const doc = await parseDocument.execute({
    content: "# Parent\n\nParent content.\n\n## Child\n\nChild content.\n",
  });
  const child = doc.sections.find((s) => s.title === "Child")!;
  const parent = doc.sections.find((s) => s.title === "Parent")!;
  const scopeRef = await generateReference.execute({
    doc,
    target: { kind: "section", section: child },
    format: "debug",
    profile: "full",
    quote: false,
    quoteMax: 0,
    extentSelector: "sec",
  });
  const plainParentRef = await generateReference.execute({
    doc,
    target: { kind: "section", section: parent },
    format: "debug",
    profile: "full",
    quote: false,
    quoteMax: 0,
  });
  const scopeParsed = parseDebugMrfi(scopeRef);
  const parentParsed = parseDebugMrfi(plainParentRef);
  // hh of scope ref on ## Child should equal hh of plain ref on # Parent
  assertEquals(scopeParsed?.headingHash?.hash, parentParsed?.headingHash?.hash);
});

Deno.test("scope ref hh absent for root-level heading", async () => {
  const doc = await parseDocument.execute({
    content: "# Root\n\nContent.\n",
  });
  const root = doc.sections[0];
  const ref = await generateReference.execute({
    doc,
    target: { kind: "section", section: root },
    format: "debug",
    profile: "full",
    quote: false,
    quoteMax: 0,
    extentSelector: "sec",
  });
  const parsed = parseDebugMrfi(ref);
  assertEquals(parsed?.headingHash, undefined);
});

Deno.test("no extentSelector means no x field in output", async () => {
  const doc = await parseDocument.execute({
    content: "# Section A\n\nContent.\n",
  });
  const section = doc.sections[0];
  const ref = await generateReference.execute({
    doc,
    target: { kind: "section", section },
    format: "debug",
    profile: "min",
    quote: false,
    quoteMax: 0,
  });
  const parsed = parseDebugMrfi(ref);
  assertEquals(parsed?.extentSelector, undefined);
});

Deno.test("structural path: h2 nests under its preceding h1 with per-parent occurrence", async () => {
  const content = [
    "# Root",
    "",
    "## Alpha",
    "",
    "Alpha para.",
    "",
    "## Beta",
    "",
    "Beta para.",
  ].join("\n");
  const line = content.split("\n").findIndex((l) => l === "Beta para.") + 1;
  const path = await structuralPathFor(content, {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: "Beta para.".length + 1,
  });
  // Beta is the second h2 under Root (h1[1]), not the second h2 in the doc overall.
  assertEquals(path?.startsWith("h1[1]/h2[2]/"), true);
});

Deno.test("structural path: h2 occurrence resets under each h1 parent", async () => {
  const content = [
    "# First",
    "",
    "## Shared",
    "",
    "First/Shared para.",
    "",
    "# Second",
    "",
    "## Shared",
    "",
    "Second/Shared para.",
  ].join("\n");
  const lines = content.split("\n");
  const firstLine = lines.findIndex((l) => l === "First/Shared para.") + 1;
  const secondLine = lines.findIndex((l) => l === "Second/Shared para.") + 1;

  const firstPath = await structuralPathFor(content, {
    startLine: firstLine,
    startColumn: 1,
    endLine: firstLine,
    endColumn: "First/Shared para.".length + 1,
  });
  const secondPath = await structuralPathFor(content, {
    startLine: secondLine,
    startColumn: 1,
    endLine: secondLine,
    endColumn: "Second/Shared para.".length + 1,
  });

  // Both h2s are the *first* h2 under their own h1 parent: occurrence resets.
  assertEquals(firstPath?.startsWith("h1[1]/h2[1]/"), true);
  assertEquals(secondPath?.startsWith("h1[2]/h2[1]/"), true);
});

Deno.test("structural path: includes a paragraph container step within a section", async () => {
  const content = [
    "# Root",
    "",
    "## Section",
    "",
    "First para.",
    "",
    "Second para.",
  ].join("\n");
  const line = content.split("\n").findIndex((l) => l === "Second para.") + 1;
  const path = await structuralPathFor(content, {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: "Second para.".length + 1,
  });
  assertEquals(path, "h1[1]/h2[1]/p[2]");
});

Deno.test("structural path: includes list container steps (ul/li) nested inside a section", async () => {
  const content = [
    "# Section",
    "",
    "- item one",
    "- item two",
  ].join("\n");
  const line = content.split("\n").findIndex((l) => l === "- item two") + 1;
  const path = await structuralPathFor(content, {
    startLine: line,
    startColumn: 3,
    endLine: line,
    endColumn: "- item two".length + 1,
  });
  assertEquals(path, "h1[1]/ul[1]/li[2]/p[1]");
});

Deno.test("structural path: falls back to the heading chain when the range spans multiple top-level blocks in a section", async () => {
  const content = [
    "# Section",
    "",
    "First para.",
    "",
    "Second para.",
  ].join("\n");
  const path = await structuralPathFor(content, {
    startLine: 3,
    startColumn: 1,
    endLine: 5,
    endColumn: "Second para.".length + 1,
  });
  assertEquals(path, "h1[1]");
});

Deno.test("structural path: omitted when neither a section nor a block identifies the range", async () => {
  const content = ["Preface one.", "", "Preface two."].join("\n");
  const path = await structuralPathFor(content, {
    startLine: 1,
    startColumn: 1,
    endLine: 3,
    endColumn: "Preface two.".length + 1,
  });
  assertEquals(path, undefined);
});

Deno.test("structural path: whole-section range is just the heading chain, no block step", async () => {
  const content = ["# Root", "", "## Section", "", "Only para."].join("\n");
  const path = await structuralPathFor(content, {
    startLine: 3,
    startColumn: 1,
    endLine: 5,
    endColumn: "Only para.".length + 1,
  });
  assertEquals(path, "h1[1]/h2[1]");
});

Deno.test("structural path: block steps only (no heading prefix) before the first heading", async () => {
  const content = ["Preface para.", "", "# Root", "", "Content."].join("\n");
  const path = await structuralPathFor(content, {
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: "Preface para.".length + 1,
  });
  assertEquals(path, "p[1]");
});
