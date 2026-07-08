/**
 * MRFI reference string <-> `DebugMrfi` struct codec.
 *
 * Covers both wire formats: the human-readable debug form (`~{v0;...}`,
 * `serializeDebugMrfi`/`parseDebugMrfi`) and the compact binary envelope
 * carried as base62 or Hangul text (`encodeCompactMrfi`/`decodeCompactMrfi`
 * plus the base62/Hangul/CBOR machinery in `mrfi-cbor.ts`). `formatMrfi`/
 * `parseMrfiReference` are the format-agnostic entry points used by the
 * resolve, generate, and transform use cases.
 */

import { MdError } from "../entities/document.ts";
import type {
  DebugMrfi,
  HashSignal,
  MrfiFormat,
  SourceRange,
} from "../entities/mrfi.ts";
import {
  type CborMap,
  CborReader,
  type CborValue,
  checksum24,
  concatBytes,
  decodeBase62Payload,
  decodeHangulPayload,
  decodeVarUint,
  encodeBase62Payload,
  encodeCbor,
  encodeHangulPayload,
  encodeVarUint,
  HANGUL_BASE,
  HANGUL_LIMIT,
  isCborMap,
  MRFI_MAGIC,
} from "./mrfi-cbor.ts";
import { isRangeShapeValid } from "./mrfi-text.ts";

export async function parseMrfiReference(
  ref: string,
): Promise<DebugMrfi | undefined> {
  const debug = parseDebugMrfi(ref);
  if (debug) return debug;

  const payload = getCompactPayload(ref);
  if (!payload) return undefined;

  const envelope = isHangulPayload(payload)
    ? decodeHangulPayload(payload)
    : decodeBase62Payload(payload);
  const cbor = await decodeCompactEnvelope(envelope);
  return decodeCompactMrfi(cbor);
}

export function getCompactPayload(ref: string): string | undefined {
  if (!ref.startsWith("~")) return undefined;
  if (ref.startsWith("~{") && ref.endsWith("}")) {
    return ref.slice(2, -1);
  }
  return ref.slice(1);
}

export function isHangulPayload(payload: string): boolean {
  const first = payload.codePointAt(0);
  return first !== undefined && first >= HANGUL_BASE && first <= HANGUL_LIMIT;
}

export async function formatMrfi(
  parsed: DebugMrfi,
  format: MrfiFormat,
): Promise<string> {
  if (format === "debug") {
    return serializeDebugMrfi(parsed);
  }

  const envelope = await encodeCompactEnvelope(encodeCompactMrfi(parsed));
  return format === "base62"
    ? `~${encodeBase62Payload(envelope)}`
    : `~${encodeHangulPayload(envelope)}`;
}

export function isOffsetRangeShapeValid(
  range: { readonly start: number; readonly end: number },
): boolean {
  return range.start >= 0 && range.end > range.start;
}

export function serializeDebugMrfi(parsed: DebugMrfi): string {
  const fields = ["v0"];

  if (parsed.range) {
    fields.push(
      `r=${parsed.range.startLine}:${parsed.range.startColumn}-${parsed.range.endLine}:${parsed.range.endColumn}`,
    );
  }
  if (parsed.offsetRange) {
    fields.push(`o=${parsed.offsetRange.start}-${parsed.offsetRange.end}`);
  }
  if (parsed.structuralPath) {
    fields.push(`p=${encodeDebugValue(parsed.structuralPath)}`);
  }
  if (parsed.anchor) {
    fields.push(`a=${encodeDebugValue(parsed.anchor)}`);
  }
  if (parsed.exactHash) {
    fields.push(`${serializeHashSignal("fh", parsed.exactHash)}`);
  }
  if (parsed.headingHash) {
    fields.push(serializeSmh64Field("hh", parsed.headingHash));
  }
  if (parsed.passageHash) {
    fields.push(serializeSmh64Field("ph", parsed.passageHash));
  }
  if (parsed.context) {
    const contextFields = [
      ...(parsed.context.prefix ? [`pre:${parsed.context.prefix}`] : []),
      ...(parsed.context.suffix ? [`suf:${parsed.context.suffix}`] : []),
    ];
    if (contextFields.length > 0) {
      fields.push(`ctx=${contextFields.join(",")}`);
    }
  }
  if (parsed.documentHash) {
    fields.push(serializeSmh64Field("doc", parsed.documentHash));
  }
  if (parsed.quote) {
    fields.push(`q=${encodeDebugValue(parsed.quote)}`);
  }
  if (parsed.extentSelector) {
    fields.push(`x=${parsed.extentSelector}`);
  }
  for (const [key, value] of parsed.extra ?? []) {
    fields.push(`${key}=${encodeDebugValue(value)}`);
  }
  return `~{${fields.join(";")}}`;
}

