/**
 * Adapter: CommonmarkBlockTreeParser
 *
 * Implements the BlockTreeParser port on top of the `commonmark` npm
 * package's block-tree AST (headings, paragraphs, lists/items,
 * blockquotes), matching each node's `sourcepos` back to codepoint offsets
 * in the given source fragment.
 */

import { Parser } from "commonmark";
import type {
  BlockKind,
  BlockStep,
  BlockTreeParser,
} from "../../domain/ports/block-tree-parser.ts";

interface CommonmarkNode {
  readonly type: string;
  readonly listType?: string;
  readonly sourcepos?: readonly [
    readonly [number, number],
    readonly [number, number],
  ];
  readonly firstChild: CommonmarkNode | null;
  readonly next: CommonmarkNode | null;
}

/** CommonMark-backed implementation of the BlockTreeParser port */
export class CommonmarkBlockTreeParser implements BlockTreeParser {
  private cachedSource: string | undefined;
  private cachedRoot: CommonmarkNode | undefined;
  private cachedLineStartOffsets: readonly number[] | undefined;

  constructor(private readonly parser: Parser = new Parser()) {}

  stepsForRange(
    source: string,
    start: number,
    end: number,
  ): readonly BlockStep[] {
    const { root, lineStartOffsets } = this.parseCached(source);
    return walkDown(root, lineStartOffsets, start, end);
  }

  rangeForSteps(
    source: string,
    steps: readonly BlockStep[],
  ): { start: number; end: number } | undefined {
    if (steps.length === 0) return undefined;

    const { root, lineStartOffsets } = this.parseCached(source);
    let current = root;
    for (const step of steps) {
      const found = findChild(current, step);
      if (!found) return undefined;
      current = found;
    }
    return nodeRange(current, lineStartOffsets);
  }

  // stepsForRange/rangeForSteps are both called once per review item, and
  // callers (see generate-reference.ts's getStructuralPath) invoke them
  // repeatedly with the same section-scoped source across every item in
  // that section. Reparsing on every call turned per-item id resolution
  // quadratic in the number of items sharing a section. lineStartOffsets is
  // a prefix-sum table so nodeRange (called for every child visited while
  // walking down to a match) is O(1) instead of O(line number).
  private parseCached(
    source: string,
  ): { root: CommonmarkNode; lineStartOffsets: readonly number[] } {
    if (
      this.cachedSource === source && this.cachedRoot &&
      this.cachedLineStartOffsets
    ) {
      return {
        root: this.cachedRoot,
        lineStartOffsets: this.cachedLineStartOffsets,
      };
    }

    const root = this.parser.parse(source);
    const lineStartOffsets = buildLineStartOffsets(source.split("\n"));
    this.cachedSource = source;
    this.cachedRoot = root;
    this.cachedLineStartOffsets = lineStartOffsets;
    return { root, lineStartOffsets };
  }
}

function buildLineStartOffsets(lines: readonly string[]): readonly number[] {
  const offsets: number[] = [0];
  for (const line of lines) {
    offsets.push(offsets[offsets.length - 1] + Array.from(line).length + 1);
  }
  return offsets;
}

function* childrenOf(
  node: CommonmarkNode,
): Generator<CommonmarkNode> {
  let child = node.firstChild;
  while (child) {
    yield child;
    child = child.next;
  }
}

function kindOf(node: CommonmarkNode): BlockKind | undefined {
  switch (node.type) {
    case "paragraph":
      return "p";
    case "item":
      return "li";
    case "block_quote":
      return "blockquote";
    case "list":
      return node.listType === "ordered" ? "ol" : "ul";
    default:
      return undefined;
  }
}

function findChild(
  node: CommonmarkNode,
  step: BlockStep,
): CommonmarkNode | undefined {
  const counts = new Map<BlockKind, number>();
  for (const child of childrenOf(node)) {
    const kind = kindOf(child);
    if (!kind) continue;
    const occurrence = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, occurrence);
    if (kind === step.kind && occurrence === step.occurrence) return child;
  }
  return undefined;
}

function walkDown(
  node: CommonmarkNode,
  lineStartOffsets: readonly number[],
  start: number,
  end: number,
): readonly BlockStep[] {
  const counts = new Map<BlockKind, number>();
  for (const child of childrenOf(node)) {
    const kind = kindOf(child);
    if (!kind) continue;
    const occurrence = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, occurrence);

    const range = nodeRange(child, lineStartOffsets);
    if (range && range.start <= start && end <= range.end) {
      return [
        { kind, occurrence },
        ...walkDown(child, lineStartOffsets, start, end),
      ];
    }
  }
  return [];
}

function nodeRange(
  node: CommonmarkNode,
  lineStartOffsets: readonly number[],
): { start: number; end: number } | undefined {
  if (!node.sourcepos) return undefined;
  const [[startLine, startColumn], [endLine, endColumn]] = node.sourcepos;
  return {
    start: offsetForPosition(lineStartOffsets, startLine, startColumn),
    end: offsetForPosition(lineStartOffsets, endLine, endColumn) + 1,
  };
}

/**
 * commonmark's sourcepos columns are UTF-16 code-unit offsets into the
 * original line, not codepoint indices; treated as codepoint offsets here to
 * match the rest of the codebase's Array.from-based counting (mrfi-text.ts).
 * Diverges only for astral characters, an accepted edge case.
 */
function offsetForPosition(
  lineStartOffsets: readonly number[],
  line: number,
  column: number,
): number {
  const index = Math.min(line - 1, lineStartOffsets.length - 1);
  return lineStartOffsets[index] + column - 1;
}
