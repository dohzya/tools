/**
 * Use Case: RankReferenceCandidates
 *
 * Deliberate seam, not yet the real behavior. Today this is a literal
 * identity function: it returns `candidates` unchanged, in the same order
 * they were given.
 *
 * The intended future behavior (not implemented here): rank a list of MRFI
 * reference strings by textual/structural proximity to `target`, closest-
 * probable-match first, operating purely on the candidates' own string
 * content — no `Document` is involved, so no resolution happens in this
 * use case. That lets a caller holding several stored candidate references
 * for the same file resolve them in ranked order and stop at the first
 * confident match, instead of resolving every candidate against the
 * document.
 *
 * Pure and synchronous: no dependencies, no I/O.
 */

/** Input for the RankReferenceCandidates use case */
export interface RankReferenceCandidatesInput {
  /** The text a caller is trying to place; ranking will be relative to this */
  readonly target: string;
  /** MRFI reference strings to rank, e.g. previously stored `~{...}` references */
  readonly candidates: readonly string[];
}

/** Ranks reference candidates by proximity to a target (currently a no-op identity stub) */
export class RankReferenceCandidatesUseCase {
  /** Rank `candidates`, closest-probable-match first (currently returns them unchanged) */
  execute(input: RankReferenceCandidatesInput): readonly string[] {
    return input.candidates;
  }
}