export function serializeHashSignal(key: string, signal: HashSignal): string {
  return `${key}=${signal.algorithm}:${signal.prefix}`;
}

/** Serializes a fuzzy (smh64) field — `hh`, `ph`, or `doc` — in debug form */
export function serializeSmh64Field(
  key: string,
  fuzzyHash: { readonly hash: bigint; readonly maxDistance?: number },
): string {
  const hash = fuzzyHash.hash.toString(16).padStart(16, "0");
  const threshold = fuzzyHash.maxDistance === undefined
    ? ""
    : `/${fuzzyHash.maxDistance}`;
  return `${key}=smh64:${hash}${threshold}`;
}

/**
 * Per-field default hash tag: compact encodings omit the tag entirely when
 * a signal uses its field's default, per docs/specs/mrfi.md "Tags are only
 * spelled out in the debug encoding ... `v0` defines a default tag per hash
 * field". `fh`'s default is xxh64 (small/fast, no adversarial-collision
 * need); `doc`, like `hh`/`ph`, only ever uses smh64, so its compact form
 * omits the tag unconditionally (see decodeCompactHeadingHash).
 */
const FH_DEFAULT_ALGORITHM = "xxh64";

/**
 * Small registered codes for known non-default tags, so a hash carrying an
 * explicit but non-default algorithm still costs one CBOR byte instead of
 * spelling the algorithm name out in the compact envelope. An algorithm not
 * in this map falls back to a literal `[algorithm, prefix]` encoding.
 */
const HASH_ALGORITHM_CODES: Readonly<Record<string, number>> = {
  sha256: 1,
  xxh64: 2,
};
const HASH_ALGORITHM_NAMES: Readonly<Record<number, string>> = Object
  .fromEntries(
    Object.entries(HASH_ALGORITHM_CODES).map(([name, code]) => [code, name]),
  );

function encodeCompactHashSignal(
  signal: HashSignal,
  defaultAlgorithm: string,
): CborValue {
  if (signal.algorithm === defaultAlgorithm) return signal.prefix;
  const code = HASH_ALGORITHM_CODES[signal.algorithm];
  return code === undefined
    ? [signal.algorithm, signal.prefix]
    : [code, signal.prefix];
}

function decodeCompactHashSignalWithDefault(
  value: CborValue | undefined,
  defaultAlgorithm: string,
): HashSignal | undefined {
  if (typeof value === "string") {
    return { algorithm: defaultAlgorithm, prefix: value };
  }
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [tag, prefix] = value;
  if (typeof prefix !== "string") return undefined;
  if (typeof tag === "number") {
    const algorithm = HASH_ALGORITHM_NAMES[tag];
    return algorithm ? { algorithm, prefix } : undefined;
  }
  if (typeof tag === "string") return { algorithm: tag, prefix };
  return undefined;
}

