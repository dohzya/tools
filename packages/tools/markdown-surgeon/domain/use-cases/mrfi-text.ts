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

/**
 * Formats a resolved range at full `line:col` precision, per
 * docs/specs/mrfi.md's Output Model ("range: ... at the same `line:col`
 * precision as `r`"), matching the `r=` field's own
 * `startLine:startColumn-endLine:endColumn` format.
 */
export function formatSourceRange(range: SourceRange): string {
  return `${range.startLine}:${range.startColumn}-${range.endLine}:${range.endColumn}`;
}

/** A SourceRange spanning whole lines, for callers that only have line numbers */
export function fullLineRange(
  doc: Document,
  startLine: number,
  endLine: number,
): SourceRange {
  return {
    startLine,
    startColumn: 1,
    endLine,
    endColumn: getLineEndColumn(doc, endLine),
  };
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

// xxHash64 (seed 0), a non-cryptographic fingerprint used as the default `fh`
// algorithm: much smaller/faster than sha256, which is unnecessary for
// proving "this text is unchanged" (no adversarial collision concern).
// Pure-TS port of the reference algorithm (github.com/Cyan4973/xxHash);
// mrfi-text.test.ts pins it against cespare/xxhash's canonical test vectors.
const XXH_PRIME64_1 = 11400714785074694791n;
const XXH_PRIME64_2 = 14029467366897019727n;
const XXH_PRIME64_3 = 1609587929392839161n;
const XXH_PRIME64_4 = 9650029242287828579n;
const XXH_PRIME64_5 = 2870177450012600261n;

function xxhRotl64(value: bigint, bits: bigint): bigint {
  const x = value & UINT64_MASK;
  return ((x << bits) | (x >> (64n - bits))) & UINT64_MASK;
}

function xxhRound(acc: bigint, input: bigint): bigint {
  acc = (acc + input * XXH_PRIME64_2) & UINT64_MASK;
  acc = xxhRotl64(acc, 31n);
  return (acc * XXH_PRIME64_1) & UINT64_MASK;
}

function xxhMergeRound(acc: bigint, value: bigint): bigint {
  const merged = xxhRound(0n, value);
  acc = (acc ^ merged) & UINT64_MASK;
  return (acc * XXH_PRIME64_1 + XXH_PRIME64_4) & UINT64_MASK;
}

/** xxHash64 (seed 0) of the given text's UTF-8 bytes */
export function xxh64(text: string): bigint {
  const bytes = new TextEncoder().encode(text);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;
  let offset = 0;
  let h64: bigint;

  if (length >= 32) {
    let v1 = (XXH_PRIME64_1 + XXH_PRIME64_2) & UINT64_MASK;
    let v2 = XXH_PRIME64_2;
    let v3 = 0n;
    let v4 = (-XXH_PRIME64_1) & UINT64_MASK;

    const limit = length - 32;
    while (offset <= limit) {
      v1 = xxhRound(v1, view.getBigUint64(offset, true));
      v2 = xxhRound(v2, view.getBigUint64(offset + 8, true));
      v3 = xxhRound(v3, view.getBigUint64(offset + 16, true));
      v4 = xxhRound(v4, view.getBigUint64(offset + 24, true));
      offset += 32;
    }

    h64 = (xxhRotl64(v1, 1n) + xxhRotl64(v2, 7n) + xxhRotl64(v3, 12n) +
      xxhRotl64(v4, 18n)) & UINT64_MASK;
    h64 = xxhMergeRound(h64, v1);
    h64 = xxhMergeRound(h64, v2);
    h64 = xxhMergeRound(h64, v3);
    h64 = xxhMergeRound(h64, v4);
  } else {
    h64 = XXH_PRIME64_5;
  }

  h64 = (h64 + BigInt(length)) & UINT64_MASK;

  while (offset + 8 <= length) {
    const k1 = xxhRound(0n, view.getBigUint64(offset, true));
    h64 = (h64 ^ k1) & UINT64_MASK;
    h64 = (xxhRotl64(h64, 27n) * XXH_PRIME64_1 + XXH_PRIME64_4) & UINT64_MASK;
    offset += 8;
  }

  if (offset + 4 <= length) {
    h64 = (h64 ^ (BigInt(view.getUint32(offset, true)) * XXH_PRIME64_1)) &
      UINT64_MASK;
    h64 = (xxhRotl64(h64, 23n) * XXH_PRIME64_2 + XXH_PRIME64_3) & UINT64_MASK;
    offset += 4;
  }

  while (offset < length) {
    h64 = (h64 ^ (BigInt(bytes[offset]) * XXH_PRIME64_5)) & UINT64_MASK;
    h64 = (xxhRotl64(h64, 11n) * XXH_PRIME64_1) & UINT64_MASK;
    offset += 1;
  }

  h64 = (h64 ^ (h64 >> 33n)) & UINT64_MASK;
  h64 = (h64 * XXH_PRIME64_2) & UINT64_MASK;
  h64 = (h64 ^ (h64 >> 29n)) & UINT64_MASK;
  h64 = (h64 * XXH_PRIME64_3) & UINT64_MASK;
  h64 = (h64 ^ (h64 >> 32n)) & UINT64_MASK;

  return h64;
}

/** xxHash64 (seed 0) as a fixed-width 16-char lowercase hex string */
export function xxh64Hex(text: string): string {
  return xxh64(text).toString(16).padStart(16, "0");
}

/** Default `fh`-style hash signal: xxh64, base62-encoded and prefix-truncated */
export function xxh64PrefixSignal(text: string, length = 8): HashSignal {
  const hash = xxh64(normalizeForCompare(text));
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, hash, false);
  return {
    algorithm: "xxh64",
    prefix: encodeBase62Payload(bytes).slice(0, length),
  };
}

/**
 * Computes a HashSignal for the given algorithm tag, or `undefined` when the
 * tag is not one the resolver knows how to recompute (an unknown tag per
 * docs/specs/mrfi.md still round-trips through the reference itself; it just
 * cannot be used to verify a candidate passage here).
 */
export async function hashSignalFor(
  algorithm: string,
  text: string,
  length = 8,
): Promise<HashSignal | undefined> {
  if (algorithm === "sha256") return await sha256PrefixSignal(text, length);
  if (algorithm === "xxh64") return xxh64PrefixSignal(text, length);
  return undefined;
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

/**
 * Default acceptance distance for smh64 fuzzy hash fields (`hh`, `ph`,
 * `doc`) when a locator does not carry its own `maxDistance`. Shared by
 * resolve-reference.ts and compare-references.ts so both use the same
 * default notion of "close enough".
 */
export const DEFAULT_SMH64_MAX_DISTANCE = 8;

export function hammingDistance64(left: bigint, right: bigint): number {
  let value = (left ^ right) & UINT64_MASK;
  let distance = 0;
  while (value !== 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}
