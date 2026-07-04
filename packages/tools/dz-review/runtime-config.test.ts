import { assertEquals } from "@std/assert";
import * as path from "node:path";

import {
  configureDzReviewRuntime,
  DEFAULT_DZ_REVIEW_STATE_DIR,
  getDzReviewReferenceMapFile,
  getDzReviewStateDir,
} from "./runtime-config.ts";

Deno.test("dz-review runtime-config - injected environment replaces Deno.env/Deno.cwd", () => {
  try {
    // A non-Deno caller (e.g. the VSCode extension host) has no `Deno` global:
    // it can only reach this module through a plain object implementing
    // `DzReviewEnvironment`. `getEnv` always misses and `getCwd` points at a
    // path that isn't a git worktree, so `findGitRoot()` fails to spawn `git`
    // there and the state dir falls back to the package-relative default —
    // proving the injected `getCwd` (not the real `Deno.cwd()`, which *is*
    // inside this git repo) drove the lookup.
    configureDzReviewRuntime({
      environment: {
        getEnv: () => undefined,
        getCwd: () => "/some/fake/path",
      },
    });

    assertEquals(
      getDzReviewStateDir(),
      path.normalize(DEFAULT_DZ_REVIEW_STATE_DIR),
    );
    assertEquals(
      getDzReviewReferenceMapFile(),
      path.join(DEFAULT_DZ_REVIEW_STATE_DIR, "reference-map.json"),
    );
  } finally {
    configureDzReviewRuntime({});
  }
});

Deno.test("dz-review runtime-config - stateDir override still works without an injected environment", () => {
  try {
    configureDzReviewRuntime({ stateDir: "/explicit/state-dir" });

    assertEquals(getDzReviewStateDir(), path.normalize("/explicit/state-dir"));
    assertEquals(
      getDzReviewReferenceMapFile(),
      path.join("/explicit/state-dir", "reference-map.json"),
    );
  } finally {
    configureDzReviewRuntime({});
  }
});
