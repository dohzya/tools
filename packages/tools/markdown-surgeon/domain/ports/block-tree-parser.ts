/**
 * Port: BlockTreeParser
 *
 * Abstracts CommonMark block-tree parsing so the domain does not depend on
 * a specific Markdown parser implementation. Used to compute/resolve the
 * container and paragraph steps of a `p` structural path below its
 * section-tree heading ancestry (docs/specs/mrfi.md: "p paths walk the
 * section tree, extended with real container steps").
 *
 * Dependencies: entities only (none needed here).
 */

/** Container/paragraph node kinds usable as `p`-path steps below heading ancestry */
export type BlockKind = "p" | "ul" | "ol" | "li" | "blockquote";

/** One step of a block-tree path: a node kind with its one-based sibling occurrence under its parent step */
export interface BlockStep {
  readonly kind: BlockKind;
  readonly occurrence: number;
}

/** Parses a Markdown source fragment into a block tree and walks it by structural steps */
export interface BlockTreeParser {
  /**
   * Container/paragraph step chain (root to leaf) for the deepest block in
   * `source` that fully contains the codepoint range [start, end). Returns
   * an empty array when no single block fully contains the range (e.g. the
   * range spans multiple top-level blocks, or covers the whole source).
   */
  stepsForRange(
    source: string,
    start: number,
    end: number,
  ): readonly BlockStep[];

  /**
   * Inverse of stepsForRange: the codepoint range in `source` of the block
   * reached by walking `steps` from the document root, or `undefined` if no
   * such block exists (the steps don't match the current tree shape).
   */
  rangeForSteps(
    source: string,
    steps: readonly BlockStep[],
  ): { start: number; end: number } | undefined;
}
