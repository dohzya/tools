import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";

import {
  addAgentSessionFiles,
  listReviewItemsJson,
  respondToAgentReviewItem,
  rollbackAgentSession,
  startAgentSession,
} from "./agent-core.ts";
import {
  applyConversationAction,
  applyReviewAnnotationAction,
  collectConversations,
  collectReviewAnnotations,
  getAddedLinesByFile,
  getConversationLastMessage,
  getConversationStatus,
  isClosedConversation,
} from "./review-core.ts";
import {
  collectReferenceIds,
  collectReviewReferences,
  formatReferenceTarget,
  parseReferenceLineRange,
  validateReferenceSnapshots,
} from "./ref-core.ts";
import {
  decodeCompactTimestamp,
  decodeHangulTimestamp,
  encodeCompactTimestamp,
  encodeHangulTimestamp,
  formatTimestampForDisplay,
  parseReviewTimestamp,
} from "./timestamp.ts";
import {
  assignStableReviewItemIds,
  getShortStableReviewItemId,
  resolveStableReviewItemId,
  stableReviewItemFingerprint,
} from "./stable-review-id.ts";

Deno.test("dz-review core - collects HTML and compact review conversations", () => {
  const text = [
    "Intro",
    "<!--",
    "@agent HTML note",
    "-->",
    "Body {?? @me compact note ??} end",
  ].join("\n");

  const conversations = collectConversations(text);

  assertEquals(
    conversations.map(({ lineStart, lineEnd, roles }) => ({
      lineStart,
      lineEnd,
      roles,
    })),
    [
      { lineStart: 2, lineEnd: 4, roles: ["agent"] },
      { lineStart: 5, lineEnd: 5, roles: ["me"] },
    ],
  );
});

Deno.test("dz-review core - applies conversation actions", () => {
  const source = "{?? @agent note ??}";
  const conversation = collectConversations(source)[0];

  const withOk = applyConversationAction(source, conversation, {
    kind: "toggle-ok",
  });
  assertEquals(withOk, "{?? @agent note @me ok ??}");

  const withoutOk = applyConversationAction(
    withOk,
    collectConversations(withOk)[0],
    { kind: "toggle-ok" },
  );
  assertEquals(withoutOk, "{?? @agent note ??}");

  const withReply = applyConversationAction(source, conversation, {
    kind: "reply",
    body: "Vu, je garde.",
  });
  assertEquals(withReply, "{?? @agent note @me Vu, je garde. ??}");

  assertEquals(
    applyConversationAction(source, conversation, { kind: "delete" }),
    "",
  );
});

Deno.test("dz-review core - classifies conversation status", () => {
  const statusOf = (text: string) =>
    getConversationStatus(collectConversations(text)[0]);

  assertEquals(statusOf("<!-- @agent note -->"), "open");
  assertEquals(statusOf("<!-- @agent note @me -->"), "wip");
  assertEquals(statusOf("<!-- @agent note @ -->"), "wip");
  assertEquals(statusOf("<!-- @agent note @me answer -->"), "handled");
  assertEquals(statusOf("<!-- @agent note @ answer -->"), "handled");
  assertEquals(statusOf("<!-- @agent note @me ok -->"), "resolved");
  assertEquals(statusOf("<!-- @agent note @ ok -->"), "resolved");
  assertEquals(
    isClosedConversation(
      collectConversations("<!-- @agent note @agent ok -->")[0],
    ),
    false,
  );
});

Deno.test("dz-review core - parses timestamps on conversation messages", () => {
  const conversation = collectConversations(
    "<!-- @agent%1WzvP91W note @me%2026-06-16T17:35:35+02:00 ok -->",
  )[0];

  assertEquals(getConversationStatus(conversation), "resolved");
  assertEquals(getConversationLastMessage(conversation), {
    body: "ok",
    marker: "@me",
    timestamp: "2026-06-16T17:35:35+02:00",
  });
});

Deno.test("dz-review core - encodes and decodes compact timestamps", () => {
  const instant = new Date("2026-06-16T17:35:35+02:00");

  assertEquals(encodeCompactTimestamp(instant, 120), "1WzvP91W");
  assertEquals(decodeCompactTimestamp("1WzvP91W"), {
    offsetMinutes: 120,
    unixSeconds: 1781624135n,
  });
  assertEquals(
    formatTimestampForDisplay(parseReviewTimestamp("1WzvP91W")),
    "2026-06-16T17:35:35+02:00",
  );
  assertEquals(
    formatTimestampForDisplay(parseReviewTimestamp("%1WzvP91W")),
    "2026-06-16T17:35:35+02:00",
  );
});

