import { assertEquals } from "@std/assert";
import * as path from "node:path";
import { resolveReferenceTargetFile } from "./resolve-target-file.ts";

Deno.test("resolveReferenceTargetFile", async (t) => {
  await t.step("absolute path is returned as-is", () => {
    const result = resolveReferenceTargetFile(
      "/projects/notes/review.md",
      "/absolute/path/target.md",
      undefined,
    );
    assertEquals(result, "/absolute/path/target.md");
  });

  await t.step(
    "dotslash path resolves relative to source file directory",
    () => {
      const result = resolveReferenceTargetFile(
        "/projects/notes/review.md",
        "./sibling.md",
        undefined,
      );
      assertEquals(result, path.resolve("/projects/notes", "./sibling.md"));
    },
  );

  await t.step(
    "dotdotslash path resolves relative to source file directory",
    () => {
      const result = resolveReferenceTargetFile(
        "/projects/notes/review.md",
        "../parent.md",
        undefined,
      );
      assertEquals(result, path.resolve("/projects/notes", "../parent.md"));
    },
  );

  await t.step(
    "bare path resolves relative to git root when available",
    () => {
      const result = resolveReferenceTargetFile(
        "/projects/notes/review.md",
        "src/main.ts",
        "/projects",
      );
      assertEquals(result, path.resolve("/projects", "src/main.ts"));
    },
  );

  await t.step(
    "bare path falls back to source file directory when no git root",
    () => {
      const result = resolveReferenceTargetFile(
        "/projects/notes/review.md",
        "sibling.md",
        undefined,
      );
      assertEquals(
        result,
        path.resolve("/projects/notes", "sibling.md"),
      );
    },
  );

  await t.step(
    "dotslash path ignores git root even when available",
    () => {
      const result = resolveReferenceTargetFile(
        "/projects/notes/review.md",
        "./local.md",
        "/projects",
      );
      assertEquals(result, path.resolve("/projects/notes", "./local.md"));
    },
  );

  await t.step(
    "bare path with nested directories resolves from git root",
    () => {
      const result = resolveReferenceTargetFile(
        "/projects/docs/reviews/review.md",
        "packages/tools/mod.ts",
        "/projects",
      );
      assertEquals(
        result,
        path.resolve("/projects", "packages/tools/mod.ts"),
      );
    },
  );
});
