/**
 * Use Case: RankReferenceCandidates
 *
 * Implements `rank(target, candidates)` from docs/specs/mrfi.md's "Ranking":
 * compares `target` against each candidate via `compareLocators`
 * (compare-references.ts) and orders candidates by `(verdict class,
 * similarity)`, closest-probable-match first. Ties are reported explicitly
 * via a shared `rank` number (standard competition ranking: equal entries
 * share a rank, the next distinct entry skips accordingly).
 *
 * Pure over its inputs' string content: no `Document` is involved, so no
 * resolution happens in this use case. That lets a caller holding several
 * stored candidate references for the same file resolve them in ranked
 * order and stop at the first confident match, instead of resolving every
 * candidate against the document.
 *
 * A `target` or candidate that fails to parse, or that violates the
 * must-understand rule (unknown non-`_` field), compares as `invalid` --
 * same as at resolution time -- and sorts last rather than throwing, so one
 * bad candidate cannot break ranking for the rest.
 */

import { MdError } from "../entities/document.ts";
import type {
  DebugMrfi,
  MrfiVerdict,
  RankedReferenceCandidate,
} from "../entities/mrfi.ts";
import { compareLocators } from "./compare-references.ts";
import { parseMrfiReference } from "./mrfi-codec.ts";

/** Input for the RankReferenceCandidates use case */
export interface RankReferenceCandidatesInput {
  /** The MRFI reference string ranking is relative to */
  readonly target: string;
  /** MRFI reference strings to rank, e.g. previously stored `~{...}` references */
  readonly candidates: readonly string[];
}

/**
 * Verdict quality order, best (closest probable match) first. `invalid`
 * sorts alongside `incomparable` at the back: both carry no usable
 * evidence, so a bad candidate falls to the end without special-casing.
 */
const VERDICT_ORDER: readonly MrfiVerdict[] = [
  "same",
  "likely",
  "possible",
  "unrelated",
  "incomparable",
  "invalid",
];

/** Ranks reference candidates by proximity to a target, per `rank(target, candidates)` */
export class RankReferenceCandidatesUseCase {
  /** Rank `candidates`, closest-probable-match first, with ties reported via a shared `rank` */
  async execute(
    input: RankReferenceCandidatesInput,
  ): Promise<readonly RankedReferenceCandidate[]> {
    const target = await tryParse(input.target);

    const compared = await Promise.all(
      input.candidates.map(async (ref) => {
        const candidate = await tryParse(ref);
        const comparison = target && candidate
          ? compareLocators(target, candidate)
          : {
            similarity: 0,
            comparability: 0,
            verdict: "invalid" as const,
            fields: [],
            diagnostics: ["unparsable MRFI reference"],
          };
        return { ref, comparison };
      }),
    );

    const sorted = [...compared].sort((left, right) => {
      const classDiff = VERDICT_ORDER.indexOf(left.comparison.verdict) -
        VERDICT_ORDER.indexOf(right.comparison.verdict);
      if (classDiff !== 0) return classDiff;
      return right.comparison.similarity - left.comparison.similarity;
    });

    const ranked: RankedReferenceCandidate[] = [];
    let rank = 0;
    let previous: (typeof sorted)[number] | undefined;
    for (const [index, entry] of sorted.entries()) {
      const tiedWithPrevious = previous !== undefined &&
        previous.comparison.verdict === entry.comparison.verdict &&
        previous.comparison.similarity === entry.comparison.similarity;
      rank = tiedWithPrevious ? rank : index + 1;
      ranked.push({ ref: entry.ref, rank, comparison: entry.comparison });
      previous = entry;
    }
    return ranked;
  }
}

async function tryParse(ref: string): Promise<DebugMrfi | undefined> {
  try {
    return await parseMrfiReference(ref);
  } catch (error) {
    if (error instanceof MdError) return undefined;
    throw error;
  }
}
