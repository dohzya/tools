/**
 * Unit tests for the MRFI hash-tag registry: docs/specs/mrfi.md requires
 * compact encodings to omit a hash field's default algorithm tag, use a
 * small registered code for a known non-default tag, and fall back to a
 * literal encoding for an unknown tag — while the debug form always spells
 * the tag out literally.
 */

import { assertEquals } from "@std/assert";
import type { DebugMrfi } from "../entities/mrfi.ts";
import { assertThrows } from "@std/assert";
import {
  decodeCompactMrfi,
  decodeExtraFields,
  encodeCompactMrfi,
  getMustUnderstandViolations,
  parseDebugMrfi,
  parseHashSignal,
  serializeDebugMrfi,
  serializeHashSignal,
} from "./mrfi-codec.ts";

Deno.test("parseHashSignal - accepts the default fh tag (xxh64)", () => {
  assertEquals(parseHashSignal("xxh64:abc123"), {
    algorithm: "xxh64",
    prefix: "abc123",
  });
});

Deno.test("parseHashSignal - accepts a non-default known tag (sha256)", () => {
  assertEquals(parseHashSignal("sha256:abc123"), {
    algorithm: "sha256",
    prefix: "abc123",
  });
});

Deno.test("parseHashSignal - accepts and preserves an unknown tag verbatim", () => {
  assertEquals(parseHashSignal("blake3:abc123"), {
    algorithm: "blake3",
    prefix: "abc123",
  });
});

Deno.test("serializeHashSignal - always spells the tag out literally", () => {
  assertEquals(
    serializeHashSignal("fh", { algorithm: "xxh64", prefix: "abc123" }),
    "fh=xxh64:abc123",
  );
});

function roundTrip(parsed: DebugMrfi): DebugMrfi | undefined {
  return decodeCompactMrfi(encodeCompactMrfi(parsed));
}

Deno.test("compact fh round-trip - default tag (xxh64) omits the algorithm", () => {
  const parsed: DebugMrfi = {
    exactHash: { algorithm: "xxh64", prefix: "abc123" },
  };
  const decoded = roundTrip(parsed);
  assertEquals(decoded?.exactHash, { algorithm: "xxh64", prefix: "abc123" });
});

Deno.test("compact fh round-trip - non-default known tag (sha256) uses a registered code", () => {
  const parsed: DebugMrfi = {
    exactHash: { algorithm: "sha256", prefix: "abc123" },
  };
  const decoded = roundTrip(parsed);
  assertEquals(decoded?.exactHash, { algorithm: "sha256", prefix: "abc123" });
});

Deno.test("compact fh round-trip - unknown tag falls back to literal encoding", () => {
  const parsed: DebugMrfi = {
    exactHash: { algorithm: "blake3", prefix: "abc123" },
  };
  const decoded = roundTrip(parsed);
  assertEquals(decoded?.exactHash, { algorithm: "blake3", prefix: "abc123" });
});

Deno.test("compact doc round-trip - fuzzy (smh64) hash, like hh/ph", () => {
  const parsed: DebugMrfi = {
    documentHash: { hash: 0x0123456789abcdefn, maxDistance: 8 },
  };
  const decoded = roundTrip(parsed);
  assertEquals(decoded?.documentHash, {
    hash: 0x0123456789abcdefn,
    maxDistance: 8,
  });
});

Deno.test("debug doc field - serializes as a fuzzy smh64 hash, not a HashSignal", () => {
  const serialized = serializeDebugMrfi({
    documentHash: { hash: 0x0123456789abcdefn, maxDistance: 8 },
  });
  assertEquals(serialized, "~{v0;doc=smh64:0123456789abcdef/8}");
  assertEquals(parseDebugMrfi(serialized)?.documentHash, {
    hash: 0x0123456789abcdefn,
    maxDistance: 8,
  });
});

Deno.test("compact hh round-trip - default tag (smh64) still decodes correctly", () => {
  const parsed: DebugMrfi = {
    headingHash: { hash: 0x0123456789abcdefn, maxDistance: 4 },
  };
  const decoded = roundTrip(parsed);
  assertEquals(decoded?.headingHash, {
    hash: 0x0123456789abcdefn,
    maxDistance: 4,
  });
});

