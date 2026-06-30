const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readGrammar(filename) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "syntaxes", filename), "utf8"),
  );
}

function readPackage() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
}

const GRAMMAR_TIMESTAMP_PATTERN =
  "[A-Za-z0-9]{8}|[가-돿]{4}|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:Z|[+-]\\d{2}:?\\d{2})";

test("global list fallback starts HTML and custom conversations", () => {
  const grammar = readGrammar("md-review-list-injection.tmLanguage.json");

  assert.equal(grammar.injectionSelector, "L:text.html.markdown");
  assert.deepEqual(grammar.patterns, [
    { include: "#md-review-conversation" },
    { include: "#md-review-custom-conversation" },
  ]);
  assert.equal(
    grammar.repository["md-review-conversation"].begin,
    `<!--(?=(?:(?!-->)[\\s\\S])*\\s*@(agent|me)?(?:%(?:${GRAMMAR_TIMESTAMP_PATTERN}))?(?=\\s|$))`,
  );
  assert.equal(
    grammar.repository["md-review-custom-conversation"].begin,
    `\\{\\?\\?(?=(?:(?!\\?\\?\\})[\\s\\S])*\\s*@(agent|me)?(?:%(?:${GRAMMAR_TIMESTAMP_PATTERN}))?(?=\\s|$))`,
  );
  assert.equal(
    grammar.repository["md-review-custom-conversation"].end,
    "\\?\\?\\}",
  );
});

test("all conversation grammars include inline role scopes", () => {
  for (
    const filename of [
      "md-review-injection.tmLanguage.json",
      "md-review-list-injection.tmLanguage.json",
    ]
  ) {
    const grammar = readGrammar(filename);

    for (
      const key of ["md-review-conversation", "md-review-custom-conversation"]
    ) {
      const includes = grammar.repository[key].patterns.map((pattern) =>
        pattern.include
      );

      assert(
        includes.includes("#md-review-agent-inline"),
        `${filename}:${key} lacks @agent inline`,
      );
      assert(
        includes.includes("#md-review-human-inline"),
        `${filename}:${key} lacks @me inline`,
      );
      assert(
        includes.includes("#md-review-human-quick-inline"),
        `${filename}:${key} lacks @ inline`,
      );
    }

    assert(
      grammar.repository["md-review-agent-inline"].match.includes(
        `%(?:${GRAMMAR_TIMESTAMP_PATTERN})`,
      ),
      `${filename} agent role does not support timestamp metadata`,
    );
    assert.equal(
      grammar.repository["md-review-agent-inline"].captures["2"].name,
      "meta.timestamp.review.markdown",
    );
    assert.equal(
      grammar.repository["md-review-human-line"].captures["2"].name,
      "meta.timestamp.review.markdown",
    );
  }
});

test("HTML comment injection supports inline role scopes", () => {
  const grammar = readGrammar(
    "md-review-html-comment-injection.tmLanguage.json",
  );
  const includes = grammar.patterns.map((pattern) => pattern.include);

  assert(includes.includes("#md-review-agent-inline"));
  assert(includes.includes("#md-review-human-inline"));
  assert(includes.includes("#md-review-human-quick-inline"));
});

test("ref snapshots use labelled recursive TextMate rules", () => {
  for (
    const filename of [
      "md-review-injection.tmLanguage.json",
      "md-review-list-injection.tmLanguage.json",
      "md-review-html-comment-injection.tmLanguage.json",
    ]
  ) {
    const grammar = readGrammar(filename);
    const snapshot = grammar.repository["md-review-ref-snapshot"];

    assert.equal(snapshot.begin, "\\{&&([A-Za-z0-9_-]+)");
    assert.equal(snapshot.end, "\\1&&\\}");
    assert.deepEqual(snapshot.patterns, [
      { include: "#md-review-ref-snapshot" },
    ]);
    assert.equal(
      snapshot.beginCaptures["1"].name,
      "entity.name.label.ref-snapshot.md-review.markdown",
    );
  }
});

test("comment marker colors target review and native HTML punctuation scopes", () => {
  const pkg = readPackage();
  const rules =
    pkg.contributes.configurationDefaults["editor.tokenColorCustomizations"]
      .textMateRules;
  const markerRule = rules.find((rule) =>
    rule.settings.foreground === "#8C8FA1"
  );

  assert.deepEqual(markerRule.scope, [
    "punctuation.definition.comment.begin.md-review.markdown",
    "punctuation.definition.comment.end.md-review.markdown",
    "punctuation.definition.comment.begin.html",
    "punctuation.definition.comment.end.html",
  ]);
});

test("Obsidian Markdown grammar includes Obsidian and custom review annotation scopes", () => {
  const grammar = readGrammar("obsidian-markdown-injection.tmLanguage.json");

  assert.equal(
    grammar.injectionSelector,
    "L:text.html.markdown",
  );
  assert(
    grammar.patterns.some((pattern) =>
      pattern.include === "#obsidian-wikilinks"
    ),
  );
  assert(
    grammar.patterns.some((pattern) =>
      pattern.include === "#criticmarkup-substitution"
    ),
  );
  assert.equal(
    grammar.repository["obsidian-wikilinks"].name,
    "markup.underline.link.obsidian.markdown",
  );
  assert.equal(
    grammar.repository["obsidian-callouts"].captures["1"].name,
    "storage.type.callout.obsidian.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-addition"].name,
    "markup.inserted.critic.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-addition"].beginCaptures["2"].name,
    "meta.timestamp.review.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-highlight"].beginCaptures["2"].name,
    "meta.timestamp.review.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-addition"].endCaptures["0"].name,
    "punctuation.definition.addition.end.critic.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-deletion"].endCaptures["0"].name,
    "punctuation.definition.deletion.end.critic.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-highlight"].endCaptures["0"].name,
    "punctuation.definition.highlight.end.critic.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-comment"].beginCaptures["2"].name,
    "meta.timestamp.review.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-comment"].endCaptures["0"].name,
    "punctuation.definition.comment.end.critic.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-substitution"].captures["4"].name,
    "punctuation.separator.substitution.critic.markdown",
  );
  assert.equal(
    grammar.repository["obsidian-comments"].patterns[1].begin,
    "^\\s*%%\\s*$",
  );
  assert.equal(
    grammar.repository["criticmarkup-substitution"].match,
    `(\\{~~)(%(?:${GRAMMAR_TIMESTAMP_PATTERN})\\|)?(.*?)(~>)(.*?)(~~\\})`,
  );
  assert.equal(
    grammar.repository["criticmarkup-substitution"].captures["1"].name,
    "punctuation.definition.substitution.begin.critic.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-substitution"].captures["3"].name,
    "markup.deleted.critic.substitution.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-substitution"].captures["5"].name,
    "markup.inserted.critic.substitution.markdown",
  );
  assert.equal(
    grammar.repository["criticmarkup-substitution"].captures["6"].name,
    "punctuation.definition.substitution.end.critic.markdown",
  );
  assert.equal(
    grammar.repository["obsidian-highlights"].begin,
    "(?<!\\{)==(?!\\})",
  );
});

test("timestamp metadata has a dim token color rule", () => {
  const pkg = readPackage();
  const rules =
    pkg.contributes.configurationDefaults["editor.tokenColorCustomizations"]
      .textMateRules;
  const timestampRule = rules.find((rule) =>
    Array.isArray(rule.scope)
      ? rule.scope.includes("meta.timestamp.review.markdown")
      : rule.scope === "meta.timestamp.review.markdown"
  );

  assert.deepEqual(timestampRule.settings, {
    foreground: "#8C8FA1",
    fontStyle: "",
  });
});
