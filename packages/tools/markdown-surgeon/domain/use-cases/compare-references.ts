/**
 * Use Case: CompareReferences
 *
 * Implements `compare(A, B)` from docs/specs/mrfi.md's "Comparing
 * References Without Resolving": evaluates every field present in both
 * locators, and returns a similarity/comparability/verdict triple plus
 * per-field detail, without ever touching a Document (pure string/locator
 * comparison, no resolution).
 *
 * `rank(target, candidates)` (RankReferenceCandidatesUseCase, in
 * rank-reference-candidates.ts) builds on top of `compareLocators` here.
 */

import { MdError } from "../entities/document.ts";
import type {
  CompareResult,
  DebugMrfi,
  MrfiFieldComparison,
  MrfiVerdict,
} from "../entities/mrfi.ts";
import {
  getMustUnderstandViolations,
  parseMrfiReference,
} from "./mrfi-codec.ts";
import {
  DEFAULT_SMH64_MAX_DISTANCE,
  hammingDistance64,
  includesNormalized,
  normalizeForCompare,
} from "./mrfi-text.ts";

/** Input for the CompareReferences use case: two MRFI reference strings */
export interface CompareReferencesInput {
  readonly a: string;
  readonly b: string;
}

/** Compares two MRFI reference strings per docs/specs/mrfi.md's `compare(A, B)` */
export class CompareReferencesUseCase {
  async execute(input: CompareReferencesInput): Promise<CompareResult> {
    let parsedA: DebugMrfi | undefined;
    let parsedB: DebugMrfi | undefined;
    try {
      parsedA = await parseMrfiReference(input.a);
      parsedB = await parseMrfiReference(input.b);
    } catch (error) {
      return invalidResult([
        error instanceof MdError ? error.message : "invalid MRFI payload",
      ]);
    }
    if (!parsedA || !parsedB) {
      return invalidResult(["unsupported MRFI payload"]);
    }
    return compareLocators(parsedA, parsedB);
  }
}

function invalidResult(diagnostics: string[]): CompareResult {
  return {
    similarity: 0,
    comparability: 0,
    verdict: "invalid",
    fields: [],
    diagnostics,
  };
}

/**
 * Per-field weight used to aggregate `similarity`/`comparability`, roughly
 * following docs/specs/mrfi.md's "Strength" column: `fh`/`a` are near-proof
 * of identity, `hh`/`ph`/`ctx`/`q` are the core graded signals, `p` is
 * medium, `doc` mostly gates `r`/`o` (which stay weak alone). `x` is
 * excluded: per spec it "is not evidence about location" and must not
 * inflate similarity/comparability, even though it always participates and
 * can cap the verdict.
 */
const FIELD_WEIGHT: Readonly<Record<string, number>> = {
  fh: 5,
  a: 5,
  hh: 3,
  ph: 4,
  ctx: 3,
  p: 2,
  doc: 2,
  r: 1,
  o: 1,
  q: 3,
};

/** Fields strong enough to count toward "comparability" (excludes weak/gated r, o) */
const STRONG_FIELDS: readonly string[] = [
  "fh",
  "a",
  "hh",
  "ph",
  "ctx",
  "p",
  "doc",
  "q",
];

/** Per-field similarity threshold above which a graded field counts as "match" rather than "conflict" */
const FIELD_MATCH_THRESHOLD = 0.6;

/** Similarity floor for `likely`, below which agreement is only `possible` */
const LIKELY_SIMILARITY_THRESHOLD = 0.7;

/** Comparability floor for `likely`; below it, evidence is too thin to call it more than `possible` */
const LIKELY_COMPARABILITY_THRESHOLD = 0.5;

