import { assertEquals } from "@std/assert";
import { CommonmarkBlockTreeParser } from "./commonmark-block-tree-parser.ts";

const parser = new CommonmarkBlockTreeParser();

Deno.test("stepsForRange: single top-level paragraph", () => {
  const source = "First para.\n\nSecond para.\n";
  const start = source.indexOf("Second");
  const end = start + "Second para.".length;
  assertEquals(parser.stepsForRange(source, start, end), [
    { kind: "p", occurrence: 2 },
  ]);
});

Deno.test("stepsForRange: nested list item paragraph", () => {
  const source = [
    "Intro.",
    "",
    "- item one",
    "- item two",
    "",
    "  second para in item two",
    "",
    "1. ordered",
  ].join("\n");
  const target = "second para in item two";
  const start = source.indexOf(target);
  const end = start + target.length;
  assertEquals(parser.stepsForRange(source, start, end), [
    { kind: "ul", occurrence: 1 },
    { kind: "li", occurrence: 2 },
    { kind: "p", occurrence: 2 },
  ]);
});

Deno.test("stepsForRange: blockquote paragraph", () => {
  const source = "> Quoted line one.\n> Quoted line two.\n";
  const start = source.indexOf("Quoted line two");
  const end = start + "Quoted line two.".length;
  assertEquals(parser.stepsForRange(source, start, end), [
    { kind: "blockquote", occurrence: 1 },
    { kind: "p", occurrence: 1 },
  ]);
});

Deno.test("stepsForRange: range spanning multiple top-level blocks yields no steps", () => {
  const source = "First para.\n\nSecond para.\n";
  assertEquals(parser.stepsForRange(source, 0, source.trimEnd().length), []);
});

Deno.test("rangeForSteps: inverts stepsForRange for a nested paragraph", () => {
  const source = [
    "- item one",
    "- item two",
    "",
    "  second para in item two",
  ].join("\n");
  const target = "second para in item two";
  const start = source.indexOf(target);
  const end = start + target.length;
  const steps = parser.stepsForRange(source, start, end);
  const range = parser.rangeForSteps(source, steps);
  assertEquals(range && source.slice(range.start, range.end), target);
});

Deno.test("rangeForSteps: undefined when the step chain doesn't exist", () => {
  const source = "Just one paragraph.\n";
  assertEquals(
    parser.rangeForSteps(source, [{ kind: "li", occurrence: 1 }]),
    undefined,
  );
});
