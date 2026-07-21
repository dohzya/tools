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
  private readonly parser = new Parser();

  stepsForRange(
    source: string,
    start: number,
    end: number,
  ): readonly BlockStep[] {
    const root: CommonmarkNode = this.parser.parse(source);
    const lines = source.split("\n");
    return walkDown(root, lines, start, end);
  }

  rangeForSteps(
    source: string,
    steps: readonly BlockStep[],
  ): { start: number; end: number } | undefined {
    if (steps.length === 0) return undefined;

    const root: CommonmarkNode = this.parser.parse(source);
    const lines = source.split("\n");
    let current = root;
    for (const step of steps) {
      const found = findChild(current, step);
      if (!found) return undefined;
      current = found;
    }
    return nodeRange(current, lines);
  }
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
  lines: readonly string[],
  start: number,
  end: number,
): readonly BlockStep[] {
  const counts = new Map<BlockKind, number>();
  for (const child of childrenOf(node)) {
    const kind = kindOf(child);
    if (!kind) continue;
    const occurrence = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, occurrence);

    const range = nodeRange(child, lines);
    if (range && range.start <= start && end <= range.end) {
      return [{ kind, occurrence }, ...walkDown(child, lines, start, end)];
    }
  }
  return [];
}

function nodeRange(
  node: CommonmarkNode,
  lines: readonly string[],
): { start: number; end: number } | undefined {
  if (!node.sourcepos) return undefined;
  const [[startLine, startColumn], [endLine, endColumn]] = node.sourcepos;
  return {
    start: offsetForPosition(lines, startLine, startColumn),
    end: offsetForPosition(lines, endLine, endColumn) + 1,
  };
}

/**
 * commonmark's sourcepos columns are UTF-16 code-unit offsets into the
 * original line, not codepoint indices; treated as codepoint offsets here to
 * match the rest of the codebase's Array.from-based counting (mrfi-text.ts).
 * Diverges only for astral characters, an accepted edge case.
 */
function offsetForPosition(
  lines: readonly string[],
  line: number,
  column: number,
): number {
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) {
    offset += Array.from(lines[index] ?? "").length + 1;
  }
  return offset + column - 1;
}
