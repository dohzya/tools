import { assertEquals, assertStringIncludes } from "@std/assert";

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
