/**
 * Property tests for the confidence constants used by ResolveReferenceUseCase,
 * plus integration tests for must-understand validation and extent selection.
 *
 * docs/specs/mrfi.md "Confidence" requires thresholds to be documented and
 * stable, and confidence to be monotone: a higher value always means
 * stronger evidence agreement. These tests pin CONFIDENCE as the single
 * source of truth and check that every named tier respects that ordering
 * relative to CONFIDENT_THRESHOLD, instead of leaving ad-hoc literals
 * scattered across resolveMrfiReference's branches.
 */

import { assert, assertEquals } from "@std/assert";
import {
  checkDestructiveGate,
  CONFIDENCE,
  CONFIDENT_THRESHOLD,
  ResolveReferenceUseCase,
} from "./resolve-reference.ts";
import type { ResolveResult } from "../entities/mrfi.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import type { HashService } from "../ports/hash-service.ts";
import { serializeSmh64Field } from "./mrfi-codec.ts";
import {
  DEFAULT_SMH64_MAX_DISTANCE,
  hammingDistance64,
  sha256PrefixSignal,
  smh64Value,
} from "./mrfi-text.ts";

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
const resolveReference = new ResolveReferenceUseCase();

Deno.test("CONFIDENCE.EXACT is the maximum possible confidence, per spec", () => {
  assertEquals(CONFIDENCE.EXACT, 1);
  for (const [name, value] of Object.entries<number>(CONFIDENCE)) {
    assert(value <= CONFIDENCE.EXACT, `${name} (${value}) exceeds EXACT`);
  }
});

Deno.test("every AMBIGUOUS_* and STALE_* tier is below the confident threshold", () => {
  for (const [name, value] of Object.entries<number>(CONFIDENCE)) {
    if (name.startsWith("AMBIGUOUS_") || name.startsWith("STALE_")) {
      assert(
        value < CONFIDENT_THRESHOLD,
        `${name} (${value}) should be below CONFIDENT_THRESHOLD (${CONFIDENT_THRESHOLD})`,
      );
    }
  }
});

Deno.test("every CONFIDENT_* and RANGE_CONFIDENT* tier meets the confident threshold", () => {
  for (const [name, value] of Object.entries<number>(CONFIDENCE)) {
    if (name.startsWith("CONFIDENT_") || name.startsWith("RANGE_CONFIDENT")) {
      assert(
        value >= CONFIDENT_THRESHOLD,
        `${name} (${value}) should be at or above CONFIDENT_THRESHOLD (${CONFIDENT_THRESHOLD})`,
      );
    }
  }
});

// --- Must-understand validation ---

Deno.test("must-understand violation returns invalid", async () => {
  const content = "# Hello\n\nSome content.\n";
  const doc = await parseDocument.execute({ content });
  // "foo" is not a known key and does not start with "_", so it is a
  // must-understand violation.
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;foo=bar}",
  });
  assertEquals(result.status, "invalid");
  assertEquals(result.confidence, 0);
  assert(
    result.diagnostics.some((d) => d.includes("must-understand")),
    `expected must-understand diagnostic, got: ${result.diagnostics}`,
  );
});

Deno.test("extension field (_-prefixed) is NOT a must-understand violation", async () => {
  const content = "# Hello\n\nSome content here.\n";
  const doc = await parseDocument.execute({ content });
  // r= points at the heading line; _kind is an extension field.
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:8;_kind=review}",
  });
  // Should resolve successfully, not return invalid.
  assert(
    result.status !== "invalid",
    `expected non-invalid status, got: ${result.status} — ${result.diagnostics}`,
  );
});

// --- Extent selection ---

const extentDoc = [
  "# A", // line 1
  "", // line 2
  "Content A.", // line 3
  "", // line 4
  "## A.1", // line 5
  "", // line 6
  "Sub content.", // line 7
  "", // line 8
  "# B", // line 9
  "", // line 10
  "Content B.", // line 11
].join("\n");

