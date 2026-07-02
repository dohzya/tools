/**
 * Use Case: GenerateReference
 *
 * Builds a fresh MRFI reference (in debug/base62/hangul form) for a source
 * range or a section, reproducing the exact generation pipeline that used
 * to live inline in the CLI `outline --mrfi` and `ref` commands: computing
 * the range/offset/structural-path locators plus the exact/heading/passage
 * hash signals and context fingerprints, then applying the requested field
 * profile.
 *
 * Dependencies: mrfi-text.ts for document text/range/hash primitives,
 * mrfi-codec.ts to format the built DebugMrfi into the requested output
 * format.
 */

import { MdError } from "../entities/document.ts";
import type { Document, Section } from "../entities/document.ts";
import type {
  DebugMrfi,
  MrfiFormat,
  MrfiProfile,
  SourceRange,
} from "../entities/mrfi.ts";
import { formatMrfi } from "./mrfi-codec.ts";
import {
  buildComparisonMap,
  comparisonIndexForSourceEnd,
  comparisonIndexForSourceStart,
  findFirstSectionAnchor,
  findSectionContainingLine,
  getLineEndColumn,
  getOffsetRange,
  getRangeText,
  getSectionScopeText,
  getStructuralNodeSourceForSection,
  getTrimmedSectionEndLine,
  isRangeShapeValid,
  sha256PrefixSignal,
  smh64Value,
} from "./mrfi-text.ts";

/** Target to generate a MRFI reference for: an explicit range, or a whole section */
export type GenerateReferenceTarget =
  | { readonly kind: "range"; readonly range: SourceRange }
  | { readonly kind: "section"; readonly section: Section };

/** Input for the GenerateReference use case */
export interface GenerateReferenceInput {
  /** Parsed document to generate the reference against */
  readonly doc: Document;
  /** The range or section to generate a reference for */
  readonly target: GenerateReferenceTarget;
  /** Output encoding for the generated reference */
  readonly format: MrfiFormat;
  /** Field verbosity profile to apply */
  readonly profile: MrfiProfile;
  /** Whether to include a `q=` quote evidence field */
  readonly quote: boolean;
  /** Maximum length of the quote evidence field, when included */
  readonly quoteMax: number;
}

/** Builds a fresh MRFI reference for a range or section of a document */
export class GenerateReferenceUseCase {
  /** Generate the reference in the requested format/profile */
  async execute(input: GenerateReferenceInput): Promise<string> {
    const { doc, target, format, profile, quote, quoteMax } = input;
    return target.kind === "range"
      ? await makeRangeMrfi(doc, target.range, format, profile, quote, quoteMax)
      : await makeSectionMrfi(
        doc,
        target.section,
        format,
        profile,
        quote,
        quoteMax,
      );
  }
}

async function makeSectionMrfi(
  doc: Document,
  section: Section,
  format: MrfiFormat,
  profile: MrfiProfile,
  includeQuote: boolean,
  quoteMax: number,
): Promise<string> {
  const endLine = getTrimmedSectionEndLine(doc, section);
  const parsed = await buildMrfiForRange(doc, {
    startLine: section.line,
    startColumn: 1,
    endLine,
    endColumn: getLineEndColumn(doc, endLine),
  }, includeQuote ? truncateQuote(section.title, quoteMax) : undefined);
  return await formatMrfi(applyMrfiProfile(parsed, profile), format);
}

async function makeRangeMrfi(
  doc: Document,
  range: SourceRange,
  format: MrfiFormat,
  profile: MrfiProfile,
  includeQuote: boolean,
  quoteMax: number,
): Promise<string> {
  validateSourceRangeInDocument(doc, range);
  const selectedText = getRangeText(doc, range);
  const parsed = await buildMrfiForRange(
    doc,
    range,
    includeQuote ? truncateQuote(selectedText.trim(), quoteMax) : undefined,
  );
  return await formatMrfi(applyMrfiProfile(parsed, profile), format);
}

function applyMrfiProfile(parsed: DebugMrfi, profile: MrfiProfile): DebugMrfi {
  if (profile === "full") return parsed;

  const base: DebugMrfi = {
    range: parsed.range,
    exactHash: parsed.exactHash,
    headingHash: parsed.headingHash,
    ...(parsed.anchor ? { anchor: parsed.anchor } : {}),
    ...(parsed.quote ? { quote: parsed.quote } : {}),
  };

  if (profile === "min") return base;

  return {
    ...base,
    ...(parsed.structuralPath ? { structuralPath: parsed.structuralPath } : {}),
    ...(parsed.context ? { context: parsed.context } : {}),
  };
}

