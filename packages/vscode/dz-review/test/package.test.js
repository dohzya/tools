const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readPackage() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
}

test("cmd+enter is left to VS Code", () => {
  const pkg = readPackage();
  const keybindings = pkg.contributes.keybindings.filter((binding) =>
    binding.key === "cmd+enter" || binding.mac === "cmd+enter"
  );

  assert.deepEqual(keybindings, []);
});

test("cmd+alt+up and cmd+alt+down are left to VS Code", () => {
  const pkg = readPackage();
  const keybindings = pkg.contributes.keybindings.filter((binding) =>
    ["cmd+alt+up", "cmd+alt+down"].includes(binding.key) ||
    ["cmd+alt+up", "cmd+alt+down"].includes(binding.mac)
  );

  assert.deepEqual(keybindings, []);
});

test("Obsidian Markdown support injects into Markdown without a test language", () => {
  const pkg = readPackage();
  const obsidianGrammar = pkg.contributes.grammars.find(
    (grammar) => grammar.scopeName === "source.obsidian.markdown.injection",
  );

  assert.equal(
    obsidianGrammar.path,
    "./syntaxes/obsidian-markdown-injection.tmLanguage.json",
  );
  assert.deepEqual(obsidianGrammar.injectTo, ["text.html.markdown"]);
  assert.equal(pkg.contributes.languages, undefined);
});

test("Catppuccin Latte defaults color Obsidian and custom review annotation scopes", () => {
  const pkg = readPackage();
  const customizations =
    pkg.contributes.configurationDefaults["editor.tokenColorCustomizations"];
  const globalRules = customizations.textMateRules;
  const latteRules = customizations["[Catppuccin Latte]"].textMateRules;

  assert(
    globalRules.some((rule) =>
      rule.scope.includes("comment.block.obsidian.markdown") &&
      rule.settings.foreground === "#8C8FA1"
    ),
  );
  assert(
    globalRules.some((rule) =>
      rule.scope.includes("markup.inserted.critic.substitution.markdown") &&
      rule.settings.fontStyle === "bold"
    ),
  );
  assert.deepEqual(latteRules[0], {
    scope: [
      "markup.inserted.critic.markdown",
      "markup.inserted.critic.substitution.markdown",
    ],
    settings: {
      foreground: "#40a02b",
      fontStyle: "bold",
    },
  });
  assert(
    latteRules.some((rule) =>
      rule.scope.includes("markup.marked.obsidian.markdown")
    ),
  );
  assert(
    latteRules.some((rule) =>
      rule.scope.includes("comment.block.obsidian.markdown")
    ),
  );
});

test("timestamp color rules override annotation colors", () => {
  const pkg = readPackage();
  const customizations =
    pkg.contributes.configurationDefaults["editor.tokenColorCustomizations"];
  const globalRules = customizations.textMateRules;
  const latteRules = customizations["[Catppuccin Latte]"].textMateRules;

  assertRuleAfter(
    globalRules,
    "meta.timestamp.review.markdown",
    "markup.inserted.critic.markdown",
  );
  assertRuleAfter(
    latteRules,
    "meta.timestamp.review.markdown",
    "markup.inserted.critic.markdown",
  );
  assertRuleAfter(
    latteRules,
    "meta.timestamp.review.markdown",
    "markup.deleted.critic.markdown",
  );
  assertRuleAfter(
    latteRules,
    "meta.timestamp.review.markdown",
    "markup.marked.critic.markdown",
  );
  assertRuleAfter(
    latteRules,
    "meta.timestamp.review.markdown",
    "comment.block.critic.markdown",
  );
  assertRuleExists(
    globalRules,
    "markup.inserted.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    globalRules,
    "markup.deleted.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    globalRules,
    "meta.substitution.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    globalRules,
    "markup.marked.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    globalRules,
    "comment.block.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    latteRules,
    "markup.inserted.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    latteRules,
    "markup.deleted.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    latteRules,
    "meta.substitution.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    latteRules,
    "markup.marked.critic.markdown meta.timestamp.review.markdown",
  );
  assertRuleExists(
    latteRules,
    "comment.block.critic.markdown meta.timestamp.review.markdown",
  );
});

test("timestamp format configuration can disable timestamp insertion", () => {
  const pkg = readPackage();
  const setting =
    pkg.contributes.configuration.properties["dzMdReview.timestampFormat"];

  assert.deepEqual(setting.enum, ["compact", "hangul", "iso", "none"]);
  assert.equal(setting.default, "compact");
});

