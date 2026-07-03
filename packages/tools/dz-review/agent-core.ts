import { z } from "@zod/zod/mini";
import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  applyReviewAnnotationAction,
  collectReviewItems,
  type ConversationFilter,
  getAddedLinesByFile,
  getConversationLastMessage,
  getConversationMessages,
  getConversationStatus,
  type ReviewAnnotation,
  type ReviewItem,
  reviewItemMatchesConversationFilter,
  reviewItemOverlapsLines,
  summarizeConversation,
  summarizeReviewAnnotation,
} from "./review-core.ts";
import { assignPersistentReviewItemIds } from "./reference-map.ts";
import {
  getShortStableReviewItemId,
  STABLE_REVIEW_ID_PREFIX,
  stableReviewItemFingerprint,
} from "./stable-review-id.ts";
import {
  collectReviewTimestampFormatStats,
  encodeTimestamp,
  parseReviewTimestamp,
  type ReviewTimestamp,
  type TimestampFormat,
  type TimestampFormatStats,
  transformReviewTimestamps,
} from "./timestamp.ts";
import {
  DEFAULT_DZ_REVIEW_STATE_DIR,
  getDzReviewDefaultIgnorePatterns,
  getDzReviewIgnoreFile,
  getDzReviewSessionFile,
} from "./runtime-config.ts";

export const AGENT_SESSION_FILE: string = path.join(
  DEFAULT_DZ_REVIEW_STATE_DIR,
  "agent-session.json",
);

export type AgentTimestampFormat = TimestampFormat | "mixed" | "none";

export interface AgentReviewItem {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  kind: string;
  state: string;
  firstMessage?: AgentReviewMessage;
  lastMessage?: AgentReviewMessage;
  context: string;
  suggestedAction: string;
  rawHash: string;
}

export interface AgentReviewMessage {
  author: "@" | "@me" | "@agent";
  body: string;
  timestamp?: string;
}

export interface AgentFileSnapshot {
  path: string;
  timestampFormat: AgentTimestampFormat;
  contentHash: string;
  itemIds: string[];
  originalContent?: string;
}

export interface AgentSessionSnapshot {
  version: number;
  startedAt: string;
  cwd: string;
  files: AgentFileSnapshot[];
  items: AgentReviewItem[];
}

export interface AgentReviewState {
  files: AgentFileSnapshot[];
  items: AgentReviewItem[];
  texts: Map<string, string>;
}

export interface AgentGuardrailFailure {
  id: string;
  file: string;
  line: number;
  message: string;
}

export interface AgentHandoff {
  version: number;
  filesAnnotated: number;
  filesModified: number;
  conversationsAnswered: number;
  cleanableConversations: AgentReviewItem[];
  remainingOpenItems: AgentReviewItem[];
  guardrailFailures: AgentGuardrailFailure[];
}

export interface AgentSessionStatus extends AgentHandoff {
  items: AgentReviewItem[];
}

export interface StartAgentSessionOptions {
  dryRun?: boolean;
}

export interface AgentActionResult {
  id: string;
  file: string;
  line: number;
  action: string;
  message: string;
}

export interface AgentCleanResult {
  version: number;
  dryRun: boolean;
  cleaned: number;
  cleanable: AgentReviewItem[];
}

export interface AgentRollbackResult {
  version: number;
  rolledBackFiles: string[];
  sessionClosed: boolean;
}

export interface LocatedReviewItem {
  file: string;
  id: string;
  item: ReviewItem;
  text: string;
}

export interface ReviewItemListing {
  version: number;
  items: AgentReviewItem[];
}

interface IgnoreRule {
  ignored: boolean;
  pattern: string;
  directoryOnly: boolean;
  regex: RegExp;
}

const DOMINANT_TIMESTAMP_FORMAT_RATIO = 0.9;

const AgentLastMessageSchema = z.object({
  author: z.enum(["@", "@me", "@agent"]),
  body: z.string(),
  timestamp: z.optional(z.string()),
});
const AgentReviewItemSchema = z.object({
  id: z.string(),
  file: z.string(),
  lineStart: z.number(),
  lineEnd: z.number(),
  kind: z.string(),
  state: z.string(),
  firstMessage: z.optional(AgentLastMessageSchema),
  lastMessage: z.optional(AgentLastMessageSchema),
  context: z.string(),
  suggestedAction: z.string(),
  rawHash: z.string(),
});
const AgentFileSnapshotSchema = z.object({
  path: z.string(),
  timestampFormat: z.enum(["compact", "hangul", "iso", "mixed", "none"]),
  contentHash: z.string(),
  itemIds: z.array(z.string()),
  originalContent: z.optional(z.string()),
});
const AgentSessionSnapshotSchema = z.object({
  version: z.number(),
  startedAt: z.string(),
  cwd: z.string(),
  files: z.array(AgentFileSnapshotSchema),
  items: z.array(AgentReviewItemSchema),
});

