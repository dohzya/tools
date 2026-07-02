/**
 * Use Case: ResolveReference
 *
 * Resolves a `^anchor` or `~mrfi` reference against a parsed document,
 * reproducing the exact resolution pipeline that used to live inline in the
 * CLI `resolve` command: anchor lookup, physical-range match (with anchor/
 * exact-hash/context/heading-hash contradiction checks), and the fallback
 * chain (exact hash -> context -> fuzzy heading -> structural path) used
 * when the physical range is stale or absent.
 *
 * Dependencies: mrfi-text.ts for document text/range/hash primitives,
 * mrfi-codec.ts to parse the incoming reference string into a DebugMrfi.
 */

import { MdError } from "../entities/document.ts";
import type { Document } from "../entities/document.ts";
import type {
  DebugMrfi,
  ResolveResult,
  SourceRange,
} from "../entities/mrfi.ts";
import { parseMrfiReference } from "./mrfi-codec.ts";
import {
  buildComparisonMap,
  findAnchorLines,
  findSectionContainingLine,
  formatLineRange,
  getOffsetRange,
  getRangeText,
  getSectionOrLinePassage,
  getSectionScopeText,
  getStructuralNodeSourceForSection,
  getTrimmedSectionEndLine,
  hammingDistance64,
  includesNormalized,
  isRangeInsideDocument,
  rangeContainsLine,
  rangeFromOffsets,
  sha256PrefixSignal,
  smh64Value,
  sourceOffsetsFromComparisonRange,
} from "./mrfi-text.ts";

/** Input for the ResolveReference use case */
export interface ResolveReferenceInput {
  /** Parsed document to resolve the reference against */
  readonly doc: Document;
  /** The `^anchor` or `~mrfi` reference to resolve (already split from any witness suffix) */
  readonly ref: string;
  /** Optional witness text (from `::witness` or the ref quote field) used to confirm a match */
  readonly witness?: string;
}

/** Resolves a `^anchor` or `~mrfi` reference against a document */
export class ResolveReferenceUseCase {
  /** Resolve the reference, dispatching to anchor or MRFI resolution based on its prefix */
  async execute(input: ResolveReferenceInput): Promise<ResolveResult> {
    const { doc, ref, witness } = input;
    return ref.startsWith("^")
      ? resolveAnchorReference(doc, ref)
      : await resolveMrfiReference(doc, ref, witness);
  }
}

const DEFAULT_SMH64_MAX_DISTANCE = 8;

function resolveAnchorReference(
  doc: Document,
  ref: string,
): ResolveResult {
  const anchor = ref.slice(1);
  const anchorLines = findAnchorLines(doc, anchor);

  if (anchorLines.length === 0) {
    return {
      ref,
      status: "not_found",
      confidence: 0,
      diagnostics: ["anchor not found"],
    };
  }

  if (anchorLines.length > 1) {
    return {
      ref,
      status: "ambiguous",
      confidence: 0.6,
      anchor,
      diagnostics: ["duplicate anchor"],
      candidates: anchorLines.map((line) => ({
        range: formatLineRange(line, line),
        score: 60,
        reasons: ["anchor occurrence"],
      })),
    };
  }

  const anchorLine = anchorLines[0];
  const passage = getSectionOrLinePassage(doc, anchorLine);

  return {
    ref,
    status: "exact",
    confidence: 1,
    range: formatLineRange(passage.startLine, passage.endLine),
    anchor,
    passage: passage.text,
    diagnostics: ["unique anchor matched"],
  };
}

