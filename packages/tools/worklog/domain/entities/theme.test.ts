import { assertEquals } from "@std/assert";
import { catppuccinLatte } from "./theme.ts";

Deno.test("catppuccinLatte - statusDone hex", () => {
  assertEquals(catppuccinLatte.statusDone, "#40a02b");
});

Deno.test("catppuccinLatte - statusStarted hex", () => {
  assertEquals(catppuccinLatte.statusStarted, "#df8e1d");
});

Deno.test("catppuccinLatte - statusReady hex", () => {
  assertEquals(catppuccinLatte.statusReady, "#179299");
});

Deno.test("catppuccinLatte - statusCreated hex", () => {
  assertEquals(catppuccinLatte.statusCreated, "#1e66f5");
});

Deno.test("catppuccinLatte - statusCancelled hex (overlay1)", () => {
  assertEquals(catppuccinLatte.statusCancelled, "#8c8fa1");
});

Deno.test("catppuccinLatte - id hex (overlay1)", () => {
  assertEquals(catppuccinLatte.id, "#8c8fa1");
});

Deno.test("catppuccinLatte - timestamp hex (subtext0)", () => {
  assertEquals(catppuccinLatte.timestamp, "#6c6f85");
});

Deno.test("catppuccinLatte - tag hex (mauve)", () => {
  assertEquals(catppuccinLatte.tag, "#8839ef");
});

Deno.test("catppuccinLatte - header hex (sapphire)", () => {
  assertEquals(catppuccinLatte.header, "#209fb5");
});

Deno.test("catppuccinLatte - heading hex (blue)", () => {
  assertEquals(catppuccinLatte.heading, "#1e66f5");
});
