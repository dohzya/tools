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

test("critique wasm scans items with UTF-16 offsets", () => {
  const items = loadCritique().scanReviewItems("a.md", "😀 {>> é <<}");

  assert.equal(items.length, 1);
  assert.equal(items[0].start, 3);
});

test("critique wasm accepts a lone surrogate without shifting offsets", () => {
  // wasm-bindgen replaces it with U+FFFD, which is one UTF-16 unit as well.
  const items = loadCritique().scanReviewItems("a.md", "\uD800 {>> x <<}");

  assert.equal(items.length, 1);
  assert.equal(items[0].start, 2);
});
