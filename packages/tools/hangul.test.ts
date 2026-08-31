/**
 * Unit tests for the shared Hangul alphabet. Two access patterns sit on the
 * same 8192-syllable window: a byte stream (what MRFI's compact payload uses,
 * with the envelope carrying the length) and a fixed-width positional numeral
 * (what dz-review timestamps use, with the caller knowing the width).
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeHangulBytes,
  decodeHangulDigits,
  encodeHangulBytes,
  encodeHangulDigits,
  HANGUL_BASE,
  HANGUL_BITS,
  HANGUL_LEGACY_BITS,
  HANGUL_LIMIT,
} from "./hangul.ts";

Deno.test("HANGUL window - 8192 syllables from the block start", () => {
  assertEquals(HANGUL_BASE, 0xac00);
  assertEquals(HANGUL_BITS, 13);
  assertEquals(HANGUL_LIMIT, 0xcbff);
  assertEquals(HANGUL_LIMIT - HANGUL_BASE + 1, 1 << HANGUL_BITS);
});

Deno.test("encodeHangulBytes - packs 13 bits per syllable", () => {
  assertEquals([...encodeHangulBytes(new Uint8Array(13).fill(0xff))].length, 8);
  assertEquals(
    [...encodeHangulBytes(new Uint8Array(13).fill(0xff), HANGUL_LEGACY_BITS)]
      .length,
    10,
  );
});

Deno.test("decodeHangulBytes - recovers every payload byte", () => {
  for (let length = 0; length <= 60; length += 1) {
    const source = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 0xff);
    const decoded = decodeHangulBytes(encodeHangulBytes(source));
    assertEquals(decoded.slice(0, length), source, `length ${length}`);
  }
});

Deno.test("decodeHangulBytes - rejects a syllable past the window", () => {
  assertThrows(() => decodeHangulBytes(String.fromCodePoint(HANGUL_LIMIT + 1)));
});

Deno.test("encodeHangulDigits - writes a fixed number of digits", () => {
  assertEquals([...encodeHangulDigits(0n, 3)].length, 3);
  assertEquals([...encodeHangulDigits(1n, 3)].length, 3);
  assertEquals(
    encodeHangulDigits(0n, 3),
    String.fromCodePoint(HANGUL_BASE).repeat(3),
  );
  assertEquals(
    encodeHangulDigits(1n, 1),
    String.fromCodePoint(HANGUL_BASE + 1),
  );
});

Deno.test("encodeHangulDigits - round-trips through decodeHangulDigits", () => {
  for (const value of [0n, 1n, 8191n, 8192n, 1787000000n, (1n << 39n) - 1n]) {
    assertEquals(decodeHangulDigits(encodeHangulDigits(value, 3)), value);
  }
});

Deno.test("encodeHangulDigits - rejects a value wider than the digit count", () => {
  assertThrows(() => encodeHangulDigits(1n << 39n, 3));
  assertThrows(() => encodeHangulDigits(-1n, 3));
});

Deno.test("decodeHangulDigits - honours the legacy bit width", () => {
  const epoch = 1787000000n;
  const text = encodeHangulDigits(epoch, 3, HANGUL_LEGACY_BITS);
  assertEquals(decodeHangulDigits(text, HANGUL_LEGACY_BITS), epoch);

  // Reading the same 3 syllables at 13 bits inflates the leading digit by 16x.
  // That gap is what lets a timestamp decoder tell the two layouts apart
  // without any envelope: only one reading lands in a plausible date range.
  const misread = decodeHangulDigits(text);
  assertEquals(misread > epoch * 15n, true);
});