Deno.test("dz-review core - encodes and decodes hangul timestamps", () => {
  const instant = new Date("2026-06-16T17:35:35+02:00");
  const timestamp = encodeHangulTimestamp(instant, 120);

  assertEquals(/^[\uac00-\ub3ff]{4}$/.test(timestamp), true);
  assertEquals(decodeHangulTimestamp(timestamp), {
    offsetMinutes: 120,
    unixSeconds: 1781624135n,
  });
  assertEquals(
    formatTimestampForDisplay(parseReviewTimestamp(timestamp)),
    "2026-06-16T17:35:35+02:00",
  );
  assertEquals(
    formatTimestampForDisplay(parseReviewTimestamp(`%${timestamp}`)),
    "2026-06-16T17:35:35+02:00",
  );
});

Deno.test("dz-review core - collects review annotations and applies actions", () => {
  const source = [
    "Add {++%1WzvP91W|new++}",
    "Remove {--%2026-06-16T17:35:35+0200|old--}",
    "Discuss <!-- @agent note -->",
  ].join("\n");

  const annotations = collectReviewAnnotations(source);

  assertEquals(
    annotations.map(({ kind, lineStart, lineEnd }) => ({
      kind,
      lineStart,
      lineEnd,
    })),
    [
      { kind: "addition", lineStart: 1, lineEnd: 1 },
      { kind: "deletion", lineStart: 2, lineEnd: 2 },
      { kind: "conversation", lineStart: 3, lineEnd: 3 },
    ],
  );

  assertEquals(
    applyReviewAnnotationAction(source, annotations[0], { kind: "apply" }),
    [
      "Add new",
      "Remove {--%2026-06-16T17:35:35+0200|old--}",
      "Discuss <!-- @agent note -->",
    ].join("\n"),
  );
});

Deno.test("dz-review core - parses added worktree diff lines by file", () => {
  const diff = [
    "diff --git a/file.md b/file.md",
    "index 1111111..2222222 100644",
    "--- a/file.md",
    "+++ b/file.md",
    "@@ -1,0 +2,2 @@",
    "+<!--",
    "+@agent new",
    "@@ -8 +10,0 @@",
    "-old",
  ].join("\n");

  assertEquals(
    getAddedLinesByFile(diff),
    new Map([
      ["file.md", new Set([2, 3])],
    ]),
  );
});

Deno.test("dz-review core - renders timestamped annotations for display", () => {
  const annotation = collectReviewAnnotations("{++%1WzvP91W|new++}")[0];

  assertStringIncludes(annotation.raw, "%1WzvP91W|");
  assertEquals(annotation.timestamp, "1WzvP91W");
});

Deno.test("dz-review core - stable review ids use the first timestamp as anchor", () => {
  const before = collectReviewAnnotations(
    "Intro\n<!-- @agent%1WzvP91W Question? -->\n",
  );
  const after = collectReviewAnnotations(
    "Intro\nInserted\n<!-- @agent%1WzvP91W Question edited a bit? -->\n",
  );

  const [started] = assignStableReviewItemIds("file.md", before);
  const [current] = assignStableReviewItemIds("file.md", after);

  assertEquals(started.id, current.id);
  assertEquals(
    resolveStableReviewItemId(started.id, "file.md", after)?.raw,
    after[0].raw,
  );
});

Deno.test("dz-review core - stable review fingerprints still ignore timestamps", () => {
  const before = collectReviewAnnotations(
    "Intro\n<!-- @agent%1WzvP91W Question? -->\n",
  );
  const after = collectReviewAnnotations(
    "Intro\nInserted\n<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->\n",
  );

  const [started] = assignStableReviewItemIds("file.md", before);
  const [current] = assignStableReviewItemIds("file.md", after);

  assertEquals(started.id, current.id);
  assertEquals(
    stableReviewItemFingerprint(started.item),
    stableReviewItemFingerprint(current.item),
  );
});

Deno.test("dz-review core - short stable review ids drop namespace and keep safety margin", () => {
  const ids = [
    "rvw_abcdef123456",
    "rvw_abcdeg123456",
    "rvw_999999123456",
  ];

  assertEquals(getShortStableReviewItemId(ids[0], ids), "abcdef1");
  assertEquals(getShortStableReviewItemId(ids[2], ids), "999999");
});

Deno.test("dz-review ref core - parses canonical and tolerated line ranges", () => {
  assertEquals(parseReferenceLineRange("82"), { start: 82, end: 82 });
  assertEquals(parseReferenceLineRange("82-82"), { start: 82, end: 82 });
  assertEquals(parseReferenceLineRange("80-82"), { start: 80, end: 82 });
  assertEquals(parseReferenceLineRange("L82"), { start: 82, end: 82 });
  assertEquals(parseReferenceLineRange("L80-L82"), { start: 80, end: 82 });
  assertEquals(parseReferenceLineRange("L80-82"), { start: 80, end: 82 });
  assertEquals(parseReferenceLineRange("80-L82"), undefined);
});