async function resolveMrfiReference(
  doc: Document,
  ref: string,
  witness?: string,
): Promise<ResolveResult> {
  let parsed: DebugMrfi | undefined;
  try {
    parsed = await parseMrfiReference(ref);
  } catch (error) {
    return {
      ref,
      status: "invalid",
      confidence: 0,
      diagnostics: [
        error instanceof MdError ? error.message : "invalid MRFI payload",
      ],
    };
  }
  if (!parsed) {
    return {
      ref,
      status: "invalid",
      confidence: 0,
      diagnostics: ["unsupported MRFI payload"],
    };
  }

  if (parsed.range) {
    if (!isRangeInsideDocument(doc, parsed.range)) {
      const fallback = await resolveMrfiWithoutPhysicalRange(
        doc,
        ref,
        parsed,
        witness,
      );
      if (fallback) return fallback;

      return {
        ref,
        status: "not_found",
        confidence: 0,
        diagnostics: ["range is outside the document"],
      };
    }

    const startLine = clampLine(parsed.range.startLine, doc);
    const endLine = clampLine(parsed.range.endLine, doc);
    if (startLine > endLine) {
      return {
        ref,
        status: "not_found",
        confidence: 0,
        diagnostics: ["range is outside the document"],
      };
    }

    const currentRange: SourceRange = {
      ...parsed.range,
      startLine,
      endLine,
    };
    const anchorResult = parsed.anchor
      ? resolveMrfiAnchorSignal(doc, ref, parsed.anchor)
      : undefined;
    const anchorContradictsRange = anchorResult !== undefined &&
      !rangeContainsLine(currentRange, anchorResult.anchorLine);
    const passage = getRangeText(doc, currentRange);
    const diagnostics = ["range matched"];
    const rangeSection = findSectionContainingLine(doc, startLine);
    const headingHashText = rangeSection
      ? getSectionScopeText(doc, rangeSection)
      : passage;
    const headingDistance = parsed.headingHash
      ? hammingDistance64(
        await smh64Value(headingHashText),
        parsed.headingHash.hash,
      )
      : undefined;
    if (headingDistance !== undefined) {
      diagnostics.push(`range smh64 distance ${headingDistance}`);
    }
    const exactHashMatched = parsed.exactHash
      ? (await sha256PrefixSignal(passage)).prefix === parsed.exactHash.prefix
      : false;
    if (exactHashMatched) {
      diagnostics.push("range exact fragment hash matched");
    }
    const contextDiagnostics = await getContextDiagnosticsForRange(
      doc,
      parsed.context,
      currentRange,
    );
    diagnostics.push(...contextDiagnostics);
    const evidence = getTextEvidence(parsed, witness);
    const evidenceMatched = evidence
      ? includesNormalized(passage, evidence.text)
      : false;
    if (evidenceMatched && evidence) {
      diagnostics.push(`${evidence.label} matched`);
    }

    if (
      anchorResult !== undefined && anchorContradictsRange &&
      !exactHashMatched && contextDiagnostics.length === 0 &&
      !evidenceMatched
    ) {
      return anchorResult.result;
    }

    const evidenceContradictsRange = evidence !== undefined &&
      !evidenceMatched;
    const exactHashContradictsRange = parsed.exactHash !== undefined &&
      !exactHashMatched;
    const contextContradictsRange = hasContextSignal(parsed.context) &&
      contextDiagnostics.length === 0;
    const headingHashContradictsRange = headingDistance !== undefined &&
      headingDistance >
        (parsed.headingHash?.maxDistance ?? DEFAULT_SMH64_MAX_DISTANCE);
    const anchorContradictionWithoutStrongRangeEvidence =
      anchorContradictsRange &&
      !exactHashMatched && contextDiagnostics.length === 0 &&
      !evidenceMatched;
    if (
      evidenceContradictsRange ||
      exactHashContradictsRange ||
      contextContradictsRange ||
      headingHashContradictsRange ||
      anchorContradictionWithoutStrongRangeEvidence
    ) {
      if (anchorResult !== undefined && anchorContradictsRange) {
        return anchorResult.result;
      }

      const exactResult = await resolveExactHashReference(
        doc,
        ref,
        parsed,
        witness,
      );
      if (exactResult) {
        return exactResult;
      }

      const contextResult = await resolveContextReference(
        doc,
        ref,
        parsed,
        witness,
      );
      if (contextResult) {
        return contextResult;
      }

      if (parsed.headingHash) {
        const fuzzyResult = await resolveFuzzyHeadingReference(
          doc,
          ref,
          parsed,
          witness,
        );
        if (
          fuzzyResult.status === "confident" ||
          fuzzyResult.status === "ambiguous"
        ) {
          return fuzzyResult;
        }
      }

      const structuralResult = resolveStructuralPathReference(
        doc,
        ref,
        parsed,
        witness,
      );
      if (structuralResult) {
        return structuralResult;
      }
    }

    const status = evidence !== undefined
      ? (evidenceMatched ? "confident" : "stale")
      : (exactHashContradictsRange || contextContradictsRange ||
          headingHashContradictsRange)
      ? "stale"
      : "confident";
    const confidence = evidence !== undefined
      ? (evidenceMatched ? 0.86 : 0.55)
      : (exactHashContradictsRange || contextContradictsRange ||
          headingHashContradictsRange)
      ? 0.55
      : 0.75;

    return {
      ref,
      status,
      confidence,
      range: formatLineRange(startLine, endLine),
      passage,
      diagnostics,
    };
  }

  const fallback = await resolveMrfiWithoutPhysicalRange(
    doc,
    ref,
    parsed,
    witness,
  );
  if (fallback) return fallback;

  return {
    ref,
    status: "invalid",
    confidence: 0,
    diagnostics: ["MRFI payload has no supported locator signal"],
  };
}

