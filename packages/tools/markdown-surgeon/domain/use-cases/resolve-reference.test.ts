/**
 * Property tests for the confidence constants used by ResolveReferenceUseCase.
 *
 * docs/specs/mrfi.md "Confidence" requires thresholds to be documented and
 * stable, and confidence to be monotone: a higher value always means
 * stronger evidence agreement. These tests pin CONFIDENCE as the single
 * source of truth and check that every named tier respects that ordering
 * relative to CONFIDENT_THRESHOLD, instead of leaving ad-hoc literals
 * scattered across resolveMrfiReference's branches.
 */

import { assert, assertEquals } from "@std/assert";
import { CONFIDENCE, CONFIDENT_THRESHOLD } from "./resolve-reference.ts";

Deno.test("CONFIDENCE.EXACT is the maximum possible confidence, per spec", () => {
  assertEquals(CONFIDENCE.EXACT, 1);
  for (const [name, value] of Object.entries<number>(CONFIDENCE)) {
    assert(value <= CONFIDENCE.EXACT, `${name} (${value}) exceeds EXACT`);
  }
});

Deno.test("every AMBIGUOUS_* and STALE_* tier is below the confident threshold", () => {
  for (const [name, value] of Object.entries<number>(CONFIDENCE)) {
    if (name.startsWith("AMBIGUOUS_") || name.startsWith("STALE_")) {
      assert(
        value < CONFIDENT_THRESHOLD,
        `${name} (${value}) should be below CONFIDENT_THRESHOLD (${CONFIDENT_THRESHOLD})`,
      );
    }
  }
});

Deno.test("every CONFIDENT_* and RANGE_CONFIDENT* tier meets the confident threshold", () => {
  for (const [name, value] of Object.entries<number>(CONFIDENCE)) {
    if (name.startsWith("CONFIDENT_") || name.startsWith("RANGE_CONFIDENT")) {
      assert(
        value >= CONFIDENT_THRESHOLD,
        `${name} (${value}) should be at or above CONFIDENT_THRESHOLD (${CONFIDENT_THRESHOLD})`,
      );
    }
  }
});
