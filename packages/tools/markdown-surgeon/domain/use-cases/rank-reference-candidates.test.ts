/**
 * Tests for RankReferenceCandidatesUseCase, per docs/specs/mrfi.md's
 * `rank(target, candidates)`: orders candidates by `(verdict class,
 * similarity)`, closest-probable-match first, with ties sharing a rank.
 */

import { assertEquals } from "@std/assert";
import { RankReferenceCandidatesUseCase } from "./rank-reference-candidates.ts";

const useCase = new RankReferenceCandidatesUseCase();

Deno.test("rank - orders an exact fh match ahead of an unrelated one", async () => {
  const target = "~{v0;fh=xxh64:aabbccdd}";
  const result = await useCase.execute({
    target,
    candidates: [
      "~{v0;fh=xxh64:11223344;p=h1[1]}",
      "~{v0;fh=xxh64:aabbccdd}",
    ],
  });

  assertEquals(result[0].ref, "~{v0;fh=xxh64:aabbccdd}");
  assertEquals(result[0].comparison.verdict, "same");
  assertEquals(result[0].rank, 1);
});

Deno.test("rank - handles an empty candidate list", async () => {
  const result = await useCase.execute({
    target: "~{v0;fh=xxh64:aabbccdd}",
    candidates: [],
  });
  assertEquals(result, []);
});

Deno.test("rank - reports ties with the same rank", async () => {
  const target = "~{v0;a=intro}";
  const result = await useCase.execute({
    target,
    candidates: ["~{v0;a=intro}", "~{v0;a=intro}"],
  });

  assertEquals(result[0].rank, 1);
  assertEquals(result[1].rank, 1);
});

Deno.test("rank - an unparsable candidate sorts last instead of throwing", async () => {
  const target = "~{v0;fh=xxh64:aabbccdd}";
  const result = await useCase.execute({
    target,
    candidates: ["not a reference", "~{v0;fh=xxh64:aabbccdd}"],
  });

  assertEquals(result[0].ref, "~{v0;fh=xxh64:aabbccdd}");
  assertEquals(result[1].comparison.verdict, "invalid");
});

Deno.test("rank - an unparsable target makes every comparison invalid", async () => {
  const result = await useCase.execute({
    target: "not a reference",
    candidates: ["~{v0;fh=xxh64:aabbccdd}"],
  });

  assertEquals(result[0].comparison.verdict, "invalid");
});
