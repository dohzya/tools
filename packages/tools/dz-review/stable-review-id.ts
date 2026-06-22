import { parseReviewTimestamp } from "./timestamp.ts";

export interface StableReviewItemInput {
  kind: string;
  raw: string;
}

export interface StableReviewItem<T extends StableReviewItemInput> {
  id: string;
  item: T;
}

export const STABLE_REVIEW_ID_PREFIX = "rvw_";

const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TIMESTAMP_VALUE_PATTERN = String
  .raw`[A-Za-z0-9]{8}|[\uac00-\ub3ff]{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`;
const REVIEW_MARKER_RE = new RegExp(
  String
    .raw`(^|[ \t\r\n])(@agent|@me|@)(?:%(${TIMESTAMP_VALUE_PATTERN})(?=[ \t\r\n]|$)|(?=[ \t]*:|[ \t\r\n]|$))`,
  "g",
);
const REVIEW_ANNOTATION_TIMESTAMP_RE = new RegExp(
  String.raw`(\{(?:\+\+|--|==|>>|~~))%(${TIMESTAMP_VALUE_PATTERN})\|`,
  "g",
);

export function assignStableReviewItemIds<T extends StableReviewItemInput>(
  file: string,
  items: readonly T[],
): StableReviewItem<T>[] {
  const keys = items.map((item) => getStableReviewItemKey(file, item));
  const totals = countValues(keys);
  const seen = new Map<string, number>();

  return items.map((item, index) => {
    const key = keys[index];
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    return {
      id: makeStableReviewItemIdFromKey(
        totals.get(key) === 1 ? key : `${key}\0${occurrence}`,
      ),
      item,
    };
  });
}

export function resolveStableReviewItemId<T extends StableReviewItemInput>(
  id: string,
  file: string,
  items: readonly T[],
): T | undefined {
  return assignStableReviewItemIds(file, items)
    .find((candidate) => candidate.id === id)?.item;
}

export function stableReviewItemFingerprint(
  item: StableReviewItemInput,
): string {
  return hashStableReviewText(stripReviewTimestamps(item.raw));
}

export function getShortStableReviewItemId(
  id: string,
  allIds: readonly string[],
): string {
  const displayId = stripStableReviewItemIdPrefix(id);
  const allDisplayIds = allIds.map(stripStableReviewItemIdPrefix);
  const minLen = 5;
  let len = minLen;

  while (len < displayId.length) {
    const prefix = displayId.slice(0, len);
    const conflicts = allDisplayIds.filter((other) =>
      other !== displayId &&
      other.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (conflicts.length === 0) {
      return displayId.slice(0, Math.min(len + 1, displayId.length));
    }
    len += 1;
  }

  return displayId;
}

export function stripReviewTimestamps(text: string): string {
  return text
    .replace(REVIEW_MARKER_RE, "$1$2")
    .replace(REVIEW_ANNOTATION_TIMESTAMP_RE, "$1");
}

function getStableReviewItemKey(
  file: string,
  item: StableReviewItemInput,
): string {
  return [
    normalizeStableReviewFile(file),
    item.kind,
    getStableReviewItemAnchor(item),
  ].join("\0");
}

function getStableReviewItemAnchor(item: StableReviewItemInput): string {
  const timestamp = getFirstReviewTimestampAnchor(item.raw);
  if (timestamp) {
    return timestamp;
  }

  if (item.kind === "conversation") {
    const firstMessage = getFirstReviewMessage(item.raw);
    if (firstMessage) {
      return `${firstMessage.marker}\0${firstMessage.body}`;
    }
  }

  return stripReviewTimestamps(item.raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function getFirstReviewMessage(
  raw: string,
): { marker: string; body: string } | undefined {
  const matches = [...raw.matchAll(REVIEW_MARKER_RE)];
  const first = matches[0];
  if (!first) {
    return undefined;
  }

  const markerStart = (first.index ?? 0) + first[1].length;
  const markerEnd = markerStart + first[2].length +
    (first[3] ? first[3].length + 1 : 0);
  const next = matches[1];
  const closeStart = getConversationCloseStart(raw);
  const nextMarkerStart = next
    ? (next.index ?? 0) + next[1].length
    : closeStart;
  return {
    marker: first[2],
    body: raw.slice(getBodyStart(raw, markerEnd), nextMarkerStart)
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function getFirstReviewTimestampAnchor(raw: string): string | undefined {
  const timestamps = [
    ...[...raw.matchAll(REVIEW_MARKER_RE)]
      .filter((match) => match[3])
      .map((match) => ({
        index: (match.index ?? 0) + match[1].length + match[2].length + 1,
        value: match[3],
      })),
    ...[...raw.matchAll(REVIEW_ANNOTATION_TIMESTAMP_RE)]
      .map((match) => ({
        index: (match.index ?? 0) + match[1].length + 1,
        value: match[2],
      })),
  ].sort((left, right) => left.index - right.index);

  const first = timestamps[0];
  if (!first) {
    return undefined;
  }

  const parsed = parseStableReviewTimestamp(first.value);
  return parsed
    ? `timestamp\0${parsed.unixSeconds}\0${parsed.offsetMinutes}`
    : `timestamp\0${first.value}`;
}

function parseStableReviewTimestamp(
  value: string,
): { unixSeconds: bigint; offsetMinutes: number } | undefined {
  return parseReviewTimestamp(value);
}

function makeStableReviewItemIdFromKey(key: string): string {
  return `${STABLE_REVIEW_ID_PREFIX}${
    encodeBase62(hashStableReviewTextValue(key))
  }`;
}

function stripStableReviewItemIdPrefix(id: string): string {
  return id.startsWith(STABLE_REVIEW_ID_PREFIX)
    ? id.slice(STABLE_REVIEW_ID_PREFIX.length)
    : id;
}

function hashStableReviewText(text: string): string {
  return hashStableReviewTextValue(text).toString(16).padStart(16, "0");
}

function hashStableReviewTextValue(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash;
}

function encodeBase62(value: bigint): string {
  if (value === 0n) {
    return "0";
  }

  let encoded = "";
  let remaining = value;
  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }

  return encoded;
}

function normalizeStableReviewFile(file: string): string {
  return file.replace(/\\/g, "/");
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function getBodyStart(raw: string, offset: number): number {
  let bodyStart = offset;

  while (raw[bodyStart] === " " || raw[bodyStart] === "\t") {
    bodyStart += 1;
  }

  if (raw[bodyStart] === ":") {
    bodyStart += 1;
    while (raw[bodyStart] === " " || raw[bodyStart] === "\t") {
      bodyStart += 1;
    }
  }

  return bodyStart;
}

function getConversationCloseStart(raw: string): number {
  if (raw.startsWith("<!--")) {
    return raw.lastIndexOf("-->");
  }

  return raw.lastIndexOf("??}");
}