Deno.test("extent sec includes heading and subsections, stops at same-level", async () => {
  const doc = await parseDocument.execute({ content: extentDoc });
  // r= points at "# A" (line 1, 4 chars including "# A")
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4;x=sec}",
  });
  assert(
    result.status !== "invalid" && result.status !== "not_found",
    `expected resolved, got: ${result.status} — ${result.diagnostics}`,
  );
  // sec includes heading through last non-blank line before # B
  assertEquals(result.passage, "# A\n\nContent A.\n\n## A.1\n\nSub content.");
  assert(
    result.diagnostics.some((d) => d.includes("x=sec")),
    `expected extent diagnostic, got: ${result.diagnostics}`,
  );
});

Deno.test("extent body excludes heading, includes subsections", async () => {
  const doc = await parseDocument.execute({ content: extentDoc });
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4;x=body}",
  });
  assert(
    result.status !== "invalid" && result.status !== "not_found",
    `expected resolved, got: ${result.status} — ${result.diagnostics}`,
  );
  // body starts after heading, includes subsections, stops before # B
  assertEquals(result.passage, "Content A.\n\n## A.1\n\nSub content.");
  assert(
    result.diagnostics.some((d) => d.includes("x=body")),
    `expected extent diagnostic, got: ${result.diagnostics}`,
  );
});

Deno.test("extent lead stops at first child heading", async () => {
  const doc = await parseDocument.execute({ content: extentDoc });
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4;x=lead}",
  });
  assert(
    result.status !== "invalid" && result.status !== "not_found",
    `expected resolved, got: ${result.status} — ${result.diagnostics}`,
  );
  // lead stops at ## A.1 and trims trailing blank lines
  assertEquals(result.passage, "Content A.");
  assert(
    result.diagnostics.some((d) => d.includes("x=lead")),
    `expected extent diagnostic, got: ${result.diagnostics}`,
  );
});

Deno.test("extent body on heading followed by same-level heading gives empty passage", async () => {
  const emptyBodyDoc = [
    "# A", // line 1
    "# B", // line 2
    "", // line 3
    "Content B.", // line 4
  ].join("\n");
  const doc = await parseDocument.execute({ content: emptyBodyDoc });
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4;x=body}",
  });
  assert(
    result.status !== "invalid" && result.status !== "not_found",
    `expected resolved, got: ${result.status} — ${result.diagnostics}`,
  );
  assertEquals(result.passage, "");
  assertEquals(result.range, "2:1-2:1");
});

Deno.test("extent follows current document structure, not stored level", async () => {
  // If the heading changed from ## to #, extent should follow current level
  const changedDoc = [
    "# A", // line 1 — was ## originally
    "", // line 2
    "Content A.", // line 3
    "", // line 4
    "# B", // line 5
  ].join("\n");
  const doc = await parseDocument.execute({ content: changedDoc });
  // r= points at current # A even though it might have been ## before
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4;x=body}",
  });
  assert(
    result.status !== "invalid" && result.status !== "not_found",
    `expected resolved, got: ${result.status} — ${result.diagnostics}`,
  );
  assertEquals(result.passage, "Content A.");
});

// --- checkDestructiveGate ---

function syntheticResult(
  overrides: Partial<ResolveResult>,
): ResolveResult {
  return {
    ref: "~test",
    status: "exact",
    confidence: 1,
    diagnostics: [],
    ...overrides,
  };
}

Deno.test("gate rejects stale status", () => {
  const r = syntheticResult({ status: "stale", confidence: 0.55 });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, false);
  assert(gate.reason.includes("stale"));
});

Deno.test("gate rejects ambiguous status", () => {
  const r = syntheticResult({ status: "ambiguous", confidence: 0.6 });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, false);
});

Deno.test("gate rejects not_found status", () => {
  const r = syntheticResult({ status: "not_found", confidence: 0 });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, false);
});

