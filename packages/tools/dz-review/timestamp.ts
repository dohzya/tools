const BASE62_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_EPOCH_WIDTH = 6;
const DEFAULT_TZ_WIDTH = 2;
const HANGUL_TIMESTAMP_START = 0xac00;
const HANGUL_TIMESTAMP_END = 0xb3ff;
const HANGUL_TIMESTAMP_BASE = 2048;
const HANGUL_EPOCH_WIDTH = 3;
const HANGUL_TZ_WIDTH = 1;
const HANGUL_TIMESTAMP_RE = /^[\uac00-\ub3ff]{4}$/u;
const ISO_TIMESTAMP_RE =
  /^%?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/;

export type TimestampFormat = "compact" | "hangul" | "iso";

export interface ReviewTimestamp {
  offsetMinutes: number;
  unixSeconds: bigint;
}

export interface TimestampFormatStats {
  compact: number;
  hangul: number;
  iso: number;
}

const DISPLAY_TIMESTAMP_VALUE_PATTERN = String
  .raw`[A-Za-z0-9]{8}|[\uac00-\ub3ff]{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`;
const DISPLAY_CONVERSATION_TIMESTAMP_RE = new RegExp(
  String
    .raw`(@agent|@me|@)%(${DISPLAY_TIMESTAMP_VALUE_PATTERN})(?=[ \t\r\n]|$)`,
  "g",
);
const DISPLAY_ANNOTATION_TIMESTAMP_RE = new RegExp(
  String.raw`(\{(?:\+\+|--|==|>>|~~))%(${DISPLAY_TIMESTAMP_VALUE_PATTERN})\|`,
  "g",
);

export function encodeTimestamp(
  date: Date,
  format: TimestampFormat,
  offsetMinutes: number = getLocalOffsetMinutes(date),
): string {
  if (format === "iso") {
    const rendered = formatTimestampForDisplay({
      unixSeconds: normalizeUnixSeconds(date),
      offsetMinutes,
    });
    if (!rendered) {
      throw new Error("Could not render timestamp.");
    }

    return rendered;
  }

  if (format === "hangul") {
    return encodeHangulTimestamp(date, offsetMinutes);
  }

  return encodeCompactTimestamp(date, offsetMinutes);
}

export function encodeCompactTimestamp(
  unixSeconds: number | bigint | Date,
  offsetMinutes: number,
): string {
  assertInteger(offsetMinutes, "offsetMinutes");

  const epochSeconds = normalizeUnixSeconds(unixSeconds);
  const base = BigInt(BASE62_ALPHABET.length);
  const modulus = base ** BigInt(DEFAULT_TZ_WIDTH);
  const minOffset = -(modulus / 2n);
  const maxOffset = (modulus - 1n) / 2n;
  const offset = BigInt(offsetMinutes);

  if (offset < minOffset || offset > maxOffset) {
    throw new RangeError(
      `offsetMinutes out of compact timestamp range: ${offsetMinutes}.`,
    );
  }

  const encodedOffsetValue = offset >= 0n ? offset : modulus + offset;
  const maxEpoch = base ** BigInt(DEFAULT_EPOCH_WIDTH);
  if (epochSeconds >= maxEpoch) {
    throw new RangeError(
      `unixSeconds out of compact timestamp range: ${epochSeconds}.`,
    );
  }

  return encodeUnsignedInteger(epochSeconds).padStart(
    DEFAULT_EPOCH_WIDTH,
    BASE62_ALPHABET[0],
  ) +
    encodeUnsignedInteger(encodedOffsetValue).padStart(
      DEFAULT_TZ_WIDTH,
      BASE62_ALPHABET[0],
    );
}

export function decodeCompactTimestamp(value: string): ReviewTimestamp {
  if (!/^[0-9A-Za-z]{8}$/.test(value)) {
    throw new Error("Invalid compact timestamp.");
  }

  const epochPart = value.slice(0, DEFAULT_EPOCH_WIDTH);
  const offsetPart = value.slice(DEFAULT_EPOCH_WIDTH);
  const base = BigInt(BASE62_ALPHABET.length);
  const modulus = base ** BigInt(DEFAULT_TZ_WIDTH);
  const rawOffset = decodeUnsignedInteger(offsetPart);
  const signedOffset = rawOffset < modulus / 2n
    ? rawOffset
    : rawOffset - modulus;

  return {
    unixSeconds: decodeUnsignedInteger(epochPart),
    offsetMinutes: Number(signedOffset),
  };
}

