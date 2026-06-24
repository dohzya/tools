import {
  formatTimestampForDisplay,
  parseReviewTimestamp,
} from "./timestamp.ts";

export type ReviewRole = "agent" | "me" | "quick-me";
export type ConversationStatus = "open" | "wip" | "handled" | "resolved";

export interface Conversation {
  index: number;
  start: number;
  end: number;
  raw: string;
  roles: ReviewRole[];
  lineStart: number;
  lineEnd: number;
}

export type ReviewAnnotationKind =
  | "addition"
  | "deletion"
  | "substitution"
  | "highlight"
  | "comment"
  | "discussion"
  | "conversation";

export interface ReviewAnnotation {
  index: number;
  start: number;
  end: number;
  raw: string;
  kind: ReviewAnnotationKind;
  lineStart: number;
  lineEnd: number;
  timestamp?: string;
}

export type ConversationAction =
  | { kind: "delete" }
  | { kind: "toggle-ok" }
  | { kind: "reply"; body: string };

export type ReviewAnnotationAction =
  | ConversationAction
  | { kind: "apply" }
  | { kind: "cancel" };

export interface ReviewMessage {
  body: string;
  marker: "@" | "@me" | "@agent";
  timestamp?: string;
}

export interface ConversationReviewItem extends Conversation {
  kind: "conversation";
}

export type ReviewItem = ReviewAnnotation | ConversationReviewItem;

export type ConversationFilter = "all" | ConversationStatus | "pending";

interface ReviewLine {
  marker: "@" | "@me" | "@agent";
  markerStart: number;
  bodyStart: number;
  body: string;
  timestamp?: string;
}

const REVIEW_BLOCK_RE = /<!--[\s\S]*?-->|\{\?\?[\s\S]*?\?\}/g;
const REVIEW_ANNOTATION_RE =
  /<!--[\s\S]*?-->|\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}|\{\?\?[\s\S]*?\?\}|\{~~[\s\S]*?~>[\s\S]*?~~\}/g;
const TIMESTAMP_VALUE_PATTERN = String
  .raw`[A-Za-z0-9]{8}|[\uac00-\ub3ff]{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`;
const REVIEW_MARKER_RE = new RegExp(
  String
    .raw`(^|[ \t\r\n])(@agent|@me|@)(?:%(${TIMESTAMP_VALUE_PATTERN})(?=[ \t\r\n]|$)|(?=[ \t]*:|[ \t\r\n]|$))`,
  "g",
);
const REVIEW_METADATA_PREFIX_RE = new RegExp(
  String.raw`^%(${TIMESTAMP_VALUE_PATTERN})\|`,
);
const REVIEW_METADATA_PREFIX_RE_WITH_MARKER = new RegExp(
  String.raw`^(\{(?:\+\+|--|==|>>|~~))%(${TIMESTAMP_VALUE_PATTERN})\|`,
);
const HTML_REVIEW_CLOSE = "-->";
const CRITICMARKUP_REVIEW_CLOSE = "??}";

export function collectConversations(text: string): Conversation[] {
  const lineStarts = getLineStarts(text);
  const conversations: Conversation[] = [];

  for (const match of text.matchAll(REVIEW_BLOCK_RE)) {
    const raw = match[0];
    const roles = collectReviewRoles(raw);
    if (roles.length === 0) {
      continue;
    }

    const start = match.index ?? 0;
    const end = start + raw.length;
    conversations.push({
      index: conversations.length + 1,
      start,
      end,
      raw,
      roles,
      lineStart: offsetToLine(lineStarts, start),
      lineEnd: offsetToLine(lineStarts, Math.max(start, end - 1)),
    });
  }

  return conversations;
}

