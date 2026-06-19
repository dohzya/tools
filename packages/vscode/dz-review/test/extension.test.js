const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function offsetAt(text, position) {
  const lines = text.split("\n");
  return lines.slice(0, position.line).join("\n").length +
    (position.line === 0 ? 0 : 1) +
    position.character;
}

function positionAt(text, offset) {
  let remaining = offset;
  const lines = text.split("\n");

  for (let line = 0; line < lines.length; line += 1) {
    if (remaining <= lines[line].length) {
      return { line, character: remaining };
    }

    remaining -= lines[line].length + 1;
  }

  return { line: lines.length - 1, character: lines.at(-1).length };
}

function createHarness() {
  let commentSyntax = "html";
  let timestampFormat = "none";
  let deferSetContext = false;
  let quickPickLabel;
  const quickPickCalls = [];
  const executedCommands = [];
  const executedCommandCalls = [];
  const pendingSetContextResolutions = [];
  const webviewViewProviders = [];
  const statusBarCalls = [];
  const mockVscode = {
    window: {
      activeTextEditor: undefined,
      createTextEditorDecorationType() {
        return {};
      },
      createStatusBarItem() {
        return {
          command: undefined,
          text: "",
          tooltip: "",
          dispose() {},
          hide() {
            statusBarCalls.push("hide");
          },
          show() {
            statusBarCalls.push("show");
          },
        };
      },
      registerWebviewViewProvider(id, provider) {
        const registration = {
          id,
          provider,
          dispose() {},
        };
        webviewViewProviders.push(registration);
        return registration;
      },
      onDidChangeActiveTextEditor() {
        return {};
      },
      showQuickPick(items, options) {
        quickPickCalls.push({ items, options });
        return Promise.resolve(
          items.find((item) => item.label === quickPickLabel) ?? items[0],
        );
      },
      showInformationMessage() {},
    },
    workspace: {
      getConfiguration() {
        return {
          get(key) {
            if (key === "timestampFormat") {
              return timestampFormat;
            }

            return commentSyntax;
          },
        };
      },
      onDidChangeTextDocument() {
        return {};
      },
    },
    languages: {
      registerHoverProvider() {
        return {};
      },
    },
    commands: {
      registerCommand() {
        return {};
      },
      executeCommand(command, ...args) {
        executedCommands.push(command);
        executedCommandCalls.push([command, ...args]);
        if (command === "setContext" && deferSetContext) {
          return new Promise((resolve) => {
            pendingSetContextResolutions.push(resolve);
          });
        }

        return Promise.resolve();
      },
    },
    EventEmitter: class EventEmitter {
      constructor() {
        this.listeners = [];
        this.event = (listener) => {
          this.listeners.push(listener);
          return { dispose() {} };
        };
      }

      fire(value) {
        for (const listener of this.listeners) {
          listener(value);
        }
      }

      dispose() {}
    },
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    TreeItem: class TreeItem {
      constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
      }
    },
    TreeItemCollapsibleState: {
      None: 0,
    },
    Uri: {
      joinPath() {
        return "icon";
      },
    },
    OverviewRulerLane: {
      Right: 1,
    },
    StatusBarAlignment: {
      Left: 1,
    },
    Range: class Range {
      constructor(start, endOrStartCharacter, endLine, endCharacter) {
        if (typeof endOrStartCharacter === "number") {
          this.start = { line: start, character: endOrStartCharacter };
          this.end = { line: endLine, character: endCharacter };
        } else {
          this.start = start;
          this.end = endOrStartCharacter;
        }
      }
    },
    MarkdownString: class MarkdownString {
      constructor(value) {
        this.value = value;
      }
    },
    Hover: class Hover {
      constructor(contents, range) {
        this.contents = contents;
        this.range = range;
      }
    },
    Selection: class Selection {
      constructor(start, end) {
        this.start = start;
        this.end = end;
        this.active = end;
        this.isEmpty = start.line === end.line &&
          start.character === end.character;
      }
    },
    TextEditorRevealType: {
      InCenterIfOutsideViewport: 1,
    },
  };
  const module = { exports: {} };
  const source =
    fs.readFileSync(path.join(__dirname, "..", "out", "extension.js"), "utf8") +
    "\nmodule.exports.__test = { activate: module.exports.activate, addHumanComment, addHumanOk, addTimestampToCurrentReviewElement, applyCriticMarkupAnnotation, approveAgentMessage, cancelCriticMarkupAnnotation, collectConversations, collectReviewPanelItems, convertTimestampsInActiveEditor, createCompactCriticMarkupReviewNote, createCompactReviewNote, createReviewConversation, exitReviewMode, fillReviewLineAfterNativeNewline, filterReviewItems, getConversationContentRanges, getConversationMarkerRanges, getConversationOkRanges, getConversationRoleRanges, getConversationStatus, moveToConversation, moveToReviewBlock, provideTimestampHover, removeHumanOk, revealReviewPanelItem, showAllReviewItems, showHandledReviewItems, showOpenReviewItems, showPendingReviewItems, showResolvedReviewItems, showUnresolvedReviewItems, showWipReviewItems, toggleReviewMode, wrapCriticMarkupAnnotation };";

  vm.runInNewContext(source, {
    require(name) {
      if (name === "vscode") {
        return mockVscode;
      }

      if (name === "./timestamp") {
        return require("../out/timestamp.js");
      }

      return require(name);
    },
    module,
    exports: module.exports,
  });

  function createEditor(text, start, end = start) {
    const editor = {
      selection: new mockVscode.Selection(start, end),
      document: {
        languageId: "markdown",
        text,
        get lineCount() {
          return this.text.split("\n").length;
        },
        getText(range) {
          if (!range) {
            return this.text;
          }

          return this.text.slice(
            offsetAt(this.text, range.start),
            offsetAt(this.text, range.end),
          );
        },
        lineAt(line) {
          const lines = this.text.split("\n");
          return {
            text: lines[line],
            range: {
              start: { line, character: 0 },
              end: { line, character: lines[line].length },
            },
          };
        },
        offsetAt(position) {
          return offsetAt(this.text, position);
        },
        positionAt(offset) {
          return positionAt(this.text, offset);
        },
      },
      async edit(callback) {
        const edits = [];
        callback({
          insert: (position, value) =>
            edits.push({ type: "insert", position, value }),
          replace: (range, value) =>
            edits.push({ type: "replace", range, value }),
          delete: (range) => edits.push({ type: "replace", range, value: "" }),
        });

        for (const edit of edits.reverse()) {
          if (edit.type === "insert") {
            const offset = offsetAt(this.document.text, edit.position);
            this.document.text = this.document.text.slice(0, offset) +
              edit.value +
              this.document.text.slice(offset);
          } else {
            const startOffset = offsetAt(this.document.text, edit.range.start);
            const endOffset = offsetAt(this.document.text, edit.range.end);
            this.document.text = this.document.text.slice(0, startOffset) +
              edit.value +
              this.document.text.slice(endOffset);
          }
        }
      },
      revealedRanges: [],
      revealRange(range, revealType) {
        this.revealedRanges.push({ range, revealType });
      },
      setDecorations() {},
    };

    mockVscode.window.activeTextEditor = editor;
    return editor;
  }

  function createWebviewView() {
    let messageListener;
    return {
      webview: {
        html: "",
        options: undefined,
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
      },
      async postMessageFromWebview(message) {
        await messageListener(message);
      },
    };
  }

  return {
    api: module.exports.__test,
    createEditor,
    createWebviewView,
    executedCommandCalls,
    executedCommands,
    quickPickCalls,
    resolveSetContexts() {
      for (const resolve of pendingSetContextResolutions.splice(0)) {
        resolve();
      }
    },
    setCommentSyntax(value) {
      commentSyntax = value;
    },
    setTimestampFormat(value) {
      timestampFormat = value;
    },
    setQuickPickLabel(value) {
      quickPickLabel = value;
    },
    setDeferSetContext(value) {
      deferSetContext = value;
    },
    statusBarCalls,
    webviewViewProviders,
  };
}