export function encodeHangulTimestamp(
  unixSeconds: number | bigint | Date,
  offsetMinutes: number,
): string {
  assertInteger(offsetMinutes, "offsetMinutes");

  const epochSeconds = normalizeUnixSeconds(unixSeconds);
  const base = BigInt(HANGUL_TIMESTAMP_BASE);
  const modulus = base ** BigInt(HANGUL_TZ_WIDTH);
  const minOffset = -(modulus / 2n);
  const maxOffset = (modulus - 1n) / 2n;
  const offset = BigInt(offsetMinutes);

  if (offset < minOffset || offset > maxOffset) {
    throw new RangeError(
      `offsetMinutes out of hangul timestamp range: ${offsetMinutes}.`,
    );
  }

  const encodedOffsetValue = offset >= 0n ? offset : modulus + offset;
  const maxEpoch = base ** BigInt(HANGUL_EPOCH_WIDTH);
  if (epochSeconds >= maxEpoch) {
    throw new RangeError(
      `unixSeconds out of hangul timestamp range: ${epochSeconds}.`,
    );
  }

  return encodeHangulUnsignedInteger(epochSeconds).padStart(
    HANGUL_EPOCH_WIDTH,
    String.fromCodePoint(HANGUL_TIMESTAMP_START),
  ) +
    encodeHangulUnsignedInteger(encodedOffsetValue).padStart(
      HANGUL_TZ_WIDTH,
      String.fromCodePoint(HANGUL_TIMESTAMP_START),
    );
}

export function decodeHangulTimestamp(value: string): ReviewTimestamp {
  if (!HANGUL_TIMESTAMP_RE.test(value)) {
    throw new Error("Invalid hangul timestamp.");
  }

  const epochPart = value.slice(0, HANGUL_EPOCH_WIDTH);
  const offsetPart = value.slice(HANGUL_EPOCH_WIDTH);
  const base = BigInt(HANGUL_TIMESTAMP_BASE);
  const modulus = base ** BigInt(HANGUL_TZ_WIDTH);
  const rawOffset = decodeHangulUnsignedInteger(offsetPart);
  const signedOffset = rawOffset < modulus / 2n
    ? rawOffset
    : rawOffset - modulus;

  return {
    unixSeconds: decodeHangulUnsignedInteger(epochPart),
    offsetMinutes: Number(signedOffset),
  };
}