Deno.test("dz-review ref core - collects refs with timestamp, ids, and labelled snapshots", () => {
  const text = [
    "# Doc",
    "<!-- ref%궩거깇걸:",
    "  02_trame_commentee.md:82~GdwjSq {&&rFZEOtB",
    "  SAS : permet d'envoyer/récupérer des fichiers depuis le cloud.",
    "  rFZEOtB&&};",
    "  ../source2.md:L80-L82^stable-id",
    "-->",
  ].join("\n");

  const references = collectReviewReferences(text);

  assertEquals(references.length, 1);
  assertEquals(references[0].timestamp, "궩거깇걸");
  assertEquals(
    references[0].targets.map((target) => ({
      path: target.path,
      lineRange: target.lineRange,
      mrfi: target.mrfi,
      reviewId: target.reviewId,
      stableId: target.stableId,
      snapshot: target.snapshot
        ? { label: target.snapshot.label, content: target.snapshot.content }
        : undefined,
    })),
    [
      {
        path: "02_trame_commentee.md",
        lineRange: { start: 82, end: 82 },
        mrfi: "~GdwjSq",
        reviewId: undefined,
        stableId: undefined,
        snapshot: {
          label: "rFZEOtB",
          content:
            "SAS : permet d'envoyer/récupérer des fichiers depuis le cloud.",
        },
      },
      {
        path: "../source2.md",
        lineRange: { start: 80, end: 82 },
        mrfi: undefined,
        reviewId: undefined,
        stableId: "stable-id",
        snapshot: undefined,
      },
    ],
  );
  assertEquals(formatReferenceTarget(references[0].targets[1]), {
    canonical: "../source2.md:80-82^stable-id",
    location: "../source2.md:80-82",
  });
});

Deno.test("dz-review ref core - collects MRFI targets while keeping witness out of persisted refs", () => {
  const text = [
    "<!-- ref: source.md:12~{v0;r=12:1-12:18;fh=sha256:FragHash}::previous passage; source.md:13~갊뉘궤 -->",
  ].join("\n");

  const references = collectReviewReferences(text);

  assertEquals(references.length, 1);
  assertEquals(references[0].targets[0].path, "source.md");
  assertEquals(references[0].targets[0].lineRange, { start: 12, end: 12 });
  assertEquals(
    references[0].targets[0].mrfi,
    "~{v0;r=12:1-12:18;fh=sha256:FragHash}",
  );
  assertEquals(references[0].targets[0].witness, undefined);
  assertEquals(references[0].targets[0].reviewId, undefined);
  assertEquals(references[0].targets[1].path, "source.md");
  assertEquals(references[0].targets[1].lineRange, { start: 13, end: 13 });
  assertEquals(references[0].targets[1].mrfi, "~갊뉘궤");
});

Deno.test("dz-review ref core - parses paths containing colon digits before the line hint", () => {
  const text = "<!-- ref: notes/log:2026.md:12~abc -->";

  const references = collectReviewReferences(text);

  assertEquals(references.length, 1);
  assertEquals(references[0].targets[0].path, "notes/log:2026.md");
  assertEquals(references[0].targets[0].lineRange, { start: 12, end: 12 });
  assertEquals(references[0].targets[0].mrfi, "~abc");
});

Deno.test("dz-review ref core - collects inline refs inside conversations", () => {
  const text =
    "<!-- @me%궩거깇걸 Pourquoi ? @agent%궩거깇걸 ref: 02_trame_commentee.md:82~GdwjSq @ Je vois. -->";

  const references = collectReviewReferences(text);

  assertEquals(references.length, 1);
  assertEquals(references[0].targets.length, 1);
  assertEquals(references[0].targets[0].path, "02_trame_commentee.md");
  assertEquals(references[0].targets[0].lineRange, { start: 82, end: 82 });
  assertEquals(references[0].targets[0].mrfi, "~GdwjSq");
  assertEquals(references[0].targets[0].reviewId, undefined);
});

Deno.test("dz-review ref core - detects duplicate nested snapshot labels", () => {
  const text = [
    "<!-- ref: source.md:1 {&&rSame",
    "outer",
    "{&&rSame",
    "inner",
    "rSame&&}",
    "rSame&&} -->",
  ].join("\n");
  const [reference] = collectReviewReferences(text);

  assertEquals(
    validateReferenceSnapshots(reference).map((issue) => issue.kind),
    [
      "duplicate-nested-label",
    ],
  );
});

Deno.test("dz-review ref core - collects stable ref ids", () => {
  const text = ["# Source", "<!-- ^sas-ines -->", "SAS INES details."].join(
    "\n",
  );

  assertEquals(collectReferenceIds(text), [
    { id: "sas-ines", line: 2, start: 9, end: 27 },
  ]);
});