test("review mode toggles the VS Code keybinding context", async () => {
  const harness = createHarness();

  await harness.api.toggleReviewMode();
  await harness.api.toggleReviewMode();

  assert.deepEqual(harness.executedCommandCalls, [
    ["setContext", "dzMdReview.inReviewMode", true],
    ["setContext", "dzMdReview.inReviewMode", false],
  ]);
});

test("review mode hides its status bar item immediately on exit", async () => {
  const harness = createHarness();

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  await Promise.resolve();
  harness.statusBarCalls.length = 0;

  await harness.api.toggleReviewMode();
  assert.deepEqual(harness.statusBarCalls, ["show"]);

  harness.setDeferSetContext(true);
  const exitPromise = harness.api.exitReviewMode();
  await Promise.resolve();

  assert.deepEqual(harness.statusBarCalls, ["show", "hide"]);

  harness.resolveSetContexts();
  await exitPromise;
});

test("review panel webview lists review items from the active Markdown editor", async () => {
  const harness = createHarness();
  harness.createEditor(
    [
      "# Draft",
      "<!-- @agent%2026-06-16T17:35:35+02:00 open issue -->",
      "{++new text++}",
      "{--old text--}",
      "{?? plain discussion ??}",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();

  assert.equal(harness.webviewViewProviders[0].id, "dzMdReview.reviewItems");
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);

  assert.match(view.webview.html, /Open conversation/);
  assert.match(
    view.webview.html,
    /Agent · <span class="message-timestamp" title="2026-06-16T17:35:35\+02:00">2026-06-16 17:35:35<\/span>/,
  );
  assert.match(view.webview.html, /new text/);
  assert.match(view.webview.html, /old text/);
  assert.match(view.webview.html, /plain discussion/);
  assert.match(view.webview.html, /<textarea/);
  assert.match(view.webview.html, /data-action="ok"/);
  assert.match(view.webview.html, /data-action="reply"/);
  assert.doesNotMatch(view.webview.html, /data-action="reveal"/);
  assert.doesNotMatch(view.webview.html, /data-filter="all"/);
  assert.doesNotMatch(view.webview.html, /data-filter="pending"/);
  assert.match(view.webview.html, /closest\("button, textarea"\)/);
  assert.match(view.webview.html, /addEventListener\("keydown"/);
  assert.match(
    view.webview.html,
    /event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/,
  );
  assert.match(
    view.webview.html,
    /vscode\.postMessage\(\{ type: "reveal", item \}\)/,
  );
});

test("review panel webview lists items with hangul timestamps", async () => {
  const harness = createHarness();
  harness.createEditor(
    [
      "# Draft",
      "<!-- @agent%\uada8\ub22d\ub147\uac78 open issue -->",
      "{++%\uada8\ub22d\ub147\uac78|new text++}",
      "{++%\uada8\ub22f\uaeff\uac78|foo++}",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);

  assert.match(view.webview.html, /Open conversation/);
  assert.match(
    view.webview.html,
    /Agent · <span class="message-timestamp" title="2026-06-16T17:35:35\+02:00">2026-06-16 17:35:35<\/span>/,
  );
  assert.match(view.webview.html, /new text/);
  assert.match(view.webview.html, /foo/);
  assert.doesNotMatch(view.webview.html, /%\uada8\ub22d\ub147\uac78\|new text/);
  assert.doesNotMatch(view.webview.html, /%\uada8\ub22f\uaeff\uac78\|foo/);
});

test("review panel webview supports review status filters", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    [
      "# Draft",
      "<!-- @agent open issue -->",
      "<!-- @me handled issue -->",
      "<!-- @me ok -->",
      "<!--",
      "@agent unfinished issue",
      "@me ",
      "-->",
      "{++new text++}",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);

  const labelsFor = (filter) =>
    Array.from(
      harness.api.collectReviewPanelItems(editor.document, filter),
      (item) => item.label,
    );

  assert.deepEqual(labelsFor("all"), [
    "Open conversation",
    "Handled conversation",
    "Resolved conversation",
    "WIP conversation",
    "Addition",
  ]);
  assert.deepEqual(labelsFor("unresolved"), [
    "Open conversation",
    "Handled conversation",
    "WIP conversation",
    "Addition",
  ]);
  assert.deepEqual(labelsFor("pending"), [
    "Open conversation",
    "WIP conversation",
    "Addition",
  ]);
  assert.deepEqual(labelsFor("open"), ["Open conversation"]);
  assert.deepEqual(labelsFor("wip"), ["WIP conversation"]);
  assert.deepEqual(labelsFor("handled"), ["Handled conversation"]);
  assert.deepEqual(labelsFor("resolved"), ["Resolved conversation"]);

  assert.equal(view.description, "unresolved");
  assert.match(view.webview.html, /Open conversation/);
  assert.match(view.webview.html, /Handled conversation/);
  assert.match(view.webview.html, /WIP conversation/);
  assert.match(view.webview.html, /new text/);
  assert.doesNotMatch(view.webview.html, /Resolved conversation/);
  assert.deepEqual(
    harness.executedCommandCalls.find((call) => call[0] === "setContext"),
    [
      "setContext",
      "dzMdReview.reviewItemsFilter",
      "unresolved",
    ],
  );

  await harness.api.showPendingReviewItems();

  assert.equal(view.description, "pending");
  assert.match(view.webview.html, /Open conversation/);
  assert.match(view.webview.html, /WIP conversation/);
  assert.match(view.webview.html, /new text/);
  assert.doesNotMatch(view.webview.html, /Handled conversation/);
  assert.doesNotMatch(view.webview.html, /Resolved conversation/);
  assert.deepEqual(harness.executedCommandCalls.at(-1), [
    "setContext",
    "dzMdReview.reviewItemsFilter",
    "pending",
  ]);

  await harness.api.showResolvedReviewItems();

  assert.equal(view.description, "resolved");
  assert.match(view.webview.html, /Resolved conversation/);
  assert.doesNotMatch(view.webview.html, /Open conversation/);
  assert.doesNotMatch(view.webview.html, /WIP conversation/);
  assert.doesNotMatch(view.webview.html, /new text/);
  assert.deepEqual(harness.executedCommandCalls.at(-1), [
    "setContext",
    "dzMdReview.reviewItemsFilter",
    "resolved",
  ]);

  await harness.api.showAllReviewItems();

  assert.equal(view.description, undefined);
  assert.match(view.webview.html, /Open conversation/);
  assert.match(view.webview.html, /Handled conversation/);
  assert.match(view.webview.html, /Resolved conversation/);
  assert.deepEqual(harness.executedCommandCalls.at(-1), [
    "setContext",
    "dzMdReview.reviewItemsFilter",
    "all",
  ]);
});

test("review panel filter command prompts for a status filter", async () => {
  const harness = createHarness();
  harness.createEditor(
    [
      "# Draft",
      "<!-- @agent open issue -->",
      "<!-- @me handled issue -->",
      "<!-- @me ok -->",
    ].join("\n"),
    { line: 0, character: 0 },
  );
  harness.setQuickPickLabel("Handled");

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);

  await harness.api.filterReviewItems();

  assert.deepEqual(
    Array.from(harness.quickPickCalls[0].items, (item) => item.label),
    [
      "All",
      "Unresolved",
      "Pending",
      "Open",
      "WIP",
      "Handled",
      "Resolved",
    ],
  );
  assert.equal(view.description, "handled");
  assert.match(view.webview.html, /Handled conversation/);
  assert.doesNotMatch(view.webview.html, /Open conversation/);
  assert.doesNotMatch(view.webview.html, /Resolved conversation/);
});

test("review panel webview can reply to a conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    [
      "# Draft",
      "<!--",
      "@agent open issue",
      "-->",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = harness.api.collectReviewPanelItems(editor.document);

  await view.postMessageFromWebview({
    type: "reply",
    item: conversation,
    body: "ça marche",
  });

  assert.equal(
    editor.document.text,
    [
      "# Draft",
      "<!--",
      "@agent open issue",
      "@me ça marche",
      "-->",
    ].join("\n"),
  );
  assert.match(view.webview.html, /Handled conversation/);
});