export function parseReviewTimestamp(
  value: string,
): ReviewTimestamp | undefined {
  const normalized = value.startsWith("%") ? value.slice(1) : value;

  if (ISO_TIMESTAMP_RE.test(value)) {
    const date = new Date(normalizeIsoTimestamp(normalized));
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return {
      unixSeconds: normalizeUnixSeconds(date),
      offsetMinutes: parseIsoOffsetMinutes(normalized),
    };
  }

  if (/^[0-9A-Za-z]{8}$/.test(normalized)) {
    try {
      return decodeCompactTimestamp(normalized);
    } catch {
      return undefined;
    }
  }

  if (HANGUL_TIMESTAMP_RE.test(normalized)) {
    try {
      return decodeHangulTimestamp(normalized);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function formatTimestampForDisplay(
  timestamp: ReviewTimestamp | undefined,
): string | undefined {
  if (!timestamp) {
    return undefined;
  }

  const date = new Date(Number(timestamp.unixSeconds) * 1000);
  const shifted = new Date(
    date.getTime() + timestamp.offsetMinutes * 60 * 1000,
  );
  const iso = shifted.toISOString().replace(/\.\d{3}Z$/, "");
  return `${iso}${formatOffset(timestamp.offsetMinutes)}`;
}

export function getLocalOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset();
}

export function collectReviewTimestampFormatStats(
  text: string,
): TimestampFormatStats {
  const stats: TimestampFormatStats = { compact: 0, hangul: 0, iso: 0 };

  for (const match of text.matchAll(DISPLAY_CONVERSATION_TIMESTAMP_RE)) {
    incrementTimestampFormatStats(stats, match[2]);
  }

  for (const match of text.matchAll(DISPLAY_ANNOTATION_TIMESTAMP_RE)) {
    incrementTimestampFormatStats(stats, match[2]);
  }

  return stats;
}

export function transformReviewTimestamps(
  text: string,
  fallbackDate: Date,
  format: TimestampFormat,
): { count: number; updated: string } {
  const fallbackTimestamp = encodeTimestamp(fallbackDate, format);
  let count = 0;

  const withConvertedConversationTimestamps = text.replace(
    DISPLAY_CONVERSATION_TIMESTAMP_RE,
    (match: string, marker: string, value: string) => {
      const timestamp = renderTimestampValue(value, format);
      if (!timestamp) {
        return match;
      }

      if (timestamp === value) {
        return match;
      }

      count += 1;
      return `${marker}%${timestamp}`;
    },
  );

  const withConversationTimestamps = withConvertedConversationTimestamps
    .replace(
      /(^|[ \t\r\n])(@agent|@me|@)(?![%\(])(?=[ \t]*:|[ \t\r\n]|$)/g,
      (_match: string, prefix: string, marker: string) => {
        count += 1;
        return `${prefix}${
          normalizeConversationMarker(marker)
        }%${fallbackTimestamp}`;
      },
    );

  const withConvertedAnnotationTimestamps = withConversationTimestamps.replace(
    DISPLAY_ANNOTATION_TIMESTAMP_RE,
    (match: string, marker: string, value: string) => {
      const timestamp = renderTimestampValue(value, format);
      if (!timestamp || timestamp === value) {
        return match;
      }

      count += 1;
      return `${marker}%${timestamp}|`;
    },
  );

  const updated = withConvertedAnnotationTimestamps.replace(
    /\{(\+\+|--|==|>>|~~)(?!%)/g,
    (_match: string, marker: string) => {
      count += 1;
      return `{${marker}%${fallbackTimestamp}|`;
    },
  );

  return { count, updated };
}

function incrementTimestampFormatStats(
  stats: TimestampFormatStats,
  value: string,
): void {
  if (/^[A-Za-z0-9]{8}$/.test(value)) {
    stats.compact += 1;
    return;
  }

  if (/^[\uac00-\ub3ff]{4}$/u.test(value)) {
    stats.hangul += 1;
    return;
  }

  stats.iso += 1;
}

function normalizeConversationMarker(marker: string): string {
  return marker === "@" ? "@me" : marker;
}

function renderTimestampValue(
  value: string,
  format: TimestampFormat,
): string | undefined {
  const timestamp = parseReviewTimestamp(value);
  if (!timestamp) {
    return undefined;
  }

  if (format === "iso") {
    return formatTimestampForDisplay(timestamp);
  }

  if (format === "hangul") {
    return encodeHangulTimestamp(
      timestamp.unixSeconds,
      timestamp.offsetMinutes,
    );
  }

  return encodeCompactTimestamp(timestamp.unixSeconds, timestamp.offsetMinutes);
}

function normalizeUnixSeconds(value: number | bigint | Date): bigint {
  if (isDateLike(value)) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) {
      throw new Error("Invalid Date.");
    }

    return BigInt(Math.floor(ms / 1000));
  }

  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) {
    throw new RangeError("Timestamp cannot be negative.");
  }

  return n;
}

function isDateLike(value: number | bigint | Date): value is Date {
  return typeof value === "object" && value !== null &&
    typeof value.getTime === "function";
}

function encodeUnsignedInteger(value: bigint): string {
  if (value < 0n) {
    throw new RangeError("Cannot encode a negative integer as unsigned.");
  }

  if (value === 0n) {
    return BASE62_ALPHABET[0];
  }

  const base = BigInt(BASE62_ALPHABET.length);
  let remaining = value;
  let out = "";

  while (remaining > 0n) {
    const digit = Number(remaining % base);
    out = BASE62_ALPHABET[digit] + out;
    remaining /= base;
  }

  return out;
}

function decodeUnsignedInteger(value: string): bigint {
  if (value.length === 0) {
    throw new Error("Cannot decode an empty integer.");
  }

  const base = BigInt(BASE62_ALPHABET.length);
  let out = 0n;

  for (const char of value) {
    const digit = BASE62_ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new Error(`Invalid compact timestamp character: ${char}.`);
    }

    out = out * base + BigInt(digit);
  }

  return out;
}

function encodeHangulUnsignedInteger(value: bigint): string {
  if (value < 0n) {
    throw new RangeError("Cannot encode a negative integer as unsigned.");
  }

  if (value === 0n) {
    return String.fromCodePoint(HANGUL_TIMESTAMP_START);
  }

  const base = BigInt(HANGUL_TIMESTAMP_BASE);
  let remaining = value;
  let out = "";

  while (remaining > 0n) {
    const digit = Number(remaining % base);
    out = String.fromCodePoint(HANGUL_TIMESTAMP_START + digit) + out;
    remaining /= base;
  }

  return out;
}

function decodeHangulUnsignedInteger(value: string): bigint {
  if (value.length === 0) {
    throw new Error("Cannot decode an empty integer.");
  }

  const base = BigInt(HANGUL_TIMESTAMP_BASE);
  let out = 0n;

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint === undefined || codePoint < HANGUL_TIMESTAMP_START ||
      codePoint > HANGUL_TIMESTAMP_END
    ) {
      throw new Error(`Invalid hangul timestamp character: ${char}.`);
    }

    out = out * base + BigInt(codePoint - HANGUL_TIMESTAMP_START);
  }

  return out;
}

function parseIsoOffsetMinutes(value: string): number {
  if (value.endsWith("Z")) {
    return 0;
  }

  const offset = value.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!offset) {
    return 0;
  }

  const sign = offset[1] === "-" ? -1 : 1;
  return sign * (Number(offset[2]) * 60 + Number(offset[3]));
}

function normalizeIsoTimestamp(value: string): string {
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer.`);
  }
}