Deno.test("dz-review agent core - lists items without an agent session", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "{++%2026-06-16T17:35:35+02:00|new++}\n<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->\n",
  );

  try {
    await withCwd(dir, () => {
      const listing = listReviewItemsJson(
        ["file.md"],
        undefined,
        false,
        "all",
        undefined,
      );

      assertEquals(listing.version, 1);
      assertEquals(listing.items.length, 2);
      assertEquals(listing.items[0].file, "file.md");
      assertEquals(listing.items[1].state, "open");
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent core - ignores internal .dz-review files by default", async () => {
  const dir = await Deno.makeTempDir();
  const reviewDir = join(dir, ".dz-review");
  const file = join(reviewDir, "internal.md");
  await Deno.mkdir(reviewDir);
  await Deno.writeTextFile(file, "<!-- @agent internal -->\n");

  try {
    await withCwd(dir, () => {
      const snapshot = startAgentSession([".dz-review/internal.md"], false);

      assertEquals(snapshot.files, []);
      assertEquals(snapshot.items, []);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent core - explicit start files bypass project ignore", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "ignored.md");
  await Deno.writeTextFile(join(dir, ".dz-review-ignore"), "*.md\n");
  await Deno.writeTextFile(file, "<!-- @agent explicit -->\n");

  try {
    await withCwd(dir, () => {
      const snapshot = startAgentSession(["ignored.md"], false, {
        dryRun: true,
      });

      assertEquals(snapshot.files[0].path, "ignored.md");
      assertEquals(snapshot.items.length, 1);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent core - dry-run start does not write or normalize", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const sessionFile = join(dir, ".dz-review", "agent-session.json");
  const original = "<!-- @agent%1WzvP91W Question? -->\n";
  await Deno.writeTextFile(file, original);

  try {
    await withCwd(dir, () => {
      const snapshot = startAgentSession(["file.md"], false, {
        dryRun: true,
      });
      let sessionExists = true;
      try {
        Deno.statSync(sessionFile);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
        sessionExists = false;
      }

      assertEquals(snapshot.files[0].path, "file.md");
      assertEquals(snapshot.files[0].timestampFormat, "compact");
      assertEquals(snapshot.items.length, 1);
      assertEquals(Deno.readTextFileSync(file), original);
      assertEquals(sessionExists, false);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent core - add-file extends an active session", async () => {
  const dir = await Deno.makeTempDir();
  const first = join(dir, "first.md");
  const second = join(dir, "second.md");
  await Deno.writeTextFile(join(dir, ".dz-review-ignore"), "second.md\n");
  await Deno.writeTextFile(first, "<!-- @agent first -->\n");
  await Deno.writeTextFile(second, "<!-- @agent%1WzvP91W second -->\n");

  try {
    await withCwd(dir, () => {
      startAgentSession(["first.md"], false);
      const snapshot = addAgentSessionFiles(["second.md"]);

      assertEquals(snapshot.files.map((file) => file.path), [
        "first.md",
        "second.md",
      ]);
      assertEquals(snapshot.files[1].timestampFormat, "compact");
      assertEquals(snapshot.items.length, 2);
      assertStringIncludes(
        Deno.readTextFileSync(second),
        "2026-06-16T17:35:35+02:00",
      );
      assertStringIncludes(
        Deno.readTextFileSync(join(dir, ".dz-review", "agent-session.json")),
        '"second.md"',
      );
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent core - appends agent replies by stable id", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  await Deno.writeTextFile(
    file,
    "<!-- @agent%2026-06-16T17:35:35+02:00 Question? -->\n",
  );

  try {
    await withCwd(dir, () => {
      const snapshot = startAgentSession(["file.md"], false);
      const id = snapshot.items[0].id;
      const result = respondToAgentReviewItem(id, [], "Done.");

      assertEquals(result.action, "responded");
    });

    const updated = await Deno.readTextFile(file);
    assertStringIncludes(updated, "@agent%");
    assertStringIncludes(updated, "Done.");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dz-review agent core - rollback restores pre-start content", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "file.md");
  const original = "<!-- @agent%1WzvP91W Question? -->\n";
  await Deno.writeTextFile(file, original);

  try {
    await withCwd(dir, () => {
      const snapshot = startAgentSession(["file.md"], false);
      const id = snapshot.items[0].id;
      respondToAgentReviewItem(id, [], "Done.");
      const result = rollbackAgentSession([]);

      assertEquals(result.rolledBackFiles, ["file.md"]);
      assertEquals(result.sessionClosed, true);
    });

    assertEquals(await Deno.readTextFile(file), original);
    assertEquals(
      await exists(join(dir, ".dz-review", "agent-session.json")),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function withCwd<T>(
  cwd: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous = Deno.cwd();
  Deno.chdir(cwd);
  try {
    return await fn();
  } finally {
    Deno.chdir(previous);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await Deno.stat(file);
    return true;
  } catch {
    return false;
  }
}