test("review panel webview can mark a conversation ok", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    [
      "# Draft",
      "<!--",
      "@agent open issue",
      "-->",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = harness.api.collectReviewPanelItems(editor.document);

  await view.postMessageFromWebview({
    type: "ok",
    item: conversation,
  });

  assert.equal(
    editor.document.text,
    [
      "# Draft",
      "<!--",
      "@agent open issue",
      "@me ok",
      "-->",
    ].join("\n"),
  );
  assert.match(view.webview.html, /No unresolved review items/);
  assert.doesNotMatch(view.webview.html, /Resolved conversation/);
});

test("review panel webview can delete a conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    [
      "# Draft",
      "<!-- @agent open issue -->",
      "After",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = harness.api.collectReviewPanelItems(editor.document);

  await view.postMessageFromWebview({
    type: "delete",
    item: conversation,
  });

  assert.equal(editor.document.text, "# Draft\nAfter");
  assert.doesNotMatch(view.webview.html, /open issue/);
});

test("review panel webview can resolve annotations", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "Before {++new text++} after {--old text--}",
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const view = harness.createWebviewView();
  harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [addition, deletion] = harness.api.collectReviewPanelItems(
    editor.document,
  );

  await view.postMessageFromWebview({
    type: "resolveAnnotation",
    item: addition,
    resolution: "apply",
  });
  assert.equal(editor.document.text, "Before new text after {--old text--}");

  const [remainingDeletion] = harness.api.collectReviewPanelItems(
    editor.document,
  );
  await view.postMessageFromWebview({
    type: "resolveAnnotation",
    item: remainingDeletion,
    resolution: "cancel",
  });
  assert.equal(editor.document.text, "Before new text after old text");
});