Deno.test("gate rejects invalid status", () => {
  const r = syntheticResult({ status: "invalid", confidence: 0 });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, false);
});

Deno.test("gate rejects confident with no strong signal", () => {
  const r = syntheticResult({ status: "confident", confidence: 0.75 });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, false);
  assert(gate.reason.includes("strong"));
});

Deno.test("gate allows exact with uniqueAnchor", () => {
  const r = syntheticResult({
    strongSignals: { uniqueAnchor: true },
  });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, true);
});

Deno.test("gate allows exact with exactHash", () => {
  const r = syntheticResult({
    strongSignals: { exactHash: true },
  });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, true);
});

Deno.test("gate allows confident with bothContext", () => {
  const r = syntheticResult({
    status: "confident",
    confidence: 0.88,
    strongSignals: { bothContext: true },
  });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, true);
});

Deno.test("gate allows confident with witnessAgreement", () => {
  const r = syntheticResult({
    status: "confident",
    confidence: 0.86,
    strongSignals: { witnessAgreement: true },
  });
  const gate = checkDestructiveGate(r);
  assertEquals(gate.allowed, true);
});

Deno.test("gate strict rejects confident, allows exact", () => {
  const confident = syntheticResult({
    status: "confident",
    confidence: 0.88,
    strongSignals: { bothContext: true },
  });
  assertEquals(
    checkDestructiveGate(confident, { strict: true }).allowed,
    false,
  );

  const exact = syntheticResult({
    strongSignals: { exactHash: true },
  });
  assertEquals(
    checkDestructiveGate(exact, { strict: true }).allowed,
    true,
  );
});

Deno.test("gate force allows anything", () => {
  const stale = syntheticResult({ status: "stale", confidence: 0.55 });
  assertEquals(
    checkDestructiveGate(stale, { force: true }).allowed,
    true,
  );

  const notFound = syntheticResult({
    status: "not_found",
    confidence: 0,
  });
  assertEquals(
    checkDestructiveGate(notFound, { force: true }).allowed,
    true,
  );
});

// --- strongSignals integration ---

Deno.test("unique anchor resolution sets strongSignals.uniqueAnchor", async () => {
  const content = "# Hello\n\n<!-- ^myanchor -->\n\nSome content.\n";
  const doc = await parseDocument.execute({ content });
  const result = await resolveReference.execute({ doc, ref: "^myanchor" });
  assertEquals(result.status, "exact");
  assertEquals(result.strongSignals?.uniqueAnchor, true);
});

Deno.test("bare range MRFI has no strong signal", async () => {
  const content = "# Hello\n\nSome content.\n";
  const doc = await parseDocument.execute({ content });
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:8}",
  });
  assertEquals(result.status, "confident");
  const signals = result.strongSignals;
  const hasStrong = signals !== undefined &&
    (signals.exactHash === true || signals.uniqueAnchor === true ||
      signals.bothContext === true || signals.witnessAgreement === true);
  assertEquals(hasStrong, false, "bare range should have no strong signal");
});

// --- extentOverride ---

Deno.test("extentOverride applies extent selection to MRFI ref", async () => {
  const doc = await parseDocument.execute({ content: extentDoc });
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4}",
    extentOverride: "body",
  });
  assert(
    result.status !== "invalid" && result.status !== "not_found",
    `expected resolved, got: ${result.status} — ${result.diagnostics}`,
  );
  assertEquals(result.passage, "Content A.\n\n## A.1\n\nSub content.");
});

Deno.test("extentOverride applies extent selection to anchor ref", async () => {
  // Anchor the heading itself via inline anchor syntax
  const contentWithAnchor = [
    "# Section",
    "<!-- ^sec1 -->",
    "",
    "Body text.",
    "",
    "# Next",
  ].join("\n");
  const docWithAnchor = await parseDocument.execute({
    content: contentWithAnchor,
  });
  const result = await resolveReference.execute({
    doc: docWithAnchor,
    ref: "^sec1",
    extentOverride: "body",
  });
  // body includes everything after the heading: anchor comment + body text
  assertEquals(result.passage, "<!-- ^sec1 -->\n\nBody text.");
});

