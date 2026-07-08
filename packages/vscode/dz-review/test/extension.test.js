const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

// assignPersistentReviewItemIds (wired in via activate()) persists
// .dz-review/reference-map.json through runtime-config.ts's
// getDzReviewStateDir(). That function only returns an absolute,
// environment-anchored path when it can resolve a git root for the
// injected `getCwd()` -- otherwise it falls back to the bare relative
// string ".dz-review", which Node resolves against the real process cwd
// (this repo's own checkout), not the injected environment. A real git
// repo of its own, one per harness, is the only way to make
// getDzReviewStateDir() resolve to an isolated path instead of silently
// writing into this actual project's .dz-review/ on every test run.
function createIsolatedDzReviewStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dz-review-vscode-test-"));
  childProcess.spawnSync("git", ["init", "--quiet"], { cwd: dir });
  return dir;
}

function createHarness() {
  let commentSyntax = "html";
  let timestampFormat = "none";
  let refSnapshotLines = 10;
  let deferSetContext = false;
  let quickPickLabel;
  const quickPickCalls = [];
  const executedCommands = [];
  const executedCommandCalls = [];
  const pendingSetContextResolutions = [];
  const definitionProviders = [];
  const hoverProviders = [];
  const statusBarItems = [];
  const webviewViewProviders = [];
  const statusBarCalls = [];
  const mockVscode = {
    window: {
      activeTextEditor: undefined,
      createTextEditorDecorationType() {
        return {};
      },
      createStatusBarItem() {
        const item = {
          command: undefined,
          text: "",
          tooltip: "",
          backgroundColor: undefined,
          dispose() {},
          hide() {
            statusBarCalls.push("hide");
          },
          show() {
            statusBarCalls.push("show");
          },
        };
        statusBarItems.push(item);
        return item;
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
      fs: {
        readFile(uri) {
          return Promise.resolve(fs.readFileSync(uri.fsPath));
        },
      },
      openTextDocument() {
        return Promise.resolve(undefined);
      },
      getConfiguration() {
        return {
          get(key) {
            if (key === "timestampFormat") {
              return timestampFormat;
            }

            if (key === "refSnapshotLines") {
              return refSnapshotLines;
            }

            return commentSyntax;
          },
        };
      },
      onDidChangeTextDocument() {
        return {};
      },
      asRelativePath(target) {
        const value = typeof target === "string" ? target : target.fsPath;
        return value.startsWith("/workspace/")
          ? value.slice("/workspace/".length)
          : value;
      },
    },
    languages: {
      registerHoverProvider(selector, provider) {
        hoverProviders.push({ selector, provider });
        return {};
      },
      registerDefinitionProvider(selector, provider) {
        definitionProviders.push({ selector, provider });
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
    ThemeColor: class ThemeColor {
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
      file(file) {
        return { fsPath: file };
      },
      joinPath() {
        return "icon";
      },
    },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    },
    OverviewRulerLane: {
      Right: 1,
    },
    StatusBarAlignment: {
      Left: 1,
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
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
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "out",
      "extension.js",
    ),
    "utf8",
  );

  vm.runInNewContext(source, {
    require(name) {
      if (name === "vscode") {
        return mockVscode;
      }

      return require(name);
    },
    module,
    exports: module.exports,
    TextDecoder,
    // reference-map.ts's Blake3HashService (via ParseDocumentUseCase) uses
    // these as globals, not through `require` -- a fresh vm context has
    // neither by default, unlike the real extension host (Node 22+
    // provides both on globalThis).
    TextEncoder,
    crypto,
    process,
  });

  function createEditor(text, start, end = start) {
    const editor = {
      selection: new mockVscode.Selection(start, end),
      document: {
        languageId: "markdown",
        text,
        uri: { fsPath: "/workspace/doc.md" },
        fileName: "/workspace/doc.md",
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

  const isolatedStateDir = createIsolatedDzReviewStateDir();
  const realActivate = module.exports.__test.activate;
  module.exports.__test.activate = (...args) => {
    const result = realActivate(...args);
    // Override activate()'s real (VSCode-backed) environment with one
    // anchored to this harness's own throwaway git repo, so
    // reference-map.json never touches the real project checkout.
    module.exports.__test.configureDzReviewRuntime({
      environment: {
        getEnv: () => undefined,
        getCwd: () => isolatedStateDir,
      },
    });
    return result;
  };

  return {
    api: module.exports.__test,
    createEditor,
    createWebviewView,
    definitionProviders,
    executedCommandCalls,
    executedCommands,
    hoverProviders,
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
    setRefSnapshotLines(value) {
      refSnapshotLines = value;
    },
    setQuickPickLabel(value) {
      quickPickLabel = value;
    },
    setDeferSetContext(value) {
      deferSetContext = value;
    },
    statusBarCalls,
    statusBarItems,
    webviewViewProviders,
  };
}

test("review modes update the VS Code keybinding context", async () => {
  const harness = createHarness();

  await harness.api.enterBatchMode();
  await harness.api.enterLiveMode();
  await harness.api.enterEditMode();

  assert.deepEqual(harness.executedCommandCalls, [
    ["setContext", "dzMdReview.mode", "batch"],
    ["setContext", "dzMdReview.inBatchMode", true],
    ["setContext", "dzMdReview.mode", "live"],
    ["setContext", "dzMdReview.inBatchMode", false],
    ["setContext", "dzMdReview.mode", "edit"],
    ["setContext", "dzMdReview.inBatchMode", false],
  ]);
});

test("status bar command cycles through review modes", async () => {
  const harness = createHarness();

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.statusBarItems[0].command, "dzMdReview.cycleReviewMode");

  harness.executedCommandCalls.length = 0;
  await harness.api.cycleReviewMode();
  await harness.api.cycleReviewMode();
  await harness.api.cycleReviewMode();

  assert.deepEqual(harness.executedCommandCalls, [
    ["setContext", "dzMdReview.mode", "batch"],
    ["setContext", "dzMdReview.inBatchMode", true],
    ["setContext", "dzMdReview.mode", "live"],
    ["setContext", "dzMdReview.inBatchMode", false],
    ["setContext", "dzMdReview.mode", "edit"],
    ["setContext", "dzMdReview.inBatchMode", false],
  ]);
});

test("review modes keep the status bar visible while changing modes", async () => {
  const harness = createHarness();

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  await Promise.resolve();
  harness.statusBarCalls.length = 0;

  await harness.api.enterBatchMode();
  assert.deepEqual(harness.statusBarCalls, ["show"]);

  await harness.api.enterEditMode();

  assert.deepEqual(harness.statusBarCalls, ["show", "show"]);
});

test("review panel webview lists review items from the active Markdown editor", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);

  assert.match(view.webview.html, /Open conversation/);
  assert.match(view.webview.html, /#1 · [0-9A-Za-z]{6} · LINE 2/);
  assert.doesNotMatch(view.webview.html, /<div class="meta">[^<]*rvw_/);
  assert.match(view.webview.html, /"id":"rvw_[0-9A-Za-z]{1,11}"/);
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

  const [conversation] = await harness.api.collectReviewPanelItems(
    editor.document,
  );
  assert.match(conversation.id, /^rvw_[0-9A-Za-z]{1,11}$/);
  assert.equal(conversation.displayId, conversation.id.slice(4, 10));
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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);

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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);

  const labelsFor = async (filter) =>
    Array.from(
      await harness.api.collectReviewPanelItems(editor.document, filter),
      (item) => item.label,
    );

  assert.deepEqual(await labelsFor("all"), [
    "Open conversation",
    "Handled conversation",
    "Resolved conversation",
    "WIP conversation",
    "Addition",
  ]);
  assert.deepEqual(await labelsFor("unresolved"), [
    "Open conversation",
    "Handled conversation",
    "WIP conversation",
    "Addition",
  ]);
  assert.deepEqual(await labelsFor("pending"), [
    "Open conversation",
    "WIP conversation",
    "Addition",
  ]);
  assert.deepEqual(await labelsFor("open"), ["Open conversation"]);
  assert.deepEqual(await labelsFor("wip"), ["WIP conversation"]);
  assert.deepEqual(await labelsFor("handled"), ["Handled conversation"]);
  assert.deepEqual(await labelsFor("resolved"), ["Resolved conversation"]);

  assert.equal(view.description, "unresolved");
  assert.match(view.webview.html, /Open conversation/);
  assert.match(view.webview.html, /Handled conversation/);
  assert.match(view.webview.html, /WIP conversation/);
  assert.match(view.webview.html, /new text/);
  assert.doesNotMatch(view.webview.html, /Resolved conversation/);
  assert.deepEqual(
    harness.executedCommandCalls.find((call) =>
      call[0] === "setContext" && call[1] === "dzMdReview.reviewItemsFilter"
    ),
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
  assert.deepEqual(
    harness.executedCommandCalls
      .filter((call) =>
        call[0] === "setContext" && call[1] === "dzMdReview.reviewItemsFilter"
      )
      .at(-1),
    [
      "setContext",
      "dzMdReview.reviewItemsFilter",
      "pending",
    ],
  );

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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);

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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = await harness.api.collectReviewPanelItems(
    editor.document,
  );

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

test("review panel webview resolves stale conversation offsets by stable id", async () => {
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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = await harness.api.collectReviewPanelItems(
    editor.document,
  );
  editor.document.text = ["Preamble", editor.document.text].join("\n");

  await view.postMessageFromWebview({
    type: "reply",
    item: conversation,
    body: "offset refreshed",
  });

  assert.equal(
    editor.document.text,
    [
      "Preamble",
      "# Draft",
      "<!--",
      "@agent open issue",
      "@me offset refreshed",
      "-->",
    ].join("\n"),
  );
});

test("review panel webview keeps the same id when an annotation's own text is edited", async () => {
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
  const [before] = await harness.api.collectReviewPanelItems(editor.document);

  // Same line range, different text -- the old scheme (a pure hash of
  // file + kind + the annotation's own text) would have minted a
  // different id here. The persistent mapping's fast path only cares
  // about the line range, so it survives this edit.
  editor.document.text = [
    "# Draft",
    "<!--",
    "@agent open issue, rephrased",
    "-->",
  ].join("\n");

  const [after] = await harness.api.collectReviewPanelItems(editor.document);

  assert.equal(after.id, before.id);
});

test("assignPersistentReviewItemIds and the review panel agree on the same file's id", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "{++one line addition++}",
    { line: 0, character: 0 },
  );

  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const [panelItem] = await harness.api.collectReviewPanelItems(
    editor.document,
  );

  // Simulate what the CLI would do for the exact same real file: if the
  // panel's file-path normalization (getReviewPanelDocumentPath) ever
  // diverged from what a direct assignPersistentReviewItemIds caller would
  // use, this would mint a *new* id instead of recognizing panelItem's.
  const file = harness.api.getReviewPanelDocumentPath(editor.document);
  const [cliAssigned] = await harness.api.assignPersistentReviewItemIds(
    file,
    editor.document.text,
    [{
      kind: "addition",
      raw: "{++one line addition++}",
      lineStart: 1,
      lineEnd: 1,
    }],
  );

  assert.equal(cliAssigned.id, panelItem.id);
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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = await harness.api.collectReviewPanelItems(
    editor.document,
  );

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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [conversation] = await harness.api.collectReviewPanelItems(
    editor.document,
  );

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
  await harness.webviewViewProviders[0].provider.resolveWebviewView(view);
  const [addition, deletion] = await harness.api.collectReviewPanelItems(
    editor.document,
  );

  await view.postMessageFromWebview({
    type: "resolveAnnotation",
    item: addition,
    resolution: "apply",
  });
  assert.equal(editor.document.text, "Before new text after {--old text--}");

  const [remainingDeletion] = await harness.api.collectReviewPanelItems(
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

  // assignPersistentReviewItemIds (wired in via activate()'s
  // configureDzReviewRuntime call) needs the injected environment; without
  // activate() this falls back to the Deno-based default, which doesn't
  // exist in this Node vm sandbox.
  harness.api.activate({ subscriptions: [], extensionUri: "extension-uri" });
  const [conversation] = await harness.api.collectReviewPanelItems(
    editor.document,
  );

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

test("shows referenced passage on ref hover", async () => {
  const harness = createHarness();
  const dir = fs.mkdtempSync(path.join(__dirname, "ref-hover-"));
  fs.writeFileSync(path.join(dir, "source.md"), "one\ntwo\nthree\n");
  const editor = harness.createEditor("<!-- ref: source.md:2 -->\n", {
    line: 0,
    character: 12,
  });
  editor.document.uri = { fsPath: path.join(dir, "doc.md") };
  editor.document.fileName = path.join(dir, "doc.md");

  try {
    const hover = await harness.api.provideReviewHover(editor.document, {
      line: 0,
      character: 12,
    });

    assert.match(hover.contents.value, /source\.md:2/);
    assert.match(hover.contents.value, /> two/);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("shows referenced HTML conversation text on ref hover", async () => {
  const harness = createHarness();
  const dir = fs.mkdtempSync(path.join(__dirname, "ref-hover-comment-"));
  fs.writeFileSync(
    path.join(dir, "source.md"),
    "<!-- @agent%궩거깇걸 Pourquoi parler du SAS ici ? -->\n",
  );
  const editor = harness.createEditor("<!-- ref: source.md:1 -->\n", {
    line: 0,
    character: 12,
  });
  editor.document.uri = { fsPath: path.join(dir, "doc.md") };
  editor.document.fileName = path.join(dir, "doc.md");

  try {
    const hover = await harness.api.provideReviewHover(editor.document, {
      line: 0,
      character: 12,
    });

    assert.match(hover.contents.value, /source\.md:1/);
    assert.match(
      hover.contents.value,
      /&lt;!-- @agent%궩거깇걸 Pourquoi parler du SAS ici \? --&gt;/,
    );
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("limits referenced passage lines on ref hover", async () => {
  const harness = createHarness();
  const dir = fs.mkdtempSync(path.join(__dirname, "ref-hover-limit-"));
  const sourceLines = Array.from(
    { length: 12 },
    (_, index) => `line ${index + 1}`,
  );
  fs.writeFileSync(path.join(dir, "source.md"), `${sourceLines.join("\n")}\n`);
  const editor = harness.createEditor("<!-- ref: source.md:1-12 -->\n", {
    line: 0,
    character: 12,
  });
  editor.document.uri = { fsPath: path.join(dir, "doc.md") };
  editor.document.fileName = path.join(dir, "doc.md");

  try {
    const hover = await harness.api.provideReviewHover(editor.document, {
      line: 0,
      character: 12,
    });

    assert.match(hover.contents.value, /> line 10/);
    assert.doesNotMatch(hover.contents.value, /line 11/);
    assert.match(
      hover.contents.value,
      /> \[ref snapshot truncated: 2 lines omitted\]/,
    );
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("goes to referenced line from a ref", () => {
  const harness = createHarness();
  const dir = fs.mkdtempSync(path.join(__dirname, "ref-definition-"));
  const editor = harness.createEditor("<!-- ref: source.md:2 -->\n", {
    line: 0,
    character: 12,
  });
  editor.document.uri = { fsPath: path.join(dir, "doc.md") };
  editor.document.fileName = path.join(dir, "doc.md");

  try {
    const definition = harness.api.provideReferenceDefinition(
      editor.document,
      {
        line: 0,
        character: 12,
      },
    );

    assert.equal(definition.uri.fsPath, path.join(dir, "source.md"));
    assert.deepEqual({ ...definition.range.start }, { line: 1, character: 0 });
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
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
  assert.match(
    editor.document.text,
    /^\{\?\? @agent note @me%[0-9A-Za-z]{8} ok \?\?\}$/,
  );

  await harness.api.addHumanOk();
  assert.match(
    editor.document.text,
    /^\{\?\? @agent note @me%[0-9A-Za-z]{8} ok \?\?\}$/,
  );

  await harness.api.removeHumanOk();
  assert.equal(editor.document.text, "{?? @agent note ??}");

  await harness.api.removeHumanOk();
  assert.equal(editor.document.text, "{?? @agent note ??}");
});

test("cmd+ctrl+alt+enter adds mode-aware ok replies", async () => {
  const editHarness = createHarness();
  editHarness.setTimestampFormat("compact");
  const editEditor = editHarness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await editHarness.api.enterEditMode();
  await editHarness.api.addHumanOk();

  assert.match(
    editEditor.document.text,
    /^\{\?\? @agent note @me%[0-9A-Za-z]{8} ok \?\?\}$/,
  );

  const batchHarness = createHarness();
  batchHarness.setTimestampFormat("compact");
  const batchEditor = batchHarness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await batchHarness.api.enterBatchMode();
  await batchHarness.api.addHumanOk();

  assert.match(
    batchEditor.document.text,
    /^\{\?\? @agent note @me%[0-9A-Za-z]{8} ok \?\?\}$/,
  );

  const liveHarness = createHarness();
  liveHarness.setTimestampFormat("compact");
  const liveEditor = liveHarness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await liveHarness.api.enterLiveMode();
  await liveHarness.api.addHumanOk();

  assert.equal(liveEditor.document.text, "{?? @agent note @ ok ??}");
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
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

  await harness.api.enterLiveMode();
  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo <!-- @  -->");
  assert.deepEqual(editor.selection.active, { line: 0, character: 11 });
});

test("cmd+alt+enter uses @me and the configured timestamp format in edit mode", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.approveAgentMessage();

  assert.match(editor.document.text, /^foo <!-- @me%[0-9A-Za-z]{8}  -->$/);
});

test("timestampFormat none keeps workshop quick notes timestamp-free", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("none");
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.enterLiveMode();
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

  assert.match(
    editor.document.text,
    /^\{\+\+foo\+\+\}\{\?\? @me%[0-9A-Za-z]{8} ok \?\?\}$/,
  );
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

  await harness.api.enterLiveMode();
  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 18 });
});

test("cmd+alt+enter appends a timestamped @me reply in edit mode", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.enterEditMode();
  await harness.api.approveAgentMessage();

  assert.match(
    editor.document.text,
    /^\{\?\? @agent note @me%[0-9A-Za-z]{8}  \?\?\}$/,
  );
  assert.deepEqual(editor.selection.active, { line: 0, character: 29 });
});

test("cmd+alt+enter appends a timestamped @me reply and leaves batch mode", async () => {
  const harness = createHarness();
  harness.setTimestampFormat("compact");
  const editor = harness.createEditor("{?? @agent note ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.enterBatchMode();
  harness.executedCommandCalls.length = 0;
  await harness.api.approveAgentMessage();

  assert.match(
    editor.document.text,
    /^\{\?\? @agent note @me%[0-9A-Za-z]{8}  \?\?\}$/,
  );
  assert.deepEqual(editor.selection.active, { line: 0, character: 29 });
  assert.deepEqual(harness.executedCommandCalls, [
    ["setContext", "dzMdReview.mode", "edit"],
    ["setContext", "dzMdReview.inBatchMode", false],
  ]);
});

test("cmd+alt+enter preserves a trailing inline ok reply and appends a quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @me ok ??}", {
    line: 0,
    character: 5,
  });

  await harness.api.enterLiveMode();
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