test("review panel reveal command moves the active editor to the selected item", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    [
      "# Draft",
      "<!-- @agent open issue -->",
      "{++new text++}",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  const [conversation] = harness.api.collectReviewPanelItems(editor.document);

  await harness.api.revealReviewPanelItem(conversation);

  assert.deepEqual(editor.selection.active, { line: 1, character: 0 });
  assert.deepEqual(
    editor.revealedRanges.map(({ range, revealType }) => ({
      start: range.start,
      end: range.end,
      revealType,
    })),
    [{
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
      revealType: 1,
    }],
  );
});

test("creates an HTML review conversation for selected text and places the cursor after @me", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("html");
  const editor = harness.createEditor(
    "foo bar baz",
    { line: 0, character: 4 },
    { line: 0, character: 7 },
  );

  await harness.api.createReviewConversation(editor, "");

  assert.equal(editor.document.text, "foo {==bar==}<!--\n@me \n--> baz");
  assert.deepEqual(editor.selection.active, { line: 1, character: 4 });
});

test("creates a custom review conversation for selected text", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor(
    "foo bar baz",
    { line: 0, character: 4 },
    { line: 0, character: 7 },
  );

  await harness.api.createReviewConversation(editor, "");

  assert.equal(editor.document.text, "foo {==bar==}{??\n@me \n??} baz");
  assert.deepEqual(editor.selection.active, { line: 1, character: 4 });
});

test("creates review messages with compact timestamps when configured", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor(
    "foo bar baz",
    { line: 0, character: 4 },
    { line: 0, character: 7 },
  );

  await harness.api.createReviewConversation(editor, "");

  assert.match(
    editor.document.text,
    /^foo \{==bar==\}<!--\n@me%[0-9A-Za-z]{8} \n--> baz$/,
  );
});

test("creates review messages with hangul timestamps when configured", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("hangul");
  const editor = harness.createEditor(
    "foo bar baz",
    { line: 0, character: 4 },
    { line: 0, character: 7 },
  );

  await harness.api.createReviewConversation(editor, "");

  assert.match(
    editor.document.text,
    /^foo \{==bar==\}<!--\n@me%[\uac00-\ub3ff]{4} \n--> baz$/,
  );
});

test("shows readable hover text for hangul timestamps", () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "<!-- @agent%\uada8\ub22d\ub147\uac78 note -->",
    { line: 0, character: 13 },
  );

  const hover = harness.api.provideTimestampHover(editor.document, {
    line: 0,
    character: 16,
  });

  assert.equal(hover.contents.value, "2026-06-16T17:35:35+02:00");
});

test("shows readable hover text for compact timestamps", () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "<!-- @agent%1WzvP91W note -->",
    { line: 0, character: 13 },
  );

  const hover = harness.api.provideTimestampHover(editor.document, {
    line: 0,
    character: 16,
  });

  assert.equal(hover.contents.value, "2026-06-16T17:35:35+02:00");
});

