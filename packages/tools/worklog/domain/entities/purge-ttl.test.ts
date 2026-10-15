import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_PURGE_TTL_DAYS,
  parsePurgeTtlDays,
  resolvePurgeTtlDays,
} from "./purge-ttl.ts";

Deno.test("resolvePurgeTtlDays - defaults to 30 days", () => {
  assertEquals(DEFAULT_PURGE_TTL_DAYS, 30);
  assertEquals(resolvePurgeTtlDays({}), 30);
});

Deno.test("resolvePurgeTtlDays - precedence is cli > env > local > global", () => {
  const all = { cli: 1, env: 2, local: 3, global: 4 };
  assertEquals(resolvePurgeTtlDays(all), 1);
  assertEquals(resolvePurgeTtlDays({ ...all, cli: undefined }), 2);
  assertEquals(
    resolvePurgeTtlDays({ ...all, cli: undefined, env: undefined }),
    3,
  );
  assertEquals(resolvePurgeTtlDays({ global: 4 }), 4);
});

Deno.test("parsePurgeTtlDays - accepts positive integers", () => {
  assertEquals(parsePurgeTtlDays(180, "test"), 180);
  assertEquals(parsePurgeTtlDays("180", "test"), 180);
});

Deno.test("parsePurgeTtlDays - rejects invalid values, naming the source", () => {
  for (const bad of [0, -1, 1.5, "abc", "", NaN]) {
    assertThrows(
      () => parsePurgeTtlDays(bad, "WORKLOG_PURGE_TTL_DAYS"),
      Error,
      "WORKLOG_PURGE_TTL_DAYS",
    );
  }
});