export async function startAgentSession(
  files: string[],
  force: boolean,
  options: StartAgentSessionOptions = {},
): Promise<AgentSessionSnapshot> {
  const sessionFile = getDzReviewSessionFile();
  if (!options.dryRun && !force && fs.existsSync(sessionFile)) {
    throw new Error(
      [
        `agent session already exists at ${sessionFile}.`,
        "Use dz-review agent status [file...] to inspect progress, dz-review session done [file...] to finish, or dz-review session start --force [file...] to replace the snapshot.",
      ].join("\n"),
    );
  }

  const resolvedFiles = resolveAgentFiles(files);
  const originalState = await collectAgentReviewState(resolvedFiles, false);
  const timestampFormats = new Map(
    originalState.files.map((file) => [file.path, file.timestampFormat]),
  );
  const originalContents = new Map(originalState.texts);

  if (options.dryRun) {
    return buildAgentSessionSnapshot(
      originalState,
      timestampFormats,
      originalContents,
    );
  }

  for (const file of originalState.files) {
    const text = originalState.texts.get(file.path);
    if (text === undefined) {
      continue;
    }

    const { updated } = transformReviewTimestamps(
      text,
      fs.statSync(file.path).mtime,
      "iso",
    );
    if (updated !== text) {
      fs.writeFileSync(file.path, updated, "utf8");
    }
  }

  const state = await collectAgentReviewState(
    originalState.files.map((file) => file.path),
    false,
  );
  const snapshot = buildAgentSessionSnapshot(
    state,
    timestampFormats,
    originalContents,
  );

  writeAgentSnapshot(snapshot);
  return snapshot;
}

export async function addAgentSessionFiles(
  files: string[],
): Promise<AgentSessionSnapshot> {
  if (files.length === 0) {
    throw new Error("session add-file requires at least one file.");
  }

  const snapshot = readAgentSnapshot();
  const resolvedFiles = resolveAgentFiles(files);
  const originalState = await collectAgentReviewState(resolvedFiles, false);
  const timestampFormats = new Map(
    originalState.files.map((file) => [file.path, file.timestampFormat]),
  );
  const originalContents = new Map(originalState.texts);

  for (const file of originalState.files) {
    const text = originalState.texts.get(file.path);
    if (text === undefined) {
      continue;
    }

    const { updated } = transformReviewTimestamps(
      text,
      fs.statSync(file.path).mtime,
      "iso",
    );
    if (updated !== text) {
      fs.writeFileSync(file.path, updated, "utf8");
    }
  }

  const addedState = await collectAgentReviewState(
    originalState.files.map((file) => file.path),
    false,
  );
  const addedSnapshot = buildAgentSessionSnapshot(
    addedState,
    timestampFormats,
    originalContents,
  );
  const addedPaths = new Set(addedSnapshot.files.map((file) => file.path));
  const mergedSnapshot: AgentSessionSnapshot = {
    ...snapshot,
    files: [
      ...snapshot.files.filter((file) => !addedPaths.has(file.path)),
      ...addedSnapshot.files,
    ],
    items: [
      ...snapshot.items.filter((item) => !addedPaths.has(item.file)),
      ...addedSnapshot.items,
    ],
  };

  writeAgentSnapshot(mergedSnapshot);
  return mergedSnapshot;
}

function buildAgentSessionSnapshot(
  state: AgentReviewState,
  timestampFormats: Map<string, AgentTimestampFormat>,
  originalContents: Map<string, string>,
): AgentSessionSnapshot {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    cwd: Deno.cwd(),
    files: state.files.map((file) => ({
      ...file,
      timestampFormat: timestampFormats.get(file.path) ?? "none",
      ...(originalContents.has(file.path)
        ? { originalContent: originalContents.get(file.path) }
        : {}),
    })),
    items: state.items,
  };
}

export async function finishAgentSession(
  files: string[],
): Promise<AgentHandoff> {
  const snapshot = readAgentSnapshot();
  const targetFiles = files.length > 0
    ? resolveAgentFiles(files)
    : snapshot.files.map((file) => file.path);
  const beforeRestore = await collectAgentReviewState(targetFiles, true);
  const modifiedFiles = countModifiedAgentFiles(snapshot, beforeRestore);
  const conversationsAnswered = countAnsweredAgentConversations(
    snapshot,
    beforeRestore,
  );

  restoreAgentTimestampFormats(snapshot, targetFiles);
  const afterRestore = await collectAgentReviewState(targetFiles, true);
  const guardrailFailures = await collectAgentGuardrailFailures(
    snapshot,
    afterRestore,
  );
  guardrailFailures.push(
    ...collectAgentTimestampDriftFailures(snapshot, afterRestore),
  );

  return {
    version: 1,
    filesAnnotated:
      afterRestore.files.filter((file) => file.itemIds.length > 0).length,
    filesModified: modifiedFiles,
    conversationsAnswered,
    cleanableConversations: afterRestore.items.filter((item) =>
      item.kind === "conversation" && item.state === "resolved"
    ),
    remainingOpenItems: afterRestore.items.filter((item) =>
      item.kind === "conversation" &&
      (item.state === "open" || item.state === "wip")
    ),
    guardrailFailures,
  };
}