test("cmd+enter expands a compact inline note and adds @me", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo {?? @agent note inline ??} baz", {
    line: 0,
    character: 8,
  });

  await harness.api.addHumanComment();

  assert.equal(
    editor.document.text,
    "foo {??\n@agent note inline\n@me \n??} baz",
  );
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+enter expands a compact HTML note and adds @me", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo <!-- @agent note inline --> baz", {
    line: 0,
    character: 9,
  });

  await harness.api.addHumanComment();

  assert.equal(
    editor.document.text,
    "foo <!--\n@agent note inline\n@me \n--> baz",
  );
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+alt+enter appends a quick reply inline in a compact inline note", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo {?? @agent note inline ??} baz", {
    line: 0,
    character: 8,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo {?? @agent note inline @  ??} baz");
  assert.deepEqual(editor.selection.active, { line: 0, character: 29 });
});

test("cmd+alt+enter appends a quick reply inline in a compact HTML note", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo <!-- @agent note inline --> baz", {
    line: 0,
    character: 9,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo <!-- @agent note inline @  --> baz");
  assert.deepEqual(editor.selection.active, { line: 0, character: 30 });
});

test("cmd+alt+enter reuses a trailing inline quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @  ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 19 });
});

test("addHumanOk only adds ok and removeHumanOk only removes ok", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.addHumanOk();
  assert.equal(editor.document.text, "{?? @agent note @me ok ??}");

  await harness.api.addHumanOk();
  assert.equal(editor.document.text, "{?? @agent note @me ok ??}");

  await harness.api.removeHumanOk();
  assert.equal(editor.document.text, "{?? @agent note ??}");

  await harness.api.removeHumanOk();
  assert.equal(editor.document.text, "{?? @agent note ??}");
});

test("addHumanOk recognizes timestamped quick ok replies", async () => {
  const timestamp = "2026-06-16T17:35:35+02:00";
  const cases = [
    [
      `{?? @agent note @%${timestamp} ok ??}`,
      "{?? @agent note ??}",
    ],
    [
      `<!--\n@agent note\n@%${timestamp} ok\n-->`,
      "<!--\n@agent note\n-->",
    ],
  ];

  for (const [text, expectedAfterRemoval] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor(text, { line: 0, character: 5 });

    await harness.api.addHumanOk();
    assert.equal(editor.document.text, text);

    await harness.api.removeHumanOk();
    assert.equal(editor.document.text, expectedAfterRemoval);
  }
});

test("addHumanOk fills a trailing empty human reply", async () => {
  const cases = [
    ["{?? @agent note @  ??}", "{?? @agent note @ ok ??}"],
    ["{?? @agent note @me  ??}", "{?? @agent note @me ok ??}"],
    ["<!--\n@agent note\n@ \n-->", "<!--\n@agent note\n@ ok\n-->"],
    ["<!--\n@agent note\n@me \n-->", "<!--\n@agent note\n@me ok\n-->"],
  ];

  for (const [text, expected] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor(text, { line: 0, character: 5 });

    await harness.api.addHumanOk();

    assert.equal(editor.document.text, expected);
  }
});

test("compact inline notes in list items keep inline quick replies", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("- B {?? @agent note ??}", {
    line: 0,
    character: 8,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "- B {?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 22 });
});

test("cmd+alt+enter appends a quick reply after a trailing @me ok line", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@me ok\n-->", {
    line: 3,
    character: 0,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me ok\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 3, character: 2 });
});

test("cmd+alt+enter preserves colonless @me ok lines and appends a quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@me ok\n-->", {
    line: 3,
    character: 0,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me ok\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 3, character: 2 });
});

test("cmd+alt+enter adds a quick reply when the conversation does not end with ok", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@me question\n-->", {
    line: 3,
    character: 0,
  });

  await harness.api.approveAgentMessage();

  assert.equal(
    editor.document.text,
    "<!--\n@agent note\n@me question\n@ \n-->",
  );
  assert.deepEqual(editor.selection.active, { line: 3, character: 2 });
});

test("cmd+alt+enter reuses a trailing multiline quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@ \n-->", {
    line: 3,
    character: 0,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 2, character: 2 });
});

test("cmd+enter delegates to native newline away from the end of a conversation", async () => {
  const harness = createHarness();
  harness.createEditor("<!--\n@agent note\n@me question\n-->", {
    line: 1,
    character: 0,
  });

  await harness.api.addHumanComment();

  assert.deepEqual(harness.executedCommands, ["editor.action.insertLineAfter"]);
});

test("cmd+enter inserts @me on the close marker line", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n-->", {
    line: 2,
    character: 0,
  });

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me \n-->");
  assert.deepEqual(harness.executedCommands, []);
});

test("cmd+enter inserts @me from the @agent line of a simple HTML conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note isolée\n-->", {
    line: 1,
    character: 0,
  });

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "<!--\n@agent note isolée\n@me \n-->");
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+enter inserts @me after the last message before the close marker", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n  ??}",
    { line: 2, character: 2 },
  );

  await harness.api.addHumanComment();

  assert.equal(
    editor.document.text,
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n  @me \n  ??}",
  );
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 3, character: 6 });
});

test("cmd+enter inserts @me after a colonless last message at line end", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "<!--\n@agent note sans deux-points\n-->",
    { line: 1, character: "@agent note sans deux-points".length },
  );

  await harness.api.addHumanComment();

  assert.equal(
    editor.document.text,
    "<!--\n@agent note sans deux-points\n@me \n-->",
  );
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+enter inserts @me after the last content line of a multiline message", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "<!--\n@agent note sur plusieurs lignes\nsuite de la note\n-->",
    { line: 2, character: "suite de la note".length },
  );

  await harness.api.addHumanComment();

  assert.equal(
    editor.document.text,
    "<!--\n@agent note sur plusieurs lignes\nsuite de la note\n@me \n-->",
  );
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 3, character: 4 });
});