export function collectReviewAnnotations(text: string): ReviewAnnotation[] {
  const lineStarts = getLineStarts(text);
  const annotations: ReviewAnnotation[] = [];

  for (const match of text.matchAll(REVIEW_ANNOTATION_RE)) {
    const raw = match[0];
    const kind = getReviewAnnotationKind(raw);
    if (!kind) {
      continue;
    }

    const start = match.index ?? 0;
    const end = start + raw.length;
    const metadata = getReviewAnnotationMetadata(raw);
    annotations.push({
      index: annotations.length + 1,
      start,
      end,
      raw,
      kind,
      lineStart: offsetToLine(lineStarts, start),
      lineEnd: offsetToLine(lineStarts, Math.max(start, end - 1)),
      ...(metadata?.timestamp ? { timestamp: metadata.timestamp } : {}),
    });
  }

  return annotations;
}

export function applyConversationAction(
  text: string,
  conversation: Conversation,
  action: ConversationAction,
): string {
  const replacement = getConversationReplacement(conversation.raw, action);
  return text.slice(0, conversation.start) + replacement +
    text.slice(conversation.end);
}

export function applyReviewAnnotationAction(
  text: string,
  annotation: ReviewAnnotation,
  action: ReviewAnnotationAction,
): string {
  const replacement = getReviewAnnotationReplacement(annotation.raw, action);
  return text.slice(0, annotation.start) + replacement +
    text.slice(annotation.end);
}

export function reviewItemOverlapsLines(
  item: Pick<Conversation | ReviewAnnotation, "lineStart" | "lineEnd">,
  lines: Set<number>,
): boolean {
  for (let line = item.lineStart; line <= item.lineEnd; line += 1) {
    if (lines.has(line)) {
      return true;
    }
  }

  return false;
}

export const conversationOverlapsLines = reviewItemOverlapsLines;

export function collectReviewItems(
  text: string,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
): ReviewItem[] {
  const keepReviewItem = (item: ReviewItem) =>
    reviewItemMatchesConversationFilter(item, conversationFilter);

  const conversations: ConversationReviewItem[] = collectConversations(text)
    .map((conversation) => ({
      ...conversation,
      kind: "conversation",
    }));

  const discussionAnnotations = collectReviewAnnotations(text).filter((item) =>
    item.kind === "discussion"
  );

  if (!conversationOnly) {
    return collectReviewAnnotations(text).filter(keepReviewItem);
  }

  return [...conversations, ...discussionAnnotations].filter(keepReviewItem);
}

export function reviewItemMatchesConversationFilter(
  item: ReviewItem,
  conversationFilter: ConversationFilter,
): boolean {
  if (conversationFilter === "all") {
    return true;
  }

  const status = getReviewItemStatus(item);
  if (conversationFilter === "pending") {
    return status === "open" || status === "wip";
  }

  return status === conversationFilter;
}

export function getReviewItemStatus(item: ReviewItem): ConversationStatus {
  return isConversationReviewItem(item)
    ? getConversationStatus(item)
    : "handled";
}

export function isConversationReviewItem(
  item: ReviewItem,
): item is ConversationReviewItem {
  return item.kind === "conversation" && "roles" in item;
}

export function getAddedLinesByFile(diff: string): Map<string, Set<number>> {
  const addedLines = new Map<string, Set<number>>();
  let currentFile: string | undefined;
  let currentLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const file = line.slice(4).trim();
      currentFile = file === "/dev/null" ? undefined : normalizeDiffPath(file);
      if (currentFile && !addedLines.has(currentFile)) {
        addedLines.set(currentFile, new Set());
      }
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      currentLine = Number(hunk[1]);
      continue;
    }

    if (!currentFile || line.length === 0 || line.startsWith("diff --git ")) {
      continue;
    }

    if (line.startsWith("+")) {
      addedLines.get(currentFile)?.add(currentLine);
      currentLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      continue;
    }

    currentLine += 1;
  }

  return addedLines;
}

export function summarizeConversation(conversation: Conversation): string {
  return summarizeConversationRaw(conversation.raw);
}