function assertRuleAfter(rules, laterScope, earlierScope) {
  const laterIndex = rules.findIndex((rule) =>
    scopeIncludes(rule.scope, laterScope)
  );
  const earlierIndex = rules.findIndex((rule) =>
    scopeIncludes(rule.scope, earlierScope)
  );

  assert(laterIndex >= 0, `Missing rule for ${laterScope}`);
  assert(earlierIndex >= 0, `Missing rule for ${earlierScope}`);
  assert(
    laterIndex > earlierIndex,
    `${laterScope} should be after ${earlierScope}`,
  );
}

function assertRuleExists(rules, scope) {
  assert(
    rules.some((rule) => scopeIncludes(rule.scope, scope)),
    `Missing rule for ${scope}`,
  );
}

function scopeIncludes(scope, expected) {
  return Array.isArray(scope) ? scope.includes(expected) : scope === expected;
}

test("custom review annotation commands are available through cmd+alt+k chords", () => {
  const pkg = readPackage();
  const commands = new Set(
    pkg.contributes.commands.map((command) => command.command),
  );
  const keybindings = new Map(
    pkg.contributes.keybindings.map((
      binding,
    ) => [binding.command, binding.mac]),
  );
  const hasKeybinding = (command, mac) =>
    pkg.contributes.keybindings.some((binding) =>
      binding.command === command && binding.mac === mac
    );

  assert(commands.has("dzMdReview.addCriticMarkupAddition"));
  assert(commands.has("dzMdReview.addCriticMarkupDeletion"));
  assert(commands.has("dzMdReview.addCriticMarkupSubstitution"));
  assert(commands.has("dzMdReview.addCriticMarkupHighlight"));
  assert(commands.has("dzMdReview.addCriticMarkupComment"));
  assert(commands.has("dzMdReview.createCriticMarkupDiscussion"));
  assert(commands.has("dzMdReview.cancelCriticMarkupAnnotation"));
  assert(commands.has("dzMdReview.applyCriticMarkupAnnotation"));
  assert(commands.has("dzMdReview.addHumanOk"));
  assert(commands.has("dzMdReview.removeHumanOk"));
  assert(commands.has("dzMdReview.nextReviewBlock"));
  assert(commands.has("dzMdReview.previousReviewBlock"));
  assert(commands.has("dzMdReview.nextConversation"));
  assert(commands.has("dzMdReview.previousConversation"));
  assert(commands.has("dzMdReview.nextPendingConversation"));
  assert(commands.has("dzMdReview.previousPendingConversation"));
  assert(commands.has("dzMdReview.addTimestampToCurrentReviewElement"));
  assert(commands.has("dzMdReview.convertTimestampsInActiveEditor"));

  assert.equal(
    keybindings.get("dzMdReview.addCriticMarkupAddition"),
    "cmd+alt+k a",
  );
  assert.equal(
    keybindings.get("dzMdReview.addCriticMarkupDeletion"),
    "cmd+alt+k s",
  );
  assert.equal(
    keybindings.get("dzMdReview.addCriticMarkupSubstitution"),
    "cmd+alt+k r",
  );
  assert.equal(
    keybindings.get("dzMdReview.addCriticMarkupHighlight"),
    "cmd+alt+k h",
  );
  assert.equal(
    keybindings.get("dzMdReview.addCriticMarkupComment"),
    "cmd+alt+k c",
  );
  assert.equal(
    keybindings.get("dzMdReview.createCriticMarkupDiscussion"),
    "cmd+alt+k d",
  );
  assert.equal(
    keybindings.get("dzMdReview.cancelCriticMarkupAnnotation"),
    "cmd+alt+k x",
  );
  assert.equal(
    keybindings.get("dzMdReview.applyCriticMarkupAnnotation"),
    "cmd+alt+k shift+x",
  );
  assert.equal(keybindings.get("dzMdReview.addHumanOk"), "cmd+alt+k o");
  assert.equal(
    keybindings.get("dzMdReview.removeHumanOk"),
    "cmd+alt+k shift+o",
  );
  assert.equal(keybindings.get("dzMdReview.nextReviewBlock"), "cmd+alt+k n");
  assert.equal(
    keybindings.get("dzMdReview.previousReviewBlock"),
    "cmd+alt+k shift+n",
  );
  assert.equal(keybindings.get("dzMdReview.nextConversation"), "cmd+ctrl+down");
  assert.equal(
    keybindings.get("dzMdReview.previousConversation"),
    "cmd+ctrl+up",
  );
  assert.equal(
    keybindings.get("dzMdReview.addTimestampToCurrentReviewElement"),
    "cmd+alt+k t",
  );
  assert.equal(
    keybindings.has("dzMdReview.convertTimestampsInActiveEditor"),
    false,
  );
  assert(
    hasKeybinding("dzMdReview.nextPendingConversation", "cmd+ctrl+alt+down"),
  );
  assert(
    hasKeybinding("dzMdReview.previousPendingConversation", "cmd+ctrl+alt+up"),
  );
  assert(hasKeybinding("dzMdReview.addHumanOk", "cmd+ctrl+alt+enter"));
  assert(hasKeybinding("dzMdReview.nextPendingConversation", "cmd+alt+k p"));
  assert(
    hasKeybinding(
      "dzMdReview.previousPendingConversation",
      "cmd+alt+k shift+p",
    ),
  );
});