async function resolveMrfiWithoutPhysicalRange(
  doc: Document,
  ref: string,
  parsed: DebugMrfi,
  witness?: string,
): Promise<ResolveResult | undefined> {
  if (parsed.anchor) {
    const anchorResult = resolveMrfiAnchorSignal(doc, ref, parsed.anchor);
    if (anchorResult) {
      return anchorResult.result;
    }
  }

  const exactResult = await resolveExactHashReference(
    doc,
    ref,
    parsed,
    witness,
  );
  if (exactResult) {
    return exactResult;
  }

  const contextResult = await resolveContextReference(
    doc,
    ref,
    parsed,
    witness,
  );
  if (contextResult) {
    return contextResult;
  }

  if (parsed.headingHash) {
    const fuzzyResult = await resolveFuzzyHeadingReference(
      doc,
      ref,
      parsed,
      witness,
    );
    if (
      fuzzyResult.status === "confident" ||
      fuzzyResult.status === "ambiguous"
    ) {
      return fuzzyResult;
    }
  }

  const structuralResult = resolveStructuralPathReference(
    doc,
    ref,
    parsed,
    witness,
  );
  if (structuralResult) {
    return structuralResult;
  }

  if (parsed.headingHash) {
    return await resolveFuzzyHeadingReference(doc, ref, parsed, witness);
  }

  return undefined;
}

function resolveMrfiAnchorSignal(
  doc: Document,
  ref: string,
  anchor: string,
): { anchorLine: number; result: ResolveResult } | undefined {
  const anchorLines = findAnchorLines(doc, anchor);
  if (anchorLines.length === 0) return undefined;

  const anchorResult = resolveAnchorReference(doc, `^${anchor}`);
  if (
    anchorResult.status !== "exact" && anchorResult.status !== "ambiguous"
  ) {
    return undefined;
  }

  return {
    anchorLine: anchorLines[0],
    result: {
      ...anchorResult,
      ref,
      diagnostics: ["MRFI anchor signal", ...anchorResult.diagnostics],
    },
  };
}