Deno.test("extentOverride overrides embedded x field", async () => {
  const doc = await parseDocument.execute({ content: extentDoc });
  // ref has x=sec, but override says lead
  const result = await resolveReference.execute({
    doc,
    ref: "~{v0;r=1:1-1:4;x=sec}",
    extentOverride: "lead",
  });
  assertEquals(result.passage, "Content A.");
});

// --- passage hash (ph) scoring signal ---

Deno.test("ph confirmation: fh fails but ph in-threshold keeps range confident", async () => {
  // Longer passage so smh64 is more tolerant of single-word edits
  const originalPassage =
    "The quick brown fox jumps over the lazy dog and then runs through the forest to find the hidden treasure buried under the ancient oak tree near the river.";
  // Single-word edit: "dog" → "cat" (fh will fail, ph stays in-threshold at distance ~6)
  const modifiedPassage =
    "The quick brown fox jumps over the lazy cat and then runs through the forest to find the hidden treasure buried under the ancient oak tree near the river.";
  const content = `# Heading\n\n${modifiedPassage}\n`;
  const doc = await parseDocument.execute({ content });

  // Compute ph from the original passage — should be close to modified
  const phHash = await smh64Value(originalPassage);
  const phDistance = hammingDistance64(
    phHash,
    await smh64Value(modifiedPassage),
  );
  // Verify our test assumption: ph is within threshold
  assert(
    phDistance <= DEFAULT_SMH64_MAX_DISTANCE,
    `test assumption: ph distance ${phDistance} should be <= ${DEFAULT_SMH64_MAX_DISTANCE}`,
  );

  // Compute hh for the heading section
  const hhHash = await smh64Value(content);
  const phField = serializeSmh64Field("ph", { hash: phHash });
  const hhField = serializeSmh64Field("hh", { hash: hhHash });

  // Build a ref with range, fh (wrong — will fail), and ph (close — will confirm)
  const ref =
    `~{v0;r=3:1-3:${modifiedPassage.length};fh=sha256:deadbeef;${hhField};${phField}}`;
  const result = await resolveReference.execute({ doc, ref });

  assertEquals(
    result.status,
    "confident",
    `diagnostics: ${result.diagnostics}`,
  );
  assertEquals(
    result.confidence,
    CONFIDENCE.RANGE_PH_SUPPRESSES_FH,
    `fh-fail + ph-confirm should get RANGE_PH_SUPPRESSES_FH, got ${result.confidence}`,
  );
  assert(
    result.diagnostics.some((d) => d.startsWith("range ph distance")),
    `diagnostics should include ph distance: ${result.diagnostics}`,
  );
});

Deno.test("ph confirmation confidence: fh fails + ph confirms → RANGE_PH_SUPPRESSES_FH", async () => {
  const passage = "Some distinctive passage text for testing purposes.";
  const content = `# Section\n\n${passage}\n`;
  const doc = await parseDocument.execute({ content });

  const phHash = await smh64Value(passage);
  const hhHash = await smh64Value(content);
  const phField = serializeSmh64Field("ph", { hash: phHash });
  const hhField = serializeSmh64Field("hh", { hash: hhHash });

  // fh fails, ph confirms exactly (distance 0)
  const ref =
    `~{v0;r=3:1-3:${passage.length};fh=sha256:deadbeef;${hhField};${phField}}`;
  const result = await resolveReference.execute({ doc, ref });

  assertEquals(result.status, "confident");
  assertEquals(result.confidence, CONFIDENCE.RANGE_PH_SUPPRESSES_FH);
  // Monotonicity: fh-match baseline must be >= ph-override confidence
  assert(
    CONFIDENCE.RANGE_CONFIDENT >= CONFIDENCE.RANGE_PH_SUPPRESSES_FH,
    `monotonicity: RANGE_CONFIDENT (${CONFIDENCE.RANGE_CONFIDENT}) must be >= RANGE_PH_SUPPRESSES_FH (${CONFIDENCE.RANGE_PH_SUPPRESSES_FH})`,
  );
});

