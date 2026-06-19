import * as vscode from "vscode";
import {
  encodeCompactTimestamp,
  encodeHangulTimestamp,
  encodeTimestamp,
  formatTimestampForDisplay,
  parseReviewTimestamp,
  type ReviewTimestamp,
  type TimestampFormat,
} from "./timestamp";

type ReviewRole = "agent" | "me" | "quick-me";
type ConversationStatus = "open" | "wip" | "handled" | "resolved";
type CriticMarkupAnnotationKind =
  | "addition"
  | "deletion"
  | "substitution"
  | "highlight"
  | "comment";
type CriticMarkupResolution = "cancel" | "apply";
type ExtensionTimestampFormat = TimestampFormat | "none";

interface Conversation {
  start: number;
  end: number;
  raw: string;
  roles: ReviewRole[];
}

interface ReviewLine {
  start: number;
  end: number;
  indent: string;
  marker: "@" | "@me" | "@agent";
  body: string;
  bodyStart: number;
  timestamp?: string;
}

interface RoleRange {
  role: ReviewRole;
  range: vscode.Range;
}

interface ReviewBlock {
  start: number;
  end: number;
}

type ReviewPanelItemKind =
  | "conversation"
  | "addition"
  | "deletion"
  | "substitution"
  | "highlight"
  | "comment";
type ReviewPanelFilter = "all" | "unresolved" | "pending" | ConversationStatus;

interface ReviewPanelItem {
  start: number;
  end: number;
  kind: ReviewPanelItemKind;
  status?: ConversationStatus;
  label: string;
  line: number;
  summary: string;
  messages?: ReviewPanelMessage[];
}

interface ReviewPanelMessage {
  role: string;
  timestamp?: string;
  timestampTitle?: string;
  body: string;
}

type ReviewPanelWebviewMessage =
  | { type: "filter"; filter: ReviewPanelFilter }
  | { type: "reveal"; item: ReviewPanelItem }
  | { type: "ok"; item: ReviewPanelItem }
  | { type: "reply"; item: ReviewPanelItem; body: string }
  | { type: "delete"; item: ReviewPanelItem }
  | {
    type: "resolveAnnotation";
    item: ReviewPanelItem;
    resolution: CriticMarkupResolution;
  };

interface TimestampEdit {
  start: number;
  end: number;
  text: string;
}

let openConversationDecorationType: vscode.TextEditorDecorationType | undefined;
let wipConversationDecorationType: vscode.TextEditorDecorationType | undefined;
let handledConversationDecorationType:
  | vscode.TextEditorDecorationType
  | undefined;
let resolvedConversationDecorationType:
  | vscode.TextEditorDecorationType
  | undefined;
let conversationGutterDecorationType:
  | vscode.TextEditorDecorationType
  | undefined;
let markerDecorationType: vscode.TextEditorDecorationType | undefined;
let agentDecorationType: vscode.TextEditorDecorationType | undefined;
let humanDecorationType: vscode.TextEditorDecorationType | undefined;
let quickHumanDecorationType: vscode.TextEditorDecorationType | undefined;
let okDecorationType: vscode.TextEditorDecorationType | undefined;
let reviewModeEnabled = false;
let reviewModeStatusBarItem: vscode.StatusBarItem | undefined;
let reviewPanelProvider: ReviewPanelProvider | undefined;

const REVIEW_BLOCK_RE = /<!--[\s\S]*?-->|\{\?\?[\s\S]*?\?\?\}/g;
const CRITICMARKUP_ANNOTATION_RE =
  /\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}|\{\?\?[\s\S]*?\?\?\}|\{~~[\s\S]*?~>[\s\S]*?~~\}/g;
const TIMESTAMPABLE_CRITICMARKUP_ANNOTATION_RE =
  /\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}|\{~~[\s\S]*?~>[\s\S]*?~~\}/g;
const REVIEW_RESOLUTION_RE =
  /<!--[\s\S]*?-->|\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}|\{\?\?[\s\S]*?\?\?\}|\{~~[\s\S]*?~>[\s\S]*?~~\}/g;

const TIMESTAMP_VALUE_PATTERN = String
  .raw`[A-Za-z0-9]{8}|[\uac00-\ub3ff]{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`;
const REVIEW_MARKER_RE = new RegExp(
  String
    .raw`(^|[ \t\r\n])(@agent|@me|@)(?:%(${TIMESTAMP_VALUE_PATTERN})(?=[ \t\r\n]|$)|(?=[ \t]*:|[ \t\r\n]|$))`,
  "g",
);
const REVIEW_TIMESTAMP_RE = new RegExp(
  String.raw`%(${TIMESTAMP_VALUE_PATTERN})`,
  "g",
);
const REVIEW_METADATA_PREFIX_RE = new RegExp(
  String.raw`^%(${TIMESTAMP_VALUE_PATTERN})\|`,
);
const HTML_REVIEW_OPEN = "<!--";
const HTML_REVIEW_CLOSE = "-->";
const CRITICMARKUP_REVIEW_OPEN = "{??";
const CRITICMARKUP_REVIEW_CLOSE = "??}";
const REVIEW_MODE_CONTEXT = "dzMdReview.inReviewMode";
const REVIEW_PANEL_VIEW_ID = "dzMdReview.reviewItems";
const REVIEW_PANEL_FILTER_CONTEXT = "dzMdReview.reviewItemsFilter";
const CATPPUCCIN_LATTE_BLUE = "#1E66F5";
const CATPPUCCIN_LATTE_GREEN = "#40A02B";
const CATPPUCCIN_LATTE_YELLOW = "#DF8E1D";
const CATPPUCCIN_LATTE_PEACH = "#FE640B";
const CATPPUCCIN_LATTE_OVERLAY1 = "#8C8FA1";

const REVIEW_PANEL_FILTERS: ReadonlyArray<
  { filter: ReviewPanelFilter; label: string; description: string }
> = [
  {
    filter: "all",
    label: "All",
    description: "Open, WIP, handled, and resolved",
  },
  {
    filter: "unresolved",
    label: "Unresolved",
    description: "Open, WIP, and handled",
  },
  { filter: "pending", label: "Pending", description: "Open and WIP" },
  { filter: "open", label: "Open", description: "Open conversations" },
  {
    filter: "wip",
    label: "WIP",
    description: "Conversations waiting for your reply",
  },
  { filter: "handled", label: "Handled", description: "Handled conversations" },
  {
    filter: "resolved",
    label: "Resolved",
    description: "Resolved conversations",
  },
];

class ReviewPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private filter: ReviewPanelFilter = "unresolved";

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: ReviewPanelWebviewMessage) => {
      return handleReviewPanelMessage(message);
    });
    this.refresh();
  }

  setFilter(filter: ReviewPanelFilter): void {
    this.filter = filter;
    this.refresh();
  }

  refresh(): void {
    if (!this.view) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const items = editor?.document.languageId === "markdown"
      ? collectReviewPanelItems(editor.document, this.filter)
      : [];
    this.view.description = this.filter === "all" ? undefined : this.filter;
    this.view.webview.html = getReviewPanelHtml(items, this.filter);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  openConversationDecorationType = vscode.window.createTextEditorDecorationType(
    {
      backgroundColor: "rgba(30, 102, 245, 0.07)",
      overviewRulerColor: CATPPUCCIN_LATTE_BLUE,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    },
  );
  wipConversationDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(223, 142, 29, 0.11)",
    overviewRulerColor: CATPPUCCIN_LATTE_YELLOW,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  handledConversationDecorationType = vscode.window
    .createTextEditorDecorationType({
      backgroundColor: "rgba(140, 143, 161, 0.05)",
      overviewRulerColor: CATPPUCCIN_LATTE_OVERLAY1,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  resolvedConversationDecorationType = vscode.window
    .createTextEditorDecorationType({
      backgroundColor: "rgba(64, 160, 43, 0.05)",
      overviewRulerColor: CATPPUCCIN_LATTE_GREEN,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  conversationGutterDecorationType = vscode.window
    .createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(
        context.extensionUri,
        "assets",
        "review-comment-gutter.svg",
      ),
      gutterIconSize: "contain",
    });
  markerDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_OVERLAY1,
    fontStyle: "normal",
    fontWeight: "normal",
  });
  agentDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_BLUE,
    fontWeight: "bold",
  });
  humanDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_PEACH,
    fontWeight: "bold",
  });
  quickHumanDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_PEACH,
    fontWeight: "bold",
  });
  okDecorationType = vscode.window.createTextEditorDecorationType({
    fontWeight: "bold",
  });
  reviewModeStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  reviewModeStatusBarItem.text = "$(comment-discussion) Review";
  reviewModeStatusBarItem.tooltip = "Markdown Review Mode";
  reviewModeStatusBarItem.command = "dzMdReview.toggleReviewMode";
  reviewPanelProvider = new ReviewPanelProvider();
  void vscode.commands.executeCommand(
    "setContext",
    REVIEW_PANEL_FILTER_CONTEXT,
    "unresolved",
  );

  context.subscriptions.push(
    openConversationDecorationType,
    wipConversationDecorationType,
    handledConversationDecorationType,
    resolvedConversationDecorationType,
    conversationGutterDecorationType,
    markerDecorationType,
    agentDecorationType,
    humanDecorationType,
    quickHumanDecorationType,
    okDecorationType,
    reviewModeStatusBarItem,
    vscode.window.registerWebviewViewProvider(
      REVIEW_PANEL_VIEW_ID,
      reviewPanelProvider,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.toggleReviewMode",
      toggleReviewMode,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.enterReviewMode",
      enterReviewMode,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.exitReviewMode",
      exitReviewMode,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.approveAgentMessage",
      approveAgentMessage,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addHumanComment",
      addHumanComment,
    ),
    vscode.commands.registerCommand("dzMdReview.addHumanOk", addHumanOk),
    vscode.commands.registerCommand("dzMdReview.removeHumanOk", removeHumanOk),
    vscode.commands.registerCommand(
      "dzMdReview.createCompactReviewNote",
      createCompactReviewNote,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.createCriticMarkupDiscussion",
      createCompactCriticMarkupReviewNote,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addCriticMarkupAddition",
      () => wrapCriticMarkupAnnotation("addition"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addCriticMarkupDeletion",
      () => wrapCriticMarkupAnnotation("deletion"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addCriticMarkupSubstitution",
      () => wrapCriticMarkupAnnotation("substitution"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addCriticMarkupHighlight",
      () => wrapCriticMarkupAnnotation("highlight"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addCriticMarkupComment",
      () => wrapCriticMarkupAnnotation("comment"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.addTimestampToCurrentReviewElement",
      addTimestampToCurrentReviewElement,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.convertTimestampsInActiveEditor",
      convertTimestampsInActiveEditor,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.cancelCriticMarkupAnnotation",
      cancelCriticMarkupAnnotation,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.applyCriticMarkupAnnotation",
      applyCriticMarkupAnnotation,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.nextReviewBlock",
      () => moveToReviewBlock("next"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.previousReviewBlock",
      () => moveToReviewBlock("previous"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.deleteConversation",
      deleteConversation,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.nextConversation",
      () => moveToConversation("next"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.previousConversation",
      () => moveToConversation("previous"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.nextPendingConversation",
      () => moveToConversation("next", "pending"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.previousPendingConversation",
      () => moveToConversation("previous", "pending"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.revealReviewItem",
      revealReviewPanelItem,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.filterReviewItems",
      filterReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showUnresolvedReviewItems",
      showUnresolvedReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showPendingReviewItems",
      showPendingReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showAllReviewItems",
      showAllReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showOpenReviewItems",
      showOpenReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showWipReviewItems",
      showWipReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showHandledReviewItems",
      showHandledReviewItems,
    ),
    vscode.commands.registerCommand(
      "dzMdReview.showResolvedReviewItems",
      showResolvedReviewItems,
    ),
    vscode.languages.registerHoverProvider({ language: "markdown" }, {
      provideHover: provideTimestampHover,
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateConversationDecorations(editor);
      reviewPanelProvider?.refresh();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (event.document === editor?.document) {
        void fillReviewLineAfterNativeNewline(event, editor);
        updateConversationDecorations(editor);
        reviewPanelProvider?.refresh();
      }
    }),
  );

  void setReviewMode(false);
  updateConversationDecorations(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // Nothing to dispose manually; subscriptions are owned by VS Code.
}

async function toggleReviewMode(): Promise<void> {
  await setReviewMode(!reviewModeEnabled);
}

async function enterReviewMode(): Promise<void> {
  await setReviewMode(true);
}

async function exitReviewMode(): Promise<void> {
  await setReviewMode(false);
}

async function setReviewMode(enabled: boolean): Promise<void> {
  reviewModeEnabled = enabled;
  updateReviewModeStatus(enabled);
  await vscode.commands.executeCommand(
    "setContext",
    REVIEW_MODE_CONTEXT,
    enabled,
  );
}

function updateReviewModeStatus(enabled: boolean): void {
  if (!reviewModeStatusBarItem) {
    return;
  }

  if (enabled) {
    reviewModeStatusBarItem.show();
    return;
  }

  reviewModeStatusBarItem.hide();
}

function collectReviewPanelItems(
  document: vscode.TextDocument,
  filter: ReviewPanelFilter = "all",
): ReviewPanelItem[] {
  const text = document.getText();
  const items: ReviewPanelItem[] = [];
  const conversationSpans = new Set<string>();

  for (const conversation of collectConversations(text)) {
    conversationSpans.add(`${conversation.start}:${conversation.end}`);
    const status = getConversationStatus(conversation);
    if (!reviewPanelConversationMatchesFilter(status, filter)) {
      continue;
    }

    items.push({
      start: conversation.start,
      end: conversation.end,
      kind: "conversation",
      status,
      label: formatReviewPanelConversationLabel(status),
      line: document.positionAt(conversation.start).line + 1,
      summary: summarizeReviewPanelText(
        getConversationContent(conversation.raw),
      ),
      messages: getReviewPanelConversationMessages(conversation.raw),
    });
  }

  for (const match of text.matchAll(CRITICMARKUP_ANNOTATION_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (conversationSpans.has(`${start}:${end}`)) {
      continue;
    }

    const kind = getReviewPanelAnnotationKind(raw);
    if (!reviewPanelAnnotationMatchesFilter(filter)) {
      continue;
    }

    items.push({
      start,
      end,
      kind,
      label: formatReviewPanelAnnotationLabel(kind),
      line: document.positionAt(start).line + 1,
      summary: summarizeReviewPanelText(
        getReviewPanelAnnotationPayload(raw, kind),
      ),
    });
  }

  return items.sort((left, right) =>
    left.start - right.start || left.end - right.end
  );
}

async function filterReviewItems(): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    REVIEW_PANEL_FILTERS.map(({ filter, label, description }) => ({
      filter,
      label,
      description,
    })),
    { placeHolder: "Filter review items" },
  );

  if (!selected) {
    return;
  }

  await setReviewPanelFilter(selected.filter);
}

async function showPendingReviewItems(): Promise<void> {
  await setReviewPanelFilter("pending");
}

async function showAllReviewItems(): Promise<void> {
  await setReviewPanelFilter("all");
}

async function showUnresolvedReviewItems(): Promise<void> {
  await setReviewPanelFilter("unresolved");
}

async function showOpenReviewItems(): Promise<void> {
  await setReviewPanelFilter("open");
}

async function showWipReviewItems(): Promise<void> {
  await setReviewPanelFilter("wip");
}

async function showHandledReviewItems(): Promise<void> {
  await setReviewPanelFilter("handled");
}

async function showResolvedReviewItems(): Promise<void> {
  await setReviewPanelFilter("resolved");
}

async function setReviewPanelFilter(filter: ReviewPanelFilter): Promise<void> {
  reviewPanelProvider?.setFilter(filter);
  await vscode.commands.executeCommand(
    "setContext",
    REVIEW_PANEL_FILTER_CONTEXT,
    filter,
  );
}

function reviewPanelConversationMatchesFilter(
  status: ConversationStatus,
  filter: ReviewPanelFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unresolved":
      return status !== "resolved";
    case "pending":
      return status === "open" || status === "wip";
    case "open":
    case "wip":
    case "handled":
    case "resolved":
      return status === filter;
  }
}

function reviewPanelAnnotationMatchesFilter(
  filter: ReviewPanelFilter,
): boolean {
  return filter === "all" || filter === "unresolved" || filter === "pending";
}

async function handleReviewPanelMessage(
  message: ReviewPanelWebviewMessage,
): Promise<void> {
  switch (message.type) {
    case "filter":
      await setReviewPanelFilter(message.filter);
      return;
    case "reveal":
      revealReviewPanelItem(message.item);
      return;
    case "ok":
      await markReviewPanelConversationOk(message.item);
      reviewPanelProvider?.refresh();
      return;
    case "reply":
      await replyToReviewPanelConversation(message.item, message.body);
      reviewPanelProvider?.refresh();
      return;
    case "delete":
      await deleteReviewPanelConversation(message.item);
      reviewPanelProvider?.refresh();
      return;
    case "resolveAnnotation":
      await resolveReviewPanelAnnotation(message.item, message.resolution);
      reviewPanelProvider?.refresh();
      return;
  }
}

function revealReviewPanelItem(item: ReviewPanelItem): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const position = editor.document.positionAt(item.start);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

async function replyToReviewPanelConversation(
  item: ReviewPanelItem,
  body: string,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const conversation = editor
    ? findReviewPanelConversation(editor.document, item)
    : undefined;
  if (!editor || !conversation) {
    void vscode.window.showInformationMessage(
      "No Markdown review conversation for this panel item.",
    );
    return;
  }

  const insertion = buildHumanCommentInsertion(conversation, body);
  const insertOffset = conversation.start + insertion.offset;
  const insertPosition = editor.document.positionAt(insertOffset);

  await editor.edit((edit) => {
    edit.insert(insertPosition, insertion.text);
  });
}

async function markReviewPanelConversationOk(
  item: ReviewPanelItem,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const conversation = editor
    ? findReviewPanelConversation(editor.document, item)
    : undefined;
  if (!editor || !conversation) {
    void vscode.window.showInformationMessage(
      "No Markdown review conversation for this panel item.",
    );
    return;
  }

  if (getTrailingHumanOkRemoval(conversation)) {
    return;
  }

  const trailingEmptyHumanReply = getTrailingEmptyHumanReply(conversation);
  if (trailingEmptyHumanReply) {
    await fillTrailingEmptyHumanReply(
      editor,
      conversation,
      trailingEmptyHumanReply,
      "ok",
    );
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await appendInlineHumanOk(editor, conversation);
    return;
  }

  const insertion = buildHumanCommentInsertion(conversation, "ok");
  const insertOffset = conversation.start + insertion.offset;
  const insertPosition = editor.document.positionAt(insertOffset);

  await editor.edit((edit) => {
    edit.insert(insertPosition, insertion.text);
  });
}

async function deleteReviewPanelConversation(
  item: ReviewPanelItem,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const conversation = editor
    ? findReviewPanelConversation(editor.document, item)
    : undefined;
  if (!editor || !conversation) {
    void vscode.window.showInformationMessage(
      "No Markdown review conversation for this panel item.",
    );
    return;
  }

  await editor.edit((edit) => {
    edit.delete(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(
          trimTrailingBlankLine(editor.document.getText(), conversation.end),
        ),
      ),
    );
  });
}

async function resolveReviewPanelAnnotation(
  item: ReviewPanelItem,
  resolution: CriticMarkupResolution,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const annotation = findCurrentCriticMarkupAnnotation(
    editor.document.getText(),
    item.start,
  );
  if (
    !annotation || annotation.start !== item.start ||
    annotation.end !== item.end
  ) {
    void vscode.window.showInformationMessage(
      "No review annotation for this panel item.",
    );
    return;
  }

  const replacement = resolution === "apply"
    ? annotation.apply
    : annotation.cancel;
  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(annotation.start),
        editor.document.positionAt(annotation.end),
      ),
      replacement,
    );
  });
}

function findReviewPanelConversation(
  document: vscode.TextDocument,
  item: ReviewPanelItem,
): Conversation | undefined {
  if (item.kind !== "conversation") {
    return undefined;
  }

  return collectConversations(document.getText())
    .find((conversation) =>
      conversation.start === item.start && conversation.end === item.end
    );
}

function formatReviewPanelConversationLabel(
  status: ConversationStatus,
): string {
  switch (status) {
    case "open":
      return "Open conversation";
    case "wip":
      return "WIP conversation";
    case "handled":
      return "Handled conversation";
    case "resolved":
      return "Resolved conversation";
  }
}

function getReviewPanelConversationMessages(raw: string): ReviewPanelMessage[] {
  return getReviewLines(raw).map((line) => {
    const timestamp = line.timestamp
      ? formatReviewPanelTimestamp(line.timestamp)
      : undefined;
    return {
      role: line.marker === "@agent" ? "Agent" : "You",
      ...(timestamp
        ? { timestamp: timestamp.label, timestampTitle: timestamp.title }
        : {}),
      body: line.body,
    };
  });
}

function formatReviewPanelTimestamp(
  timestamp: string,
): { label: string; title: string } | undefined {
  const parsed = parseReviewTimestamp(timestamp);
  const title = formatTimestampForDisplay(parsed);
  if (!parsed || !title) {
    return undefined;
  }

  return {
    label: formatShortReviewPanelTimestamp(parsed),
    title,
  };
}

function formatShortReviewPanelTimestamp(timestamp: ReviewTimestamp): string {
  const localDate = new Date(Number(timestamp.unixSeconds) * 1000);
  const now = new Date();
  const time = [
    localDate.getHours(),
    localDate.getMinutes(),
    localDate.getSeconds(),
  ].map((value) => String(value).padStart(2, "0")).join(":");

  if (
    localDate.getFullYear() === now.getFullYear() &&
    localDate.getMonth() === now.getMonth() &&
    localDate.getDate() === now.getDate()
  ) {
    return time;
  }

  return `${localDate.getFullYear()}-${
    String(localDate.getMonth() + 1).padStart(2, "0")
  }-${String(localDate.getDate()).padStart(2, "0")} ${time}`;
}

function getReviewPanelAnnotationKind(raw: string): ReviewPanelItemKind {
  if (raw.startsWith("{++")) {
    return "addition";
  }

  if (raw.startsWith("{--")) {
    return "deletion";
  }

  if (raw.startsWith("{~~")) {
    return "substitution";
  }

  if (raw.startsWith("{==")) {
    return "highlight";
  }

  if (raw.startsWith("{>>")) {
    return "comment";
  }

  return "conversation";
}

function formatReviewPanelAnnotationLabel(kind: ReviewPanelItemKind): string {
  switch (kind) {
    case "addition":
      return "Addition";
    case "deletion":
      return "Deletion";
    case "substitution":
      return "Substitution";
    case "highlight":
      return "Highlight";
    case "comment":
      return "Comment";
    case "conversation":
      return "Conversation";
  }
}

function getReviewPanelAnnotationPayload(
  raw: string,
  kind: ReviewPanelItemKind,
): string {
  switch (kind) {
    case "addition":
    case "deletion":
    case "highlight":
      return getReviewAnnotationPayload(raw, 3, -3);
    case "comment":
      return getReviewAnnotationPayload(raw, 3, -3);
    case "substitution": {
      const contentStart = getReviewAnnotationPayloadStart(raw, 3);
      const separator = raw.indexOf("~>", contentStart);
      return separator >= 0
        ? `${raw.slice(contentStart, separator)} -> ${
          raw.slice(separator + 2, -3)
        }`
        : raw;
    }
    case "conversation":
      return getConversationContent(raw);
  }
}

function summarizeReviewPanelText(text: string): string {
  const summary = text.replace(/\s+/g, " ").trim();
  return summary.length <= 80 ? summary : `${summary.slice(0, 77)}...`;
}

function getReviewPanelHtml(
  items: ReviewPanelItem[],
  filter: ReviewPanelFilter,
): string {
  const serializedItems = JSON.stringify(items).replace(/</g, "\\u003c");
  const emptyText = filter === "all"
    ? "No review items."
    : `No ${filter} review items.`;
  const itemCards = items.length > 0
    ? items.map(renderReviewPanelItem).join("")
    : `<p class="empty">${escapeHtml(emptyText)}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --accent: var(--vscode-focusBorder);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --panel: var(--vscode-sideBar-background);
      --input: var(--vscode-input-background);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --secondary: var(--vscode-button-secondaryBackground);
      --secondary-fg: var(--vscode-button-secondaryForeground);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--panel);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .item {
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 12px;
      padding: 10px;
      background: var(--vscode-editor-background);
    }
    .item-header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .meta {
      color: var(--muted);
      font-weight: 600;
      min-width: 0;
    }
    .chip {
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      font-size: 11px;
      padding: 2px 6px;
      white-space: nowrap;
    }
    .message {
      border-left: 3px solid var(--accent);
      margin: 8px 0;
      padding: 8px 10px;
      background: var(--vscode-textBlockQuote-background);
    }
    .message-role {
      color: var(--muted);
      font-weight: 700;
      margin-bottom: 4px;
    }
    .message-timestamp {
      font-weight: 600;
    }
    .body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    textarea {
      width: 100%;
      min-height: 68px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px;
      padding: 8px;
      color: var(--vscode-input-foreground);
      background: var(--input);
      font-family: var(--vscode-font-family);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 8px;
    }
    button {
      border: 0;
      border-radius: 4px;
      padding: 5px 10px;
      color: var(--button-fg);
      background: var(--button);
      cursor: pointer;
      font: inherit;
    }
    button.secondary {
      color: var(--secondary-fg);
      background: var(--secondary);
    }
    .empty {
      color: var(--muted);
      margin: 8px 0;
    }
  </style>
</head>
<body>
  <main>
    ${itemCards}
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const items = ${serializedItems};
    document.addEventListener("click", (event) => {
      const interactive = event.target.closest("button, textarea");
      const card = event.target.closest(".item");
      const item = card ? items[Number(card.dataset.index)] : undefined;
      if (!interactive && item) {
        vscode.postMessage({ type: "reveal", item });
        return;
      }
      const target = event.target.closest("button");
      if (!target) {
        return;
      }
      const filter = target.dataset.filter;
      if (filter) {
        vscode.postMessage({ type: "filter", filter });
        return;
      }
      if (!item) {
        return;
      }
      const action = target.dataset.action;
      if (action === "ok") {
        vscode.postMessage({ type: "ok", item });
        return;
      }
      if (action === "reply") {
        const textarea = card.querySelector("textarea");
        vscode.postMessage({ type: "reply", item, body: textarea ? textarea.value : "" });
        return;
      }
      if (action === "delete") {
        vscode.postMessage({ type: "delete", item });
        return;
      }
      if (action === "apply" || action === "cancel") {
        vscode.postMessage({ type: "resolveAnnotation", item, resolution: action });
        return;
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!(event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
        return;
      }
      const textarea = event.target instanceof HTMLTextAreaElement ? event.target : undefined;
      if (!textarea) {
        return;
      }
      const card = textarea.closest(".item");
      const item = card ? items[Number(card.dataset.index)] : undefined;
      if (!item) {
        return;
      }
      event.preventDefault();
      vscode.postMessage({ type: "reply", item, body: textarea.value });
    });
  </script>
</body>
</html>`;
}

function renderReviewPanelItem(item: ReviewPanelItem, index: number): string {
  const messages = item.kind === "conversation"
    ? renderReviewPanelMessages(item.messages ?? [])
    : `<div class="message"><div class="body">${
      escapeHtml(item.summary)
    }</div></div>`;
  const actions = item.kind === "conversation"
    ? `
    <textarea aria-label="Reply to ${
      escapeAttribute(item.label)
    }" placeholder="Reply..."></textarea>
    <div class="actions">
      <button data-action="ok" class="secondary">OK</button>
      <button data-action="reply">Reply</button>
      <button data-action="delete" class="secondary">Delete thread</button>
    </div>
  `
    : `
    <div class="actions">
      <button data-action="cancel" class="secondary">Cancel</button>
      <button data-action="apply">Apply</button>
    </div>
  `;

  return `
    <section class="item" data-index="${index}">
      <div class="item-header">
        <div class="meta">#${index + 1} · LINE ${item.line}</div>
        <div class="chip">${escapeHtml(item.label)}</div>
      </div>
      ${messages}
      ${actions}
    </section>
  `;
}

function renderReviewPanelMessages(messages: ReviewPanelMessage[]): string {
  return messages.map((message) => `
    <div class="message">
      <div class="message-role">${renderReviewPanelMessageRole(message)}</div>
      <div class="body">${escapeHtml(message.body)}</div>
    </div>
  `).join("");
}

function renderReviewPanelMessageRole(message: ReviewPanelMessage): string {
  const role = escapeHtml(message.role);
  if (!message.timestamp) {
    return role;
  }

  return `${role} · <span class="message-timestamp" title="${
    escapeAttribute(message.timestampTitle ?? message.timestamp)
  }">${escapeHtml(message.timestamp)}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

async function approveAgentMessage(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createCompactQuickHumanNote(editor);
    return;
  }

  const trailingQuickReply = getTrailingQuickHumanReply(conversation);
  if (trailingQuickReply) {
    const position = editor.document.positionAt(
      conversation.start + trailingQuickReply.bodyStart,
    );
    editor.selection = new vscode.Selection(position, position);
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await appendInlineQuickHumanReply(editor, conversation);
    return;
  }

  await insertQuickHumanComment();
}

async function addHumanOk(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createCompactHumanNote(editor, "ok");
    return;
  }

  if (getTrailingHumanOkRemoval(conversation)) {
    return;
  }

  const trailingEmptyHumanReply = getTrailingEmptyHumanReply(conversation);
  if (trailingEmptyHumanReply) {
    await fillTrailingEmptyHumanReply(
      editor,
      conversation,
      trailingEmptyHumanReply,
      "ok",
    );
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await appendInlineHumanOk(editor, conversation);
    return;
  }

  await insertHumanComment("ok");
}

async function removeHumanOk(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);
  const removal = conversation
    ? getTrailingHumanOkRemoval(conversation)
    : undefined;

  if (!conversation || !removal) {
    return;
  }

  await editor.edit((edit) => {
    edit.delete(
      new vscode.Range(
        editor.document.positionAt(conversation.start + removal.start),
        editor.document.positionAt(conversation.start + removal.end),
      ),
    );
  });
}

async function addHumanComment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (conversation && isInlineConversation(conversation.raw)) {
    await expandInlineConversation(editor, conversation, "");
    return;
  }

  if (
    !conversation ||
    !isAtConversationReplyTarget(
      editor.document,
      conversation,
      editor.selection.active,
    )
  ) {
    await vscode.commands.executeCommand("editor.action.insertLineAfter");
    return;
  }

  await insertHumanComment("");
}

async function createCompactReviewNote(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createMultilineQuickHumanConversation(editor);
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await expandInlineConversation(editor, conversation, undefined);
    return;
  }

  await compactConversation(editor, conversation);
}

async function createCompactCriticMarkupReviewNote(): Promise<void> {
  await createCompactReviewNoteWithMarkers({
    open: CRITICMARKUP_REVIEW_OPEN,
    close: CRITICMARKUP_REVIEW_CLOSE,
  });
}

async function createCompactReviewNoteWithMarkers(
  markers: { open: string; close: string },
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createCompactHumanNote(editor, "", markers);
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await expandInlineConversation(editor, conversation, undefined);
    return;
  }

  await compactConversation(editor, conversation);
}

async function wrapCriticMarkupAnnotation(
  kind: CriticMarkupAnnotationKind,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const annotation = buildCriticMarkupAnnotation(kind, selectedText);

  await editor.edit((edit) => {
    edit.replace(selection, annotation.text);
  });

  const cursor = editor.document.positionAt(
    editor.document.offsetAt(selection.start) + annotation.cursorOffset,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function addTimestampToCurrentReviewElement(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const text = editor.document.getText();
  const offset = editor.document.offsetAt(editor.selection.active);
  const timestamp = getExplicitTimestampSuffix();
  const edit = findCurrentTimestampEdit(text, offset, timestamp);

  if (!edit) {
    void vscode.window.showInformationMessage(
      "No timestampable review element at cursor.",
    );
    return;
  }

  await editor.edit((builder) => {
    builder.replace(
      new vscode.Range(
        editor.document.positionAt(edit.start),
        editor.document.positionAt(edit.end),
      ),
      edit.text,
    );
  });
}

async function convertTimestampsInActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const format = getTimestampFormat();
  const targetFormat = format === "none" ? "compact" : format;
  const text = editor.document.getText();
  const updated = convertReviewTimestamps(text, targetFormat);

  if (updated === text) {
    void vscode.window.showInformationMessage(
      "No review timestamps to convert.",
    );
    return;
  }

  await editor.edit((builder) => {
    builder.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(text.length),
      ),
      updated,
    );
  });
}

function convertReviewTimestamps(
  text: string,
  format: TimestampFormat,
): string {
  return text.replace(REVIEW_TIMESTAMP_RE, (match: string, value: string) => {
    const timestamp = parseReviewTimestamp(value);
    if (!timestamp) {
      return match;
    }

    if (format === "iso") {
      const rendered = formatTimestampForDisplay(timestamp);
      return rendered ? `%${rendered}` : match;
    }

    if (format === "hangul") {
      return `%${
        encodeHangulTimestamp(timestamp.unixSeconds, timestamp.offsetMinutes)
      }`;
    }

    return `%${
      encodeCompactTimestamp(timestamp.unixSeconds, timestamp.offsetMinutes)
    }`;
  });
}

function findCurrentTimestampEdit(
  text: string,
  offset: number,
  timestamp: string,
): TimestampEdit | undefined {
  const conversationEdit = findCurrentConversationTimestampEdit(
    text,
    offset,
    timestamp,
  );
  if (conversationEdit) {
    return conversationEdit;
  }

  return findCurrentAnnotationTimestampEdit(text, offset, timestamp);
}

function findCurrentConversationTimestampEdit(
  text: string,
  offset: number,
  timestamp: string,
): TimestampEdit | undefined {
  const conversation = findCurrentConversation(
    collectConversations(text),
    offset,
  );
  if (!conversation) {
    return undefined;
  }

  const relativeOffset = offset - conversation.start;
  const line = getReviewLines(conversation.raw)
    .find((candidate) =>
      candidate.start <= relativeOffset && relativeOffset <= candidate.end
    );
  if (!line || line.timestamp) {
    return undefined;
  }

  const start = conversation.start + getReviewLineMarkerStart(line);
  const end = conversation.start + line.bodyStart;
  return {
    start,
    end,
    text: `${line.marker}${timestamp} `,
  };
}

function findCurrentAnnotationTimestampEdit(
  text: string,
  offset: number,
  timestamp: string,
): TimestampEdit | undefined {
  const annotation =
    [...text.matchAll(TIMESTAMPABLE_CRITICMARKUP_ANNOTATION_RE)]
      .map((match) => {
        const raw = match[0];
        const start = match.index ?? 0;
        return { raw, start, end: start + raw.length };
      })
      .filter((candidate) =>
        candidate.start <= offset && offset <= candidate.end
      )
      .sort((left, right) =>
        (left.end - left.start) - (right.end - right.start)
      )[0];

  if (!annotation || annotation.raw.slice(3).match(REVIEW_METADATA_PREFIX_RE)) {
    return undefined;
  }

  const insertionOffset = annotation.start + 3;
  return {
    start: insertionOffset,
    end: insertionOffset,
    text: `${timestamp}|`,
  };
}

async function cancelCriticMarkupAnnotation(): Promise<void> {
  await resolveCriticMarkupAnnotation("cancel");
}

async function applyCriticMarkupAnnotation(): Promise<void> {
  await resolveCriticMarkupAnnotation("apply");
}

async function resolveCriticMarkupAnnotation(
  resolution: CriticMarkupResolution,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const text = editor.document.getText();
  const offset = editor.document.offsetAt(editor.selection.active);
  const annotation = findCurrentCriticMarkupAnnotation(text, offset);

  if (!annotation) {
    void vscode.window.showInformationMessage(
      "No review annotation at cursor.",
    );
    return;
  }

  const replacement = resolution === "apply"
    ? annotation.apply
    : annotation.cancel;

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(annotation.start),
        editor.document.positionAt(annotation.end),
      ),
      replacement,
    );
  });

  const cursor = editor.document.positionAt(
    annotation.start + replacement.length,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function createReviewConversation(
  editor: vscode.TextEditor,
  body: string,
): Promise<void> {
  if (!editor.selection.isEmpty) {
    await createMarkedConversation(editor, body);
    return;
  }

  const line = editor.document.lineAt(editor.selection.active.line);
  await createHumanConversation(editor, body, line.range.end);
}

async function insertHumanComment(body: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createHumanConversation(editor, body);
    return;
  }

  const insertion = buildHumanCommentInsertion(conversation, body);
  const insertOffset = conversation.start + insertion.offset;
  const insertPosition = editor.document.positionAt(insertOffset);

  await editor.edit((edit) => {
    edit.insert(insertPosition, insertion.text);
  });

  if (body === "") {
    const position = editor.document.positionAt(
      insertOffset + insertion.cursorOffset,
    );
    editor.selection = new vscode.Selection(position, position);
  }
}

async function insertQuickHumanComment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createMultilineQuickHumanConversation(editor);
    return;
  }

  const insertion = buildQuickHumanCommentInsertion(conversation);
  const insertOffset = conversation.start + insertion.offset;
  const insertPosition = editor.document.positionAt(insertOffset);

  await editor.edit((edit) => {
    edit.insert(insertPosition, insertion.text);
  });

  const position = editor.document.positionAt(
    insertOffset + insertion.cursorOffset,
  );
  editor.selection = new vscode.Selection(position, position);
}

async function createMarkedConversation(
  editor: vscode.TextEditor,
  body: string,
): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (selectedText.length === 0) {
    await createHumanConversation(editor, body);
    return;
  }

  const endLine = editor.document.lineAt(selection.end.line);
  const bodyIndent = getReviewBodyIndent(endLine.text);
  const message = buildReviewMessage("@me", body);
  const messageLine = `${bodyIndent}${message.text}`;
  const markers = getPreferredReviewMarkers();
  const block =
    `{==${selectedText}==}${markers.open}\n${messageLine}\n${bodyIndent}${markers.close}`;
  const cursorOffset =
    `{==${selectedText}==}${markers.open}\n${bodyIndent}`.length +
    message.cursorOffset;

  await editor.edit((edit) => {
    edit.replace(selection, block);
  });

  if (body === "") {
    const cursor = editor.document.positionAt(
      editor.document.offsetAt(selection.start) + cursorOffset,
    );
    editor.selection = new vscode.Selection(cursor, cursor);
  }
}

async function createCompactHumanNote(
  editor: vscode.TextEditor,
  body: string,
  markers = getPreferredReviewMarkers(),
): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const message = buildReviewMessage("@me", body).text;
  const compactNote = `${markers.open} ${message} ${markers.close}`;
  const anchor = selectedText.length > 0 ? `{==${selectedText}==}` : "";
  const text = `${anchor}${compactNote}`;
  const cursorOffset = `${anchor}${markers.open} ${message}`.length;

  if (selectedText.length > 0) {
    await editor.edit((edit) => {
      edit.replace(selection, text);
    });
    const cursor = editor.document.positionAt(
      editor.document.offsetAt(selection.start) + cursorOffset,
    );
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const line = editor.document.lineAt(selection.active.line);
  const position = line.range.end;
  const prefix = markers.open === CRITICMARKUP_REVIEW_OPEN
    ? ""
    : line.text.length > 0 && !/[ \t]$/.test(line.text)
    ? " "
    : "";

  await editor.edit((edit) => {
    edit.insert(position, `${prefix}${compactNote}`);
  });

  const cursor = editor.document.positionAt(
    editor.document.offsetAt(position) + prefix.length + cursorOffset,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function createCompactQuickHumanNote(
  editor: vscode.TextEditor,
): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const markers = { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };
  const message = buildReviewMessage("@", "").text;
  const compactNote = `${markers.open} ${message} ${markers.close}`;
  const anchor = selectedText.length > 0 ? `{==${selectedText}==}` : "";
  const text = `${anchor}${compactNote}`;
  const cursorOffset = `${anchor}${markers.open} ${message}`.length;

  if (selectedText.length > 0) {
    await editor.edit((edit) => {
      edit.replace(selection, text);
    });
    const cursor = editor.document.positionAt(
      editor.document.offsetAt(selection.start) + cursorOffset,
    );
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const line = editor.document.lineAt(selection.active.line);
  const position = line.range.end;
  const prefix = line.text.length > 0 && !/[ \t]$/.test(line.text) ? " " : "";

  await editor.edit((edit) => {
    edit.insert(position, `${prefix}${compactNote}`);
  });

  const cursor = editor.document.positionAt(
    editor.document.offsetAt(position) + prefix.length + cursorOffset,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function createMultilineQuickHumanConversation(
  editor: vscode.TextEditor,
): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const markers = { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };

  if (selectedText.length > 0) {
    const endLine = editor.document.lineAt(selection.end.line);
    const bodyIndent = getReviewBodyIndent(endLine.text);
    const message = buildReviewMessage("@", "");
    const block =
      `{==${selectedText}==}${markers.open}\n${bodyIndent}${message.text}\n${bodyIndent}${markers.close}`;
    const cursorOffset =
      `{==${selectedText}==}${markers.open}\n${bodyIndent}`.length +
      message.cursorOffset;

    await editor.edit((edit) => {
      edit.replace(selection, block);
    });
    const cursor = editor.document.positionAt(
      editor.document.offsetAt(selection.start) + cursorOffset,
    );
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const line = editor.document.lineAt(selection.active.line);
  const lineText = line.text;
  const baseIndent = lineText.match(/^[ \t]*/)?.[0] ?? "";
  const bodyIndent = getReviewBodyIndent(lineText);
  const message = buildReviewMessage("@", "");
  const block =
    `${markers.open}\n${bodyIndent}${message.text}\n${bodyIndent}${markers.close}`;
  let cursorOffset = `${markers.open}\n${bodyIndent}`.length +
    message.cursorOffset;

  if (/^[ \t]*$/.test(lineText)) {
    const text = `${baseIndent}${block}`;
    cursorOffset += baseIndent.length;

    await editor.edit((edit) => {
      edit.replace(line.range, text);
    });
    const cursor = editor.document.positionAt(
      editor.document.offsetAt(line.range.start) + cursorOffset,
    );
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const position = line.range.end;
  const prefix = lineText.length > 0 && !/[ \t]$/.test(lineText) ? " " : "";
  const text = `${prefix}${block}`;
  cursorOffset += prefix.length;

  await editor.edit((edit) => {
    edit.insert(position, text);
  });

  const cursor = editor.document.positionAt(
    editor.document.offsetAt(position) + cursorOffset,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
}

function buildCriticMarkupAnnotation(
  kind: CriticMarkupAnnotationKind,
  selectedText: string,
): { text: string; cursorOffset: number } {
  const metadata = getReviewAnnotationMetadataPrefix();
  switch (kind) {
    case "addition":
      return {
        text: `{++${metadata}${selectedText}++}`,
        cursorOffset: `{++${metadata}${selectedText}`.length,
      };
    case "deletion":
      return {
        text: `{--${metadata}${selectedText}--}`,
        cursorOffset: `{--${metadata}${selectedText}`.length,
      };
    case "substitution":
      return {
        text: `{~~${metadata}${selectedText}~>~~}`,
        cursorOffset: selectedText.length > 0
          ? `{~~${metadata}${selectedText}~>`.length
          : `{~~${metadata}`.length,
      };
    case "highlight":
      return {
        text: `{==${metadata}${selectedText}==}`,
        cursorOffset: `{==${metadata}${selectedText}`.length,
      };
    case "comment":
      return {
        text: `{>>${metadata}${selectedText}<<}`,
        cursorOffset: `{>>${metadata}${selectedText}`.length,
      };
  }
}

function getReviewAnnotationMetadataPrefix(): string {
  const timestamp = getTimestampSuffix();
  return timestamp.length > 0 ? `${timestamp}|` : "";
}

function findCurrentCriticMarkupAnnotation(
  text: string,
  offset: number,
): { start: number; end: number; cancel: string; apply: string } | undefined {
  const candidates = [...text.matchAll(REVIEW_RESOLUTION_RE)]
    .map((match) => {
      const raw = match[0];
      const start = match.index ?? 0;
      return {
        start,
        end: start + raw.length,
        raw,
      };
    })
    .filter((annotation) =>
      annotation.start <= offset && offset <= annotation.end
    )
    .sort((left, right) => (left.end - left.start) - (right.end - right.start));

  for (const candidate of candidates) {
    const replacement = getCriticMarkupReplacement(candidate.raw);
    if (replacement) {
      return {
        start: candidate.start,
        end: candidate.end,
        ...replacement,
      };
    }
  }

  return undefined;
}

function getCriticMarkupReplacement(
  raw: string,
): { cancel: string; apply: string } | undefined {
  if (raw.startsWith("<!--") && raw.endsWith("-->")) {
    return collectReviewRoles(raw).length > 0
      ? { cancel: "", apply: "" }
      : undefined;
  }

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

  if (raw.startsWith("{??") && raw.endsWith("??}")) {
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

async function createHumanConversation(
  editor: vscode.TextEditor,
  body: string,
  position = editor.selection.active,
): Promise<void> {
  const line = editor.document.lineAt(position.line);
  const lineText = line.text;
  const baseIndent = lineText.match(/^[ \t]*/)?.[0] ?? "";
  const bodyIndent = getReviewBodyIndent(lineText);
  const message = buildReviewMessage("@me", body);
  const messageLine = `${bodyIndent}${message.text}`;
  const markers = getPreferredReviewMarkers();
  const block =
    `${markers.open}\n${messageLine}\n${bodyIndent}${markers.close}`;
  let cursorOffset = `${markers.open}\n${bodyIndent}`.length +
    message.cursorOffset;

  if (/^[ \t]*$/.test(lineText)) {
    const text = `${baseIndent}${block}`;
    cursorOffset += baseIndent.length;

    await editor.edit((edit) => {
      edit.replace(line.range, text);
    });

    if (body === "") {
      const cursor = editor.document.positionAt(
        editor.document.offsetAt(line.range.start) + cursorOffset,
      );
      editor.selection = new vscode.Selection(cursor, cursor);
    }

    return;
  }

  const beforeCursor = lineText.slice(0, position.character);
  const prefix = beforeCursor.length > 0 && !/[ \t]$/.test(beforeCursor)
    ? " "
    : "";
  const text = `${prefix}${block}`;
  cursorOffset += prefix.length;

  await editor.edit((edit) => {
    edit.insert(position, text);
  });

  if (body === "") {
    const cursor = editor.document.positionAt(
      editor.document.offsetAt(position) + cursorOffset,
    );
    editor.selection = new vscode.Selection(cursor, cursor);
  }
}

async function deleteConversation(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    void vscode.window.showInformationMessage(
      "No Markdown review conversation at cursor.",
    );
    return;
  }

  await editor.edit((edit) => {
    edit.delete(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(
          trimTrailingBlankLine(editor.document.getText(), conversation.end),
        ),
      ),
    );
  });
}

function moveToConversation(
  direction: "next" | "previous",
  filter: "all" | "pending" = "all",
): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText())
    .filter((conversation) => {
      if (filter === "all") {
        return true;
      }

      const status = getConversationStatus(conversation);
      return status === "open" || status === "wip";
    });
  const offset = editor.document.offsetAt(editor.selection.active);
  const target = direction === "next"
    ? conversations.find((conversation) => conversation.start > offset)
    : [...conversations]
      .reverse()
      .find((conversation) => conversation.end < offset);

  if (!target) {
    const scope = filter === "pending" ? " pending" : "";
    void vscode.window.showInformationMessage(
      `No ${direction}${scope} Markdown review conversation.`,
    );
    return;
  }

  const position = editor.document.positionAt(target.start);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

function moveToReviewBlock(direction: "next" | "previous"): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const blocks = collectReviewBlocks(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const target = direction === "next"
    ? blocks.find((block) => block.start > offset)
    : [...blocks]
      .reverse()
      .find((block) => block.end < offset);

  if (!target) {
    void vscode.window.showInformationMessage(
      `No ${direction} Markdown review block.`,
    );
    return;
  }

  const position = editor.document.positionAt(target.start);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

function collectConversations(text: string): Conversation[] {
  const conversations: Conversation[] = [];

  for (const match of text.matchAll(REVIEW_BLOCK_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const roles = collectReviewRoles(raw);

    if (roles.length > 0) {
      conversations.push({
        start,
        end: start + raw.length,
        raw,
        roles,
      });
    }
  }

  return conversations;
}

function collectReviewBlocks(text: string): ReviewBlock[] {
  const blocks = [
    ...collectConversations(text).map(({ start, end }) => ({ start, end })),
    ...[...text.matchAll(CRITICMARKUP_ANNOTATION_RE)].map((match) => {
      const start = match.index ?? 0;
      return {
        start,
        end: start + match[0].length,
      };
    }),
  ];
  const seen = new Set<string>();

  return blocks
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((block) => {
      const key = `${block.start}:${block.end}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
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

function findLastReviewLine(raw: string): ReviewLine | undefined {
  const reviewLines = getReviewLines(raw);
  return reviewLines[reviewLines.length - 1];
}

function getConversationStatus(conversation: Conversation): ConversationStatus {
  const lastLine = findLastReviewLine(conversation.raw);

  if (!lastLine || lastLine.marker === "@agent") {
    return "open";
  }

  const body = lastLine.body.trim();
  if (body.length === 0) {
    return "wip";
  }

  if (body.toLowerCase() === "ok") {
    return "resolved";
  }

  return "handled";
}

function buildHumanCommentInsertion(
  conversation: Conversation,
  body: string,
): { offset: number; text: string; cursorOffset: number } {
  const closeMarker = getConversationCloseMarker(conversation.raw);
  const closeIndex = conversation.raw.lastIndexOf(closeMarker);
  const beforeClose = conversation.raw.slice(0, closeIndex);
  const indent = findLastReviewLine(conversation.raw)?.indent ?? "";
  const closeLineStart = beforeClose.lastIndexOf("\n") + 1;
  const beforeCloseLine = conversation.raw.slice(closeLineStart, closeIndex);
  const message = buildReviewMessage("@me", body);
  const line = `${indent}${message.text}\n`;
  const cursorInLine = indent.length + message.cursorOffset;

  if (/^[ \t]*$/.test(beforeCloseLine)) {
    return {
      offset: closeLineStart,
      text: line,
      cursorOffset: cursorInLine,
    };
  }

  const prefix = beforeClose.endsWith("\n") ? "" : "\n";
  return {
    offset: closeIndex,
    text: `${prefix}${line}`,
    cursorOffset: prefix.length + cursorInLine,
  };
}

function buildQuickHumanCommentInsertion(
  conversation: Conversation,
): { offset: number; text: string; cursorOffset: number } {
  const closeMarker = getConversationCloseMarker(conversation.raw);
  const closeIndex = conversation.raw.lastIndexOf(closeMarker);
  const beforeClose = conversation.raw.slice(0, closeIndex);
  const indent = findLastReviewLine(conversation.raw)?.indent ?? "";
  const closeLineStart = beforeClose.lastIndexOf("\n") + 1;
  const beforeCloseLine = conversation.raw.slice(closeLineStart, closeIndex);
  const message = buildReviewMessage("@", "");
  const line = `${indent}${message.text}\n`;
  const cursorInLine = indent.length + message.cursorOffset;

  if (/^[ \t]*$/.test(beforeCloseLine)) {
    return {
      offset: closeLineStart,
      text: line,
      cursorOffset: cursorInLine,
    };
  }

  const prefix = beforeClose.endsWith("\n") ? "" : "\n";
  return {
    offset: closeIndex,
    text: `${prefix}${line}`,
    cursorOffset: prefix.length + cursorInLine,
  };
}

async function fillReviewLineAfterNativeNewline(
  event: vscode.TextDocumentChangeEvent,
  editor: vscode.TextEditor,
): Promise<void> {
  void event;
  void editor;
}

async function expandInlineConversation(
  editor: vscode.TextEditor,
  conversation: Conversation,
  humanBody: string | undefined,
): Promise<void> {
  const markers = getConversationMarkers(conversation.raw);
  const line = editor.document.lineAt(
    editor.document.positionAt(conversation.start).line,
  );
  const indent = getReviewBodyIndent(line.text);
  const reviewLines = getReviewLines(conversation.raw);
  const contentLines = reviewLines.length > 0
    ? reviewLines.map((reviewLine) =>
      `${indent}${formatReviewLine(conversation.raw, reviewLine)}`
    )
    : [`${indent}${getConversationContent(conversation.raw).trim()}`];
  const lines = [
    markers.open,
    ...contentLines,
  ];
  let cursorOffset: number | undefined = lines.join("\n").length;

  if (humanBody !== undefined) {
    const humanLine = `${indent}${buildReviewMessage("@me", humanBody).text}`;
    lines.push(humanLine);
    cursorOffset = lines.join("\n").length;
  }

  lines.push(`${indent}${markers.close}`);
  const replacement = lines.join("\n");

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(conversation.end),
      ),
      replacement,
    );
  });

  const cursor = editor.document.positionAt(conversation.start + cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function appendInlineHumanOk(
  editor: vscode.TextEditor,
  conversation: Conversation,
): Promise<void> {
  const closeStart = getConversationCloseStart(conversation.raw);
  const beforeClose = conversation.raw.slice(0, closeStart);
  const prefix = /[ \t\r\n]$/.test(beforeClose) ? "" : " ";
  const insertOffset = conversation.start + closeStart;
  const message = buildReviewMessage("@me", "ok");

  await editor.edit((edit) => {
    edit.insert(
      editor.document.positionAt(insertOffset),
      `${prefix}${message.text} `,
    );
  });
}

async function fillTrailingEmptyHumanReply(
  editor: vscode.TextEditor,
  conversation: Conversation,
  line: ReviewLine,
  body: string,
): Promise<void> {
  const markerStart = getReviewLineMarkerStart(line);
  const lineStart = conversation.start + markerStart;
  const lineEnd = conversation.start + line.end;
  const prefix = conversation.raw.slice(markerStart, line.bodyStart).trimEnd();
  const replacement = isInlineConversation(conversation.raw)
    ? `${prefix} ${body} `
    : `${prefix} ${body}`;
  const cursorOffset = lineStart + replacement.length;

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(lineStart),
        editor.document.positionAt(lineEnd),
      ),
      replacement,
    );
  });

  const cursor = editor.document.positionAt(cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function appendInlineQuickHumanReply(
  editor: vscode.TextEditor,
  conversation: Conversation,
): Promise<void> {
  const closeStart = getConversationCloseStart(conversation.raw);
  const beforeClose = conversation.raw.slice(0, closeStart);
  const prefix = /[ \t\r\n]$/.test(beforeClose) ? "" : " ";
  const insertOffset = conversation.start + closeStart;
  const message = buildReviewMessage("@", "");
  const insertion = `${prefix}${message.text} `;

  await editor.edit((edit) => {
    edit.insert(editor.document.positionAt(insertOffset), insertion);
  });

  const cursor = editor.document.positionAt(
    insertOffset + prefix.length + message.cursorOffset,
  );
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function compactConversation(
  editor: vscode.TextEditor,
  conversation: Conversation,
): Promise<void> {
  const markers = getConversationMarkers(conversation.raw);
  const messages = getReviewLines(conversation.raw)
    .map((line) => formatReviewLine(conversation.raw, line))
    .join(" ");
  const compact = `${markers.open} ${messages} ${markers.close}`;

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(conversation.end),
      ),
      compact,
    );
  });
}

function updateConversationDecorations(
  editor: vscode.TextEditor | undefined,
): void {
  if (!editor || editor.document.languageId !== "markdown") {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const contentDecorationsByStatus: Record<ConversationStatus, vscode.Range[]> =
    {
      open: [],
      wip: [],
      handled: [],
      resolved: [],
    };
  for (const conversation of conversations) {
    contentDecorationsByStatus[getConversationStatus(conversation)].push(
      ...getConversationContentRanges(editor.document, conversation),
    );
  }
  const markerDecorations = conversations.flatMap((conversation) =>
    getConversationMarkerRanges(editor.document, conversation)
  );
  const roleDecorations = conversations.flatMap((conversation) =>
    getConversationRoleRanges(editor.document, conversation)
  );
  const okDecorations = conversations.flatMap((conversation) =>
    getConversationOkRanges(editor.document, conversation)
  );
  const gutterDecorations = conversations.map((conversation) => {
    const line = editor.document.positionAt(conversation.start).line;
    return new vscode.Range(line, 0, line, 0);
  });

  openConversationDecorationType &&
    editor.setDecorations(
      openConversationDecorationType,
      contentDecorationsByStatus.open,
    );
  wipConversationDecorationType &&
    editor.setDecorations(
      wipConversationDecorationType,
      contentDecorationsByStatus.wip,
    );
  handledConversationDecorationType && editor.setDecorations(
    handledConversationDecorationType,
    contentDecorationsByStatus.handled,
  );
  resolvedConversationDecorationType && editor.setDecorations(
    resolvedConversationDecorationType,
    contentDecorationsByStatus.resolved,
  );
  markerDecorationType &&
    editor.setDecorations(markerDecorationType, markerDecorations);
  agentDecorationType && editor.setDecorations(
    agentDecorationType,
    roleDecorations.filter((decoration) => decoration.role === "agent").map((
      decoration,
    ) => decoration.range),
  );
  humanDecorationType && editor.setDecorations(
    humanDecorationType,
    roleDecorations.filter((decoration) => decoration.role === "me").map((
      decoration,
    ) => decoration.range),
  );
  quickHumanDecorationType && editor.setDecorations(
    quickHumanDecorationType,
    roleDecorations.filter((decoration) => decoration.role === "quick-me").map((
      decoration,
    ) => decoration.range),
  );
  okDecorationType && editor.setDecorations(okDecorationType, okDecorations);
  conversationGutterDecorationType &&
    editor.setDecorations(conversationGutterDecorationType, gutterDecorations);
}

function provideTimestampHover(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Hover | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);

  for (const match of text.matchAll(REVIEW_TIMESTAMP_RE)) {
    const timestamp = match[1];
    const markerStart = match.index ?? 0;
    const timestampStart = markerStart + 1;
    const timestampEnd = timestampStart + timestamp.length;
    if (offset < timestampStart || offset > timestampEnd) {
      continue;
    }

    const rendered = formatTimestampForDisplay(parseReviewTimestamp(timestamp));
    if (!rendered) {
      return undefined;
    }

    return new vscode.Hover(
      new vscode.MarkdownString(rendered),
      new vscode.Range(
        document.positionAt(timestampStart),
        document.positionAt(timestampEnd),
      ),
    );
  }

  return undefined;
}

function getConversationContentRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): vscode.Range[] {
  const { open: openMarker, close: closeMarker } = getConversationMarkers(
    conversation.raw,
  );
  const openEnd = openMarker.length;
  const closeStart = conversation.raw.lastIndexOf(closeMarker);

  if (closeStart < openEnd) {
    return [];
  }

  let contentStart = openEnd;
  const afterOpen = conversation.raw.slice(contentStart, closeStart);
  const markerOnlyOpeningLine = afterOpen.match(/^[ \t]*(?:\r?\n)/);
  const inlinePadding = afterOpen.match(/^[ \t]+/);
  if (markerOnlyOpeningLine) {
    contentStart += markerOnlyOpeningLine[0].length;
  } else if (inlinePadding) {
    contentStart += inlinePadding[0].length;
  }

  let contentEnd = closeStart;
  const closeLineStart = conversation.raw.lastIndexOf("\n", closeStart) + 1;
  if (/^[ \t]*$/.test(conversation.raw.slice(closeLineStart, closeStart))) {
    contentEnd = closeLineStart;
  }

  if (contentStart >= contentEnd) {
    return [];
  }

  return [
    new vscode.Range(
      document.positionAt(conversation.start + contentStart),
      document.positionAt(conversation.start + contentEnd),
    ),
  ];
}

function getConversationMarkerRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): vscode.Range[] {
  const { open: openMarker, close: closeMarker } = getConversationMarkers(
    conversation.raw,
  );
  const closeStart = conversation.raw.lastIndexOf(closeMarker);

  if (closeStart < openMarker.length) {
    return [];
  }

  return [
    new vscode.Range(
      document.positionAt(conversation.start),
      document.positionAt(conversation.start + openMarker.length),
    ),
    new vscode.Range(
      document.positionAt(conversation.start + closeStart),
      document.positionAt(conversation.start + closeStart + closeMarker.length),
    ),
  ];
}

function getConversationRoleRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): RoleRange[] {
  return getReviewLines(conversation.raw).map((line) => {
    const role = line.marker === "@agent"
      ? "agent"
      : line.marker === "@me"
      ? "me"
      : "quick-me";
    const start = conversation.start + getReviewLineMarkerStart(line);
    const end = conversation.start +
      getReviewLineMarkerEnd(conversation.raw, line);

    return {
      role,
      range: new vscode.Range(
        document.positionAt(start),
        document.positionAt(end),
      ),
    };
  });
}

function getConversationOkRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): vscode.Range[] {
  return getReviewLines(conversation.raw)
    .filter((line) =>
      (line.marker === "@me" || line.marker === "@") &&
      line.body.trim().toLowerCase() === "ok"
    )
    .map((line) => {
      const leadingWhitespaceLength = line.body.match(/^[ \t]*/)?.[0].length ??
        0;
      const okStart = conversation.start + line.bodyStart +
        leadingWhitespaceLength;
      const okEnd = okStart + line.body.trim().length;

      return new vscode.Range(
        document.positionAt(okStart),
        document.positionAt(okEnd),
      );
    });
}