function summarizeConversationRaw(raw: string): string {
  const content = getConversationContent(raw)
    .replace(/\s+/g, " ")
    .trim();

  if (content.length <= 120) {
    return content;
  }

  return `${content.slice(0, 117)}...`;
}

export function summarizeReviewAnnotation(
  annotation: ReviewAnnotation,
): string {
  if (annotation.kind === "conversation") {
    return summarizeConversationRaw(annotation.raw);
  }

  const rendered = renderReviewAnnotationForDisplay(annotation);
  if (rendered.length <= 120) {
    return rendered;
  }

  return `${rendered.slice(0, 117)}...`;
}

export function renderReviewAnnotationForDisplay(
  annotation: ReviewAnnotation,
): string {
  if (!annotation.timestamp) {
    return annotation.raw;
  }

  const timestamp = formatTimestampForDisplay(
    parseReviewTimestamp(annotation.timestamp),
  );
  if (!timestamp) {
    return annotation.raw;
  }

  return annotation.raw.replace(
    REVIEW_METADATA_PREFIX_RE_WITH_MARKER,
    `$1%${timestamp}|`,
  );
}

export function isClosedConversation(
  conversation: Pick<Conversation | ReviewAnnotation, "raw">,
): boolean {
  return getConversationStatus(conversation) === "resolved";
}

export function getConversationStatus(
  conversation: Pick<Conversation | ReviewAnnotation, "raw">,
): ConversationStatus {
  const lines = getReviewLines(conversation.raw);
  const trailingLine = lines[lines.length - 1];

  if (!trailingLine || trailingLine.marker === "@agent") {
    return "open";
  }

  if (trailingLine.body.trim().length === 0) {
    return "wip";
  }

  if (/^ok$/i.test(trailingLine.body.trim())) {
    return "resolved";
  }

  return "handled";
}

export function getConversationLastMessage(
  conversation: Pick<Conversation | ReviewAnnotation, "raw">,
): ReviewMessage | undefined {
  const lines = getReviewLines(conversation.raw);
  const line = lines[lines.length - 1];
  if (!line) {
    return undefined;
  }

  return {
    body: line.body,
    marker: line.marker,
    ...(line.timestamp ? { timestamp: line.timestamp } : {}),
  };
}

export function getConversationMessages(
  conversation: Pick<Conversation | ReviewAnnotation, "raw">,
): ReviewMessage[] {
  return getReviewLines(conversation.raw).map((line) => ({
    body: line.body,
    marker: line.marker,
    ...(line.timestamp ? { timestamp: line.timestamp } : {}),
  }));
}

function getConversationReplacement(
  raw: string,
  action: ConversationAction,
): string {
  switch (action.kind) {
    case "delete":
      return "";
    case "toggle-ok":
      return toggleHumanOk(raw);
    case "reply":
      return appendHumanReply(raw, action.body);
  }
}

function getReviewAnnotationReplacement(
  raw: string,
  action: ReviewAnnotationAction,
): string {
  if (action.kind === "delete") {
    return "";
  }

  const annotation = getReviewAnnotationKind(raw);
  if (annotation === "conversation") {
    if (action.kind === "toggle-ok" || action.kind === "reply") {
      return getConversationReplacement(raw, action);
    }

    return "";
  }

  if (action.kind === "toggle-ok" || action.kind === "reply") {
    return raw;
  }

  const replacement = getCriticMarkupReplacement(raw);
  if (!replacement) {
    return raw;
  }

  return replacement[action.kind];
}

function getReviewAnnotationKind(
  raw: string,
): ReviewAnnotationKind | undefined {
  if (raw.startsWith("<!--") && raw.endsWith(HTML_REVIEW_CLOSE)) {
    return collectReviewRoles(raw).length > 0 ? "conversation" : undefined;
  }

  if (raw.startsWith("{++") && raw.endsWith("++}")) {
    return "addition";
  }

  if (raw.startsWith("{--") && raw.endsWith("--}")) {
    return "deletion";
  }

  if (raw.startsWith("{==") && raw.endsWith("==}")) {
    return "highlight";
  }

  if (raw.startsWith("{>>") && raw.endsWith("<<}")) {
    return "comment";
  }

  if (raw.startsWith("{??") && raw.endsWith(CRITICMARKUP_REVIEW_CLOSE)) {
    return collectReviewRoles(raw).length > 0 ? "conversation" : "discussion";
  }

  if (raw.startsWith("{~~") && raw.endsWith("~~}")) {
    return "substitution";
  }

  return undefined;
}