Deno.test("ph contradiction: out-of-threshold ph contributes to stale/fallback", async () => {
  const originalPassage = "Alpha beta gamma delta epsilon.";
  // Completely different passage — ph will be far
  const replacementPassage = "Zeta eta theta iota kappa.";
  // Keep same length so range is valid
  const content = `# Heading\n\n${replacementPassage}\n`;
  const doc = await parseDocument.execute({ content });

  const phHash = await smh64Value(originalPassage);
  const phDistance = hammingDistance64(
    phHash,
    await smh64Value(replacementPassage),
  );
  // Verify test assumption: ph is out of threshold
  assert(
    phDistance > DEFAULT_SMH64_MAX_DISTANCE,
    `test assumption: ph distance ${phDistance} should be > ${DEFAULT_SMH64_MAX_DISTANCE}`,
  );

  const phField = serializeSmh64Field("ph", { hash: phHash });
  // No fh/hh — only range + ph, so ph contradiction is the sole trigger
  const ref = `~{v0;r=3:1-3:${replacementPassage.length};${phField}}`;
  const result = await resolveReference.execute({ doc, ref });

  assertEquals(
    result.status,
    "stale",
    `expected stale from ph contradiction, got: ${result.status} — ${result.diagnostics}`,
  );
});

Deno.test("ph disambiguates context ambiguity", async () => {
  // Two locations with identical surrounding context but different passage
  // content. Context resolution finds both → ambiguous. Adding ph breaks
  // the tie and the winner's confidence must meet CONFIDENT_THRESHOLD.
  const wrapper =
    "AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKKK LLLL ";
  const passageA = "alpha-target-passage";
  const passageB = "bravo-target-passage";
  const tail = " MMMM NNNN OOOO PPPP QQQQ RRRR SSSS TTTT UUUU VVVV WWWW";
  // Repeat the same context around two different passages, separated by
  // enough unrelated text that context windows don't overlap.
  const separator = "\n" + "Z".repeat(200) + "\n";
  const content = wrapper + passageA + tail + separator +
    wrapper + passageB + tail;
  const doc = await parseDocument.execute({ content });

  // Compute context hashes — sha256PrefixSignal of the 64-char window
  // before/after the passage. The resolver tries windows of length 1..64,
  // so we hash the exact wrapper text used (length 60).
  const prefixHash = await sha256PrefixSignal(wrapper);
  const suffixHash = await sha256PrefixSignal(tail);

  // Use an offset range to provide candidate length without a resolvable
  // source range — forces the resolver past the range branch into context.
  const oStart = wrapper.length;
  const oEnd = oStart + passageA.length;
  const refWithoutPh =
    `~{v0;o=${oStart}-${oEnd};ctx=pre:${prefixHash.prefix},suf:${suffixHash.prefix}}`;
  const resultWithoutPh = await resolveReference.execute({
    doc,
    ref: refWithoutPh,
  });
  assertEquals(
    resultWithoutPh.status,
    "ambiguous",
    `baseline should be ambiguous: ${resultWithoutPh.diagnostics}`,
  );

  // Now add ph from passage A — should disambiguate
  const phHash = await smh64Value(passageA);
  const phField = serializeSmh64Field("ph", { hash: phHash });
  const refWithPh =
    `~{v0;o=${oStart}-${oEnd};ctx=pre:${prefixHash.prefix},suf:${suffixHash.prefix};${phField}}`;
  const resultWithPh = await resolveReference.execute({
    doc,
    ref: refWithPh,
  });
  assertEquals(
    resultWithPh.status,
    "confident",
    `ph should disambiguate: ${resultWithPh.diagnostics}`,
  );
  assertEquals(
    resultWithPh.passage,
    passageA,
    "winner should be passage A",
  );
  // Confidence must meet threshold for a confident result
  assert(
    resultWithPh.confidence >= CONFIDENT_THRESHOLD,
    `confidence ${resultWithPh.confidence} should be >= ${CONFIDENT_THRESHOLD}`,
  );
  // ph-disambiguated result must NOT pass destructive gate
  const gateResult = checkDestructiveGate(resultWithPh);
  assertEquals(
    gateResult.allowed,
    false,
    "ph-disambiguated result must not pass destructive gate",
  );
});

