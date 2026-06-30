export interface ReferenceLineRange {
  end: number;
  start: number;
}

export interface ReferenceSnapshot {
  content: string;
  label: string;
  raw: string;
}

export interface ReferenceTarget {
  lineRange?: ReferenceLineRange;
  path: string;
  raw: string;
  reviewId?: string;
  snapshot?: ReferenceSnapshot;
  stableId?: string;
}

export interface ReviewReference {
  end: number;
  index: number;
  lineEnd: number;
  lineStart: number;
  raw: string;
  start: number;
  targets: ReferenceTarget[];
  timestamp?: string;
}

export interface ReferenceId {
  end: number;
  id: string;
  line: number;
  start: number;
}

export interface ReferenceSnapshotIssue {
  kind: "duplicate-nested-label" | "unclosed-snapshot";
  label: string;
}

export interface FormattedReferenceTarget {
  canonical: string;
  location: string;
}

interface SnapshotParseResult {
  duplicateNestedLabels: string[];
  snapshot?: ReferenceSnapshot;
  unclosedLabels: string[];
}

interface SnapshotStackEntry {
  contentStart: number;
  label: string;
  start: number;
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const TIMESTAMP_VALUE_PATTERN = String
  .raw`[A-Za-z0-9]{8}|[\uac00-\ub3ff]{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`;
const REF_BLOCK_PREFIX_RE = new RegExp(
  String.raw`^ref(?:%(${TIMESTAMP_VALUE_PATTERN}))?(?::|\s+)`,
);
const INLINE_REF_RE = /\bref:\s*/g;
const REVIEW_MARKER_RE = new RegExp(
  String
    .raw`(^|[ \t\r\n])@(agent|me)?(?:%(${TIMESTAMP_VALUE_PATTERN}))?(?=[ \t:]|$)`,
  "g",
);
const REF_ID_RE = /^\s*(?:ref-id:\s*)?\^([A-Za-z0-9_-]+)\s*$/;
const SNAPSHOT_OPEN_RE = /^\{&&([A-Za-z0-9_-]+)/;
const TARGET_ID_RE = /([~^])([A-Za-z0-9_-]+)/g;
const TARGET_SPEC_RE =
  /^(.+):((?:L?\d+)(?:-(?:L?\d+|\d+))?)([~^][A-Za-z0-9_-]+(?:[~^][A-Za-z0-9_-]+)*)?$/;
const LOOSE_TARGET_SPEC_RE =
  /^(.+):([^~^]+)([~^][A-Za-z0-9_-]+(?:[~^][A-Za-z0-9_-]+)*)?$/;

export function collectReviewReferences(text: string): ReviewReference[] {
  const lineStarts = getLineStarts(text);
  const references: ReviewReference[] = [];

  for (const match of text.matchAll(HTML_COMMENT_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const contentStart = start + "<!--".length;
    const content = raw.slice(4, -3);
    const trimmedContent = content.trimStart();
    const prefix = trimmedContent.match(REF_BLOCK_PREFIX_RE);

    if (prefix) {
      const statement = trimmedContent.slice(prefix[0].length);
      references.push(
        makeReviewReference(
          references.length + 1,
          raw,
          start,
          start + raw.length,
          lineStarts,
          prefix[1],
          parseReferenceTargets(statement),
        ),
      );
      continue;
    }

    for (const inline of collectInlineReferenceStatements(content)) {
      references.push(
        makeReviewReference(
          references.length + 1,
          inline.statement,
          contentStart + inline.start,
          contentStart + inline.end,
          lineStarts,
          undefined,
          parseReferenceTargets(inline.statement),
        ),
      );
    }
  }

  return references.filter((reference) => reference.targets.length > 0);
}

export function collectReferenceIds(text: string): ReferenceId[] {
  const lineStarts = getLineStarts(text);
  const ids: ReferenceId[] = [];

  for (const match of text.matchAll(HTML_COMMENT_RE)) {
    const raw = match[0];
    const idMatch = raw.slice(4, -3).match(REF_ID_RE);
    if (!idMatch) {
      continue;
    }

    const start = match.index ?? 0;
    ids.push({
      end: start + raw.length,
      id: idMatch[1],
      line: offsetToLine(lineStarts, start),
      start,
    });
  }

  return ids;
}

export function parseReferenceLineRange(
  value: string,
): ReferenceLineRange | undefined {
  const match = value.match(/^(L?)(\d+)(?:-(L?)(\d+))?$/);
  if (!match) {
    return undefined;
  }

  const startHasPrefix = match[1] === "L";
  const endHasPrefix = match[3] === "L";
  if (!startHasPrefix && endHasPrefix) {
    return undefined;
  }

  const start = Number(match[2]);
  const end = match[4] ? Number(match[4]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return undefined;
  }

  if (start < 1 || end < start) {
    return undefined;
  }

  return { end, start };
}

export function formatReferenceLineRange(range: ReferenceLineRange): string {
  return range.start === range.end
    ? String(range.start)
    : `${range.start}-${range.end}`;
}

export function formatReferenceTarget(
  target: ReferenceTarget,
): FormattedReferenceTarget {
  const suffix = `${target.reviewId ? `~${target.reviewId}` : ""}${
    target.stableId ? `^${target.stableId}` : ""
  }`;
  const location = target.lineRange
    ? `${target.path}:${formatReferenceLineRange(target.lineRange)}`
    : target.path;

  return {
    canonical: `${location}${suffix}`,
    location,
  };
}

export function validateReferenceSnapshots(
  reference: ReviewReference,
): ReferenceSnapshotIssue[] {
  const issues: ReferenceSnapshotIssue[] = [];

  for (const target of reference.targets) {
    const parsed = parseLabelledSnapshot(target.raw);
    for (const label of parsed.duplicateNestedLabels) {
      issues.push({ kind: "duplicate-nested-label", label });
    }
    for (const label of parsed.unclosedLabels) {
      issues.push({ kind: "unclosed-snapshot", label });
    }
  }

  return issues;
}

export function normalizeReferenceSnapshotContent(value: string): string {
  return value
    .replace(/\{&&[A-Za-z0-9_-]+/g, "{&&")
    .replace(/[A-Za-z0-9_-]+&&\}/g, "&&}")
    .replace(/\s+/g, " ")
    .trim();
}

function collectInlineReferenceStatements(
  content: string,
): { end: number; start: number; statement: string }[] {
  const statements: { end: number; start: number; statement: string }[] = [];

  for (const match of content.matchAll(INLINE_REF_RE)) {
    const statementStart = (match.index ?? 0) + match[0].length;
    const statementEnd = findInlineReferenceEnd(content, statementStart);
    const statement = content.slice(statementStart, statementEnd).trim();
    if (statement.length === 0) {
      continue;
    }

    statements.push({
      end: statementEnd,
      start: statementStart,
      statement,
    });
  }

  return statements;
}

function findInlineReferenceEnd(content: string, start: number): number {
  REVIEW_MARKER_RE.lastIndex = start;
  const marker = REVIEW_MARKER_RE.exec(content);
  const markerStart = marker
    ? (marker.index ?? content.length) + marker[1].length
    : content.length;
  const newline = content.indexOf("\n", start);
  if (newline >= 0 && newline < markerStart) {
    return newline;
  }

  return markerStart;
}

function makeReviewReference(
  index: number,
  raw: string,
  start: number,
  end: number,
  lineStarts: number[],
  timestamp: string | undefined,
  targets: ReferenceTarget[],
): ReviewReference {
  return {
    end,
    index,
    lineEnd: offsetToLine(lineStarts, Math.max(start, end - 1)),
    lineStart: offsetToLine(lineStarts, start),
    raw,
    start,
    targets,
    ...(timestamp ? { timestamp } : {}),
  };
}

function parseReferenceTargets(statement: string): ReferenceTarget[] {
  return splitReferenceTargets(statement)
    .map(parseReferenceTarget);
}

function splitReferenceTargets(statement: string): string[] {
  const targets: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < statement.length; index += 1) {
    if (isEscapedAt(statement, index)) {
      continue;
    }

    const open = statement.slice(index).match(SNAPSHOT_OPEN_RE);
    if (open) {
      depth += 1;
      index += open[0].length - 1;
      continue;
    }

    const close = matchAnySnapshotClose(statement, index);
    if (close) {
      depth = Math.max(0, depth - 1);
      index += close.length - 1;
      continue;
    }

    if (statement[index] === ";" && depth === 0) {
      targets.push(statement.slice(start, index).trim());
      start = index + 1;
    }
  }

  targets.push(statement.slice(start).trim());
  return targets.filter((target) => target.length > 0);
}

function parseReferenceTarget(raw: string): ReferenceTarget {
  const parsedSnapshot = parseLabelledSnapshot(raw);
  const snapshot = parsedSnapshot.snapshot;
  const spec = (snapshot ? raw.slice(0, raw.indexOf(snapshot.raw)) : raw)
    .trim();
  const match = spec.match(TARGET_SPEC_RE);
  if (!match) {
    return parseInvalidReferenceTarget(raw, spec, snapshot);
  }

  const lineRange = parseReferenceLineRange(match[2]);
  if (!lineRange) {
    return parseInvalidReferenceTarget(raw, spec, snapshot);
  }

  const ids = parseTargetIds(match[3] ?? "");
  return {
    lineRange,
    path: match[1].trim(),
    raw,
    ...(ids.reviewId ? { reviewId: ids.reviewId } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(ids.stableId ? { stableId: ids.stableId } : {}),
  };
}

function parseInvalidReferenceTarget(
  raw: string,
  spec: string,
  snapshot: ReferenceSnapshot | undefined,
): ReferenceTarget {
  const looseMatch = spec.match(LOOSE_TARGET_SPEC_RE);
  const ids = parseTargetIds(looseMatch?.[3] ?? "");
  return {
    path: (looseMatch?.[1] ?? spec).trim(),
    raw,
    ...(ids.reviewId ? { reviewId: ids.reviewId } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(ids.stableId ? { stableId: ids.stableId } : {}),
  };
}

function parseTargetIds(value: string): {
  reviewId?: string;
  stableId?: string;
} {
  let reviewId: string | undefined;
  let stableId: string | undefined;

  for (const match of value.matchAll(TARGET_ID_RE)) {
    if (match[1] === "~") {
      reviewId = match[2];
    } else {
      stableId = match[2];
    }
  }

  return {
    ...(reviewId ? { reviewId } : {}),
    ...(stableId ? { stableId } : {}),
  };
}

function parseLabelledSnapshot(raw: string): SnapshotParseResult {
  const duplicateNestedLabels: string[] = [];
  const stack: SnapshotStackEntry[] = [];
  let firstSnapshot: ReferenceSnapshot | undefined;

  for (let index = 0; index < raw.length; index += 1) {
    if (isEscapedAt(raw, index)) {
      continue;
    }

    const open = raw.slice(index).match(SNAPSHOT_OPEN_RE);
    if (open) {
      const label = open[1];
      if (stack.some((entry) => entry.label === label)) {
        duplicateNestedLabels.push(label);
      }
      stack.push({
        contentStart: index + open[0].length,
        label,
        start: index,
      });
      index += open[0].length - 1;
      continue;
    }

    const current = stack[stack.length - 1];
    if (!current) {
      continue;
    }

    const close = `${current.label}&&}`;
    if (raw.startsWith(close, index)) {
      const entry = stack.pop();
      if (entry && stack.length === 0 && !firstSnapshot) {
        const end = index + close.length;
        firstSnapshot = {
          content: trimSnapshotContent(raw.slice(entry.contentStart, index)),
          label: entry.label,
          raw: raw.slice(entry.start, end),
        };
      }
      index += close.length - 1;
    }
  }

  return {
    duplicateNestedLabels: uniqueValues(duplicateNestedLabels),
    ...(firstSnapshot ? { snapshot: firstSnapshot } : {}),
    unclosedLabels: uniqueValues(stack.map((entry) => entry.label)),
  };
}

function matchAnySnapshotClose(
  text: string,
  index: number,
): string | undefined {
  const match = text.slice(index).match(/^[A-Za-z0-9_-]+&&\}/);
  return match?.[0];
}

function trimSnapshotContent(content: string): string {
  return content
    .replace(/^\s*\r?\n/, "")
    .replace(/\r?\n\s*$/, "")
    .trim();
}

function isEscapedAt(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function getLineStarts(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}