test("native-newline fallback leaves a blank line after the last message untouched", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n    \n  ??}",
    { line: 3, character: 4 },
  );

  await harness.api.fillReviewLineAfterNativeNewline(
    {
      document: editor.document,
      contentChanges: [{
        text: "\n    ",
        range: {
          start: { line: 2, character: 21 },
          end: { line: 2, character: 21 },
        },
      }],
    },
    editor,
  );

  assert.equal(
    editor.document.text,
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n    \n  ??}",
  );
});

test("cmd+alt+enter creates a compact HTML quick note at the end of the line", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo <!-- @  -->");
  assert.deepEqual(editor.selection.active, { line: 0, character: 11 });
});

test("cmd+alt+enter uses the configured timestamp format", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.approveAgentMessage();

  assert.match(editor.document.text, /^foo <!-- @%[0-9A-Za-z]{8}  -->$/);
});

test("timestampFormat none keeps workshop quick notes timestamp-free", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("none");
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo <!-- @  -->");
});

test("cmd+alt+shift+enter creates a multiline HTML quick note at the end of the line", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "foo <!--\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 1, character: 2 });
});

test("cmd+alt+shift+enter creates a multiline HTML quick note for selected text", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor(
    "foo bar baz",
    { line: 0, character: 4 },
    { line: 0, character: 7 },
  );

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "foo {==bar==}<!--\n@ \n--> baz");
  assert.deepEqual(editor.selection.active, { line: 1, character: 2 });
});

test("cmd+alt+shift+enter creates an indented multiline quick note in list items", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("- item", { line: 0, character: 6 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "- item <!--\n  @ \n  -->");
  assert.deepEqual(editor.selection.active, { line: 1, character: 4 });
});

test("cmd+alt+k o compact custom ok notes are inserted without a leading space", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.addHumanOk();

  assert.equal(editor.document.text, "{++foo++}{?? @me ok ??}");
});

test("discussion shortcut always creates a custom note", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("html");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.createCompactCriticMarkupReviewNote();

  assert.equal(editor.document.text, "{++foo++}{?? @me  ??}");
});

test("discussion shortcut uses the configured timestamp format", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.createCompactCriticMarkupReviewNote();

  assert.match(
    editor.document.text,
    /^\{\+\+foo\+\+\}\{\?\? @me%[0-9A-Za-z]{8}  \?\?\}$/,
  );
});

test("timestampFormat none keeps discussion shortcut timestamp-free", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("none");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.createCompactCriticMarkupReviewNote();

  assert.equal(editor.document.text, "{++foo++}{?? @me  ??}");
});

test("wraps selections with custom review annotations", async () => {
  const cases = [
    ["addition", "{++foo++}", { line: 0, character: 6 }],
    ["deletion", "{--foo--}", { line: 0, character: 6 }],
    ["highlight", "{==foo==}", { line: 0, character: 6 }],
    ["comment", "{>>foo<<}", { line: 0, character: 6 }],
    ["substitution", "{~~foo~>~~}", { line: 0, character: 8 }],
  ];

  for (const [kind, expectedText, expectedCursor] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor("foo", { line: 0, character: 0 }, {
      line: 0,
      character: 3,
    });

    await harness.api.wrapCriticMarkupAnnotation(kind);

    assert.equal(editor.document.text, expectedText);
    assert.deepEqual(editor.selection.active, expectedCursor);
  }
});

test("wraps selections with timestamped custom review annotations when configured", async () => {
  const cases = [
    ["addition", /^\{\+\+%[0-9A-Za-z]{8}\|foo\+\+\}$/],
    ["deletion", /^\{--%[0-9A-Za-z]{8}\|foo--\}$/],
    ["highlight", /^\{==%[0-9A-Za-z]{8}\|foo==\}$/],
    ["comment", /^\{>>%[0-9A-Za-z]{8}\|foo<<\}$/],
    ["substitution", /^\{~~%[0-9A-Za-z]{8}\|foo~>~~\}$/],
  ];

  for (const [kind, expectedText] of cases) {
    const harness = createHarness();
    harness.setTimestampFormat("compact");
    const editor = harness.createEditor("foo", { line: 0, character: 0 }, {
      line: 0,
      character: 3,
    });

    await harness.api.wrapCriticMarkupAnnotation(kind);

    assert.match(editor.document.text, expectedText);
  }
});

test("adds a timestamp to the current review annotation", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.addTimestampToCurrentReviewElement();

  assert.match(editor.document.text, /^\{\+\+%[0-9A-Za-z]{8}\|foo\+\+\}$/);
});

test("adds a timestamp to the current conversation message", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("<!-- @agent note @me ok -->", {
    line: 0,
    character: 16,
  });

  await harness.api.addTimestampToCurrentReviewElement();

  assert.match(
    editor.document.text,
    /^<!-- @agent%[0-9A-Za-z]{8} note @me ok -->$/,
  );
});

test("add timestamp command does not duplicate existing timestamp metadata", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("{++%1WzvP91W|foo++}", {
    line: 0,
    character: 8,
  });

  await harness.api.addTimestampToCurrentReviewElement();

  assert.equal(editor.document.text, "{++%1WzvP91W|foo++}");
});