export function encodeCompactMrfi(parsed: DebugMrfi): Uint8Array {
  const entries: Array<[number | string, CborValue]> = [[0, 0]];

  if (parsed.anchor) {
    entries.push([1, parsed.anchor]);
  }
  if (parsed.range) {
    entries.push([
      2,
      [
        parsed.range.startLine,
        parsed.range.startColumn,
        parsed.range.endLine,
        parsed.range.endColumn,
      ],
    ]);
  }
  if (parsed.structuralPath) {
    entries.push([3, parsed.structuralPath]);
  }
  if (parsed.exactHash) {
    entries.push([
      4,
      encodeCompactHashSignal(parsed.exactHash, FH_DEFAULT_ALGORITHM),
    ]);
  }
  if (parsed.headingHash) {
    entries.push([5, encodeCompactSmh64(parsed.headingHash)]);
  }
  if (parsed.context) {
    entries.push([
      6,
      [
        parsed.context.prefix ?? "",
        parsed.context.suffix ?? "",
      ],
    ]);
  }
  if (parsed.quote) {
    entries.push([7, parsed.quote]);
  }
  if (parsed.documentHash) {
    entries.push([8, encodeCompactSmh64(parsed.documentHash)]);
  }
  if (parsed.offsetRange) {
    entries.push([9, [parsed.offsetRange.start, parsed.offsetRange.end]]);
  }
  if (parsed.passageHash) {
    entries.push([10, encodeCompactSmh64(parsed.passageHash)]);
  }
  if (parsed.extentSelector) {
    const xCodes: Record<string, number> = { sec: 0, body: 1, lead: 2 };
    entries.push([11, xCodes[parsed.extentSelector]]);
  }
  for (const [key, value] of parsed.extra ?? []) {
    entries.push([key, value]);
  }

  return encodeCbor({ kind: "map", entries });
}

export function decodeCompactMrfi(payload: Uint8Array): DebugMrfi | undefined {
  const value = new CborReader(payload).readValue();
  if (!isCborMap(value)) return undefined;

  const version = getCborMapValue(value, 0);
  if (version !== 0) return undefined;

  const anchor = getCborMapValue(value, 1);
  const range = decodeCompactRange(getCborMapValue(value, 2));
  const structuralPath = getCborMapValue(value, 3);
  const exactHash = decodeCompactHashSignalWithDefault(
    getCborMapValue(value, 4),
    FH_DEFAULT_ALGORITHM,
  );
  const headingHash = decodeCompactHeadingHash(getCborMapValue(value, 5));
  const context = decodeCompactContext(getCborMapValue(value, 6));
  const quote = getCborMapValue(value, 7);
  const documentHash = decodeCompactHeadingHash(getCborMapValue(value, 8));
  const offsetRange = decodeCompactOffsetRange(getCborMapValue(value, 9));
  const passageHash = decodeCompactHeadingHash(getCborMapValue(value, 10));
  const xNames: Record<number, DebugMrfi["extentSelector"]> = {
    0: "sec",
    1: "body",
    2: "lead",
  };
  const rawX = getCborMapValue(value, 11);
  if (typeof rawX === "number" && !(rawX in xNames)) {
    throw new MdError(
      "invalid_id",
      `invalid MRFI extent selector code: ${rawX}`,
    );
  }
  const extentSelector = typeof rawX === "number" ? xNames[rawX] : undefined;
  const extra = decodeExtraFields(value);

  return {
    ...(typeof anchor === "string" ? { anchor } : {}),
    ...(context ? { context } : {}),
    ...(documentHash ? { documentHash } : {}),
    ...(exactHash ? { exactHash } : {}),
    ...(extentSelector ? { extentSelector } : {}),
    ...(extra.size > 0 ? { extra } : {}),
    ...(range ? { range } : {}),
    ...(headingHash ? { headingHash } : {}),
    ...(offsetRange ? { offsetRange } : {}),
    ...(passageHash ? { passageHash } : {}),
    ...(typeof quote === "string" ? { quote } : {}),
    ...(typeof structuralPath === "string" ? { structuralPath } : {}),
  };
}