/** Pure, sync core of `compare(A, B)`: assumes both locators already parsed */
export function compareLocators(a: DebugMrfi, b: DebugMrfi): CompareResult {
  const mustUnderstand = [
    ...getMustUnderstandViolations(a),
    ...getMustUnderstandViolations(b),
  ];
  if (mustUnderstand.length > 0) {
    return invalidResult([
      `must-understand field violation: ${mustUnderstand.join(", ")}`,
    ]);
  }

  const fields: MrfiFieldComparison[] = [];
  const diagnostics: string[] = [];

  fields.push(compareFragmentHash(a.exactHash, b.exactHash));
  fields.push(compareEquality("a", a.anchor, b.anchor));
  fields.push(compareSmh64("hh", a.headingHash, b.headingHash));
  fields.push(compareSmh64("ph", a.passageHash, b.passageHash));
  fields.push(compareContext(a.context, b.context));
  fields.push(comparePath(a.structuralPath, b.structuralPath));
  const docComparison = compareSmh64("doc", a.documentHash, b.documentHash);
  fields.push(docComparison);
  const docCompatible = docComparison.outcome === "match";
  fields.push(compareRangeField("r", a.range, b.range, docCompatible));
  fields.push(
    compareOffsetField("o", a.offsetRange, b.offsetRange, docCompatible),
  );
  fields.push(compareQuote("q", a.quote, b.quote));
  const xComparison = compareExtentSelector(a.extentSelector, b.extentSelector);
  fields.push(xComparison);

  const scored = fields.filter((f) =>
    f.field !== "x" && f.outcome !== "absent"
  );
  const similarity = weightedAverage(scored);
  const comparability = STRONG_FIELDS
    .map((field) => fields.find((f) => f.field === field))
    .filter((f): f is MrfiFieldComparison =>
      f !== undefined && f.outcome !== "absent"
    )
    .reduce((sum, f) => sum + FIELD_WEIGHT[f.field], 0) /
    STRONG_FIELDS.reduce((sum, field) => sum + FIELD_WEIGHT[field], 0);

  const hasStrongConflict =
    scored.some((f) =>
      f.outcome === "conflict" && (f.field === "fh" || f.field === "a")
    ) || (docComparison.outcome === "conflict" &&
      scored.some((f) =>
        f.outcome === "conflict" &&
        (f.field === "hh" || f.field === "ph" || f.field === "q")
      ));

  let verdict: MrfiVerdict;
  if (comparability === 0) {
    verdict = "incomparable";
    diagnostics.push("no shared field of sufficient strength");
  } else if (hasStrongConflict) {
    verdict = "unrelated";
  } else if (isSame(fields)) {
    verdict = "same";
  } else if (
    similarity >= LIKELY_SIMILARITY_THRESHOLD &&
    comparability >= LIKELY_COMPARABILITY_THRESHOLD
  ) {
    verdict = "likely";
  } else {
    verdict = "possible";
  }

  if (
    xComparison.outcome === "conflict" &&
    (verdict === "same" || verdict === "likely")
  ) {
    diagnostics.push("x mismatch: same identity node, different extent");
    verdict = "possible";
  }

  return { similarity, comparability, verdict, fields, diagnostics };
}

function isSame(fields: readonly MrfiFieldComparison[]): boolean {
  const fh = fields.find((f) => f.field === "fh");
  if (fh?.outcome === "match") return true;
  const a = fields.find((f) => f.field === "a");
  if (a?.outcome !== "match") return false;
  const conflicting = fields.some((f) =>
    f.outcome === "conflict" &&
    (f.field === "fh" || f.field === "hh" || f.field === "ph" ||
      f.field === "q")
  );
  return !conflicting;
}

function weightedAverage(fields: readonly MrfiFieldComparison[]): number {
  let weightSum = 0;
  let scoreSum = 0;
  for (const field of fields) {
    const weight = FIELD_WEIGHT[field.field] ?? 0;
    if (weight === 0) continue;
    const score = field.similarity ?? (field.outcome === "match" ? 1 : 0);
    weightSum += weight;
    scoreSum += weight * score;
  }
  return weightSum === 0 ? 0 : scoreSum / weightSum;
}

/**
 * `fh` per docs/specs/mrfi.md's Locator Fields: "Comparing two hash values
 * requires identical tags." A tag mismatch is non-comparable evidence, not
 * proof of different content, so it reports `absent` rather than
 * `conflict` -- the same treatment as a field present on only one side.
 */
function compareFragmentHash(
  a: DebugMrfi["exactHash"],
  b: DebugMrfi["exactHash"],
): MrfiFieldComparison {
  if (!a || !b || a.algorithm !== b.algorithm) {
    return { field: "fh", outcome: "absent" };
  }
  const matches = a.prefix === b.prefix;
  return {
    field: "fh",
    outcome: matches ? "match" : "conflict",
    similarity: matches ? 1 : 0,
  };
}

function compareEquality(
  field: string,
  a: string | undefined,
  b: string | undefined,
): MrfiFieldComparison {
  if (a === undefined || b === undefined) return { field, outcome: "absent" };
  return {
    field,
    outcome: a === b ? "match" : "conflict",
    similarity: a === b ? 1 : 0,
  };
}

function compareSmh64(
  field: string,
  a: DebugMrfi["headingHash"],
  b: DebugMrfi["headingHash"],
): MrfiFieldComparison {
  if (!a || !b) return { field, outcome: "absent" };
  const maxDistance = Math.min(
    a.maxDistance ?? DEFAULT_SMH64_MAX_DISTANCE,
    b.maxDistance ?? DEFAULT_SMH64_MAX_DISTANCE,
  );
  const distance = hammingDistance64(a.hash, b.hash);
  const similarity = Math.max(0, 1 - distance / 64);
  return {
    field,
    outcome: distance <= maxDistance ? "match" : "conflict",
    similarity,
  };
}