async function resolveExactHashReference(
  doc: Document,
  ref: string,
  parsed: DebugMrfi,
  witness?: string,
): Promise<ResolveResult | undefined> {
  if (!parsed.exactHash) return undefined;

  const expected = parsed.exactHash.prefix;
  const candidateLength = getExpectedFragmentLength(parsed);
  if (candidateLength !== undefined && candidateLength <= 0) {
    return undefined;
  }

  const candidates: Array<{
    readonly contextDiagnostics: string[];
    readonly passage: string;
    readonly range: SourceRange;
    readonly score: number;
  }> = [];

  const source = Array.from(doc.lines.join("\n"));
  const collectCandidates = async (sourceLength: number): Promise<void> => {
    for (
      let startOffset = 0;
      startOffset <= source.length - sourceLength;
      startOffset += 1
    ) {
      const endOffset = startOffset + sourceLength;
      const candidate = source.slice(startOffset, endOffset).join("");
      if ((await sha256PrefixSignal(candidate)).prefix !== expected) {
        continue;
      }

      const trimmedOffsets = trimBoundaryWhitespaceOffsets(
        source,
        startOffset,
        endOffset,
      );
      if (trimmedOffsets === undefined) continue;

      const range = rangeFromOffsets(
        doc,
        trimmedOffsets.start,
        trimmedOffsets.end,
      );
      if (
        candidates.some((existing) => rangesEqual(existing.range, range))
      ) {
        continue;
      }
      const contextDiagnostics = await getContextDiagnosticsForRange(
        doc,
        parsed.context,
        range,
      );
      candidates.push({
        contextDiagnostics,
        passage: source.slice(trimmedOffsets.start, trimmedOffsets.end).join(
          "",
        ),
        range,
        score: 25 + contextDiagnostics.length * 10,
      });
    }
  };

  if (candidateLength !== undefined) {
    await collectCandidates(candidateLength);
  }

  if (candidates.length === 0) {
    const minCandidateLength = candidateLength === undefined
      ? 1
      : Math.max(1, candidateLength - 64);
    const maxCandidateLength = candidateLength === undefined
      ? Math.min(source.length, 512)
      : Math.min(source.length, candidateLength + 64);
    for (
      let sourceLength = minCandidateLength;
      sourceLength <= maxCandidateLength;
      sourceLength += 1
    ) {
      if (sourceLength === candidateLength) continue;
      await collectCandidates(sourceLength);
    }
  }

  if (candidates.length === 0) return undefined;

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const sameScoreCandidates = candidates.filter((candidate) =>
    candidate.score === best.score
  );
  if (sameScoreCandidates.length > 1) {
    return {
      ref,
      status: "ambiguous",
      confidence: 0.7,
      diagnostics: ["exact fragment hash match is ambiguous"],
      candidates: sameScoreCandidates.slice(0, 5).map((candidate) => ({
        range: formatLineRange(
          candidate.range.startLine,
          candidate.range.endLine,
        ),
        score: candidate.score,
        reasons: ["exact fragment hash match", ...candidate.contextDiagnostics],
      })),
    };
  }

  const evidence = getTextEvidence(parsed, witness);
  const evidenceMatched = evidence
    ? includesNormalized(best.passage, evidence.text)
    : false;
  const diagnostics = [
    "exact fragment hash match",
    ...best.contextDiagnostics,
  ];
  if (evidenceMatched && evidence) {
    diagnostics.push(`${evidence.label} matched`);
  } else if (evidence !== undefined) {
    diagnostics.push(`${evidence.label} did not match exact hash candidate`);
  }

  return {
    ref,
    status: evidence !== undefined && !evidenceMatched ? "stale" : "confident",
    confidence: evidence !== undefined && !evidenceMatched ? 0.6 : 0.95,
    range: formatLineRange(best.range.startLine, best.range.endLine),
    passage: best.passage,
    diagnostics,
  };
}

