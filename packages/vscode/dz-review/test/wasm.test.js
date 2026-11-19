const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Loaded the way extension.test.js loads it: through vm, without __dirname,
// so the wasm must come inlined in the bundle rather than read from disk.
function loadCritique() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "out", "extension.js"),
    "utf8",
  );
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require(name) {
      return name === "vscode" ? {} : require(name);
    },
    module,
    exports: module.exports,
    TextDecoder,
    TextEncoder,
    crypto,
    process,
    Buffer,
  });
  return module.exports.__test.critique;
}

const SUMMARY = { source: "payload", width: 80 };

test("critique wasm reviews items with UTF-16 offsets and short ids", () => {
  const { items, map } = loadCritique().reviewItems(
    "a.md",
    "😀 {>> é <<}",
    null,
    SUMMARY,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].start, 3);
  assert.equal(items[0].end, 12);
  assert.match(items[0].id, /^rvw_/);
  assert.ok(items[0].id.slice(4).startsWith(items[0].shortId));
  assert.equal(typeof map, "string");
});

test("critique wasm returns no map once it is up to date", () => {
  const critique = loadCritique();
  const text = "a\n{>> x <<}\n<!-- @agent q\n@me a -->\n";
  const first = critique.reviewItems("a.md", text, null, SUMMARY);
  const again = critique.reviewItems("a.md", text, first.map, SUMMARY);

  assert.deepEqual(
    again.items.map(({ id }) => id),
    first.items.map(({ id }) => id),
  );
  assert.equal(again.map, null);
  // Array.from: arrays built inside the vm context fail strict deepEqual.
  assert.deepEqual(
    Array.from(first.items[1].messages, ({ author }) => author),
    [
      "@agent",
      "@me",
    ],
  );
});

test("critique wasm short ids are unique across the reference map", () => {
  const critique = loadCritique();
  const first = critique.reviewItems("a.md", "{>> x <<}", null, SUMMARY);
  const id = first.items[0].id;
  const map = JSON.parse(first.map);
  // Another file holds an id sharing the 6 first characters of this one.
  map.entries[`${id.slice(0, 10)}zzzzzz`] = {
    file: "b.md",
    range: { startLine: 1, endLine: 1 },
    mrfi: "",
  };
  const { items } = critique.reviewItems(
    "a.md",
    "{>> x <<}",
    JSON.stringify(map),
    SUMMARY,
  );

  assert.equal(first.items[0].shortId.length, 6);
  assert.ok(items[0].shortId.length > 6);
  assert.ok(id.slice(4).startsWith(items[0].shortId));
});

test("critique wasm summarizes items with the given options", () => {
  const { items } = loadCritique().reviewItems(
    "a.md",
    "{~~%1VB66I0Y|old~>new~~} {>> a\n  b <<}",
    null,
    { source: "payload", width: 4 },
  );

  assert.deepEqual(Array.from(items, ({ summary }) => summary), [
    "o...",
    "a b",
  ]);
});

test("critique wasm rejects an invalid reference map", () => {
  assert.throws(() =>
    loadCritique().reviewItems("a.md", "{>> x <<}", "{", SUMMARY)
  );
});

test("critique wasm accepts a lone surrogate without shifting offsets", () => {
  // wasm-bindgen replaces it with U+FFFD, which is one UTF-16 unit as well.
  const { items } = loadCritique().reviewItems(
    "a.md",
    "\uD800 {>> x <<}",
    null,
    SUMMARY,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].start, 2);
});

const T = { unixSeconds: 1767225600, offsetMinutes: 60 };

test("critique wasm parses timestamps in every format", () => {
  const critique = loadCritique();
  for (
    const value of ["1VB66I0Y", "%갚뚭씀갼", "2026-01-01T01:00:00+01:00"]
  ) {
    assert.deepEqual({ ...critique.parseTimestamp(value) }, T, value);
  }
  assert.equal(critique.parseTimestamp("nope"), undefined);
});

test("critique wasm encodes timestamps in every format", () => {
  const critique = loadCritique();
  assert.equal(critique.encodeTimestamp(T, "compact"), "1VB66I0Y");
  assert.equal(critique.encodeTimestamp(T, "hangul"), "갚뚭씀갼");
  assert.equal(
    critique.encodeTimestamp(T, "iso"),
    "2026-01-01T01:00:00+01:00",
  );
  assert.throws(() =>
    critique.encodeTimestamp({ unixSeconds: 0.5, offsetMinutes: 0 }, "iso")
  );
});

test("critique wasm converts existing timestamps only", () => {
  const iso = "2026-01-01T01:00:00+01:00";
  assert.equal(
    loadCritique().convertTimestamps(
      "<!-- @agent%1VB66I0Y q\n@me%갚뚭씀갼 a\n@me b -->\n" +
        `{++%${iso}|x++} {--y--} 50%discount`,
      "compact",
    ),
    "<!-- @agent%1VB66I0Y q\n@me%1VB66I0Y a\n@me b -->\n" +
      "{++%1VB66I0Y|x++} {--y--} 50%discount",
  );
});
