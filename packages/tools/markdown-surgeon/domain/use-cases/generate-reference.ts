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
import type { BlockStep, BlockTreeParser } from "../ports/block-tree-parser.ts";
import { formatMrfi } from "./mrfi-codec.ts";
import {
  findFirstSectionAnchor,
  findParentSection,
  findSectionContainingLine,
  getDocumentCodepoints,
  getDocumentText,
  getLineEndColumn,
  getOffsetRange,
  getRangeText,
  getSectionScopeText,
  getStructuralNodeSourceForSection,
  getTrimmedSectionEndLine,
  isRangeShapeValid,
  sha256PrefixSignal,
  smh64Value,
  xxh64PrefixSignal,
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
  /** Extent selector — turns this into a scope reference */
  readonly extentSelector?: "sec" | "body" | "lead";
}

/** Builds a fresh MRFI reference for a range or section of a document */
export class GenerateReferenceUseCase {
  /** Create a GenerateReferenceUseCase with the given block-tree parser */
  constructor(private readonly blockTreeParser: BlockTreeParser) {}

  /** Generate the reference in the requested format/profile */
  async execute(input: GenerateReferenceInput): Promise<string> {
    const { doc, target, format, profile, quote, quoteMax, extentSelector } =
      input;
    if (extentSelector && target.kind === "range") {
      throw new MdError(
        "invalid_id",
        "scope references require a section target, not a range",
      );
    }
    return target.kind === "range"
      ? await makeRangeMrfi(
        doc,
        target.range,
        format,
        profile,
        quote,
        quoteMax,
        this.blockTreeParser,
      )
      : await makeSectionMrfi(
        doc,
        target.section,
        format,
        profile,
        quote,
        quoteMax,
        this.blockTreeParser,
        extentSelector,
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
  blockTreeParser: BlockTreeParser,
  extentSelector?: "sec" | "body" | "lead",
): Promise<string> {
  const evidenceRange = extentSelector
    ? {
      startLine: section.line,
      startColumn: 1,
      endLine: section.line,
      endColumn: getLineEndColumn(doc, section.line),
    }
    : {
      startLine: section.line,
      startColumn: 1,
      endLine: getTrimmedSectionEndLine(doc, section),
      endColumn: getLineEndColumn(
        doc,
        getTrimmedSectionEndLine(doc, section),
      ),
    };
  const parsed = await buildMrfiForRange(
    doc,
    evidenceRange,
    blockTreeParser,
    includeQuote ? truncateQuote(section.title, quoteMax) : undefined,
  );
  let withExtent: DebugMrfi;
  if (extentSelector) {
    const parentSection = findParentSection(doc, section);
    const parentHh = parentSection
      ? { hash: await smh64Value(getSectionScopeText(doc, parentSection)) }
      : undefined;
    withExtent = {
      ...parsed,
      extentSelector,
      ...(parentHh ? { headingHash: parentHh } : { headingHash: undefined }),
    };
  } else {
    withExtent = parsed;
  }
  return await formatMrfi(applyMrfiProfile(withExtent, profile), format);
}

async function makeRangeMrfi(
  doc: Document,
  range: SourceRange,
  format: MrfiFormat,
  profile: MrfiProfile,
  includeQuote: boolean,
  quoteMax: number,
  blockTreeParser: BlockTreeParser,
): Promise<string> {
  validateSourceRangeInDocument(doc, range);
  const selectedText = getRangeText(doc, range);
  const parsed = await buildMrfiForRange(
    doc,
    range,
    blockTreeParser,
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
    ...(parsed.extentSelector ? { extentSelector: parsed.extentSelector } : {}),
  };

  if (profile === "min") return base;

  return {
    ...base,
    ...(parsed.structuralPath ? { structuralPath: parsed.structuralPath } : {}),
    ...(parsed.context ? { context: parsed.context } : {}),
    ...(parsed.documentHash ? { documentHash: parsed.documentHash } : {}),
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

// headingHash/documentHash are the same handful of expensive smh64Value
// inputs (one per section, one per document) recomputed once per review
// item. smh64Value's own cache is bounded and keyed by text content, so
// interleaving those few large, reused keys with hundreds of small,
// distinct per-item passageHash keys thrashes them out of it well before a
// large document's items are all minted. Cache these two by the stable
// Section/Document object instead, so they never compete for eviction with
// per-item hashes.
const sectionHeadingHashCache = new WeakMap<Section, Promise<bigint>>();

function getSectionHeadingHash(
  doc: Document,
  section: Section,
): Promise<bigint> {
  const cached = sectionHeadingHashCache.get(section);
  if (cached) return cached;

  const value = smh64Value(getSectionScopeText(doc, section));
  sectionHeadingHashCache.set(section, value);
  return value;
}

const documentHashCache = new WeakMap<Document, Promise<bigint>>();

function getDocumentHash(doc: Document): Promise<bigint> {
  const cached = documentHashCache.get(doc);
  if (cached) return cached;

  const value = smh64Value(getDocumentText(doc));
  documentHashCache.set(doc, value);
  return value;
}

async function buildMrfiForRange(
  doc: Document,
  range: SourceRange,
  blockTreeParser: BlockTreeParser,
  quote?: string,
): Promise<DebugMrfi> {
  const selectedText = getRangeText(doc, range);
  const section = findSectionContainingLine(doc, range.startLine);
  const offsetRange = getOffsetRange(doc, range);
  const anchor = section ? findFirstSectionAnchor(doc, section) : undefined;

  return {
    range,
    offsetRange,
    structuralPath: getStructuralPath(
      doc,
      section,
      offsetRange,
      blockTreeParser,
    ),
    exactHash: xxh64PrefixSignal(selectedText),
    headingHash: {
      hash: section
        ? await getSectionHeadingHash(doc, section)
        : await smh64Value(selectedText),
    },
    passageHash: {
      hash: await smh64Value(selectedText),
    },
    context: await getContextHashes(doc, offsetRange),
    documentHash: {
      hash: await getDocumentHash(doc),
    },
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

/**
 * `p` is a purely structural locator (docs/specs/mrfi.md: "ordered node
 * steps with sibling indices") — sub-block precision belongs to `r`/`o`,
 * not to `p`. Returns undefined when no single block or heading fully
 * identifies the range (e.g. it spans multiple top-level blocks): a
 * document-root-only path would carry no structural evidence.
 */
function getStructuralPath(
  doc: Document,
  section: Section | undefined,
  offsetRange: { start: number; end: number },
  blockTreeParser: BlockTreeParser,
): string | undefined {
  const source = getDocumentText(doc);
  const node = getStructuralNodeSourceForSection(doc, section, source);
  const relativeStart = offsetRange.start - node.startOffset;
  const relativeEnd = offsetRange.end - node.startOffset;

  const blockSteps = blockTreeParser.stepsForRange(
    node.text,
    relativeStart,
    relativeEnd,
  );

  const segments = [
    ...(section ? [formatHeadingAncestry(doc, section)] : []),
    ...blockSteps.map(formatBlockStep),
  ];
  return segments.length > 0 ? segments.join("/") : undefined;
}

function formatBlockStep(step: BlockStep): string {
  return `${step.kind}[${step.occurrence}]`;
}

/** Section-tree ancestry chain from the outermost ancestor down to `section` (inclusive) */
function headingAncestryChain(
  doc: Document,
  section: Section,
): readonly Section[] {
  const chain: Section[] = [];
  let current: Section | undefined = section;
  while (current) {
    chain.unshift(current);
    current = findParentSection(doc, current);
  }
  return chain;
}

function formatHeadingAncestry(doc: Document, section: Section): string {
  const chain = headingAncestryChain(doc, section);
  return chain
    .map((current, index) => {
      const parent = index === 0 ? undefined : chain[index - 1];
      const occurrence = headingOccurrenceUnderParent(doc, current, parent);
      return `h${current.level}[${occurrence}]`;
    })
    .join("/");
}

/** One-based occurrence of `section` among same-level section-tree siblings sharing `parent` */
function headingOccurrenceUnderParent(
  doc: Document,
  section: Section,
  parent: Section | undefined,
): number {
  return doc.sections
    .filter((candidate) =>
      candidate.level === section.level &&
      candidate.line <= section.line &&
      findParentSection(doc, candidate) === parent
    ).length;
}

async function getContextHashes(
  doc: Document,
  offsetRange: { start: number; end: number },
): Promise<{ prefix?: string; suffix?: string }> {
  const source = getDocumentCodepoints(doc);
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