Deno.test("ph confirmation confidence: ph confirms + fh absent → RANGE_CONFIDENT_WITH_PH", async () => {
  // When ph agrees and fh is not present at all, confidence should be
  // RANGE_CONFIDENT_WITH_PH (extra evidence beyond baseline).
  const passage = "Some distinctive passage text for testing purposes.";
  const content = `# Section\n\n${passage}\n`;
  const doc = await parseDocument.execute({ content });

  const phHash = await smh64Value(passage);
  const hhHash = await smh64Value(content);
  const phField = serializeSmh64Field("ph", { hash: phHash });
  const hhField = serializeSmh64Field("hh", { hash: hhHash });

  // No fh field — ph confirms exactly (distance 0)
  const ref = `~{v0;r=3:1-3:${passage.length};${hhField};${phField}}`;
  const result = await resolveReference.execute({ doc, ref });

  assertEquals(result.status, "confident");
  assertEquals(result.confidence, CONFIDENCE.RANGE_CONFIDENT_WITH_PH);
  // Monotonicity: RANGE_CONFIDENT_WITH_PH > RANGE_CONFIDENT (extra evidence)
  assert(
    CONFIDENCE.RANGE_CONFIDENT_WITH_PH > CONFIDENCE.RANGE_CONFIDENT,
    `monotonicity: RANGE_CONFIDENT_WITH_PH (${CONFIDENCE.RANGE_CONFIDENT_WITH_PH}) must be > RANGE_CONFIDENT (${CONFIDENCE.RANGE_CONFIDENT})`,
  );
  // Monotonicity: RANGE_CONFIDENT_WITH_PH > RANGE_PH_SUPPRESSES_FH
  assert(
    CONFIDENCE.RANGE_CONFIDENT_WITH_PH > CONFIDENCE.RANGE_PH_SUPPRESSES_FH,
    `monotonicity: RANGE_CONFIDENT_WITH_PH (${CONFIDENCE.RANGE_CONFIDENT_WITH_PH}) must be > RANGE_PH_SUPPRESSES_FH (${CONFIDENCE.RANGE_PH_SUPPRESSES_FH})`,
  );
});