function getCriticMarkupReplacement(
  raw: string,
): { cancel: string; apply: string } | undefined {
  if (raw.startsWith("{++") && raw.endsWith("++}")) {
    return { cancel: "", apply: getReviewAnnotationPayload(raw, 3, -3) };
  }

  if (raw.startsWith("{--") && raw.endsWith("--}")) {
    return { cancel: getReviewAnnotationPayload(raw, 3, -3), apply: "" };
  }

  if (raw.startsWith("{==") && raw.endsWith("==}")) {
    const content = getReviewAnnotationPayload(raw, 3, -3);
    return { cancel: content, apply: content };
  }

  if (raw.startsWith("{>>") && raw.endsWith("<<}")) {
    return { cancel: "", apply: "" };
  }

  if (raw.startsWith("{??") && raw.endsWith(CRITICMARKUP_REVIEW_CLOSE)) {
    return { cancel: "", apply: "" };
  }

  if (raw.startsWith("{~~") && raw.endsWith("~~}")) {
    const contentStart = getReviewAnnotationPayloadStart(raw, 3);
    const separator = raw.indexOf("~>", contentStart);
    if (separator < 0) {
      return undefined;
    }

    return {
      cancel: raw.slice(contentStart, separator),
      apply: raw.slice(separator + 2, -3),
    };
  }

  return undefined;
}

function getReviewAnnotationPayload(
  raw: string,
  contentStart: number,
  contentEnd: number,
): string {
  return raw.slice(
    getReviewAnnotationPayloadStart(raw, contentStart),
    contentEnd,
  );
}

function getReviewAnnotationPayloadStart(
  raw: string,
  contentStart: number,
): number {
  const metadata = raw.slice(contentStart).match(REVIEW_METADATA_PREFIX_RE);
  return metadata ? contentStart + metadata[0].length : contentStart;
}

function getReviewAnnotationMetadata(
  raw: string,
): { timestamp: string } | undefined {
  const contentStart = raw.startsWith("{~~") ? 3 : 3;
  const metadata = raw.slice(contentStart).match(REVIEW_METADATA_PREFIX_RE);
  return metadata ? { timestamp: metadata[1] } : undefined;
}

function collectReviewRoles(raw: string): ReviewRole[] {
  const roles = new Set<ReviewRole>();

  for (const line of getReviewLines(raw)) {
    roles.add(
      line.marker === "@agent"
        ? "agent"
        : line.marker === "@me"
        ? "me"
        : "quick-me",
    );
  }

  return [...roles];
}

function getReviewLines(raw: string): ReviewLine[] {
  const matches = [...raw.matchAll(REVIEW_MARKER_RE)]
    .filter((match) => !isEscapedAt(raw, (match.index ?? 0) + match[1].length));
  const closeStart = getConversationCloseStart(raw);

  return matches.map((match, index) => {
    const marker = parseReviewMarker(match[2]);
    const timestamp = match[3];
    const markerStart = (match.index ?? 0) + match[1].length;
    const markerEnd = markerStart + marker.length +
      (timestamp ? timestamp.length + 1 : 0);
    const nextMarkerStart = index + 1 < matches.length
      ? (matches[index + 1].index ?? 0) + matches[index + 1][1].length
      : closeStart;
    const bodyStart = getBodyStart(raw, markerEnd);

    return {
      marker,
      markerStart,
      bodyStart,
      body: raw.slice(bodyStart, nextMarkerStart).trim(),
      ...(timestamp ? { timestamp } : {}),
    };
  });
}