Deno.test("compact ph round-trip - without maxDistance", () => {
  const parsed: DebugMrfi = {
    passageHash: { hash: 0x0123456789abcdefn },
  };
  const decoded = roundTrip(parsed);
  assertEquals(decoded?.passageHash, { hash: 0x0123456789abcdefn });
});

Deno.test("decodeExtraFields - preserves a string-valued unknown key verbatim", () => {
  const extra = decodeExtraFields({
    kind: "map",
    entries: [["_kind", "review-comment"]],
  });
  assertEquals(extra.get("_kind"), "review-comment");
});

Deno.test("decodeExtraFields - coerces a non-string unknown-key value to a literal string instead of throwing", () => {
  const extra = decodeExtraFields({
    kind: "map",
    entries: [["_score", 42]],
  });
  assertEquals(extra.get("_score"), "42");
});

Deno.test("decodeExtraFields - coerces a nested-array unknown-key value to a literal string", () => {
  const extra = decodeExtraFields({
    kind: "map",
    entries: [["_tags", ["a", "b"]]],
  });
  assertEquals(extra.get("_tags"), '["a","b"]');
});

// --- extentSelector (x field) ---

Deno.test("debug extentSelector round-trip - sec", () => {
  const serialized = serializeDebugMrfi({ extentSelector: "sec" });
  assertEquals(serialized, "~{v0;x=sec}");
  assertEquals(parseDebugMrfi(serialized)?.extentSelector, "sec");
});

Deno.test("debug extentSelector round-trip - body", () => {
  const serialized = serializeDebugMrfi({ extentSelector: "body" });
  assertEquals(serialized, "~{v0;x=body}");
  assertEquals(parseDebugMrfi(serialized)?.extentSelector, "body");
});

Deno.test("debug extentSelector round-trip - lead", () => {
  const serialized = serializeDebugMrfi({ extentSelector: "lead" });
  assertEquals(serialized, "~{v0;x=lead}");
  assertEquals(parseDebugMrfi(serialized)?.extentSelector, "lead");
});

Deno.test("debug parse invalid x value throws", () => {
  assertThrows(
    () => parseDebugMrfi("~{v0;x=foo}"),
    Error,
    "invalid MRFI extent selector",
  );
});

Deno.test("compact extentSelector round-trip - sec", () => {
  assertEquals(roundTrip({ extentSelector: "sec" })?.extentSelector, "sec");
});

Deno.test("compact extentSelector round-trip - body", () => {
  assertEquals(roundTrip({ extentSelector: "body" })?.extentSelector, "body");
});

Deno.test("compact extentSelector round-trip - lead", () => {
  assertEquals(roundTrip({ extentSelector: "lead" })?.extentSelector, "lead");
});

Deno.test("compact decode throws on unknown extentSelector code", async () => {
  const { encodeCbor } = await import("./mrfi-cbor.ts");
  const payload = encodeCbor({
    kind: "map",
    entries: [[0, 0], [11, 99]],
  });
  assertThrows(
    () => decodeCompactMrfi(payload),
    Error,
    "invalid MRFI extent selector",
  );
});

Deno.test("compact extentSelector combined with range round-trip", () => {
  const input: DebugMrfi = {
    extentSelector: "lead",
    range: { startLine: 1, startColumn: 1, endLine: 5, endColumn: 10 },
  };
  const decoded = roundTrip(input);
  assertEquals(decoded?.extentSelector, "lead");
  assertEquals(decoded?.range, {
    startLine: 1,
    startColumn: 1,
    endLine: 5,
    endColumn: 10,
  });
});

// --- getMustUnderstandViolations ---

Deno.test("getMustUnderstandViolations - no violations when extra is undefined", () => {
  assertEquals(getMustUnderstandViolations({}), []);
});

Deno.test("getMustUnderstandViolations - no violations for extension keys", () => {
  assertEquals(
    getMustUnderstandViolations({
      extra: new Map([["_kind", "review"]]),
    }),
    [],
  );
});

Deno.test("getMustUnderstandViolations - violation for unknown non-extension key", () => {
  assertEquals(
    getMustUnderstandViolations({
      extra: new Map([["foo", "bar"]]),
    }),
    ["foo"],
  );
});

Deno.test("getMustUnderstandViolations - mixed extension and unknown keys", () => {
  assertEquals(
    getMustUnderstandViolations({
      extra: new Map([["_kind", "r"], ["foo", "b"], ["bar", "c"]]),
    }),
    ["foo", "bar"],
  );
});
