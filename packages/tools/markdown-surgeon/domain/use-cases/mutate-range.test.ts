import { assertEquals } from "@std/assert";
import type { Document } from "../entities/document.ts";
import type { SourceRange } from "../entities/mrfi.ts";
import { MutateRangeUseCase } from "./mutate-range.ts";

const mutateRange = new MutateRangeUseCase();

function makeDoc(lines: readonly string[]): Document {
  return {
    sections: [],
    lines,
    frontmatter: null,
    frontmatterEndLine: 0,
  };
}

function range(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): SourceRange {
  return { startLine, startColumn, endLine, endColumn };
}

Deno.test("write replaces exact line range", () => {
  const doc = makeDoc(["line1", "line2", "line3", "line4"]);
  const result = mutateRange.execute({
    doc,
    range: range(2, 1, 3, 6),
    action: "write",
    content: "replaced",
  });
  assertEquals(result.updatedLines, ["line1", "replaced", "line4"]);
  assertEquals(result.result.action, "updated");
  assertEquals(result.result.linesRemoved, 2);
  assertEquals(result.result.linesAdded, 1);
});

Deno.test("write with multi-line content", () => {
  const doc = makeDoc(["line1", "line2", "line3"]);
  const result = mutateRange.execute({
    doc,
    range: range(2, 1, 2, 6),
    action: "write",
    content: "new1\nnew2\nnew3",
  });
  assertEquals(result.updatedLines, ["line1", "new1", "new2", "new3", "line3"]);
  assertEquals(result.result.linesAdded, 3);
  assertEquals(result.result.linesRemoved, 1);
});

Deno.test("write with empty content clears range", () => {
  const doc = makeDoc(["line1", "line2", "line3"]);
  const result = mutateRange.execute({
    doc,
    range: range(2, 1, 2, 6),
    action: "write",
    content: "",
  });
  assertEquals(result.updatedLines, ["line1", "line3"]);
  assertEquals(result.result.linesAdded, 0);
  assertEquals(result.result.linesRemoved, 1);
});

Deno.test("remove deletes exact line range", () => {
  const doc = makeDoc(["line1", "line2", "line3", "line4"]);
  const result = mutateRange.execute({
    doc,
    range: range(2, 1, 3, 6),
    action: "remove",
  });
  assertEquals(result.updatedLines, ["line1", "line4"]);
  assertEquals(result.result.action, "removed");
  assertEquals(result.result.linesRemoved, 2);
  assertEquals(result.result.linesAdded, 0);
});

Deno.test("append inserts after range", () => {
  const doc = makeDoc(["line1", "line2", "line3"]);
  const result = mutateRange.execute({
    doc,
    range: range(2, 1, 2, 6),
    action: "append",
    content: "appended",
  });
  assertEquals(result.updatedLines, [
    "line1",
    "line2",
    "appended",
    "line3",
  ]);
  assertEquals(result.result.action, "appended");
  assertEquals(result.result.linesAdded, 1);
});

Deno.test("append with before inserts before range", () => {
  const doc = makeDoc(["line1", "line2", "line3"]);
  const result = mutateRange.execute({
    doc,
    range: range(2, 1, 2, 6),
    action: "append",
    content: "inserted",
    before: true,
  });
  assertEquals(result.updatedLines, [
    "line1",
    "inserted",
    "line2",
    "line3",
  ]);
  assertEquals(result.result.action, "appended");
});

Deno.test("remove single line", () => {
  const doc = makeDoc(["aaa", "bbb", "ccc"]);
  const result = mutateRange.execute({
    doc,
    range: range(1, 1, 1, 4),
    action: "remove",
  });
  assertEquals(result.updatedLines, ["bbb", "ccc"]);
});

Deno.test("append at end of document", () => {
  const doc = makeDoc(["only"]);
  const result = mutateRange.execute({
    doc,
    range: range(1, 1, 1, 5),
    action: "append",
    content: "after",
  });
  assertEquals(result.updatedLines, ["only", "after"]);
});