function findCurrentConversation(
  conversations: Conversation[],
  offset: number,
): Conversation | undefined {
  return conversations.find((conversation) =>
    conversation.start <= offset && offset <= conversation.end
  );
}

function isAtConversationReplyTarget(
  document: vscode.TextDocument,
  conversation: Conversation,
  position: vscode.Position,
): boolean {
  const closeStart = getConversationCloseStart(conversation.raw);
  if (closeStart < 0) {
    return false;
  }

  const closeLine = document.positionAt(conversation.start + closeStart).line;
  if (position.line === closeLine) {
    return true;
  }

  const lastReviewLine = findLastReviewLine(conversation.raw);
  if (!lastReviewLine) {
    return false;
  }

  const lastReviewLineNumber =
    document.positionAt(conversation.start + lastReviewLine.start).line;
  if (position.line === lastReviewLineNumber) {
    return true;
  }

  const lastContentLineStart = getLastNonBlankContentLineStart(
    conversation.raw,
  );
  if (lastContentLineStart === undefined) {
    return false;
  }

  const lastContentLineNumber =
    document.positionAt(conversation.start + lastContentLineStart).line;
  return position.line === lastContentLineNumber;
}

function trimTrailingBlankLine(text: string, offset: number): number {
  const trailingBlankLine = text.slice(offset).match(/^(?:[ \t]*\r?\n){1,2}/);
  return trailingBlankLine ? offset + trailingBlankLine[0].length : offset;
}