test("explicit add timestamp command uses compact timestamps when automatic timestamps are disabled", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("none");
  const editor = harness.createEditor("{==foo==}", { line: 0, character: 5 });

  await harness.api.addTimestampToCurrentReviewElement();

  assert.match(editor.document.text, /^\{==%[0-9A-Za-z]{8}\|foo==\}$/);
});

test("converts all timestamps in the active editor to the configured format", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("iso");
  const editor = harness.createEditor(
    "{++%1WzvP91W|foo++}\n<!-- @agent%1WzvP91W note -->",
    { line: 0, character: 0 },
  );

  await harness.api.convertTimestampsInActiveEditor();

  assert.equal(
    editor.document.text,
    "{++%2026-06-16T17:35:35+02:00|foo++}\n<!-- @agent%2026-06-16T17:35:35+02:00 note -->",
  );
});

test("wraps empty selections with custom review annotations and places the cursor inside", async () => {
  const cases = [
    ["addition", "{++++}", { line: 0, character: 3 }],
    ["deletion", "{----}", { line: 0, character: 3 }],
    ["highlight", "{====}", { line: 0, character: 3 }],
    ["comment", "{>><<}", { line: 0, character: 3 }],
    ["substitution", "{~~~>~~}", { line: 0, character: 3 }],
  ];

  for (const [kind, expectedText, expectedCursor] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor("", { line: 0, character: 0 });

    await harness.api.wrapCriticMarkupAnnotation(kind);

    assert.equal(editor.document.text, expectedText);
    assert.deepEqual(editor.selection.active, expectedCursor);
  }
});

test("cancels custom review annotations", async () => {
  const cases = [
    ["{++bla++}", ""],
    ["{++%1WzvP91W|bla++}", ""],
    ["{--bla--}", "bla"],
    ["{--%2026-06-16T17:35:35+0200|bla--}", "bla"],
    ["{==bla==}", "bla"],
    ["{==%1WzvP91W|bla==}", "bla"],
    ["{>>bla<<}", ""],
    ["{>>%1WzvP91W|bla<<}", ""],
    ["{~~foo~>bar~~}", "foo"],
    ["{~~%1WzvP91W|foo~>bar~~}", "foo"],
    ["{??bla??}", ""],
    ["<!-- @me bla -->", ""],
    ["<!--\n@agent bla\n-->", ""],
  ];

  for (const [text, expected] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor(text, { line: 0, character: 4 });

    await harness.api.cancelCriticMarkupAnnotation();

    assert.equal(editor.document.text, expected);
  }
});

test("cancel ignores plain HTML comments without review roles", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!-- plain note -->", {
    line: 0,
    character: 5,
  });

  await harness.api.cancelCriticMarkupAnnotation();

  assert.equal(editor.document.text, "<!-- plain note -->");
});

test("applies custom review annotations", async () => {
  const cases = [
    ["{++bla++}", "bla"],
    ["{++%1WzvP91W|bla++}", "bla"],
    ["{--bla--}", ""],
    ["{--%1WzvP91W|bla--}", ""],
    ["{==bla==}", "bla"],
    ["{==%2026-06-16T17:35:35+0200|bla==}", "bla"],
    ["{>>bla<<}", ""],
    ["{>>%1WzvP91W|bla<<}", ""],
    ["{~~foo~>bar~~}", "bar"],
    ["{~~%1WzvP91W|foo~>bar~~}", "bar"],
    ["{??bla??}", ""],
  ];

  for (const [text, expected] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor(text, { line: 0, character: 4 });

    await harness.api.applyCriticMarkupAnnotation();

    assert.equal(editor.document.text, expected);
  }
});

test("cmd+alt+shift+enter compacts a one-message multiline conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{??\n@agent note\n??}", {
    line: 1,
    character: 0,
  });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{?? @agent note ??}");
});

test("cmd+alt+shift+enter expands a one-message compact conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{??\n@agent note\n??}");
  assert.deepEqual(editor.selection.active, { line: 1, character: 11 });
});

test("cmd+alt+shift+enter preserves inline continuation lines while toggling", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!-- @ Bla\n  - Bla -->", {
    line: 0,
    character: 5,
  });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "<!--\n@ Bla\n  - Bla\n-->");

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "<!-- @ Bla\n  - Bla -->");
});

test("cmd+alt+shift+enter expands a multi-message compact conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @me question ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{??\n@agent note\n@me question\n??}");
  assert.deepEqual(editor.selection.active, { line: 2, character: 12 });
});

test("cmd+alt+shift+enter compacts a multi-message multiline conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{??\n@agent note\n@me question\n??}", {
    line: 1,
    character: 0,
  });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{?? @agent note @me question ??}");
});

test("cmd+alt+shift+enter compacts continuation lines without flattening them", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "{??\n@agent note\nsuite de la note\n@me question\n??}",
    { line: 1, character: 0 },
  );

  await harness.api.createCompactReviewNote();

  assert.equal(
    editor.document.text,
    "{?? @agent note\nsuite de la note @me question ??}",
  );
});

test("cmd+alt+enter appends a quick reply inline in a compact conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 18 });
});

test("cmd+alt+enter preserves a trailing inline ok reply and appends a quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @me ok ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @me ok @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 25 });
});

