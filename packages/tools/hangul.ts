/**
 * Shared Hangul alphabet for compact textual encodings.
 *
 * Two consumers sit on the same window with different access patterns:
 * markdown-surgeon's MRFI payload is a byte stream whose length is carried by
 * its envelope, while dz-review's review timestamps are a fixed-width
 * positional numeral whose width the caller knows. Neither needs the byte
 * length recoverable from the text, which is why this codec does not carry
 * one — see `decodeHangulBytes`.
 */

export const HANGUL_BASE = 0xac00;

/**
 * 8192 syllables (13 bits) is the largest power of two that fits inside the
 * Hangul syllables block (AC00–D7A3); 16384 would overflow it.
 */
export const HANGUL_BITS = 13;

export const HANGUL_LIMIT = HANGUL_BASE + (1 << HANGUL_BITS) - 1;

/**
 * The 11-bit layout emitted before `HANGUL_BITS` moved to 13. Its window is a
 * subset of the current one, so a legacy value is indistinguishable from a
 * current one by inspection; only a consumer-level plausibility check tells
 * them apart (an envelope for MRFI, a date range for timestamps).
 */
export const HANGUL_LEGACY_BITS = 11;

function syllable(value: number): string {
  return String.fromCodePoint(HANGUL_BASE + value);
}

function digitOf(char: string, bits: number): number {
  const codePoint = char.codePointAt(0);
  if (
    codePoint === undefined || codePoint < HANGUL_BASE ||
    codePoint > HANGUL_BASE + (1 << bits) - 1
  ) {
    throw new RangeError(`Invalid Hangul syllable: ${char}.`);
  }
  return codePoint - HANGUL_BASE;
}

/**
 * Bit packing only: the byte length is not recoverable from the syllable count
 * alone (2 and 3 bytes both fit in 2 syllables), so `decodeHangulBytes` may
 * return one trailing zero byte the encoder never saw. Callers must know the
 * length by other means.
 */
export function encodeHangulBytes(
  bytes: Uint8Array,
  bits: number = HANGUL_BITS,
): string {
  const mask = (1 << bits) - 1;
  let result = "";
  let buffer = 0;
  let bitCount = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= bits) {
      bitCount -= bits;
      result += syllable((buffer >> bitCount) & mask);
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0) {
    result += syllable((buffer << (bits - bitCount)) & mask);
  }

  return result;
}

export function decodeHangulBytes(
  text: string,
  bits: number = HANGUL_BITS,
): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;

  for (const char of text.normalize("NFC")) {
    buffer = (buffer << bits) | digitOf(char, bits);
    bitCount += bits;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0 && buffer !== 0) {
    throw new RangeError("Invalid Hangul padding.");
  }

  return new Uint8Array(bytes);
}

/**
 * Fixed-width positional form: `digits` syllables carry exactly
 * `digits * bits` bits, most significant first, zero-padded on the left.
 */
export function encodeHangulDigits(
  value: bigint,
  digits: number,
  bits: number = HANGUL_BITS,
): string {
  if (value < 0n) {
    throw new RangeError("Cannot encode a negative integer as unsigned.");
  }
  if (value >= 1n << BigInt(digits * bits)) {
    throw new RangeError(
      `Value ${value} does not fit in ${digits} Hangul digits.`,
    );
  }

  const base = BigInt(1 << bits);
  let remaining = value;
  let result = "";
  for (let index = 0; index < digits; index += 1) {
    result = syllable(Number(remaining % base)) + result;
    remaining /= base;
  }
  return result;
}

export function decodeHangulDigits(
  text: string,
  bits: number = HANGUL_BITS,
): bigint {
  if (text.length === 0) {
    throw new RangeError("Cannot decode an empty integer.");
  }

  const base = BigInt(1 << bits);
  let result = 0n;
  for (const char of text.normalize("NFC")) {
    result = result * base + BigInt(digitOf(char, bits));
  }
  return result;
}