function isListItemLine(line: string): boolean {
  return /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line);
}

function getReviewBodyIndent(line: string): string {
  const baseIndent = line.match(/^[ \t]*/)?.[0] ?? "";
  return isListItemLine(line) ? `${baseIndent}  ` : baseIndent;
}

function getConversationCloseMarker(raw: string): string {
  return getConversationMarkers(raw).close;
}

function getConversationCloseStart(raw: string): number {
  return raw.lastIndexOf(getConversationCloseMarker(raw));
}

function getReviewLines(raw: string): ReviewLine[] {
  const markers = getConversationMarkers(raw);
  const content = getConversationContent(raw);
  const baseOffset = markers.open.length;
  const markerMatches = [...content.matchAll(REVIEW_MARKER_RE)]
    .filter((match) =>
      !isEscapedAt(content, (match.index ?? 0) + match[1].length)
    )
    .map((match) => {
      const markerStart = (match.index ?? 0) + match[1].length;
      return {
        markerStart,
        marker: match[2] as ReviewLine["marker"],
        timestamp: match[3],
      };
    });

  return markerMatches.map((match, index) => {
    const nextMarkerStart = markerMatches[index + 1]?.markerStart ??
      content.length;
    const lineStart = content.lastIndexOf("\n", match.markerStart - 1) + 1;
    const leadingText = content.slice(lineStart, match.markerStart);
    const indent = /^[ \t]*$/.test(leadingText) ? leadingText : "";
    const start = indent.length > 0 ? lineStart : match.markerStart;
    const markerEnd = match.markerStart + match.marker.length +
      (match.timestamp ? match.timestamp.length + 1 : 0);
    const bodyStart = getReviewBodyStart(content, markerEnd);
    const bodyEnd = trimReviewBodyEnd(content, bodyStart, nextMarkerStart);

    return {
      start: baseOffset + start,
      end: baseOffset + bodyEnd,
      indent,
      marker: match.marker,
      body: content.slice(bodyStart, bodyEnd),
      bodyStart: baseOffset + bodyStart,
      ...(match.timestamp ? { timestamp: match.timestamp } : {}),
    };
  });
}