Deno.test("ph disambiguates fuzzy heading candidates", async () => {
  // Two sections with the same heading but different bodies. Their scope
  // hashes are 8 bits apart (at DEFAULT_SMH64_MAX_DISTANCE boundary).
  // Using an hh_ref equidistant from both (distance 4 each, gap 0 < margin 3)
  // makes them ambiguous. ph_ref from section A (distance 0 to A, 8 to B,
  // gap 8 >= margin 3) then disambiguates and picks section A.
  const heading = "Configuration";
  const bodyA = "Alpha setup 46 initialization procedure for system.";
  const bodyB = "Bravo setup 46 initialization procedure for system.";

  const content = `# ${heading}\n\n${bodyA}\n\n# ${heading}\n\n${bodyB}\n`;
  const doc = await parseDocument.execute({ content });

  // Scope hashes for the two sections
  const scopeA = `# ${heading}\n\n${bodyA}`;
  const scopeB = `# ${heading}\n\n${bodyB}`;
  const hashA = await smh64Value(scopeA);
  const hashB = await smh64Value(scopeB);
  const sectionDist = hammingDistance64(hashA, hashB);
  assertEquals(sectionDist, 8, "test assumption: section scope distance is 8");

  // hh_ref: midpoint hash equidistant from both (4 bits from each)
  // Constructed by flipping 4 of the 8 differing bits from hashA.
  const xorBits = hashA ^ hashB;
  let midHash = hashA;
  let flipped = 0;
  for (let pos = 0; pos < 64 && flipped < 4; pos++) {
    if ((xorBits >> BigInt(pos)) & 1n) {
      midHash ^= 1n << BigInt(pos);
      flipped++;
    }
  }
  assertEquals(
    hammingDistance64(midHash, hashA),
    4,
    "test assumption: hh_ref equidistant from A",
  );
  assertEquals(
    hammingDistance64(midHash, hashB),
    4,
    "test assumption: hh_ref equidistant from B",
  );

  // ph_ref = hashA → distance 0 to section A, 8 to section B
  const hhField = serializeSmh64Field("hh", { hash: midHash });
  const phField = serializeSmh64Field("ph", { hash: hashA });

  const ref = `~{v0;${hhField};${phField}}`;
  const result = await resolveReference.execute({ doc, ref });

  assertEquals(
    result.status,
    "confident",
    `ph should disambiguate fuzzy heading candidates: ${result.diagnostics}`,
  );
  assertEquals(
    result.confidence,
    CONFIDENCE.CONFIDENT_PH_DISAMBIGUATION,
    "confidence should be CONFIDENT_PH_DISAMBIGUATION",
  );
  assert(
    result.passage?.includes(bodyA),
    `should pick section A, got passage: ${result.passage?.slice(0, 80)}`,
  );
});

Deno.test("ctx prefix-only: passage near EOF shorter than candidateLength", async () => {
  // Phase 2 (fixed-length) skips offsets where startOffset + candidateLength
  // exceeds document length. Variable-length scanning finds the passage.
  const prefix = "Lorem ipsum dolor sit amet, consectetur adipiscing elit vero";
  const originalPassage = "A".repeat(60);
  const shortPassage = "B".repeat(20);

  const prefixHash = await sha256PrefixSignal(prefix);
  const oStart = prefix.length;
  const oEnd = oStart + originalPassage.length;
  const ref = `~{v0;o=${oStart}-${oEnd};ctx=pre:${prefixHash.prefix}}`;

  // Doc ends 20 chars after the prefix. Phase 2 needs 60 chars → skips.
  const modifiedContent = prefix + shortPassage;
  const modifiedDoc = await parseDocument.execute({ content: modifiedContent });

  const result = await resolveReference.execute({
    doc: modifiedDoc,
    ref,
  });

  assert(
    result.status === "confident" || result.status === "exact",
    `expected confident or exact, got ${result.status}: ${result.diagnostics}`,
  );
  assert(
    result.passage !== undefined && result.passage.length > 0,
    "passage should be non-empty",
  );
});

Deno.test("ctx suffix-only: passage near SOF shorter than candidateLength", async () => {
  // Suffix matches but candidateLength window doesn't fit before the suffix.
  const suffix = "Suspendisse potenti nulla facilisi sed euismod tempor incid";
  const originalPassage = "C".repeat(60);
  const shortPassage = "D".repeat(20);

  const suffixHash = await sha256PrefixSignal(suffix);
  const oStart = 0;
  const oEnd = originalPassage.length;
  const ref = `~{v0;o=${oStart}-${oEnd};ctx=suf:${suffixHash.prefix}}`;

  // Doc starts with 20 chars before the suffix. Phase 2 needs 60 → skips.
  const modifiedContent = shortPassage + suffix;
  const modifiedDoc = await parseDocument.execute({ content: modifiedContent });

  const result = await resolveReference.execute({
    doc: modifiedDoc,
    ref,
  });

  assert(
    result.status === "confident" || result.status === "exact",
    `expected confident or exact, got ${result.status}: ${result.diagnostics}`,
  );
  assert(
    result.passage !== undefined && result.passage.length > 0,
    "passage should be non-empty",
  );
});