function truncateQuote(value: string, maxLength: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  if (maxLength <= 0) return "";
  if (maxLength <= 9) return chars.slice(0, maxLength).join("");

  const marker = "...";
  const segmentLength = Math.floor((maxLength - marker.length * 2) / 3);
  const remainder = (maxLength - marker.length * 2) - segmentLength * 3;
  const startLength = segmentLength + (remainder > 0 ? 1 : 0);
  const middleLength = segmentLength + (remainder > 1 ? 1 : 0);
  const endLength = segmentLength;
  const middleStart = Math.max(
    startLength,
    Math.floor((chars.length - middleLength) / 2),
  );

  return [
    chars.slice(0, startLength).join(""),
    marker,
    chars.slice(middleStart, middleStart + middleLength).join(""),
    marker,
    chars.slice(chars.length - endLength).join(""),
  ].join("");
}

async function buildMrfiForRange(
  doc: Document,
  range: SourceRange,
  quote?: string,
): Promise<DebugMrfi> {
  const selectedText = getRangeText(doc, range);
  const section = findSectionContainingLine(doc, range.startLine);
  const scopeText = section ? getSectionScopeText(doc, section) : selectedText;
  const offsetRange = getOffsetRange(doc, range);
  const anchor = section ? findFirstSectionAnchor(doc, section) : undefined;

  return {
    range,
    offsetRange,
    structuralPath: getStructuralPath(doc, section, offsetRange),
    exactHash: await sha256PrefixSignal(selectedText),
    headingHash: {
      hash: await smh64Value(scopeText),
    },
    passageHash: {
      hash: await smh64Value(selectedText),
    },
    context: await getContextHashes(doc, offsetRange),
    documentHash: await sha256PrefixSignal(doc.lines.join("\n")),
    ...(anchor ? { anchor } : {}),
    ...(quote ? { quote } : {}),
  };
}

function validateSourceRangeInDocument(
  doc: Document,
  range: SourceRange,
): void {
  if (!isRangeShapeValid(range)) {
    throw new MdError(
      "invalid_id",
      `Range must select at least one character: ${range.startLine}:${range.startColumn}-${range.endLine}:${range.endColumn}`,
    );
  }

  const lineCount = doc.lines.length;
  if (range.startLine > lineCount || range.endLine > lineCount) {
    throw new MdError(
      "invalid_id",
      `Range is outside the document: ${range.startLine}:${range.startColumn}-${range.endLine}:${range.endColumn}`,
    );
  }

  const startLine = doc.lines[range.startLine - 1] ?? "";
  const endLine = doc.lines[range.endLine - 1] ?? "";
  const startLimit = Array.from(startLine).length + 1;
  const endLimit = Array.from(endLine).length + 1;
  if (range.startColumn > startLimit || range.endColumn > endLimit) {
    throw new MdError(
      "invalid_id",
      `Range column is outside the document line: ${range.startLine}:${range.startColumn}-${range.endLine}:${range.endColumn}`,
    );
  }
}

function getStructuralPath(
  doc: Document,
  section: Section | undefined,
  offsetRange: { start: number; end: number },
): string {
  const source = doc.lines.join("\n");
  const node = getStructuralNodeSourceForSection(doc, section, source);
  const comparisonMap = buildComparisonMap(node.text);
  const relativeStart = offsetRange.start - node.startOffset;
  const relativeEnd = offsetRange.end - node.startOffset;
  const comparisonStart = comparisonIndexForSourceStart(
    comparisonMap,
    relativeStart,
  );
  const comparisonEnd = comparisonIndexForSourceEnd(
    comparisonMap,
    relativeEnd,
  );

  if (!section) {
    return `doc/chars:${comparisonStart}-${comparisonEnd}`;
  }

  const sectionOccurrence = doc.sections
    .filter((candidate) =>
      candidate.level === section.level && candidate.line <= section.line
    ).length;
  return `h${section.level}[${sectionOccurrence}]/chars:${comparisonStart}-${comparisonEnd}`;
}

async function getContextHashes(
  doc: Document,
  offsetRange: { start: number; end: number },
): Promise<{ prefix?: string; suffix?: string }> {
  const source = Array.from(doc.lines.join("\n"));
  const prefixText = source.slice(
    Math.max(0, offsetRange.start - 64),
    offsetRange.start,
  )
    .join("");
  const suffixText = source.slice(offsetRange.end, offsetRange.end + 64).join(
    "",
  );
  return {
    ...(prefixText.length > 0
      ? { prefix: (await sha256PrefixSignal(prefixText)).prefix }
      : {}),
    ...(suffixText.length > 0
      ? { suffix: (await sha256PrefixSignal(suffixText)).prefix }
      : {}),
  };
}