function isEscapedAt(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function getReviewBodyStart(content: string, offset: number): number {
  let cursor = offset;

  while (content[cursor] === " " || content[cursor] === "\t") {
    cursor += 1;
  }

  if (content[cursor] === ":") {
    cursor += 1;
    while (content[cursor] === " " || content[cursor] === "\t") {
      cursor += 1;
    }
  }

  return cursor;
}

function trimReviewBodyEnd(
  content: string,
  bodyStart: number,
  bodyEnd: number,
): number {
  let cursor = bodyEnd;

  while (cursor > bodyStart && /[ \t\r\n]/.test(content[cursor - 1])) {
    cursor -= 1;
  }

  return cursor;
}

function getReviewLineMarkerStart(line: ReviewLine): number {
  return line.start + line.indent.length;
}

function getReviewLineMarkerEnd(raw: string, line: ReviewLine): number {
  if (line.marker === "@") {
    return getReviewLineMarkerStart(line) + line.marker.length;
  }

  let end = getReviewLineMarkerStart(line) + line.marker.length;
  while (raw[end] === " " || raw[end] === "\t") {
    end += 1;
  }

  return raw[end] === ":"
    ? end + 1
    : getReviewLineMarkerStart(line) + line.marker.length;
}

function getLastNonBlankContentLineStart(raw: string): number | undefined {
  const closeStart = getConversationCloseStart(raw);
  if (closeStart < 0) {
    return undefined;
  }

  let end = closeStart;
  while (end > 0 && /[ \t\r\n]/.test(raw[end - 1])) {
    end -= 1;
  }

  if (end <= getConversationMarkers(raw).open.length) {
    return undefined;
  }

  return raw.lastIndexOf("\n", end - 1) + 1;
}

function getTrailingHumanOkRemoval(
  conversation: Conversation,
): { start: number; end: number } | undefined {
  const lastLine = findLastReviewLine(conversation.raw);
  if (
    !lastLine ||
    (lastLine.marker !== "@" && lastLine.marker !== "@me") ||
    lastLine.body.trim().toLowerCase() !== "ok"
  ) {
    return undefined;
  }

  let start = lastLine.start;
  let end = lastLine.end;

  if (
    isInlineConversation(conversation.raw) && start > 0 &&
    /[ \t]/.test(conversation.raw[start - 1])
  ) {
    start -= 1;
  }

  if (conversation.raw[end] === "\r" && conversation.raw[end + 1] === "\n") {
    end += 2;
  } else if (conversation.raw[end] === "\n") {
    end += 1;
  } else if (start > 0 && conversation.raw[start - 1] === "\n") {
    start -= conversation.raw[start - 2] === "\r" ? 2 : 1;
  }

  return { start, end };
}

function getTrailingQuickHumanReply(
  conversation: Conversation,
): ReviewLine | undefined {
  const lastLine = findLastReviewLine(conversation.raw);
  return lastLine?.marker === "@" && lastLine.body.trim() === ""
    ? lastLine
    : undefined;
}

function getTrailingEmptyHumanReply(
  conversation: Conversation,
): ReviewLine | undefined {
  const lastLine = findLastReviewLine(conversation.raw);
  return lastLine && (lastLine.marker === "@" || lastLine.marker === "@me") &&
      lastLine.body.trim() === ""
    ? lastLine
    : undefined;
}

function formatReviewLine(raw: string, line: ReviewLine): string {
  const markerStart = getReviewLineMarkerStart(line);
  const prefix = raw.slice(markerStart, line.bodyStart).trimEnd();
  const body = line.body.trimEnd();
  return body.length > 0 ? `${prefix} ${body}` : `${prefix} `;
}

function getPreferredCommentSyntax(): "html" | "custom" {
  const value = vscode.workspace.getConfiguration("dzMdReview").get<string>(
    "commentSyntax",
  );
  return value === "custom" || value === "criticmarkup-like"
    ? "custom"
    : "html";
}

function getPreferredReviewMarkers(): { open: string; close: string } {
  return getPreferredCommentSyntax() === "custom"
    ? { open: CRITICMARKUP_REVIEW_OPEN, close: CRITICMARKUP_REVIEW_CLOSE }
    : { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };
}

function buildReviewMessage(
  marker: ReviewLine["marker"],
  body: string,
): { cursorOffset: number; text: string } {
  const timestamp = getTimestampSuffix();
  const prefix = `${marker}${timestamp}`;
  const text = body === "" ? `${prefix} ` : `${prefix} ${body}`;

  return {
    cursorOffset: `${prefix} `.length,
    text,
  };
}

function getTimestampSuffix(): string {
  const format = getTimestampFormat();
  return format === "none" ? "" : `%${encodeTimestamp(new Date(), format)}`;
}

function getExplicitTimestampSuffix(): string {
  const format = getTimestampFormat();
  return `%${
    encodeTimestamp(new Date(), format === "none" ? "compact" : format)
  }`;
}

function getTimestampFormat(): ExtensionTimestampFormat {
  const value = vscode.workspace.getConfiguration("dzMdReview").get<string>(
    "timestampFormat",
  );
  if (
    value === "iso" || value === "compact" || value === "hangul" ||
    value === "none"
  ) {
    return value;
  }

  return "compact";
}

function getConversationMarkers(raw: string): { open: string; close: string } {
  if (raw.startsWith(CRITICMARKUP_REVIEW_OPEN)) {
    return { open: CRITICMARKUP_REVIEW_OPEN, close: CRITICMARKUP_REVIEW_CLOSE };
  }

  return { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };
}

function getConversationContent(raw: string): string {
  const markers = getConversationMarkers(raw);
  const closeStart = raw.lastIndexOf(markers.close);
  return closeStart > markers.open.length
    ? raw.slice(markers.open.length, closeStart)
    : "";
}

function isInlineConversation(raw: string): boolean {
  return !isMultilineConversation(raw);
}

function isMultilineConversation(raw: string): boolean {
  return /^(?:<!--|\{\?\?)[ \t]*\r?\n/.test(raw);
}
