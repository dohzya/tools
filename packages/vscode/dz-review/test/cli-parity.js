#!/usr/bin/env node
// Compares what the extension gets from critique-wasm (the bundled
// out/extension.js) with what the `critique` CLI prints, over a corpus of
// Markdown files: review items (ids, short ids, kind, state, lines,
// messages), the reference map, references and timestamp conversion.
//
// Usage: node test/cli-parity.js [file-or-dir...]
//   CRITIQUE_BIN  critique binary (default: <repo>/target/debug/critique)
// Without arguments the corpus is every Markdown file of the black-box
// fixtures, docs, plugins and packages/tools, plus the top-level ones and
// the inline SAMPLES.
//
// Each file is copied alone as doc.md into a fresh dir with its own state
// dir, so both sides hash the same path and shorten ids over the same set.
// Not compared: the item summary (the panel renders payload/display text cut
// to a width, the CLI prints the raw block as context) and rawHash (not
// exposed to the extension). UTF-16 ranges are checked against the CLI lines.
//
// Not a node:test file on purpose (npm test must not need the CLI).

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BIN = process.env.CRITIQUE_BIN ??
  path.join(ROOT, "target", "debug", "critique");
// Guards against a vacuous pass (empty corpus, everything skipped).
const MIN_FILES = 250;
const MIN_ITEMS = 150;

// The repo's Markdown has almost no CR-only, CRLF or astral text around
// items: the cases where the wasm facade converts offsets and lines.
const SAMPLES = [
  [
    "cr-only",
    "# CR\r\rA {?? @me cr ??}\r\r<!--\r@agent q\r@me%1VB66I0Y ok\r-->\r",
  ],
  [
    "crlf",
    "# CRLF\r\n\r\n<!--\r\n@agent%갚뚭씀갼 q\r\n@me a\r\n-->\r\nx {++%2026-01-01T01:00:00+01:00|y++}\r\n",
  ],
  [
    "astral",
    "😀 {>> é 😀 <<} 𝄞 {~~a~>b~~}\n\n{?? @me%1VB66I0Y 🙂 ??} <!-- ref%1VB66I0Y: a.md:1 -->\n",
  ],
  ["duplicates", "{>> a <<} {>> a <<}\n\n{>> a <<}\n"],
  ["nested", "<!--\n@agent see {>> inner <<}\n@me\n-->\n{== hl ==}{>> c <<}\n"],
  [
    "refs",
    "<!--\n  ref%갚뚭씀갼:\n  a.md:2;\n  b.md\n-->\n{>> see <!-- ref%1VB66I0Y: a.md:1 --> <<}\n",
  ],
];

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

function markdownFiles(entry) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) return entry.endsWith(".md") ? [entry] : [];
  return fs.readdirSync(entry).sort()
    .filter((name) => name !== "node_modules")
    .flatMap((name) => markdownFiles(path.join(entry, name)));
}

function run(cwd, args, input) {
  const result = childProcess.spawnSync(BIN, args, {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      // The CLI's own identity, not the black box's dz-review compat mode.
      CRITIQUE_COMPAT_DZ_REVIEW: "",
      CRITIQUE_STATE_DIR: "",
      CRITIQUE_IGNORE_FILE: "",
      GIT_CEILING_DIRECTORIES: path.dirname(cwd),
      TZ: "UTC",
      NO_COLOR: "1",
    },
  });
  if (result.error) throw result.error;
  return result;
}

const NO_ITEMS = "No review annotations found.\n";

function cliItems(cwd, file, stateDir) {
  const args = ["list", file, "--state-dir", stateDir];
  const json = run(cwd, [...args, "--json"]);
  if (json.status !== 0) {
    return { error: `list --json exited ${json.status}: ${json.stderr}` };
  }
  const items = json.stdout === NO_ITEMS ? [] : JSON.parse(json.stdout).items;
  const text = run(cwd, [...args, "--no-pager"]);
  // Item headers: `1/2 handled conversation 3l8ict doc.md:3-3`.
  const shortIds = [
    ...text.stdout.matchAll(/^\d+\/\d+ .* (\S+) doc\.md:\d+-\d+$/gm),
  ].map((m) => m[1]);
  const mapFile = path.join(stateDir, "reference-map.json");
  const map = fs.existsSync(mapFile)
    ? JSON.parse(fs.readFileSync(mapFile, "utf8"))
    : null;
  return { items, shortIds, map };
}

function message(m) {
  return m && { author: m.author, body: m.body, timestamp: m.timestamp };
}

