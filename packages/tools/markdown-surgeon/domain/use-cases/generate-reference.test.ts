import { assertEquals, assertRejects } from "@std/assert";
import type { HashService } from "../ports/hash-service.ts";
import { MdError } from "../entities/document.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import { GenerateReferenceUseCase } from "./generate-reference.ts";
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