export async function getAgentSessionStatus(
  files: string[],
): Promise<AgentSessionStatus> {
  const snapshot = readAgentSnapshot();
  const targetFiles = files.length > 0
    ? resolveAgentFiles(files)
    : snapshot.files.map((file) => file.path);
  const state = await collectAgentReviewState(targetFiles, true);
  return await agentStatusFromState(snapshot, state);
}

export async function listAgentReviewItems(
  files: string[],
  limit: number | undefined,
): Promise<ReviewItemListing> {
  const snapshot = readAgentSnapshot();
  const targetFiles = files.length > 0
    ? resolveAgentFiles(files)
    : snapshot.files.map((file) => file.path);
  const state = await collectAgentReviewState(targetFiles, true);
  return {
    version: 1,
    items: state.items
      .filter((item) => item.state !== "resolved")
      .slice(0, limit),
  };
}

export async function showAgentReviewItem(
  id: string,
  files: string[],
): Promise<LocatedReviewItem> {
  const snapshot = readAgentSnapshot();
  return await resolveAgentLocatedReviewItem(snapshot, files, id);
}

export async function respondToAgentReviewItem(
  id: string,
  files: string[],
  message: string,
): Promise<AgentActionResult> {
  const snapshot = readAgentSnapshot();
  const located = await resolveAgentLocatedReviewItem(snapshot, files, id);
  if (!isAgentConversationItem(located.item)) {
    throw new Error("agent respond requires a conversation item id.");
  }

  const updated = replaceReviewItemRaw(
    located.text,
    located.item,
    appendAgentReply(located.item.raw, message),
  );
  fs.writeFileSync(located.file, updated, "utf8");

  return {
    id: located.id,
    file: normalizePath(located.file),
    line: located.item.lineStart,
    action: "responded",
    message,
  };
}

export async function applyAgentReviewItem(
  id: string,
  files: string[],
  replace: string | undefined,
  message: string | undefined,
): Promise<AgentActionResult> {
  const snapshot = readAgentSnapshot();
  const located = await resolveAgentLocatedReviewItem(snapshot, files, id);
  if (!isReviewAnnotationItem(located.item)) {
    throw new Error("agent apply requires a review annotation item id.");
  }

  const updated = replace === undefined
    ? applyReviewAnnotationAction(located.text, located.item, { kind: "apply" })
    : replaceReviewItemRaw(located.text, located.item, replace);
  fs.writeFileSync(located.file, updated, "utf8");

  return {
    id: located.id,
    file: normalizePath(located.file),
    line: located.item.lineStart,
    action: "applied",
    message: message ?? "annotation applied",
  };
}

export async function cleanAgentReviewItems(
  ids: string[],
  dryRun: boolean,
): Promise<AgentCleanResult> {
  const snapshot = readAgentSnapshot();
  const targetFiles = snapshot.files.map((file) => file.path);
  const allItems = await collectAgentLocatedReviewItems(targetFiles);
  const targets: LocatedReviewItem[] = [];
  if (ids.length > 0) {
    // Sequential, not Promise.all: resolveAgentLocatedReviewItem ->
    // assignPersistentReviewItemIds does a read-modify-write of
    // reference-map.json, which is not safe to run concurrently.
    for (const id of ids) {
      targets.push(await resolveAgentLocatedReviewItem(snapshot, [], id));
    }
  } else {
    targets.push(
      ...allItems.filter((item) =>
        isAgentConversationItem(item.item) &&
        getConversationStatus(item.item) === "resolved"
      ),
    );
  }

  for (const target of targets) {
    if (
      !isAgentConversationItem(target.item) ||
      getConversationStatus(target.item) !== "resolved"
    ) {
      throw new Error(
        `${
          formatStableReviewItemIdForDisplay(
            target.id,
            allItems.map((item) => item.id),
          )
        } is not a validated conversation.`,
      );
    }
  }

  if (!dryRun) {
    writeDeletedReviewItems(targets);
  }

  return {
    version: 1,
    dryRun,
    cleaned: dryRun ? 0 : targets.length,
    cleanable: targets.map((target) =>
      toAgentReviewItem(normalizePath(target.file), target.id, target.item)
    ),
  };
}

