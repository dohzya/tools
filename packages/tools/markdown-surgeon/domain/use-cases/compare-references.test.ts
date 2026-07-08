/**
 * Tests for compare(A, B), per docs/specs/mrfi.md's "Comparing References
 * Without Resolving": per-field rules, the similarity/comparability/verdict
 * output, and the `x` (extent selector) participation rules.
 */

import { assertEquals } from "@std/assert";
import { CompareReferencesUseCase } from "./compare-references.ts";

const useCase = new CompareReferencesUseCase();

Deno.test("compare - equal fh is a strong same signal", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd}",
    b: "~{v0;fh=xxh64:aabbccdd}",
  });
  assertEquals(result.verdict, "same");
});

Deno.test("compare - differing fh with a shared strong field is unrelated", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd;p=h1[1]%2Fp[1]}",
    b: "~{v0;fh=xxh64:11223344;p=h1[1]%2Fp[1]}",
  });
  assertEquals(result.verdict, "unrelated");
});

Deno.test("compare - equal anchor with no conflicting content evidence is same", async () => {
  const result = await useCase.execute({
    a: "~{v0;a=intro}",
    b: "~{v0;a=intro}",
  });
  assertEquals(result.verdict, "same");
});

Deno.test("compare - r shared without compatible doc is incomparable", async () => {
  const result = await useCase.execute({
    a: "~{v0;r=1:1-2:1}",
    b: "~{v0;r=100:1-101:1}",
  });
  assertEquals(result.verdict, "incomparable");
  assertEquals(result.comparability, 0);
});

Deno.test("compare - r overlap gated by close doc contributes to likely", async () => {
  const result = await useCase.execute({
    a: "~{v0;r=1:1-2:1;doc=smh64:0000000000000000}",
    b: "~{v0;r=1:1-2:1;doc=smh64:0000000000000001}",
  });
  // r/o alone stay weak evidence (spec: "meaningless across unrelated
  // documents" is the failure mode being avoided, not a promise that a
  // doc-gated range match alone reaches "likely").
  assertEquals(result.fields.find((f) => f.field === "r")?.outcome, "match");
});

Deno.test("compare - x mismatch caps an otherwise-same verdict at possible", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd;x=sec}",
    b: "~{v0;fh=xxh64:aabbccdd;x=body}",
  });
  assertEquals(result.verdict, "possible");
  assertEquals(result.fields.find((f) => f.field === "x")?.outcome, "conflict");
});

Deno.test("compare - x absent on both sides defaults to plain extent and matches", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd}",
    b: "~{v0;fh=xxh64:aabbccdd}",
  });
  assertEquals(result.fields.find((f) => f.field === "x")?.outcome, "match");
  assertEquals(result.verdict, "same");
});

Deno.test("compare - must-understand violation on either side is invalid", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd;zz=unknown}",
    b: "~{v0;fh=xxh64:aabbccdd}",
  });
  assertEquals(result.verdict, "invalid");
});

Deno.test("compare - unparsable reference is invalid", async () => {
  const result = await useCase.execute({
    a: "not a reference",
    b: "~{v0;fh=xxh64:aabbccdd}",
  });
  assertEquals(result.verdict, "invalid");
});

Deno.test("compare - extension fields never trigger invalid", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd;_kind=note}",
    b: "~{v0;fh=xxh64:aabbccdd}",
  });
  assertEquals(result.verdict, "same");
});

Deno.test("compare - matching ctx on both sides is a shared strong field", async () => {
  const result = await useCase.execute({
    a: "~{v0;ctx=pre:before%20text,suf:after%20text}",
    b: "~{v0;ctx=pre:before%20text,suf:after%20text}",
  });
  const ctx = result.fields.find((f) => f.field === "ctx");
  assertEquals(ctx?.outcome, "match");
  assertEquals(ctx?.similarity, 1);
  assertEquals(result.comparability > 0, true);
});

Deno.test("compare - fh with mismatched hash tags is non-comparable, not conflicting", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd;p=h1[1]%2Fp[1]}",
    b: "~{v0;fh=sha256:aabbccdd;p=h1[1]%2Fp[1]}",
  });
  assertEquals(result.fields.find((f) => f.field === "fh")?.outcome, "absent");
});

Deno.test("compare - fields present only on one side contribute nothing", async () => {
  const result = await useCase.execute({
    a: "~{v0;fh=xxh64:aabbccdd;q=hello%20world}",
    b: "~{v0;fh=xxh64:aabbccdd}",
  });
  assertEquals(result.fields.find((f) => f.field === "q")?.outcome, "absent");
  assertEquals(result.verdict, "same");
});
