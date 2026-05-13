import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createPalette } from "./palette.ts";
import { catppuccinLatte } from "./theme.ts";

Deno.test("createPalette - identity functions when useColor=false", () => {
  const p = createPalette(false, catppuccinLatte);
  assertEquals(p.statusDone("done"), "done");
  assertEquals(p.statusStarted("started"), "started");
  assertEquals(p.statusReady("ready"), "ready");
  assertEquals(p.statusCreated("created"), "created");
  assertEquals(p.statusCancelled("cancelled"), "cancelled");
  assertEquals(p.id("abc"), "abc");
  assertEquals(p.timestamp("2026-01-01"), "2026-01-01");
  assertEquals(p.tag("#x"), "#x");
  assertEquals(p.header("task:"), "task:");
  assertEquals(p.heading("traces"), "traces");
});

Deno.test("createPalette - wraps with ANSI when useColor=true", () => {
  const p = createPalette(true, catppuccinLatte);
  assertStringIncludes(p.statusDone("done"), "\x1b[");
  assertStringIncludes(p.statusStarted("started"), "\x1b[");
  assertStringIncludes(p.statusReady("ready"), "\x1b[");
  assertStringIncludes(p.statusCreated("created"), "\x1b[");
  assertStringIncludes(p.statusCancelled("cancelled"), "\x1b[");
  assertStringIncludes(p.id("abc"), "\x1b[");
  assertStringIncludes(p.timestamp("2026-01-01"), "\x1b[");
  assertStringIncludes(p.tag("#x"), "\x1b[");
  assertStringIncludes(p.header("task:"), "\x1b[");
  assertStringIncludes(p.heading("traces"), "\x1b[");
});

Deno.test("createPalette - heading combines bold + rgb24", () => {
  const p = createPalette(true, catppuccinLatte);
  const out = p.heading("x");
  // ANSI bold = ESC[1m
  assertStringIncludes(out, "\x1b[1m");
  // rgb24 sequence prefix
  assertStringIncludes(out, "\x1b[38;2;");
});

Deno.test("createPalette - statusDone uses theme.statusDone rgb (#40a02b)", () => {
  const p = createPalette(true, catppuccinLatte);
  const out = p.statusDone("done");
  // 0x40=64, 0xa0=160, 0x2b=43
  assertStringIncludes(out, "\x1b[38;2;64;160;43m");
});

Deno.test("createPalette - preserves original content (strippable to input)", () => {
  const p = createPalette(true, catppuccinLatte);
  // deno-lint-ignore no-control-regex
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  assertEquals(stripAnsi(p.statusDone("done")), "done");
  assertEquals(stripAnsi(p.heading("desc:")), "desc:");
  assert(p.statusDone("done").length > "done".length);
});
