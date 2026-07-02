/**
 * Document text/range/hash primitives shared by MRFI resolution and
 * generation.
 *
 * Pure functions operating on `Document` + `SourceRange`/offsets/text: line
 * <-> column <-> offset conversion, section/anchor lookup, the "comparison
 * map" used to translate a structural path back to source offsets (and vice
 * versa), and the SimHash (smh64) / SHA-256 fragment hashing used by both
 * the resolver and the generator to compute matching locator signals.
 */

import type { Document, Section } from "../entities/document.ts";
import type {
  ComparisonSpan,
  HashSignal,
  SourceRange,
} from "../entities/mrfi.ts";
import { encodeBase62Payload } from "./mrfi-cbor.ts";

export const ANCHOR_COMMENT_RE = /^<!--\s*\^([A-Za-z0-9_.:-]+)\s*-->$/;

export const UINT64_MASK = 0xffffffffffffffffn;

export function rangeContainsLine(range: SourceRange, line: number): boolean {
  return range.startLine <= line && line <= range.endLine;
}

export function isRangeInsideDocument(
  doc: Document,
  range: SourceRange,
): boolean {
  if (!isRangeShapeValid(range)) return false;
  if (range.startLine < 1 || range.endLine < range.startLine) return false;
  if (range.startLine > doc.lines.length || range.endLine > doc.lines.length) {
    return false;
  }

  const startLimit = Array.from(doc.lines[range.startLine - 1] ?? "").length +
    1;
  const endLimit = Array.from(doc.lines[range.endLine - 1] ?? "").length + 1;
  return range.startColumn >= 1 &&
    range.endColumn >= 1 &&
    range.startColumn <= startLimit &&
    range.endColumn <= endLimit;
}

export function getStructuralNodeSourceForSection(
  doc: Document,
  section: Section | undefined,
  source: string,
): { startOffset: number; text: string } {
  if (!section) {
    return { startOffset: 0, text: source };
  }

  const startOffset = lineColumnToOffset(doc, section.line, 1);
  const endOffset = lineColumnToOffset(
    doc,
    section.lineEnd,
    getLineEndColumn(doc, section.lineEnd),
  );
  return {
    startOffset,
    text: Array.from(source).slice(startOffset, endOffset).join(""),
  };
}

export function buildComparisonMap(text: string): readonly ComparisonSpan[] {
  const spans: ComparisonSpan[] = [];
  const chars = Array.from(text);
  let pendingWhitespaceStart: number | undefined;
  let pendingWhitespaceEnd = 0;

  const flushWhitespace = (): void => {
    if (pendingWhitespaceStart === undefined) return;
    spans.push({
      sourceStart: pendingWhitespaceStart,
      sourceEnd: pendingWhitespaceEnd,
      value: " ",
    });
    pendingWhitespaceStart = undefined;
  };

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (/\s/u.test(char)) {
      pendingWhitespaceStart ??= index;
      pendingWhitespaceEnd = index + 1;
      continue;
    }

    flushWhitespace();
    for (
      const normalizedChar of Array.from(char.normalize("NFC").toLowerCase())
    ) {
      spans.push({
        sourceStart: index,
        sourceEnd: index + 1,
        value: normalizedChar,
      });
    }
  }
  flushWhitespace();

  let start = 0;
  let end = spans.length;
  while (start < end && spans[start]?.value === " ") start += 1;
  while (end > start && spans[end - 1]?.value === " ") end -= 1;
  return spans.slice(start, end);
}

export function comparisonIndexForSourceStart(
  comparisonMap: readonly ComparisonSpan[],
  sourceOffset: number,
): number {
  return comparisonMap.filter((span) => span.sourceEnd <= sourceOffset).length;
}

export function comparisonIndexForSourceEnd(
  comparisonMap: readonly ComparisonSpan[],
  sourceOffset: number,
): number {
  return comparisonMap.filter((span) => span.sourceStart < sourceOffset).length;
}

export function sourceOffsetsFromComparisonRange(
  comparisonMap: readonly ComparisonSpan[],
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  if (start < 0 || end <= start || end > comparisonMap.length) {
    return undefined;
  }
  const first = comparisonMap[start];
  const last = comparisonMap[end - 1];
  if (!first || !last) return undefined;
  return { start: first.sourceStart, end: last.sourceEnd };
}