/**
 * `ctx` per docs/specs/mrfi.md: "Each side matches independently" -- but
 * reported as one `ctx` field (matching `FIELD_WEIGHT`/`STRONG_FIELDS`),
 * scored as the fraction of independently-present sides that agree, so a
 * both-sides match scores stronger than a one-side match, per "Strong,
 * especially when both sides match."
 */
function compareContext(
  a: DebugMrfi["context"],
  b: DebugMrfi["context"],
): MrfiFieldComparison {
  if (!a || !b) return { field: "ctx", outcome: "absent" };
  const sides: Array<[string | undefined, string | undefined]> = [
    [a.prefix, b.prefix],
    [a.suffix, b.suffix],
  ];
  const present = sides.filter(([left, right]) =>
    left !== undefined && right !== undefined
  );
  if (present.length === 0) return { field: "ctx", outcome: "absent" };
  const matching = present.filter(([left, right]) => left === right).length;
  const similarity = matching / present.length;
  return {
    field: "ctx",
    outcome: similarity >= FIELD_MATCH_THRESHOLD ? "match" : "conflict",
    similarity,
  };
}

function comparePath(
  a: string | undefined,
  b: string | undefined,
): MrfiFieldComparison {
  if (a === undefined || b === undefined) {
    return { field: "p", outcome: "absent" };
  }
  if (a === b) return { field: "p", outcome: "match", similarity: 1 };
  const stepsA = a.split("/");
  const stepsB = b.split("/");
  let common = 0;
  while (
    common < stepsA.length && common < stepsB.length &&
    stepsA[common] === stepsB[common]
  ) {
    common += 1;
  }
  const similarity = common / Math.max(stepsA.length, stepsB.length);
  return {
    field: "p",
    outcome: similarity >= FIELD_MATCH_THRESHOLD ? "match" : "conflict",
    similarity,
  };
}

function compareRangeField(
  field: string,
  a: DebugMrfi["range"],
  b: DebugMrfi["range"],
  docCompatible: boolean,
): MrfiFieldComparison {
  if (!a || !b || !docCompatible) return { field, outcome: "absent" };
  const overlap = lineRangeOverlap(a, b);
  return {
    field,
    outcome: overlap > 0 ? "match" : "conflict",
    similarity: overlap,
  };
}

function lineRangeOverlap(
  a: { readonly startLine: number; readonly endLine: number },
  b: { readonly startLine: number; readonly endLine: number },
): number {
  const start = Math.max(a.startLine, b.startLine);
  const end = Math.min(a.endLine, b.endLine);
  const overlapLen = Math.max(0, end - start + 1);
  const span = Math.max(a.endLine, b.endLine) -
    Math.min(a.startLine, b.startLine) + 1;
  return span === 0 ? 0 : overlapLen / span;
}

function compareOffsetField(
  field: string,
  a: DebugMrfi["offsetRange"],
  b: DebugMrfi["offsetRange"],
  docCompatible: boolean,
): MrfiFieldComparison {
  if (!a || !b || !docCompatible) return { field, outcome: "absent" };
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  const overlapLen = Math.max(0, end - start);
  const span = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  const overlap = span === 0 ? 0 : overlapLen / span;
  return {
    field,
    outcome: overlap > 0 ? "match" : "conflict",
    similarity: overlap,
  };
}

function compareQuote(
  field: string,
  a: string | undefined,
  b: string | undefined,
): MrfiFieldComparison {
  if (a === undefined || b === undefined) return { field, outcome: "absent" };
  const normA = normalizeForCompare(a);
  const normB = normalizeForCompare(b);
  let similarity: number;
  if (normA === normB) {
    similarity = 1;
  } else if (includesNormalized(a, b) || includesNormalized(b, a)) {
    similarity = 0.6;
  } else {
    similarity = tokenOverlap(normA, normB);
  }
  return {
    field,
    outcome: similarity >= FIELD_MATCH_THRESHOLD ? "match" : "conflict",
    similarity,
  };
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return shared / new Set([...tokensA, ...tokensB]).size;
}

/**
 * `x` always participates: absence counts as the plain-extent default, per
 * docs/specs/mrfi.md's "absence counts as the plain-extent default" — the
 * one field exception to "fields present in only one reference contribute
 * nothing".
 */
function compareExtentSelector(
  a: DebugMrfi["extentSelector"],
  b: DebugMrfi["extentSelector"],
): MrfiFieldComparison {
  const normalizedA = a ?? "plain";
  const normalizedB = b ?? "plain";
  return {
    field: "x",
    outcome: normalizedA === normalizedB ? "match" : "conflict",
  };
}
