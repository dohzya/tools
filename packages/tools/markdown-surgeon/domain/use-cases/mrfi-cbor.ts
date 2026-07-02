/**
 * Generic binary/text encoding primitives used by the MRFI compact envelope.
 *
 * CBOR (a minimal subset: uints, text strings, arrays, integer/text-keyed
 * maps) plus the base62 and Hangul payload codecs sit together here because
 * they are all low-level "bytes in, bytes/string out" machinery with no
 * knowledge of MRFI field semantics — that lives in mrfi-codec.ts.
 */

import { MdError } from "../entities/document.ts";

export type CborValue = number | string | readonly CborValue[] | CborMap;

export interface CborMap {
  readonly kind: "map";
  readonly entries: readonly [number | string, CborValue][];
}

export const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const HANGUL_BASE = 0xac00;

export const HANGUL_LIMIT = 0xb3ff;

export const MRFI_MAGIC = new TextEncoder().encode("MRFI");

export async function checksum24(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return new Uint8Array(digest).slice(0, 3);
}

export function encodeBase62Payload(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  if (value === 0n) return "0";

  let result = "";
  while (value > 0n) {
    const digit = Number(value % 62n);
    result = BASE62_ALPHABET[digit] + result;
    value = value / 62n;
  }
  return result;
}

export function decodeBase62Payload(payload: string): Uint8Array {
  if (!/^[0-9A-Za-z]+$/.test(payload)) {
    throw new MdError("invalid_id", "Invalid base62 MRFI payload");
  }

  let value = 0n;
  for (const char of payload) {
    const digit = BASE62_ALPHABET.indexOf(char);
    if (digit === -1) {
      throw new MdError("invalid_id", "Invalid base62 MRFI payload");
    }
    value = value * 62n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return new Uint8Array(bytes);
}

export function encodeHangulPayload(bytes: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bitCount = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 11) {
      bitCount -= 11;
      const value = (buffer >> bitCount) & 0x7ff;
      result += String.fromCodePoint(HANGUL_BASE + value);
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0) {
    const value = (buffer << (11 - bitCount)) & 0x7ff;
    result += String.fromCodePoint(HANGUL_BASE + value);
  }

  return result;
}

export function decodeHangulPayload(payload: string): Uint8Array {
  const normalized = payload.normalize("NFC");
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;

  for (const char of normalized) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint === undefined || codePoint < HANGUL_BASE ||
      codePoint > HANGUL_LIMIT
    ) {
      throw new MdError("invalid_id", "Invalid Hangul MRFI payload");
    }
    buffer = (buffer << 11) | (codePoint - HANGUL_BASE);
    bitCount += 11;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0 && buffer !== 0) {
    throw new MdError("invalid_id", "Invalid Hangul MRFI padding");
  }

  return new Uint8Array(bytes);
}

export function isCborMap(value: CborValue): value is CborMap {
  return typeof value === "object" && !Array.isArray(value) &&
    "kind" in value && value.kind === "map";
}

export function encodeCbor(value: CborValue): Uint8Array {
  if (typeof value === "number") {
    return encodeCborHead(0, value);
  }
  if (typeof value === "string") {
    const text = new TextEncoder().encode(value);
    return concatBytes([encodeCborHead(3, text.length), text]);
  }
  if (Array.isArray(value)) {
    return concatBytes([
      encodeCborHead(4, value.length),
      ...value.map((item) => encodeCbor(item)),
    ]);
  }

  if (!isCborMap(value)) {
    throw new MdError("invalid_id", "Unsupported CBOR value");
  }

  const entries = [...value.entries].sort(([left], [right]) => {
    if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return concatBytes([
    encodeCborHead(5, entries.length),
    ...entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)]),
  ]);
}

export function encodeCborHead(major: number, value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MdError("invalid_id", "CBOR encoder only supports uint values");
  }

  const prefix = major << 5;
  if (value < 24) return new Uint8Array([prefix | value]);
  if (value <= 0xff) return new Uint8Array([prefix | 24, value]);
  if (value <= 0xffff) {
    return new Uint8Array([prefix | 25, value >> 8, value & 0xff]);
  }
  if (value <= 0xffffffff) {
    return new Uint8Array([
      prefix | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  const bigint = BigInt(value);
  return new Uint8Array([
    prefix | 27,
    Number((bigint >> 56n) & 0xffn),
    Number((bigint >> 48n) & 0xffn),
    Number((bigint >> 40n) & 0xffn),
    Number((bigint >> 32n) & 0xffn),
    Number((bigint >> 24n) & 0xffn),
    Number((bigint >> 16n) & 0xffn),
    Number((bigint >> 8n) & 0xffn),
    Number(bigint & 0xffn),
  ]);
}

export class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readValue(): CborValue {
    if (this.offset >= this.bytes.length) {
      throw new MdError("invalid_id", "Unexpected end of CBOR payload");
    }

    const initial = this.bytes[this.offset];
    this.offset += 1;
    const major = initial >> 5;
    const length = this.readLength(initial & 0x1f);

    if (major === 0) {
      return length;
    }
    if (major === 3) {
      return new TextDecoder().decode(this.readBytes(length));
    }
    if (major === 4) {
      const values: CborValue[] = [];
      for (let index = 0; index < length; index += 1) {
        values.push(this.readValue());
      }
      return values;
    }
    if (major === 5) {
      const entries: Array<[number | string, CborValue]> = [];
      for (let index = 0; index < length; index += 1) {
        const key = this.readValue();
        if (typeof key !== "number" && typeof key !== "string") {
          throw new MdError("invalid_id", "Unsupported CBOR map key");
        }
        entries.push([key, this.readValue()]);
      }
      return { kind: "map", entries };
    }

    throw new MdError("invalid_id", "Unsupported CBOR payload");
  }

  private readLength(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.readUint(1);
    if (additional === 25) return this.readUint(2);
    if (additional === 26) return this.readUint(4);
    if (additional === 27) return this.readUint(8);
    throw new MdError("invalid_id", "Unsupported CBOR length");
  }

  private readUint(byteCount: number): number {
    const bytes = this.readBytes(byteCount);
    let value = 0n;
    for (const byte of bytes) {
      value = (value << 8n) | BigInt(byte);
    }
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)) {
      throw new MdError("invalid_id", "CBOR uint is too large");
    }
    return numberValue;
  }

  private readBytes(length: number): Uint8Array {
    const end = this.offset + length;
    if (end > this.bytes.length) {
      throw new MdError("invalid_id", "Unexpected end of CBOR payload");
    }
    const result = this.bytes.slice(this.offset, end);
    this.offset = end;
    return result;
  }
}

export function encodeVarUint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MdError("invalid_id", "Invalid compact MRFI length");
  }

  const bytes = [value & 0x7f];
  value = Math.floor(value / 128);
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  return new Uint8Array(bytes);
}

export function decodeVarUint(
  bytes: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } {
  let value = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index];
    value = value * 128 + (byte & 0x7f);
    index += 1;
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: index };
    }
  }
  throw new MdError("invalid_id", "Invalid compact MRFI length");
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