export function rollbackAgentSession(files: string[]): AgentRollbackResult {
  const snapshot = readAgentSnapshot();
  const shouldCloseSession = files.length === 0;
  const targetFiles = files.length > 0
    ? new Set(files.map(normalizePath))
    : undefined;
  const rolledBackFiles: string[] = [];

  for (const file of snapshot.files) {
    if (targetFiles && !targetFiles.has(normalizePath(file.path))) {
      continue;
    }

    if (file.originalContent === undefined) {
      throw new Error(
        [
          "session rollback requires a session snapshot with stored file content.",
          "This snapshot was created by an older dz-review version; start a new session before using rollback.",
        ].join("\n"),
      );
    }

    fs.writeFileSync(file.path, file.originalContent, "utf8");
    rolledBackFiles.push(file.path);
  }

  if (shouldCloseSession) {
    fs.rmSync(getDzReviewSessionFile(), { force: true });
  }

  return { version: 1, rolledBackFiles, sessionClosed: shouldCloseSession };
}

export async function getAgentActionDiff(
  files: string[],
): Promise<AgentSessionStatus> {
  const snapshot = readAgentSnapshot();
  const targetFiles = files.length > 0
    ? resolveAgentFiles(files)
    : snapshot.files.map((file) => file.path);
  const state = await collectAgentReviewState(targetFiles, true);
  return await agentStatusFromState(snapshot, state);
}

export async function listReviewItemsJson(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  since: ReviewTimestamp | undefined,
): Promise<ReviewItemListing> {
  const located = await collectLocatedReviewItems(
    files,
    addedLinesByFile,
    conversationOnly,
    conversationFilter,
    since,
  );
  const items = located.map((item) =>
    toAgentReviewItem(normalizePath(item.file), item.id, item.item)
  );

  return { version: 1, items };
}

export function readAgentSnapshot(): AgentSessionSnapshot {
  const sessionFile = getDzReviewSessionFile();
  if (!fs.existsSync(sessionFile)) {
    throw new Error(
      `No agent session snapshot found at ${sessionFile}. Run dz-review session start first.`,
    );
  }

  return AgentSessionSnapshotSchema.parse(
    JSON.parse(fs.readFileSync(sessionFile, "utf8")),
  );
}