/**
 * Decodes string-keyed compact fields as extension fields: any key this
 * codec does not itself use is an extension field by construction, since
 * known fields always use a numeric key in compact form. Per
 * docs/specs/mrfi.md's Extension Fields ("nothing is silently dropped"),
 * a non-string value — which another implementation may have written,
 * since this spec does not constrain what an unknown field carries — is
 * coerced to a literal string instead of failing the whole reference.
 */
export function decodeExtraFields(map: CborMap): Map<string, string> {
  const extra = new Map<string, string>();
  for (const [key, value] of map.entries) {
    if (typeof key !== "string") continue;
    extra.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return extra;
}

export function decodeCompactContext(
  value: CborValue | undefined,
): DebugMrfi["context"] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [prefix, suffix] = value;
  if (typeof prefix !== "string" || typeof suffix !== "string") {
    return undefined;
  }
  return {
    ...(prefix.length > 0 ? { prefix } : {}),
    ...(suffix.length > 0 ? { suffix } : {}),
  };
}

export function decodeCompactOffsetRange(
  value: CborValue | undefined,
): DebugMrfi["offsetRange"] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [start, end] = value;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  if (!isOffsetRangeShapeValid({ start, end })) {
    throw new MdError("invalid_id", "invalid compact MRFI offset range");
  }
  return { start, end };
}

export function decodeCompactRange(
  value: CborValue | undefined,
): SourceRange | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [startLine, startColumn, endLine, endColumn] = value;
  if (
    typeof startLine !== "number" || typeof startColumn !== "number" ||
    typeof endLine !== "number" || typeof endColumn !== "number"
  ) {
    return undefined;
  }
  const range = { startLine, startColumn, endLine, endColumn };
  if (!isRangeShapeValid(range)) {
    throw new MdError("invalid_id", "invalid compact MRFI range");
  }
  return range;
}

/** Encodes a fuzzy (smh64) field — `hh`, `ph`, or `doc` — as `[hash]` or `[hash, maxDistance]` */
export function encodeCompactSmh64(
  fuzzyHash: { readonly hash: bigint; readonly maxDistance?: number },
): CborValue[] {
  const hash = fuzzyHash.hash.toString(16).padStart(16, "0");
  const value: CborValue[] = [hash];
  if (fuzzyHash.maxDistance !== undefined) {
    value.push(fuzzyHash.maxDistance);
  }
  return value;
}

/**
 * Decodes a compact `hh`/`ph`/`doc` value: `[hash]` or `[hash, maxDistance]`.
 * The algorithm tag is not encoded because smh64 is the only supported (and
 * therefore default) tag for these fields, per docs/specs/mrfi.md's
 * per-field default-tag omission.
 */
export function decodeCompactHeadingHash(
  value: CborValue | undefined,
): DebugMrfi["headingHash"] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    return undefined;
  }
  const [hash, maxDistance] = value;
  if (typeof hash !== "string" || !/^[0-9a-f]{16}$/i.test(hash)) {
    return undefined;
  }
  if (maxDistance !== undefined && typeof maxDistance !== "number") {
    return undefined;
  }
  return {
    hash: BigInt(`0x${hash}`),
    ...(maxDistance === undefined ? {} : { maxDistance }),
  };
}

export function getCborMapValue(
  map: CborMap,
  key: number,
): CborValue | undefined {
  return map.entries.find(([candidate]) => candidate === key)?.[1];
}

export async function encodeCompactEnvelope(
  payload: Uint8Array,
): Promise<Uint8Array> {
  const header = concatBytes([
    MRFI_MAGIC,
    new Uint8Array([0]),
    encodeVarUint(payload.length),
    payload,
  ]);
  const check = await checksum24(header);
  return concatBytes([header, check]);
}