// Instant of the metadata timestamp of an annotation, as the CLI context
// shows it (`{++%ts|...`); conversations carry theirs in messages.
const CONTEXT_TS = /^\{(?:\+\+|--|==|>>|~~)%([^|\s]+)\|/;

function instant(critique, value) {
  const t = value === undefined ? undefined : critique.parseTimestamp(value);
  return t && t.unixSeconds;
}

function compareItems(report, rel, text, wasm, cli, critique) {
  const pick = (i) => ({
    id: i.id,
    kind: i.kind,
    state: i.state,
    lineStart: i.lineStart,
    lineEnd: i.lineEnd,
  });
  same(report, rel, "items", cli.items.map(pick), wasm.items.map(pick));
  same(
    report,
    rel,
    "short ids",
    cli.shortIds,
    wasm.items.map((i) => i.shortId),
  );
  same(
    report,
    rel,
    "messages",
    cli.items.map((i) => [message(i.firstMessage), message(i.lastMessage)]),
    wasm.items.map((i) =>
      i.messages
        ? [message(i.messages[0]), message(i.messages.at(-1))]
        : [undefined, undefined]
    ),
  );
  same(
    report,
    rel,
    "timestamps",
    cli.items.map((i) =>
      i.kind === "conversation"
        ? undefined
        : instant(critique, CONTEXT_TS.exec(i.context ?? "")?.[1])
    ),
    wasm.items.map((i) =>
      i.kind === "conversation" ? undefined : instant(critique, i.timestamp)
    ),
  );
  // The UTF-16 range must cover the lines the CLI reports (the CLI JSON has
  // no offsets: this is line-granular).
  const lineOf = (offset) => text.slice(0, offset).split(/\r\n|\r|\n/).length;
  same(
    report,
    rel,
    "ranges",
    cli.items.map((i) => [i.lineStart, i.lineEnd]),
    wasm.items.map((
      i,
    ) => [lineOf(i.start), lineOf(Math.max(i.start, i.end - 1))]),
  );
  same(
    report,
    rel,
    "reference map",
    cli.map,
    wasm.map === null ? null : JSON.parse(wasm.map),
  );
}

function compareRefs(report, rel, cwd, file, text, critique) {
  const out = run(cwd, ["ref", "list", file, "--json", "--no-pager"]);
  if (out.status !== 0) {
    report.divergences.push(`${rel}: ref list exited ${out.status}`);
    return;
  }
  const cli = JSON.parse(out.stdout).refs.map((r) => ({
    raw: r.target.raw,
    path: r.target.path,
    lineRange: r.target.lineRange,
  }));
  const wasm = critique.referenceTargets(text).map((t) => ({
    raw: text.slice(t.start, t.end),
    path: t.path,
    lineRange: t.lineRange &&
      { end: t.lineRange.end, start: t.lineRange.start },
  }));
  same(report, rel, "references", cli, wasm);
  report.refs += wasm.length;
}

// The CLI `timestamp` also stamps untimestamped items, which the wasm
// conversion never does: stamp everything with the CLI first, then compare
// the pure conversions of that text.
function compareTimestamps(report, rel, cwd, file, critique) {
  const stamped = run(cwd, ["timestamp", file, "--stdout", "--compact"]);
  if (stamped.status !== 0) {
    report.divergences.push(`${rel}: timestamp exited ${stamped.status}`);
    return;
  }
  for (const format of ["iso", "hangul", "compact"]) {
    const cli = run(
      cwd,
      ["timestamp", "--stdin", `--${format}`],
      stamped.stdout,
    );
    let wasm;
    try {
      wasm = critique.convertTimestamps(stamped.stdout, format);
    } catch (error) {
      wasm = `error: ${error.message}`;
    }
    const expected = cli.status === 0 ? cli.stdout : `exit ${cli.status}`;
    if (expected !== wasm && !(cli.status !== 0 && wasm.startsWith("error"))) {
      report.divergences.push(`${rel}: timestamp --${format} differs`);
    }
  }
  report.spans += critique.timestampSpans(stamped.stdout).length;
}

function same(report, rel, what, expected, actual) {
  const a = JSON.stringify(expected);
  const b = JSON.stringify(actual);
  if (a !== b) {
    report.divergences.push(`${rel}: ${what}\n  cli:  ${a}\n  wasm: ${b}`);
  }
}

function main() {
  const critique = loadCritique();
  const roots = process.argv.length > 2 ? process.argv.slice(2) : [
    path.join(ROOT, "tests", "blackbox", "fixtures"),
    ...["docs", "plugins", path.join("packages", "tools")].map((dir) =>
      path.join(ROOT, dir)
    ),
    ...fs.readdirSync(ROOT).filter((name) => name.endsWith(".md")).map((
      name,
    ) => path.join(ROOT, name)),
  ];
  const files = roots.flatMap((r) => markdownFiles(path.resolve(r)));
  const sources = [
    ...files.map((f) => ({
      rel: path.relative(ROOT, f).split(path.sep).join("/"),
      read: () => fs.readFileSync(f),
    })),
    ...(process.argv.length > 2 ? [] : SAMPLES.map(([name, text]) => ({
      rel: `sample:${name}`,
      read: () => Buffer.from(text),
    }))),
  ];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const report = {
    files: 0,
    items: 0,
    refs: 0,
    spans: 0,
    skipped: [],
    divergences: [],
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "critique-parity-"));
  try {
    for (const { rel, read } of sources) {
      let text;
      try {
        text = decoder.decode(read());
      } catch {
        report.skipped.push(`${rel} (not UTF-8)`);
        continue;
      }
      // One work dir per file: a reference map shared across files makes
      // the extension's short ids legitimately longer than the CLI's.
      const cwd = fs.mkdtempSync(path.join(tmp, "f-"));
      const file = "doc.md";
      fs.writeFileSync(path.join(cwd, file), text);
      const stateDir = path.join(cwd, ".state");
      const cli = cliItems(cwd, file, stateDir);
      if (cli.error) {
        report.divergences.push(`${rel}: ${cli.error}`);
        continue;
      }
      const wasm = critique.reviewItems(file, text, null, {
        source: "payload",
        width: 80,
      });
      compareItems(report, rel, text, wasm, cli, critique);
      compareRefs(report, rel, cwd, file, text, critique);
      compareTimestamps(report, rel, cwd, file, critique);
      report.files += 1;
      report.items += wasm.items.length;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(
    `${report.files} files, ${report.items} items, ${report.refs} references, ${report.spans} timestamps compared`,
  );
  for (const s of report.skipped) console.log(`skipped: ${s}`);
  for (const d of report.divergences) console.log(`DIVERGENCE ${d}`);
  if (process.argv.length <= 2) {
    if (report.files < MIN_FILES || report.items < MIN_ITEMS) {
      console.log(
        `too little compared (minimum ${MIN_FILES} files, ${MIN_ITEMS} items)`,
      );
      process.exitCode = 1;
    }
  }
  if (report.divergences.length > 0) process.exitCode = 1;
}

main();