test("review tracking view is contributed to the Explorer", () => {
  const pkg = readPackage();
  const commands = new Set(
    pkg.contributes.commands.map((command) => command.command),
  );
  const views = pkg.contributes.views.explorer;
  const viewTitleMenus = pkg.contributes.menus["view/title"];

  assert(pkg.activationEvents.includes("onView:dzMdReview.reviewItems"));
  assert(commands.has("dzMdReview.revealReviewItem"));
  assert(commands.has("dzMdReview.filterReviewItems"));
  assert(commands.has("dzMdReview.showPendingReviewItems"));
  assert(commands.has("dzMdReview.showAllReviewItems"));
  assert(commands.has("dzMdReview.showUnresolvedReviewItems"));
  assert(commands.has("dzMdReview.showOpenReviewItems"));
  assert(commands.has("dzMdReview.showWipReviewItems"));
  assert(commands.has("dzMdReview.showHandledReviewItems"));
  assert(commands.has("dzMdReview.showResolvedReviewItems"));
  assert.deepEqual(views.find((view) => view.id === "dzMdReview.reviewItems"), {
    id: "dzMdReview.reviewItems",
    name: "Review Items",
    type: "webview",
  });
  assert.deepEqual(
    viewTitleMenus.find((menu) =>
      menu.command === "dzMdReview.filterReviewItems"
    ),
    {
      command: "dzMdReview.filterReviewItems",
      when: "view == dzMdReview.reviewItems",
      group: "navigation",
    },
  );
});

test("review mode exposes modal single-key shortcuts behind a context", () => {
  const pkg = readPackage();
  const commands = new Set(
    pkg.contributes.commands.map((command) => command.command),
  );
  const keybindings = new Map(pkg.contributes.keybindings.map((binding) => [
    `${binding.command}:${binding.mac}`,
    binding.when,
  ]));

  assert(commands.has("dzMdReview.toggleReviewMode"));
  assert(commands.has("dzMdReview.enterReviewMode"));
  assert(commands.has("dzMdReview.exitReviewMode"));

  assert.equal(
    keybindings.get("dzMdReview.toggleReviewMode:cmd+alt+k m"),
    "editorTextFocus && editorLangId == markdown",
  );
  assert.equal(
    keybindings.get("dzMdReview.exitReviewMode:escape"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode",
  );
  assert.equal(
    keybindings.get("dzMdReview.nextReviewBlock:n"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode",
  );
  assert.equal(
    keybindings.get("dzMdReview.previousReviewBlock:shift+n"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode",
  );
  assert.equal(
    keybindings.get("dzMdReview.cancelCriticMarkupAnnotation:x"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode && !editorReadonly",
  );
  assert.equal(
    keybindings.get("dzMdReview.applyCriticMarkupAnnotation:shift+x"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode && !editorReadonly",
  );
  assert.equal(
    keybindings.get("dzMdReview.addHumanOk:o"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode && !editorReadonly",
  );
  assert.equal(
    keybindings.get("dzMdReview.approveAgentMessage:@"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode && !editorReadonly",
  );
  assert.equal(
    keybindings.get("dzMdReview.nextPendingConversation:p"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode",
  );
  assert.equal(
    keybindings.get("dzMdReview.previousPendingConversation:shift+p"),
    "editorTextFocus && editorLangId == markdown && dzMdReview.inReviewMode",
  );
});