export async function decodeCompactEnvelope(
  envelope: Uint8Array,
): Promise<Uint8Array> {
  if (envelope.length < MRFI_MAGIC.length + 1 + 3) {
    throw new MdError("invalid_id", "Invalid compact MRFI envelope");
  }
  for (let index = 0; index < MRFI_MAGIC.length; index += 1) {
    if (envelope[index] !== MRFI_MAGIC[index]) {
      throw new MdError("invalid_id", "Invalid compact MRFI magic");
    }
  }
  if (envelope[MRFI_MAGIC.length] !== 0) {
    throw new MdError("invalid_id", "Unsupported compact MRFI version");
  }

  const lengthResult = decodeVarUint(envelope, MRFI_MAGIC.length + 1);
  const payloadStart = lengthResult.nextOffset;
  const payloadEnd = payloadStart + lengthResult.value;
  const checkEnd = payloadEnd + 3;
  if (checkEnd > envelope.length) {
    throw new MdError("invalid_id", "Invalid compact MRFI length");
  }
  for (const byte of envelope.slice(checkEnd)) {
    if (byte !== 0) {
      throw new MdError("invalid_id", "Invalid compact MRFI padding");
    }
  }

  const header = envelope.slice(0, payloadEnd);
  const expectedCheck = await checksum24(header);
  const actualCheck = envelope.slice(payloadEnd, checkEnd);
  for (let index = 0; index < expectedCheck.length; index += 1) {
    if (expectedCheck[index] !== actualCheck[index]) {
      throw new MdError("invalid_id", "Invalid compact MRFI checksum");
    }
  }

  return envelope.slice(payloadStart, payloadEnd);
}

export function parseDebugMrfi(ref: string): DebugMrfi | undefined {
  if (!ref.startsWith("~{") || !ref.endsWith("}")) {
    return undefined;
  }
  const payload = ref.slice(2, -1);
  const fields = payload.split(";");
  if (fields[0] !== "v0") {
    return undefined;
  }

  let anchor: string | undefined;
  let context: DebugMrfi["context"];
  let documentHash: DebugMrfi["documentHash"];
  let exactHash: HashSignal | undefined;
  let extentSelector: DebugMrfi["extentSelector"];
  const extra = new Map<string, string>();
  let headingHash: DebugMrfi["headingHash"];
  let offsetRange: DebugMrfi["offsetRange"];
  let passageHash: DebugMrfi["passageHash"];
  let quote: string | undefined;
  let range: DebugMrfi["range"];
  let structuralPath: string | undefined;
  const seenKeys = new Set<string>();

  for (const field of fields.slice(1)) {
    const separator = field.indexOf("=");
    if (separator === -1) {
      throw new MdError("invalid_id", `Malformed MRFI debug field: ${field}`);
    }
    const key = field.slice(0, separator);
    if (seenKeys.has(key)) {
      throw new MdError("invalid_id", `duplicate MRFI field: ${key}`);
    }
    seenKeys.add(key);
    if (key.startsWith("!")) {
      throw new MdError(
        "invalid_id",
        `unsupported mandatory MRFI field: ${key}`,
      );
    }
    const value = decodeDebugValue(field.slice(separator + 1));
    if (key === "a") {
      anchor = value;
    } else if (key === "ctx") {
      context = parseContextField(value);
      if (!context) {
        throw new MdError("invalid_id", `Malformed MRFI context: ${value}`);
      }
    } else if (key === "doc") {
      documentHash = parseSmh64Field(value);
      if (!documentHash) {
        throw new MdError("invalid_id", `Malformed MRFI smh64: ${field}`);
      }
    } else if (key === "fh") {
      exactHash = parseHashSignal(value);
      if (!exactHash) {
        throw new MdError("invalid_id", `Malformed MRFI hash: ${field}`);
      }
    } else if (key === "hh") {
      headingHash = parseSmh64Field(value);
      if (!headingHash) {
        throw new MdError("invalid_id", `Malformed MRFI smh64: ${field}`);
      }
    } else if (key === "o") {
      offsetRange = parseOffsetRange(value);
      if (!offsetRange) {
        throw new MdError(
          "invalid_id",
          `Malformed MRFI offset range: ${value}`,
        );
      }
    } else if (key === "p") {
      structuralPath = value;
    } else if (key === "ph") {
      passageHash = parseSmh64Field(value);
      if (!passageHash) {
        throw new MdError("invalid_id", `Malformed MRFI smh64: ${field}`);
      }
    } else if (key === "q") {
      quote = value;
    } else if (key === "r") {
      range = parseMrfiRange(value);
      if (!range) {
        throw new MdError("invalid_id", `Malformed MRFI range: ${value}`);
      }
    } else if (key === "x") {
      if (value !== "sec" && value !== "body" && value !== "lead") {
        throw new MdError(
          "invalid_id",
          `invalid MRFI extent selector: ${value}`,
        );
      }
      extentSelector = value;
    } else {
      extra.set(key, value);
    }
  }

  return {
    anchor,
    context,
    documentHash,
    exactHash,
    extentSelector,
    ...(extra.size > 0 ? { extra } : {}),
    headingHash,
    offsetRange,
    passageHash,
    quote,
    range,
    structuralPath,
  };
}