function parseReviewMarker(value: string): ReviewLine["marker"] {
  if (value === "@" || value === "@me" || value === "@agent") {
    return value;
  }

  throw new Error(`Invalid review marker: ${value}.`);
}

function isEscapedAt(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function getBodyStart(raw: string, offset: number): number {
  let bodyStart = offset;

  while (raw[bodyStart] === " " || raw[bodyStart] === "\t") {
    bodyStart += 1;
  }

  if (raw[bodyStart] === ":") {
    bodyStart += 1;
    while (raw[bodyStart] === " " || raw[bodyStart] === "\t") {
      bodyStart += 1;
    }
  }

  return bodyStart;
}

function toggleHumanOk(raw: string): string {
  const lines = getReviewLines(raw);
  const trailingLine = lines[lines.length - 1];

  if (isClosedConversation({ raw })) {
    return removeTrailingHumanOk(raw, trailingLine!);
  }

  return appendHumanReply(raw, "ok");
}

function removeTrailingHumanOk(raw: string, line: ReviewLine): string {
  const closeStart = getConversationCloseStart(raw);

  if (isInlineConversation(raw)) {
    const removeStart =
      line.markerStart > 0 && /[ \t]/.test(raw[line.markerStart - 1])
        ? line.markerStart - 1
        : line.markerStart;
    return `${raw.slice(0, removeStart)} ${raw.slice(closeStart)}`;
  }

  return raw.slice(0, line.markerStart) + raw.slice(closeStart);
}

function appendHumanReply(raw: string, body: string): string {
  if (isInlineConversation(raw)) {
    return appendInlineHumanReply(raw, body);
  }

  return appendMultilineHumanReply(raw, body);
}

function appendInlineHumanReply(raw: string, body: string): string {
  const closeStart = getConversationCloseStart(raw);
  const beforeClose = raw.slice(0, closeStart);
  const prefix = /[ \t\r\n]$/.test(beforeClose) ? "" : " ";

  return `${beforeClose}${prefix}@me ${body} ${raw.slice(closeStart)}`;
}

function appendMultilineHumanReply(raw: string, body: string): string {
  const closeStart = getConversationCloseStart(raw);
  const closeLineStart = raw.lastIndexOf("\n", closeStart) + 1;
  const closeLine = raw.slice(closeLineStart, closeStart);
  const indent = closeLine.match(/^[ \t]*/)?.[0] ?? "";
  const line = `${indent}@me ${body}\n`;

  if (/^[ \t]*$/.test(closeLine)) {
    return raw.slice(0, closeLineStart) + line + raw.slice(closeLineStart);
  }

  const prefix = raw.slice(0, closeStart).endsWith("\n") ? "" : "\n";
  return raw.slice(0, closeStart) + prefix + line + raw.slice(closeStart);
}

function getConversationContent(raw: string): string {
  if (raw.startsWith("<!--") && raw.endsWith(HTML_REVIEW_CLOSE)) {
    return raw.slice(4, -3);
  }

  if (raw.startsWith("{??") && raw.endsWith(CRITICMARKUP_REVIEW_CLOSE)) {
    return raw.slice(3, -3);
  }

  return raw;
}

function getConversationCloseStart(raw: string): number {
  return raw.lastIndexOf(getConversationCloseMarker(raw));
}

function getConversationCloseMarker(raw: string): string {
  return raw.startsWith("<!--") ? HTML_REVIEW_CLOSE : CRITICMARKUP_REVIEW_CLOSE;
}

function isInlineConversation(raw: string): boolean {
  return !raw.includes("\n");
}

function normalizeDiffPath(file: string): string {
  const unquoted = file.startsWith('"') && file.endsWith('"')
    ? file.slice(1, -1).replace(/\\(.)/g, "$1")
    : file;

  return unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
}

function getLineStarts(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}