test("moves between custom review annotations and review conversations", () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "intro\n{++add++}\ntext\n{?? @me discuss ??}\ntext\n{~~old~>new~~}\ntext\n<!-- @me html -->",
    { line: 0, character: 0 },
  );

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 1, character: 0 });

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 3, character: 0 });

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 5, character: 0 });

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 7, character: 0 });

  harness.api.moveToReviewBlock("previous");
  assert.deepEqual(editor.selection.active, { line: 5, character: 0 });
});

test("moves between pending conversations", () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    [
      "intro",
      "<!-- @agent open -->",
      "<!-- @agent handled @me answer -->",
      "<!-- @agent wip @me -->",
      "<!-- @agent resolved @me ok -->",
      "",
    ].join("\n"),
    { line: 0, character: 0 },
  );

  harness.api.moveToConversation("next", "pending");
  assert.deepEqual(editor.selection.active, { line: 1, character: 0 });

  harness.api.moveToConversation("next", "pending");
  assert.deepEqual(editor.selection.active, { line: 3, character: 0 });

  harness.api.moveToConversation("previous", "pending");
  assert.deepEqual(editor.selection.active, { line: 1, character: 0 });
});

test("classifies conversation statuses in extension code", () => {
  const harness = createHarness();
  const statusOf = (text) =>
    harness.api.getConversationStatus(
      harness.api.collectConversations(text)[0],
    );

  assert.equal(statusOf("<!-- @agent note -->"), "open");
  assert.equal(statusOf("<!-- @agent note @me -->"), "wip");
  assert.equal(statusOf("<!-- @agent note @ -->"), "wip");
  assert.equal(statusOf("<!-- @agent note @me answer -->"), "handled");
  assert.equal(statusOf("<!-- @agent note @me ok -->"), "resolved");
});

test("brace-percent blocks are not treated as review conversations", () => {
  const harness = createHarness();

  assert.equal(
    harness.api.collectConversations("{%% @agent note %%}").length,
    0,
  );
});

test("conversation content decorations exclude marker-only delimiter lines", () => {
  const harness = createHarness();
  const text = "foo {==bar==}{??\n@me note\n??} baz";
  const conversation = harness.api.collectConversations(text)[0];
  const document = { positionAt: (offset) => positionAt(text, offset) };

  const [range] = harness.api.getConversationContentRanges(
    document,
    conversation,
  );

  assert.deepEqual(range.start, { line: 1, character: 0 });
  assert.deepEqual(range.end, { line: 2, character: 0 });
});

test("compact conversation decorations exclude markers after highlighted selections", () => {
  const harness = createHarness();

  for (
    const text of [
      "foo {==bar==}<!-- @me note --> baz",
      "foo {==bar==}{?? @me note ??} baz",
    ]
  ) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const [range] = harness.api.getConversationContentRanges(
      document,
      conversation,
    );
    const decoratedText = text.slice(
      offsetAt(text, range.start),
      offsetAt(text, range.end),
    );

    assert.equal(decoratedText, "@me note ");
  }
});

test("marker decorations target only review delimiters", () => {
  const harness = createHarness();

  for (
    const text of [
      "foo {==bar==}<!-- @me note --> baz",
      "- Bla {??\n  @agent note\n  ??}",
    ]
  ) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const ranges = harness.api.getConversationMarkerRanges(
      document,
      conversation,
    );
    const decoratedText = ranges.map((range) =>
      text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
    );

    assert.deepEqual(
      [...decoratedText],
      text.includes("<!--") ? ["<!--", "-->"] : ["{??", "??}"],
    );
  }
});

test("role decorations only cover role markers in multiline and compact list conversations", () => {
  const harness = createHarness();

  for (
    const [text, expected] of [
      ["- Bla <!--\n  @agent Bla\n  @ Bla\n  -->", ["@agent", "@"]],
      ["- Bla <!-- @agent Bla -->", ["@agent"]],
      ["- Bla <!-- @agent Bla -->", ["@agent"]],
      ["- Bla {??\n  @agent Bla\n  @me Bla\n  ??}", ["@agent", "@me"]],
      ["- Bla {??\n  @agent Bla\n  @me Bla\n  ??}", ["@agent", "@me"]],
      ["- Bla {?? @agent Bla ??}", ["@agent"]],
      ["- Bla {?? @agent Bla ??}", ["@agent"]],
      ["- Bla {?? @agent Bla @me Bla ??}", ["@agent", "@me"]],
    ]
  ) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const roleRanges = harness.api.getConversationRoleRanges(
      document,
      conversation,
    );
    const decoratedText = roleRanges.map(({ range }) =>
      text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
    );

    assert.deepEqual([...decoratedText], expected);
  }
});

test("ok decorations only cover ok replies", () => {
  const harness = createHarness();

  for (
    const [text, expected] of [
      ["<!--\n@ ok\n@me ok\n@me OK\n@me not ok\n@agent ok\n-->", [
        "ok",
        "ok",
        "OK",
      ]],
      ["{?? @agent note @ ok ??}", ["ok"]],
    ]
  ) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const okRanges = harness.api.getConversationOkRanges(
      document,
      conversation,
    );
    const decoratedText = okRanges.map((range) =>
      text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
    );

    assert.deepEqual([...decoratedText], expected);
  }
});