export function parseHashSignal(value: string): HashSignal | undefined {
  const separator = value.indexOf(":");
  if (separator === -1) return undefined;
  const algorithm = value.slice(0, separator);
  const prefix = value.slice(separator + 1);
  if (algorithm.length === 0 || prefix.length === 0) return undefined;
  return { algorithm, prefix };
}

export function parseContextField(
  value: string,
): DebugMrfi["context"] | undefined {
  let prefix: string | undefined;
  let suffix: string | undefined;
  for (const part of value.split(",")) {
    const separator = part.indexOf(":");
    if (separator === -1) continue;
    const key = part.slice(0, separator);
    const contextValue = part.slice(separator + 1);
    if (key === "pre") {
      prefix = contextValue;
    } else if (key === "suf") {
      suffix = contextValue;
    }
  }
  return prefix || suffix ? { prefix, suffix } : undefined;
}

export function parseOffsetRange(
  value: string,
): DebugMrfi["offsetRange"] | undefined {
  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) return undefined;
  const range = {
    start: Number(match[1]),
    end: Number(match[2]),
  };
  return isOffsetRangeShapeValid(range) ? range : undefined;
}

export function parseSmh64Field(
  value: string,
): DebugMrfi["headingHash"] | undefined {
  const match = value.match(/^smh64:([0-9a-f]{16})(?:\/(\d+))?$/i);
  if (!match) {
    return undefined;
  }
  return {
    hash: BigInt(`0x${match[1]}`),
    ...(match[2] ? { maxDistance: Number(match[2]) } : {}),
  };
}

export function parseMrfiRange(
  value: string,
): SourceRange | undefined {
  const match = value.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
  if (!match) {
    return undefined;
  }
  const range = {
    startLine: Number(match[1]),
    startColumn: Number(match[2]),
    endLine: Number(match[3]),
    endColumn: Number(match[4]),
  };
  return isRangeShapeValid(range) ? range : undefined;
}

export function decodeDebugValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new MdError(
      "invalid_id",
      `malformed percent-encoding in MRFI debug value: ${value}`,
    );
  }
}

export function encodeDebugValue(value: string): string {
  return Array.from(value).map((char) => {
    if (char === "%" || char === ";" || char === "}" || /\s/u.test(char)) {
      return encodeURIComponent(char);
    }
    return char;
  }).join("");
}

const KNOWN_DEBUG_KEYS = new Set([
  "r",
  "o",
  "p",
  "a",
  "fh",
  "hh",
  "ph",
  "ctx",
  "doc",
  "q",
  "x",
]);

export function getMustUnderstandViolations(parsed: DebugMrfi): string[] {
  if (!parsed.extra) return [];
  return [...parsed.extra.keys()].filter((k) =>
    !k.startsWith("_") && !KNOWN_DEBUG_KEYS.has(k)
  );
}