export async function collectAgentReviewState(
  files: string[],
  includeEmptyFiles: boolean,
): Promise<AgentReviewState> {
  const state: AgentReviewState = {
    files: [],
    items: [],
    texts: new Map(),
  };

  for (const file of files) {
    const normalizedFile = normalizePath(file);
    if (!fs.existsSync(file)) {
      if (includeEmptyFiles) {
        state.files.push({
          path: normalizedFile,
          timestampFormat: "none",
          contentHash: "",
          itemIds: [],
        });
      }
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    const items = (await assignPersistentReviewItemIds(
      normalizedFile,
      text,
      collectReviewItems(text, false, "all"),
    )).map(({ id, item }) => toAgentReviewItem(normalizedFile, id, item));
    if (items.length === 0 && !includeEmptyFiles) {
      continue;
    }

    state.texts.set(normalizedFile, text);
    state.items.push(...items);
    state.files.push({
      path: normalizedFile,
      timestampFormat: detectTimestampFormat(
        collectReviewTimestampFormatStats(text),
      ),
      contentHash: hashText(text),
      itemIds: items.map((item) => item.id),
    });
  }

  return state;
}

export async function collectLocatedReviewItems(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  since: ReviewTimestamp | undefined,
): Promise<LocatedReviewItem[]> {
  const locatedItems: LocatedReviewItem[] = [];

  for (const file of files) {
    const lines = addedLinesByFile?.get(normalizePath(file));
    if (addedLinesByFile && !lines) {
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    const itemsWithIds = await assignPersistentReviewItemIds(
      normalizePath(file),
      text,
      collectReviewItems(text, conversationOnly, "all"),
    );
    for (const { id, item } of itemsWithIds) {
      if (!reviewItemMatchesConversationFilter(item, conversationFilter)) {
        continue;
      }

      if (!reviewItemMatchesSince(item, since)) {
        continue;
      }

      if (lines && !reviewItemOverlapsLines(item, lines)) {
        continue;
      }

      locatedItems.push({ file, id, item, text });
    }
  }

  return locatedItems;
}

export function resolveAgentFiles(files: string[]): string[] {
  if (files.length > 0) {
    return filterIgnoredFiles(files, readDefaultReviewIgnoreRules());
  }

  const ignoreRules = readReviewIgnoreRules();
  if (!isInsideGitWorkTree()) {
    throw new Error(
      "dz-review agent requires files unless it runs inside a Git worktree.",
    );
  }

  const diff = getWorktreeDiff([]);
  const addedLinesByFile = getAddedLinesByFile(diff);
  const resolved = [...addedLinesByFile.keys()];
  for (const file of findFilesIncludedByReviewIgnore(ignoreRules)) {
    if (!resolved.includes(file)) {
      resolved.push(file);
    }
  }

  return filterIgnoredFiles(resolved, ignoreRules);
}

export function formatStableReviewItemIdForDisplay(
  id: string,
  allIds: readonly string[],
): string {
  return id.startsWith(STABLE_REVIEW_ID_PREFIX)
    ? getShortStableReviewItemId(id, allIds)
    : id;
}

export function toAgentReviewItem(
  file: string,
  id: string,
  item: ReviewItem,
): AgentReviewItem {
  const messages = item.kind === "conversation"
    ? getConversationMessages(item)
    : [];
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  return {
    id,
    file,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
    kind: item.kind,
    state: getAgentReviewItemState(item),
    ...(firstMessage
      ? {
        firstMessage: {
          author: firstMessage.marker,
          body: firstMessage.body,
          ...(firstMessage.timestamp
            ? { timestamp: firstMessage.timestamp }
            : {}),
        },
      }
      : {}),
    ...(lastMessage
      ? {
        lastMessage: {
          author: lastMessage.marker,
          body: lastMessage.body,
          ...(lastMessage.timestamp
            ? { timestamp: lastMessage.timestamp }
            : {}),
        },
      }
      : {}),
    context: summarizeReviewItem(item),
    suggestedAction: getAgentSuggestedAction(item),
    rawHash: stableReviewItemFingerprint(item),
  };
}

export function normalizePath(file: string): string {
  return file.split(path.sep).join("/");
}

function writeAgentSnapshot(snapshot: AgentSessionSnapshot): void {
  const sessionFile = getDzReviewSessionFile();
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

async function agentStatusFromState(
  snapshot: AgentSessionSnapshot,
  state: AgentReviewState,
): Promise<AgentSessionStatus> {
  return {
    version: 1,
    filesAnnotated: state.files.filter((file) => file.itemIds.length > 0)
      .length,
    filesModified: countModifiedAgentFiles(snapshot, state),
    conversationsAnswered: countAnsweredAgentConversations(snapshot, state),
    cleanableConversations: state.items.filter((item) =>
      item.kind === "conversation" && item.state === "resolved"
    ),
    remainingOpenItems: state.items.filter((item) =>
      item.kind === "conversation" &&
      (item.state === "open" || item.state === "wip")
    ),
    guardrailFailures: await collectAgentGuardrailFailures(snapshot, state),
    items: state.items,
  };
}

async function collectAgentLocatedReviewItems(
  files: string[],
): Promise<LocatedReviewItem[]> {
  return await collectLocatedReviewItems(
    files,
    undefined,
    false,
    "all",
    undefined,
  );
}

async function resolveAgentLocatedReviewItem(
  snapshot: AgentSessionSnapshot,
  files: string[],
  id: string,
): Promise<LocatedReviewItem> {
  const targetFiles = files.length > 0
    ? resolveAgentFiles(files)
    : snapshot.files.map((file) => file.path);
  const items = await collectAgentLocatedReviewItems(targetFiles);
  const allIds = items.map((item) => item.id);
  const normalizedId = id.toLowerCase();
  const matches = items.filter((item) => {
    const canonical = item.id.toLowerCase();
    const display = formatStableReviewItemIdForDisplay(item.id, allIds)
      .toLowerCase();
    return canonical === normalizedId ||
      display === normalizedId ||
      canonical.startsWith(normalizedId) ||
      display.startsWith(normalizedId);
  });

  if (matches.length === 0) {
    throw new Error(`No review item found for id ${id}.`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous review item id ${id}; provide a longer stable id.`,
    );
  }

  return matches[0];
}

function isReviewAnnotationItem(item: ReviewItem): item is ReviewAnnotation {
  return item.kind !== "conversation";
}

function isAgentConversationItem(item: ReviewItem): boolean {
  return item.kind === "conversation";
}

function replaceReviewItemRaw(
  text: string,
  item: Pick<ReviewItem, "start" | "end">,
  replacement: string,
): string {
  return text.slice(0, item.start) + replacement + text.slice(item.end);
}

function appendAgentReply(raw: string, body: string): string {
  if (isInlineConversationRaw(raw)) {
    return appendInlineAgentReply(raw, body);
  }

  return appendMultilineAgentReply(raw, body);
}

function appendInlineAgentReply(raw: string, body: string): string {
  const closeStart = getAgentConversationCloseStart(raw);
  const beforeClose = raw.slice(0, closeStart);
  const prefix = /[ \t\r\n]$/.test(beforeClose) ? "" : " ";

  return `${beforeClose}${prefix}${formatAgentReplyLine(body)} ${
    raw.slice(closeStart)
  }`;
}

function appendMultilineAgentReply(raw: string, body: string): string {
  const closeStart = getAgentConversationCloseStart(raw);
  const closeLineStart = raw.lastIndexOf("\n", closeStart) + 1;
  const closeLine = raw.slice(closeLineStart, closeStart);
  const indent = closeLine.match(/^[ \t]*/)?.[0] ?? "";
  const line = `${indent}${formatAgentReplyLine(body)}\n`;

  if (/^[ \t]*$/.test(closeLine)) {
    return raw.slice(0, closeLineStart) + line + raw.slice(closeLineStart);
  }

  const prefix = raw.slice(0, closeStart).endsWith("\n") ? "" : "\n";
  return `${raw.slice(0, closeStart)}${prefix}${line}${raw.slice(closeStart)}`;
}

function isInlineConversationRaw(raw: string): boolean {
  return !raw.includes("\n");
}

function getAgentConversationCloseStart(raw: string): number {
  if (raw.endsWith("-->")) {
    return raw.lastIndexOf("-->");
  }

  return raw.lastIndexOf("??}");
}

function formatAgentReplyLine(body: string): string {
  return `@agent%${encodeTimestamp(new Date(), "iso")} ${body}`;
}

function writeDeletedReviewItems(targets: LocatedReviewItem[]): void {
  const byFile = new Map<string, LocatedReviewItem[]>();
  for (const target of targets) {
    const existing = byFile.get(target.file) ?? [];
    existing.push(target);
    byFile.set(target.file, existing);
  }

  for (const [file, fileTargets] of byFile) {
    let text = fs.readFileSync(file, "utf8");
    for (
      const target of fileTargets.toSorted((left, right) =>
        right.item.start - left.item.start
      )
    ) {
      text = replaceReviewItemRaw(text, target.item, "");
    }
    fs.writeFileSync(file, text, "utf8");
  }
}

function countModifiedAgentFiles(
  snapshot: AgentSessionSnapshot,
  state: AgentReviewState,
): number {
  const currentFiles = new Map(state.files.map((file) => [file.path, file]));
  return snapshot.files.filter((file) =>
    currentFiles.get(file.path)?.contentHash !== file.contentHash
  ).length;
}

function countAnsweredAgentConversations(
  snapshot: AgentSessionSnapshot,
  state: AgentReviewState,
): number {
  const startedItems = new Map(snapshot.items.map((item) => [item.id, item]));
  return state.items.filter((item) => {
    if (item.kind !== "conversation") {
      return false;
    }

    const started = startedItems.get(item.id);
    if (!started || started.rawHash === item.rawHash) {
      return false;
    }

    return item.lastMessage?.author === "@agent";
  }).length;
}

async function collectAgentGuardrailFailures(
  snapshot: AgentSessionSnapshot,
  state: AgentReviewState,
): Promise<AgentGuardrailFailure[]> {
  const failures: AgentGuardrailFailure[] = [];
  const startedItems = new Map(snapshot.items.map((item) => [item.id, item]));
  const currentItems = new Map(state.items.map((item) => [item.id, item]));

  for (const item of snapshot.items) {
    if (item.kind === "conversation" && !currentItems.has(item.id)) {
      failures.push({
        id: item.id,
        file: item.file,
        line: item.lineStart,
        message:
          "started conversation missing; verify no durable rationale was deleted",
      });
    }
  }

  for (const file of state.files) {
    const text = state.texts.get(file.path);
    if (text === undefined) {
      continue;
    }

    for (
      const { id, item } of await assignPersistentReviewItemIds(
        file.path,
        text,
        collectReviewItems(text, false, "all"),
      )
    ) {
      if (item.kind !== "conversation") {
        if (!item.timestamp) {
          failures.push({
            id,
            file: file.path,
            line: item.lineStart,
            message: "review annotation missing timestamp",
          });
        }
        continue;
      }

      const messages = getConversationMessages(item);
      for (const message of messages) {
        if (message.marker === "@" && message.timestamp) {
          failures.push({
            id,
            file: file.path,
            line: item.lineStart,
            message: "timestamped bare @ marker should be @me",
          });
        }

        if (!message.timestamp) {
          failures.push({
            id,
            file: file.path,
            line: item.lineStart,
            message: "conversation message missing timestamp",
          });
        }
      }

      if (getConversationStatus(item) === "resolved") {
        failures.push({
          id,
          file: file.path,
          line: item.lineStart,
          message: "validated conversation remains cleanable",
        });
      }

      const started = startedItems.get(id);
      const firstStarted = started?.firstMessage;
      const firstCurrent = messages[0];
      if (
        firstStarted && firstCurrent &&
        (firstStarted.author !== firstCurrent.marker ||
          firstStarted.body !== firstCurrent.body)
      ) {
        failures.push({
          id,
          file: file.path,
          line: item.lineStart,
          message: "conversation role order changed suspiciously",
        });
      }
    }
  }

  return failures;
}

function restoreAgentTimestampFormats(
  snapshot: AgentSessionSnapshot,
  files: string[],
): void {
  const snapshotFiles = new Map(
    snapshot.files.map((file) => [file.path, file]),
  );

  for (const file of files) {
    const normalizedFile = normalizePath(file);
    const snapshotFile = snapshotFiles.get(normalizedFile);
    if (
      !snapshotFile ||
      snapshotFile.timestampFormat === "mixed" ||
      snapshotFile.timestampFormat === "none"
    ) {
      continue;
    }

    if (!fs.existsSync(file)) {
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    const { updated } = transformReviewTimestamps(
      text,
      fs.statSync(file).mtime,
      snapshotFile.timestampFormat,
    );
    if (updated !== text) {
      fs.writeFileSync(file, updated, "utf8");
    }
  }
}

function collectAgentTimestampDriftFailures(
  snapshot: AgentSessionSnapshot,
  state: AgentReviewState,
): AgentGuardrailFailure[] {
  const currentFiles = new Map(state.files.map((file) => [file.path, file]));
  const failures: AgentGuardrailFailure[] = [];

  for (const file of snapshot.files) {
    if (file.timestampFormat === "mixed" || file.timestampFormat === "none") {
      continue;
    }

    const current = currentFiles.get(file.path);
    if (!current || current.timestampFormat === file.timestampFormat) {
      continue;
    }

    failures.push({
      id: file.itemIds[0] ?? file.path,
      file: file.path,
      line: 1,
      message:
        `timestamp format drift: expected ${file.timestampFormat}, found ${current.timestampFormat}`,
    });
  }

  return failures;
}

function detectTimestampFormat(
  stats: TimestampFormatStats,
): AgentTimestampFormat {
  const total = stats.compact + stats.hangul + stats.iso;
  if (total === 0) {
    return "none";
  }

  if (stats.compact / total >= DOMINANT_TIMESTAMP_FORMAT_RATIO) {
    return "compact";
  }

  if (stats.hangul / total >= DOMINANT_TIMESTAMP_FORMAT_RATIO) {
    return "hangul";
  }

  if (stats.iso / total >= DOMINANT_TIMESTAMP_FORMAT_RATIO) {
    return "iso";
  }

  return "mixed";
}

function getAgentReviewItemState(item: ReviewItem): string {
  if (item.kind === "conversation") {
    return getConversationStatus(item);
  }

  if (item.kind === "discussion") {
    return "discussion";
  }

  return "annotation";
}

function getAgentSuggestedAction(item: ReviewItem): string {
  if (item.kind !== "conversation") {
    return "review annotation";
  }

  const status = getConversationStatus(item);
  if (status === "open") {
    return "answer";
  }

  if (status === "wip") {
    return "wait for human input";
  }

  if (status === "handled") {
    return "reply";
  }

  return "clean after validation";
}

function summarizeReviewItem(item: ReviewItem): string {
  if (item.kind === "conversation" && "roles" in item) {
    return summarizeConversation(item);
  }

  return summarizeReviewAnnotation(item);
}

function reviewItemMatchesSince(
  item: ReviewItem,
  since: ReviewTimestamp | undefined,
): boolean {
  if (!since) {
    return true;
  }

  const timestamp = getReviewItemTimestamp(item);
  return timestamp ? compareTimestamps(timestamp, since) >= 0 : false;
}

function getReviewItemTimestamp(item: ReviewItem): ReviewTimestamp | undefined {
  if (item.kind !== "conversation") {
    return item.timestamp ? parseReviewTimestamp(item.timestamp) : undefined;
  }

  const message = getConversationLastMessage(item);
  return message?.timestamp
    ? parseReviewTimestamp(message.timestamp)
    : undefined;
}

function compareTimestamps(
  left: ReviewTimestamp,
  right: ReviewTimestamp,
): number {
  if (left.unixSeconds < right.unixSeconds) {
    return -1;
  }

  if (left.unixSeconds > right.unixSeconds) {
    return 1;
  }

  return left.offsetMinutes - right.offsetMinutes;
}

function hashText(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function isInsideGitWorkTree(): boolean {
  const result = childProcess.spawnSync("git", [
    "rev-parse",
    "--is-inside-work-tree",
  ], {
    cwd: Deno.cwd(),
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.trim() === "true";
}

function getWorktreeDiff(files: string[]): string {
  const result = childProcess.spawnSync("git", [
    "diff",
    "--unified=0",
    "--no-ext-diff",
    "HEAD",
    "--",
    ...files,
  ], {
    cwd: Deno.cwd(),
    encoding: "utf8",
    env: {
      ...Deno.env.toObject(),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "color.ui",
      GIT_CONFIG_VALUE_0: "never",
      NO_COLOR: "1",
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "git diff failed");
  }

  return result.stdout;
}

function readReviewIgnoreRules(): IgnoreRule[] {
  return [
    ...readDefaultReviewIgnoreRules(),
    ...readProjectReviewIgnoreRules(),
  ];
}

function readDefaultReviewIgnoreRules(): IgnoreRule[] {
  return getDzReviewDefaultIgnorePatterns()
    .map(compileIgnoreRule)
    .filter((rule: IgnoreRule | undefined): rule is IgnoreRule =>
      rule !== undefined
    );
}

function readProjectReviewIgnoreRules(): IgnoreRule[] {
  const ignoreFile = getDzReviewIgnoreFile();
  if (!fs.existsSync(ignoreFile)) {
    return [];
  }

  return fs.readFileSync(ignoreFile, "utf8")
    .split(/\r?\n/)
    .map(compileIgnoreRule)
    .filter((rule: IgnoreRule | undefined): rule is IgnoreRule =>
      rule !== undefined
    );
}

function compileIgnoreRule(line: string): IgnoreRule | undefined {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) {
    return undefined;
  }

  let ignored = true;
  if (pattern.startsWith("!")) {
    ignored = false;
    pattern = pattern.slice(1).trim();
  }

  if (!pattern) {
    return undefined;
  }

  pattern = pattern.replace(/\\/g, "/");
  if (pattern.startsWith("./")) {
    pattern = pattern.slice(2);
  }

  const anchored = pattern.startsWith("/");
  const directoryOnly = pattern.endsWith("/");
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) {
    return undefined;
  }

  const hasSlash = pattern.includes("/");
  const body = globToRegExp(pattern);
  const source = directoryOnly
    ? (anchored || hasSlash ? `^${body}(?:/|$)` : `(?:^|/)${body}(?:/|$)`)
    : (anchored || hasSlash ? `^${body}$` : `(?:^|/)${body}(?:$|/)`);

  return {
    ignored,
    pattern,
    directoryOnly,
    regex: new RegExp(source),
  };
}

function globToRegExp(pattern: string): string {
  let regex = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      if (pattern[index + 2] === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += escapeRegExp(char);
  }

  return regex;
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function filterIgnoredFiles(
  files: string[],
  ignoreRules: IgnoreRule[],
): string[] {
  if (ignoreRules.length === 0) {
    return files;
  }

  return files.filter((file) => !isIgnoredByReview(file, ignoreRules));
}

function isIgnoredByReview(file: string, ignoreRules: IgnoreRule[]): boolean {
  const normalized = normalizePath(file);
  let ignored = false;

  for (const rule of ignoreRules) {
    if (rule.regex.test(normalized)) {
      ignored = rule.ignored;
    }
  }

  return ignored;
}

function findFilesIncludedByReviewIgnore(ignoreRules: IgnoreRule[]): string[] {
  const files = new Set<string>();

  for (const rule of ignoreRules) {
    if (rule.ignored) {
      continue;
    }

    collectFilesMatchingReviewIgnoreRule(
      getReviewIgnoreRuleScanRoot(rule),
      rule,
      files,
    );
  }

  return [...files].sort();
}

function collectFilesMatchingReviewIgnoreRule(
  file: string,
  rule: IgnoreRule,
  files: Set<string>,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isFile()) {
    const normalized = normalizePath(file);
    if (rule.regex.test(normalized)) {
      files.add(normalized);
    }
    return;
  }

  if (!stat.isDirectory() || path.basename(file) === ".git") {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(file, { withFileTypes: true });
  } catch {
    return;
  }

  for (
    const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  ) {
    collectFilesMatchingReviewIgnoreRule(
      path.join(file, entry.name),
      rule,
      files,
    );
  }
}

function getReviewIgnoreRuleScanRoot(rule: IgnoreRule): string {
  if (!rule.directoryOnly && !hasGlob(rule.pattern)) {
    return rule.pattern;
  }

  const staticSegments: string[] = [];
  for (const segment of rule.pattern.split("/")) {
    if (hasGlob(segment)) {
      break;
    }
    staticSegments.push(segment);
  }

  return staticSegments.length > 0 ? staticSegments.join("/") : ".";
}

function hasGlob(pattern: string): boolean {
  return /[*?\[]/.test(pattern);
}