export function rangeFromOffsets(
  doc: Document,
  startOffset: number,
  endOffset: number,
): SourceRange {
  const start = offsetToLineColumn(doc, startOffset);
  const end = offsetToLineColumn(doc, endOffset);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

export function offsetToLineColumn(
  doc: Document,
  offset: number,
): { line: number; column: number } {
  let remaining = offset;
  for (let index = 0; index < doc.lines.length; index += 1) {
    const lineLength = Array.from(doc.lines[index] ?? "").length;
    if (remaining <= lineLength) {
      return { line: index + 1, column: remaining + 1 };
    }
    remaining -= lineLength + 1;
  }

  const lastLine = Math.max(1, doc.lines.length);
  const lastLineLength = Array.from(doc.lines[lastLine - 1] ?? "").length;
  return { line: lastLine, column: lastLineLength + 1 };
}

export function findAnchorLines(doc: Document, anchor: string): number[] {
  const matches: number[] = [];
  let inCodeBlock = false;
  for (let index = 0; index < doc.lines.length; index += 1) {
    const trimmed = doc.lines[index]?.trim() ?? "";
    if (isCodeFenceLine(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = trimmed.match(ANCHOR_COMMENT_RE);
    if (match?.[1] === anchor) {
      matches.push(index + 1);
    }
  }
  return matches;
}

export function getSectionOrLinePassage(
  doc: Document,
  line: number,
): { startLine: number; endLine: number; text: string } {
  const section = doc.sections.find((candidate) =>
    candidate.line <= line && line <= candidate.lineEnd
  );
  const startLine = section?.line ?? line;
  const endLine = section ? getTrimmedSectionEndLine(doc, section) : line;
  return {
    startLine,
    endLine,
    text: doc.lines.slice(startLine - 1, endLine).join("\n"),
  };
}

export function getSectionScopeText(doc: Document, section: Section): string {
  return doc.lines.slice(
    section.line - 1,
    getTrimmedSectionEndLine(doc, section),
  )
    .join("\n");
}

export function isRangeShapeValid(range: SourceRange): boolean {
  if (
    range.startLine < 1 || range.startColumn < 1 || range.endLine < 1 ||
    range.endColumn < 1
  ) {
    return false;
  }
  if (range.endLine < range.startLine) return false;
  if (range.endLine === range.startLine) {
    return range.endColumn > range.startColumn;
  }
  return true;
}

export function getOffsetRange(
  doc: Document,
  range: SourceRange,
): { start: number; end: number } {
  return {
    start: lineColumnToOffset(doc, range.startLine, range.startColumn),
    end: lineColumnToOffset(doc, range.endLine, range.endColumn),
  };
}

export function lineColumnToOffset(
  doc: Document,
  line: number,
  column: number,
): number {
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) {
    offset += Array.from(doc.lines[index] ?? "").length + 1;
  }
  return offset + column - 1;
}

export function findSectionContainingLine(
  doc: Document,
  line: number,
): Section | undefined {
  return doc.sections.find((section) =>
    section.line <= line && line <= section.lineEnd
  );
}

export function getRangeText(doc: Document, range: SourceRange): string {
  const lines = doc.lines.slice(range.startLine - 1, range.endLine);
  if (lines.length === 0) return "";

  if (range.startLine === range.endLine) {
    return sliceByScalarColumns(
      lines[0] ?? "",
      range.startColumn,
      range.endColumn,
    );
  }

  const firstLine = sliceByScalarColumns(
    lines[0] ?? "",
    range.startColumn,
    Number.MAX_SAFE_INTEGER,
  );
  const lastLine = sliceByScalarColumns(
    lines[lines.length - 1] ?? "",
    1,
    range.endColumn,
  );
  return [firstLine, ...lines.slice(1, -1), lastLine].join("\n");
}

export function sliceByScalarColumns(
  line: string,
  startColumn: number,
  endColumn: number,
): string {
  return Array.from(line).slice(startColumn - 1, endColumn - 1).join("");
}

export function findFirstSectionAnchor(
  doc: Document,
  section: Section,
): string | undefined {
  let inCodeBlock = false;
  for (let line = 1; line <= section.lineEnd; line += 1) {
    const trimmed = doc.lines[line - 1]?.trim() ?? "";
    if (isCodeFenceLine(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (line < section.line || inCodeBlock) continue;

    const match = trimmed.match(ANCHOR_COMMENT_RE);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export function isCodeFenceLine(trimmedLine: string): boolean {
  return trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~");
}

export function getTrimmedSectionEndLine(
  doc: Document,
  section: Section,
): number {
  let endLine = section.lineEnd;
  while (endLine > section.line && doc.lines[endLine - 1]?.trim() === "") {
    endLine -= 1;
  }
  return endLine;
}

export function getLineEndColumn(doc: Document, line: number): number {
  return Array.from(doc.lines[line - 1] ?? "").length + 1;
}

export function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
}

export function includesNormalized(haystack: string, needle: string): boolean {
  return normalizeForCompare(haystack).includes(normalizeForCompare(needle));
}

export function normalizeForCompare(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function smh64Value(text: string): Promise<bigint> {
  const tokens = tokenizeForSmh64(text);
  const accumulators = Array.from({ length: 64 }, () => 0);
  const features: Array<{ feature: string; weight: number }> = [];

  for (const token of tokens) {
    features.push({ feature: `u:${token}`, weight: 1 });
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    features.push({
      feature: `b:${tokens[index]}\0${tokens[index + 1]}`,
      weight: 2,
    });
  }

  if (features.length === 0) {
    features.push({ feature: "empty", weight: 1 });
  }

  for (const { feature, weight } of features) {
    const hash = await featureHash64(`mrfi-smh64-v0\0${feature}`);
    for (let bit = 0; bit < 64; bit += 1) {
      const mask = 1n << BigInt(63 - bit);
      accumulators[bit] += (hash & mask) === 0n ? -weight : weight;
    }
  }

  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (accumulators[bit] >= 0) {
      result |= 1n << BigInt(63 - bit);
    }
  }
  return result;
}

export async function sha256PrefixSignal(
  text: string,
  length = 8,
): Promise<HashSignal> {
  return {
    algorithm: "sha256",
    prefix: encodeBase62Payload(await sha256Digest(normalizeForCompare(text)))
      .slice(0, length),
  };
}

export async function sha256Digest(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
}

export function tokenizeForSmh64(text: string): string[] {
  return [...text.normalize("NFC").toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => match[0]);
}

export async function featureHash64(text: string): Promise<bigint> {
  const bytes = new TextEncoder().encode(text);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  let hash = 0n;
  for (const byte of digest.slice(0, 8)) {
    hash = (hash << 8n) | BigInt(byte);
  }
  return hash;
}

export function hammingDistance64(left: bigint, right: bigint): number {
  let value = (left ^ right) & UINT64_MASK;
  let distance = 0;
  while (value !== 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}
