/**
 * Unit tests for reference-map.ts.
 *
 * This is the safety net for the later call-site migration away from
 * stable-review-id.ts's pure recompute-from-content scheme, so scenarios
 * here are deliberately thorough: fast-path range matching, fallback MRFI
 * resolution after a line shift, fresh-id minting, no-collision within a
 * batch, and cross-run persistence of the mapping file.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "node:path";
import {
  assignPersistentReviewItemIds,
  readReferenceMap,
  type ReferenceMap,
} from "./reference-map.ts";
import type {
  ReferenceLocatorService,
  RefreshReferenceOutput,
  ResolveResult,
} from "./domain/ports/reference-locator.ts";

Deno.test("assignPersistentReviewItemIds - genuinely new item mints a fresh id and stores a mapping entry", async () => {
  const dir = await Deno.makeTempDir();
  const content = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
  ].join("\n");

  try {
    await withCwd(dir, async () => {
      const [result] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [{ kind: "comment", raw: "note about this", lineStart: 7, lineEnd: 7 }],
      );

      assertEquals(result.id.startsWith("rvw_"), true);

      const map = readReferenceMap();
      const entry = map.entries[result.id];
      assertEquals(entry.file, "file.md");
      assertEquals(entry.range, { startLine: 7, endLine: 7 });
      assertEquals(entry.mrfi.length > 0, true);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assignPersistentReviewItemIds - two new items in the same call get distinct ids", async () => {
  const dir = await Deno.makeTempDir();
  const content = [
    "# Section A",
    "",
    "First passage marker.",
    "",
    "# Section B",
    "",
    "Second passage marker.",
  ].join("\n");

  try {
    await withCwd(dir, async () => {
      const results = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [
          { kind: "comment", raw: "first note", lineStart: 3, lineEnd: 3 },
          { kind: "comment", raw: "second note", lineStart: 7, lineEnd: 7 },
        ],
      );

      assertEquals(results.length, 2);
      assertNotEquals(results[0].id, results[1].id);

      const map = readReferenceMap();
      assertEquals(Object.keys(map.entries).length, 2);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assignPersistentReviewItemIds - unchanged file/items/lines on a second call hits the fast path with zero port calls", async () => {
  const dir = await Deno.makeTempDir();
  const content = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
  ].join("\n");
  const items = [
    { kind: "comment", raw: "note about this", lineStart: 7, lineEnd: 7 },
  ];

  try {
    await withCwd(dir, async () => {
      const [first] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        items,
      );

      // A locator that throws on any call: if the second run's fast path
      // were to fall through to resolution/generation, this test would
      // fail loudly instead of silently passing on the wrong code path.
      const [second] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        items,
        { locator: new ThrowingLocator() },
      );

      assertEquals(second.id, first.id);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assignPersistentReviewItemIds - raw text changed but same line range still gets the same id via the fast path", async () => {
  const dir = await Deno.makeTempDir();
  const content = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
  ].join("\n");

  try {
    await withCwd(dir, async () => {
      const [first] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [{ kind: "comment", raw: "note about this", lineStart: 7, lineEnd: 7 }],
      );

      // Same line range, different raw text (e.g. a typo fix on the
      // annotation itself) -- must still resolve via the fast path
      // without needing any MRFI resolution.
      const [second] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [{
          kind: "comment",
          raw: "note about this (typo fixed)",
          lineStart: 7,
          lineEnd: 7,
        }],
        { locator: new ThrowingLocator() },
      );

      assertEquals(second.id, first.id);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assignPersistentReviewItemIds - line range shifted but content unchanged adopts the same id via fallback resolution", async () => {
  const dir = await Deno.makeTempDir();
  const originalContent = [
    "# Section A",
    "",
    "Some content here.",
    "",
    "# Section B",
    "",
    "Target passage text unique marker.",
    "",
    "# Section C",
    "",
    "Trailing content.",
  ].join("\n");

  try {
    await withCwd(dir, async () => {
      const [first] = await assignPersistentReviewItemIds(
        "file.md",
        originalContent,
        [{
          kind: "comment",
          raw: "note about this",
          lineStart: 7,
          lineEnd: 7,
        }],
      );

      // Same passage, shifted down by 4 lines by inserting content above it.
      const movedContent = [
        "# Intro",
        "",
        "Extra text that was not here before.",
        "",
        originalContent,
      ].join("\n");

      const [second] = await assignPersistentReviewItemIds(
        "file.md",
        movedContent,
        [{
          kind: "comment",
          raw: "note about this",
          lineStart: 11,
          lineEnd: 11,
        }],
      );

      assertEquals(second.id, first.id);

      const map = readReferenceMap();
      const entry = map.entries[first.id];
      assertEquals(entry.range, { startLine: 11, endLine: 11 });
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assignPersistentReviewItemIds - the mapping file persists correctly across two separate calls", async () => {
  const dir = await Deno.makeTempDir();
  const content = [
    "# Section A",
    "",
    "First passage marker.",
    "",
    "# Section B",
    "",
    "Second passage marker.",
  ].join("\n");

  try {
    await withCwd(dir, async () => {
      const [firstRun] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [{ kind: "comment", raw: "first note", lineStart: 3, lineEnd: 3 }],
      );

      const onDiskAfterFirstRun: ReferenceMap = JSON.parse(
        await Deno.readTextFile(
          join(dir, ".dz-review", "reference-map.json"),
        ),
      );
      assertEquals(Object.keys(onDiskAfterFirstRun.entries).length, 1);

      const [secondRunSame, secondRunNew] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [
          { kind: "comment", raw: "first note", lineStart: 3, lineEnd: 3 },
          { kind: "comment", raw: "second note", lineStart: 7, lineEnd: 7 },
        ],
      );

      assertEquals(secondRunSame.id, firstRun.id);
      assertNotEquals(secondRunNew.id, firstRun.id);

      const onDiskAfterSecondRun: ReferenceMap = JSON.parse(
        await Deno.readTextFile(
          join(dir, ".dz-review", "reference-map.json"),
        ),
      );
      assertEquals(Object.keys(onDiskAfterSecondRun.entries).length, 2);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assignPersistentReviewItemIds - empty mapping file bootstraps cleanly", async () => {
  const dir = await Deno.makeTempDir();

  try {
    await withCwd(dir, () => {
      const map = readReferenceMap();
      assertEquals(map.entries, {});
      assertEquals(typeof map.version, "number");
      return Promise.resolve();
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("getShortStableReviewItemId disambiguates across mapped ids, not just freshly-assigned ones", async () => {
  const dir = await Deno.makeTempDir();
  const content = [
    "# Section A",
    "",
    "First passage marker.",
    "",
    "# Section B",
    "",
    "Second passage marker.",
  ].join("\n");

  try {
    await withCwd(dir, async () => {
      const { getShortStableReviewItemId } = await import(
        "./stable-review-id.ts"
      );

      const [existing] = await assignPersistentReviewItemIds(
        "file.md",
        content,
        [{ kind: "comment", raw: "first note", lineStart: 3, lineEnd: 3 }],
      );

      const map = readReferenceMap();
      const allIds = Object.keys(map.entries);
      // A short id must stay unambiguous against every id already on disk,
      // not just ids minted in the same call -- otherwise two different
      // annotations could display the same short id across separate runs.
      const shortId = getShortStableReviewItemId(existing.id, allIds);
      assertEquals(existing.id.startsWith(`rvw_${shortId.slice(0, 4)}`), true);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

class ThrowingLocator implements ReferenceLocatorService {
  generateReference(): Promise<string> {
    throw new Error("generateReference should not be called on the fast path");
  }
  resolveReference(): Promise<ResolveResult> {
    throw new Error("resolveReference should not be called on the fast path");
  }
  refreshReference(): Promise<RefreshReferenceOutput> {
    throw new Error("refreshReference should not be called on the fast path");
  }
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = Deno.cwd();
  Deno.chdir(cwd);
  try {
    return await fn();
  } finally {
    Deno.chdir(previous);
  }
}
