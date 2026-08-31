/**
 * Unit tests for the Hangul payload codec: the compact MRFI representation
 * packs 13 bits per syllable over the AC00–CBFF window (8192 syllables), and
 * carries the payload's true byte length in the envelope rather than in the
 * codec itself.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeHangulPayload,
  encodeHangulPayload,
  HANGUL_BASE,
  HANGUL_LEGACY_BITS,
  HANGUL_LIMIT,
} from "./mrfi-cbor.ts";
import { decodeCompactEnvelope, encodeCompactEnvelope } from "./mrfi-codec.ts";

function bytes(length: number): Uint8Array {
  return new Uint8Array(length).map((_, index) => (index * 37 + 11) & 0xff);
}

Deno.test("encodeHangulPayload - packs 13 bits per syllable", () => {
  // 13 bytes = 104 bits = exactly 8 syllables at 13 bits/syllable.
  assertEquals(
    [...encodeHangulPayload(new Uint8Array(13).fill(0xff))].length,
    8,
  );
});

Deno.test("encodeHangulPayload - uses the full 8192-syllable window", () => {
  const encoded = encodeHangulPayload(Uint8Array.from([0xff, 0xff]));
  assertEquals(encoded.codePointAt(0), 0xcbff);
});

Deno.test("HANGUL_LIMIT - spans 8192 syllables from the block start", () => {
  assertEquals(HANGUL_BASE, 0xac00);
  assertEquals(HANGUL_LIMIT - HANGUL_BASE + 1, 8192);
});

Deno.test("decodeHangulPayload - rejects a syllable past the window", () => {
  const past = String.fromCodePoint(HANGUL_LIMIT + 1);
  assertThrows(() => decodeHangulPayload(past));
});

Deno.test("decodeHangulPayload - recovers every payload byte", () => {
  for (let length = 0; length <= 60; length += 1) {
    const source = bytes(length);
    const decoded = decodeHangulPayload(encodeHangulPayload(source));
    assertEquals(decoded.slice(0, length), source, `length ${length}`);
  }
});

Deno.test("decodeHangulPayload - byte length comes from the envelope, not the codec", () => {
  // Bit packing alone cannot recover the byte count: 2 bytes (16 bits) and
  // 3 bytes (24 bits) both fit in 2 syllables (26 bits), so the decoder
  // returns the widest reading. Callers must slice to the envelope length.
  const decoded = decodeHangulPayload(encodeHangulPayload(bytes(2)));
  assertEquals(decoded.length, 3);
  assertEquals(decoded[2], 0);
});

Deno.test("compact envelope - round-trips through Hangul at every length", async () => {
  for (let length = 0; length <= 40; length += 1) {
    const payload = bytes(length);
    const encoded = encodeHangulPayload(await encodeCompactEnvelope(payload));
    const decoded = await decodeCompactEnvelope(
      decodeHangulPayload(encoded),
    );
    assertEquals(decoded, payload, `length ${length}`);
  }
});

Deno.test("encodeHangulPayload - honours an explicit bit width", () => {
  const source = bytes(13);
  assertEquals([...encodeHangulPayload(source, HANGUL_LEGACY_BITS)].length, 10);
  assertEquals([...encodeHangulPayload(source)].length, 8);
});

Deno.test("decodeHangulPayload - rejects a syllable past the legacy window", () => {
  const past = String.fromCodePoint(
    HANGUL_BASE + (1 << HANGUL_LEGACY_BITS),
  );
  assertThrows(() => decodeHangulPayload(past, HANGUL_LEGACY_BITS));
});

Deno.test("decodeHangulPayload - round-trips at the legacy bit width", () => {
  for (let length = 0; length <= 40; length += 1) {
    const source = bytes(length);
    const decoded = decodeHangulPayload(
      encodeHangulPayload(source, HANGUL_LEGACY_BITS),
      HANGUL_LEGACY_BITS,
    );
    assertEquals(decoded.slice(0, length), source, `length ${length}`);
  }
});