async function resolveContextReference(
  doc: Document,
  ref: string,
  parsed: DebugMrfi,
  witness?: string,
): Promise<ResolveResult | undefined> {
  if (!parsed.context) return undefined;

  const candidateLength = getExpectedFragmentLength(parsed);
  if (candidateLength === undefined || candidateLength <= 0) {
    return undefined;
  }

  const source = Array.from(doc.lines.join("\n"));
  const contextSignals = [
    parsed.context.prefix ? "prefix" : undefined,
    parsed.context.suffix ? "suffix" : undefined,
  ].filter((signal) => signal !== undefined);
  if (contextSignals.length === 0) return undefined;

  const candidates: Array<{
    readonly diagnostics: string[];
    readonly matchedSignals: number;
    readonly passage: string;
    readonly range: SourceRange;
    readonly score: number;
  }> = [];

  if (parsed.context.prefix && parsed.context.suffix) {
    const maxVariableLength = Math.max(128, candidateLength * 4);
    for (let startOffset = 0; startOffset < source.length; startOffset += 1) {
      if (
        !(await contextPrefixMatchesAt(source, parsed.context, startOffset))
      ) {
        continue;
      }

      for (
        let endOffset = startOffset + 1;
        endOffset <= Math.min(source.length, startOffset + maxVariableLength);
        endOffset += 1
      ) {
        if (
          !(await contextSuffixMatchesAt(source, parsed.context, endOffset))
        ) {
          continue;
        }

        const range = rangeFromOffsets(doc, startOffset, endOffset);
        candidates.push({
          diagnostics: ["context prefix match", "context suffix match"],
          matchedSignals: 2,
          passage: getRangeText(doc, range),
          range,
          score: 20 +
            lengthSimilarityBonus(candidateLength, endOffset - startOffset),
        });
      }
    }
  }

  if (candidates.length === 0) {
    for (
      let startOffset = 0;
      startOffset + candidateLength <= source.length;
      startOffset += 1
    ) {
      const endOffset = startOffset + candidateLength;
      const range = rangeFromOffsets(doc, startOffset, endOffset);
      const diagnostics = await getContextDiagnosticsForRange(
        doc,
        parsed.context,
        range,
      );
      if (diagnostics.length === 0) continue;

      const sameLineShape = parsed.range?.startLine === parsed.range?.endLine &&
        range.startLine === range.endLine;
      candidates.push({
        diagnostics,
        matchedSignals: diagnostics.length,
        passage: getRangeText(doc, range),
        range,
        score: diagnostics.length * 10 + (sameLineShape ? 1 : 0),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) return undefined;

  const sameScoreCandidates = candidates.filter((candidate) =>
    candidate.score === best.score
  );
  if (sameScoreCandidates.length > 1) {
    return {
      ref,
      status: "ambiguous",
      confidence: 0.65,
      diagnostics: ["context match is ambiguous"],
      candidates: sameScoreCandidates.slice(0, 5).map((candidate) => ({
        range: formatLineRange(
          candidate.range.startLine,
          candidate.range.endLine,
        ),
        score: candidate.score,
        reasons: candidate.diagnostics,
      })),
    };
  }

  const evidence = getTextEvidence(parsed, witness);
  const evidenceMatched = evidence
    ? includesNormalized(best.passage, evidence.text)
    : false;
  const diagnostics = [...best.diagnostics];
  if (evidenceMatched && evidence) {
    diagnostics.push(`${evidence.label} matched`);
  } else if (evidence !== undefined) {
    diagnostics.push(`${evidence.label} did not match context candidate`);
  }

  const status = evidence !== undefined && !evidenceMatched
    ? "stale"
    : "confident";
  const confidence = best.matchedSignals === contextSignals.length
    ? 0.88
    : 0.78;

  return {
    ref,
    status,
    confidence,
    range: formatLineRange(best.range.startLine, best.range.endLine),
    passage: best.passage,
    diagnostics,
  };
}

function trimBoundaryWhitespaceOffsets(
  source: readonly string[],
  startOffset: number,
  endOffset: number,
): { start: number; end: number } | undefined {
  let start = startOffset;
  let end = endOffset;
  while (start < end && /\s/u.test(source[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/u.test(source[end - 1] ?? "")) {
    end -= 1;
  }
  return start < end ? { start, end } : undefined;
}

function rangesEqual(left: SourceRange, right: SourceRange): boolean {
  return left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn;
}

async function contextPrefixMatchesAt(
  source: readonly string[],
  context: DebugMrfi["context"],
  startOffset: number,
): Promise<boolean> {
  if (!context?.prefix) return false;
  const maxWindow = Math.min(64, startOffset);
  for (let windowLength = 1; windowLength <= maxWindow; windowLength += 1) {
    const prefixText = source.slice(startOffset - windowLength, startOffset)
      .join("");
    if ((await sha256PrefixSignal(prefixText)).prefix === context.prefix) {
      return true;
    }
  }
  return false;
}

async function contextSuffixMatchesAt(
  source: readonly string[],
  context: DebugMrfi["context"],
  endOffset: number,
): Promise<boolean> {
  if (!context?.suffix) return false;
  const maxWindow = Math.min(64, source.length - endOffset);
  for (let windowLength = 1; windowLength <= maxWindow; windowLength += 1) {
    const suffixText = source.slice(endOffset, endOffset + windowLength).join(
      "",
    );
    if ((await sha256PrefixSignal(suffixText)).prefix === context.suffix) {
      return true;
    }
  }
  return false;
}

function lengthSimilarityBonus(
  expectedLength: number,
  actualLength: number,
): number {
  const delta = Math.abs(expectedLength - actualLength);
  return Math.max(0, 5 - Math.min(5, delta));
}

async function getContextDiagnosticsForRange(
  doc: Document,
  context: DebugMrfi["context"],
  range: SourceRange,
): Promise<string[]> {
  if (!context) return [];

  const source = Array.from(doc.lines.join("\n"));
  const offsetRange = getOffsetRange(doc, range);
  const diagnostics: string[] = [];
  if (context.prefix) {
    if (await contextPrefixMatchesAt(source, context, offsetRange.start)) {
      diagnostics.push("context prefix match");
    }
  }
  if (context.suffix) {
    if (await contextSuffixMatchesAt(source, context, offsetRange.end)) {
      diagnostics.push("context suffix match");
    }
  }
  return diagnostics;
}

function hasContextSignal(context: DebugMrfi["context"]): boolean {
  return context?.prefix !== undefined || context?.suffix !== undefined;
}

function resolveStructuralPathReference(
  doc: Document,
  ref: string,
  parsed: DebugMrfi,
  witness?: string,
): ResolveResult | undefined {
  if (!parsed.structuralPath) return undefined;

  const range = rangeFromStructuralPath(doc, parsed.structuralPath);
  if (!range) return undefined;

  const passage = getRangeText(doc, range);
  const evidence = getTextEvidence(parsed, witness);
  const evidenceMatched = evidence
    ? includesNormalized(passage, evidence.text)
    : false;
  const diagnostics = ["structural path match"];
  if (evidenceMatched && evidence) {
    diagnostics.push(`${evidence.label} matched`);
  } else if (evidence !== undefined) {
    diagnostics.push(`${evidence.label} did not match structural candidate`);
  }

  return {
    ref,
    status: evidence !== undefined && !evidenceMatched ? "stale" : "confident",
    confidence: evidence !== undefined && !evidenceMatched ? 0.6 : 0.78,
    range: formatLineRange(range.startLine, range.endLine),
    passage,
    diagnostics,
  };
}

function getExpectedFragmentLength(parsed: DebugMrfi): number | undefined {
  if (parsed.offsetRange) {
    return parsed.offsetRange.end - parsed.offsetRange.start;
  }
  const structuralLength = getStructuralPathLength(parsed.structuralPath);
  if (structuralLength !== undefined) {
    return structuralLength;
  }
  if (parsed.range && parsed.range.startLine === parsed.range.endLine) {
    return parsed.range.endColumn - parsed.range.startColumn;
  }
  return undefined;
}

function getStructuralPathLength(
  structuralPath: string | undefined,
): number | undefined {
  const match = structuralPath?.match(/\/chars:(\d+)-(\d+)$/);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end > start ? end - start : undefined;
}

function rangeFromStructuralPath(
  doc: Document,
  structuralPath: string,
): SourceRange | undefined {
  const match = structuralPath.match(
    /^(?:(doc)|h([1-6])\[(\d+)\])\/chars:(\d+)-(\d+)$/,
  );
  if (!match) return undefined;

  const relativeStart = Number(match[4]);
  const relativeEnd = Number(match[5]);
  if (relativeEnd <= relativeStart) return undefined;

  const source = doc.lines.join("\n");
  const section = match[1] === "doc" ? undefined : doc.sections
    .filter((candidate) => candidate.level === Number(match[2]))[
      Number(match[3]) - 1
    ];
  if (match[1] !== "doc" && section === undefined) return undefined;

  const node = getStructuralNodeSourceForSection(doc, section, source);
  const comparisonMap = buildComparisonMap(node.text);
  const sourceRange = sourceOffsetsFromComparisonRange(
    comparisonMap,
    relativeStart,
    relativeEnd,
  );
  if (!sourceRange) return undefined;

  const startOffset = node.startOffset + sourceRange.start;
  const endOffset = node.startOffset + sourceRange.end;
  const sourceLength = Array.from(doc.lines.join("\n")).length;
  if (startOffset < 0 || endOffset > sourceLength) return undefined;

  return rangeFromOffsets(doc, startOffset, endOffset);
}

async function resolveFuzzyHeadingReference(
  doc: Document,
  ref: string,
  parsed: DebugMrfi,
  witness?: string,
): Promise<ResolveResult> {
  if (!parsed.headingHash) {
    return {
      ref,
      status: "invalid",
      confidence: 0,
      diagnostics: ["MRFI payload has no fuzzy heading hash"],
    };
  }

  const maxDistance = parsed.headingHash.maxDistance ??
    DEFAULT_SMH64_MAX_DISTANCE;
  const expectedHash = parsed.headingHash.hash;
  const candidates = (await Promise.all(doc.sections
    .map(async (section) => {
      const hash = await smh64Value(getSectionScopeText(doc, section));
      const distance = hammingDistance64(hash, expectedHash);
      return {
        distance,
        section,
        score: Math.round(10 * Math.max(0, 1 - distance / maxDistance)),
      };
    })))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);

  const best = candidates[0];
  if (!best) {
    return {
      ref,
      status: "stale",
      confidence: 0.45,
      diagnostics: ["no fuzzy heading match"],
    };
  }

  const second = candidates[1];
  if (second && second.distance - best.distance < 3) {
    return {
      ref,
      status: "ambiguous",
      confidence: 0.65,
      diagnostics: ["fuzzy heading match is ambiguous"],
      candidates: candidates.slice(0, 5).map((candidate) => ({
        range: formatLineRange(
          candidate.section.line,
          getTrimmedSectionEndLine(doc, candidate.section),
        ),
        score: candidate.score,
        reasons: [`smh64 distance ${candidate.distance}`],
      })),
    };
  }

  const endLine = getTrimmedSectionEndLine(doc, best.section);
  const passage = doc.lines.slice(best.section.line - 1, endLine).join("\n");
  const diagnostics = [
    `fuzzy heading match`,
    `smh64 distance ${best.distance}`,
  ];
  const evidence = getTextEvidence(parsed, witness);
  const evidenceMatched = evidence
    ? includesNormalized(passage, evidence.text)
    : false;
  if (evidenceMatched && evidence) {
    diagnostics.push(`${evidence.label} matched`);
  } else if (evidence !== undefined) {
    diagnostics.push(`${evidence.label} did not match best candidate`);
  }

  const baseConfidence = Math.max(0.75, 1 - best.distance / (maxDistance * 2));
  const status = evidence !== undefined && !evidenceMatched
    ? "stale"
    : "confident";
  const confidence = evidence !== undefined
    ? (evidenceMatched ? Math.max(0.86, baseConfidence) : 0.6)
    : baseConfidence;

  return {
    ref,
    status,
    confidence,
    range: formatLineRange(best.section.line, endLine),
    passage,
    diagnostics,
  };
}

function getTextEvidence(
  parsed: DebugMrfi,
  witness?: string,
): { label: "witness text" | "quote"; text: string } | undefined {
  if (witness !== undefined) {
    return { label: "witness text", text: witness };
  }
  if (parsed.quote !== undefined) {
    return { label: "quote", text: parsed.quote };
  }
  return undefined;
}

function clampLine(line: number, doc: Document): number {
  return Math.max(1, Math.min(line, doc.lines.length));
}
