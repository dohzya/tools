/**
 * Unit tests for RankReferenceCandidatesUseCase.
 *
 * Only covers the current identity-stub behavior — see the doc comment on
 * the use case for the ranking behavior this is a seam for.
 */

import { assertEquals } from "@std/assert";
import { RankReferenceCandidatesUseCase } from "./rank-reference-candidates.ts";

Deno.test("RankReferenceCandidatesUseCase.execute - identity stub returns candidates unchanged", () => {
  const useCase = new RankReferenceCandidatesUseCase();
  const candidates = ["~{v0;r=L1-L2}", "~{v0;r=L5-L6}", "~{v0;r=L10-L11}"];

  const result = useCase.execute({
    target: "the passage text we are trying to place",
    candidates,
  });

  assertEquals(result, candidates);
});

Deno.test("RankReferenceCandidatesUseCase.execute - identity stub handles an empty candidate list", () => {
  const useCase = new RankReferenceCandidatesUseCase();

  const result = useCase.execute({ target: "anything", candidates: [] });

  assertEquals(result, []);
});
