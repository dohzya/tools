# WASM spike: one Rust core, used by the VS Code extension host and the CLI

Date: 2026-10-29. Question: can a pure-Rust core compile to WebAssembly and be called synchronously from the VS Code extension host (Node, CommonJS), giving the same results as the existing TypeScript code and as the native CLI?

Answer: yes. No blocker found. Everything below was measured on this machine (WSL2, Node 22.22.3, Rust 1.99.1, wasm-bindgen 0.2.129).

## Layout

```
Cargo.toml        workspace, release profile opt-level=z, lto, panic=abort
core/             pure lib: mdast.rs (copied from ../md-ast-rust), pos.rs, review_id.rs, api.rs
wasm/             cdylib, 4 `#[wasm_bindgen]` one-liners forwarding to core::api
cli/              bin `spike`, argv/stdin/stdout adapter over core::api
build.sh          the whole build (cargo + wasm-bindgen only)
harness/          Node (CJS) parity, bench, esbuild bundles; TS reference generators (deno)
```

Ported from TS: `getShortStableReviewItemId`, `assignStableReviewItemIds` (key building, FNV-1a over UTF-16 units, base62, occurrence suffix), `stripReviewTimestamps`, and the parts of `timestamp.ts`/`hangul.ts` that the anchor needs (compact, ISO, hangul, with the legacy-window rule). NOT ported: `collectReviewReferences` / `formatReferenceTarget` (`ref-core.ts`, 528 lines of regexes with lookaheads, lazy quantifiers and `matchAll` indices; not attempted in the time box) and `reference-map.ts`, `runtime-config.ts` (the injected environment stays in TS; the core takes no environment).

## Toolchain and commands (Oct 2026)

Homebrew's `rust` has no wasm target, so a user-local rustup was used:

```sh
export RUSTUP_HOME=$HOME/.local/share/rustup CARGO_HOME=$HOME/.local/share/cargo-spike
sh rustup-init.sh -y --no-modify-path --profile minimal -t wasm32-unknown-unknown
cargo install wasm-bindgen-cli --locked          # 0.2.129 == crate pin "=0.2.129"
# optional: mise x github:WebAssembly/binaryen@latest -- wasm-opt   (version 133)
# esbuild:  mise x npm:esbuild@latest -- esbuild   (0.28.2)
./build.sh
#  cargo build --release -p spike-cli
#  cargo build --release -p spike-wasm --target wasm32-unknown-unknown
#  wasm-bindgen --target nodejs --out-dir harness/pkg-node target/wasm32-unknown-unknown/release/spike_wasm.wasm
```

`wasm-pack` was not used: it is a wrapper that downloads/looks up the same `wasm-bindgen` and `wasm-opt`; calling `wasm-bindgen` directly is fewer moving parts. The CLI version must equal the crate version exactly (pin `=0.2.129`). In mise terms: `rust` (with `targets=wasm32-unknown-unknown`) + `cargo:wasm-bindgen-cli`.

Target choice: `--target nodejs` gives CJS glue that instantiates synchronously at `require()` (`new WebAssembly.Module(fs.readFileSync(...))`). `--target
bundler`/ESM-with-top-level-wasm-import is irrelevant for the extension host (needs a bundler plugin / ESM). `--target web` is useful only for the inlined esbuild variant below (`initSync`).

## Results

### Parity

Two separate questions.

**A. wasm vs native CLI (the hard requirement: editor and CLI agree).** Both are built from the same `core` crate. Run: `node harness/parity.cjs`.

| input                                                                                                                           | compared                                                                                                  | result                 |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| 80 corpus files                                                                                                                 | outline JSON (id, level, title, line, UTF-16 start/end) from wasm, native via stdin, native via file path | 80/80 byte-identical   |
| 300 generated review-id cases (796 ids; emoji, NBSP, BOM, CRLF, 3 timestamp formats, bad dates, duplicates, `\\` in file names) | wasm vs native                                                                                            | 0 differences          |
| 200 generated short-id cases                                                                                                    | wasm vs native                                                                                            | 0 differences          |
| `section_id(2,"Héllo 😀",1)`                                                                                                    | wasm vs native                                                                                            | identical (`cfb7d667`) |

The UTF-16 boundary is exercised in two ways: positions (`pos.rs` tests with `😀`/`é`/CRLF/lone CR, plus emoji headings in the benchmark docs), and review ids, where TS hashes `charCodeAt` units and slices at 160 UTF-16 units. The generator includes strings with an emoji straddling the 160-unit cut; Rust reproduces the split surrogate because `review_id.rs` works on `Vec<u16>`.

**B. TS reference vs Rust.**

Review ids (the function the extension actually calls): 300 cases / 796 ids and 200 short-id cases, generated with a seeded PRNG (`harness/gen-reviewid.ts`, reference values produced by running the real TS under `deno -A`), 0 mismatches after one fix. The first run had 6 mismatches, all **rust-bug** (mine): for `2024-04-31` / `2023-02-29` the TS `new Date()` (V8) rolls the day over to the next month instead of rejecting it (the ES spec says invalid; V8 accepts days 1..31 in any month; day 32 and month 13 are rejected). The port validated the calendar strictly. Fixed by accepting 1..=31. Note this is a concrete example of engine-specific behaviour hidden in a "pure" function: the TS reference IS V8.

Corpus outline (section ids): 59/80 identical, 21 files differ (29 headings), i.e. the same figures as Spike B. Classification, with evidence:

| files                                                                                                     | class                | evidence                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `crlf`, `crlf-fence`, `cr-only`                                                                           | ts-bug               | CommonMark 2.1: line endings are LF, CRLF or CR. TS splits on `\n` and finds 0 headings                                                      |
| `fence-indented4`                                                                                         | ts-bug               | CM 4.5: a fence may be indented at most 3 spaces; 4 spaces is indented code, so the later heading is real                                    |
| `fence-info-close`                                                                                        | ts-bug               | CM 4.5: a closing fence cannot carry an info string; TS closes early and shows a heading that is code (`only TS: still code`) and misses `B` |
| `fence-longer`, `fence-mixed`                                                                             | ts-bug               | CM 4.5: closing fence must be at least as long as the opening one and use the same character                                                 |
| `fence-inline-triple`, `heading-after-fence-same-line`                                                    | ts-bug               | CM 4.5: info string of a backtick fence cannot contain backticks (not a fence); TS miscounts                                                 |
| `setext`, `setext-multiline`, `thematic-vs-setext`, `dashes-no-frontmatter-late`, `frontmatter-not-first` | intended-rule-change | CM 4.3 setext headings; TS does not implement them. Behavioural change for documents using them: ids appear that did not exist               |
| `atx-1sp`, `atx-3sp`                                                                                      | intended-rule-change | CM 4.2: 0-3 spaces of indentation allowed; TS requires column 0                                                                              |
| `atx-empty`                                                                                               | intended-rule-change | CM 4.2: empty ATX heading is a heading                                                                                                       |
| `atx-nbsp`                                                                                                | intended-rule-change | CM 4.2: `#` must be followed by space/tab/EOL; NBSP does not count (TS regex `\s` accepts it)                                                |
| `html-block`, `html-comment`, `html-pre`                                                                  | intended-rule-change | CM 4.6: `#` lines inside HTML blocks are not headings                                                                                        |
| rust-bug                                                                                                  | none found           | but see caveat                                                                                                                               |

Caveat: the "intended-rule-change" rows are changes the migration plan must accept explicitly (they change which ids exist); the "ts-bug" rows are unambiguous per spec. The only oracle for "Rust is right" is pulldown-cmark itself (an independent CommonMark implementation was not run), and the TS tests/docs defining the original intent were not re-read in this spike.

### Sizes (`opt-level=z`, lto, panic=abort)

| item                                                                   | bytes                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `spike_wasm.wasm` (cargo output)                                       | 298,905                                        |
| `*_bg.wasm` after wasm-bindgen                                         | 268,884                                        |
| after `wasm-opt -Oz` (binaryen 133, with bulk-memory/sign-ext enabled) | 256,054 (-5 %); parity re-run on it: identical |
| gzip -9 raw / opt                                                      | 114,982 / 114,092                              |
| brotli raw / opt                                                       | 97,250 / 96,878                                |
| glue `spike_wasm.js` (nodejs)                                          | 7.8 KB                                         |
| native `spike` (stripped)                                              | 718,520                                        |

`wasm-opt` is optional: -5 % only (wasm-bindgen output is already compact). Most of the size is pulldown-cmark, unicode tables, serde_json and sha2. A vsix is zip-compressed, so ~115 KB on the wire.

### Imports and host constraints

`WebAssembly.Module.imports` on the module: exactly one import, `./spike_wasm_bg.js::__wbindgen_generic_0000000000000001` (a wasm-bindgen helper). No `env`, no WASI, no `fetch`. The nodejs glue is plain CJS (`exports.x = ...`), no top-level await, instantiates synchronously inside `require()`. The only I/O is `require('fs').readFileSync(__dirname + '/..._bg.wasm')` (see bundling). Not run inside a real VS Code instance (unverified); only plain Node 22.22.3. VS Code's Electron ships a Node >= 20 with `WebAssembly`; web extension hosts (vscode.dev) would need the `web`/`initSync` variant.

### Latency (mean over 1000 calls, Node 22, after 20 warmups)

| call                           | wasm in-process | native CLI via `spawnSync` + stdin     | TS (`parseDocument`, deno) |
| ------------------------------ | --------------- | -------------------------------------- | -------------------------- |
| instantiate (incl. `require`)  | 1.6 ms once     | n/a                                    | n/a                        |
| outline, 10 KB (92 sections)   | 0.42 ms         | 3.05 ms cold / 1.99 ms warm (mean 200) | 3.77 ms                    |
| outline, 1 MB (8,920 sections) | 41.3 ms         | 46.1 ms cold / 43.1 ms warm (mean 50)  | 367.8 ms (mean 100)        |
| `assign_stable_ids`, 50 items  | 0.13 ms         | 1.91 ms warm                           | not measured               |

Notes: the TS number includes sha-256 per heading and runs under deno, not Node (same V8). Both Rust numbers use opt-level `z` and a JSON-string result (`serde_json` + string copy across the boundary); an opt-level 3 build was not measured. The spawn cost is a ~2 ms fixed floor; for a 1 MB document the parse dominates and wasm ~ spawn. Per-keystroke use (on-change decorations) favours wasm by ~5x at 10 KB.

A bug found by the 1 MB benchmark: the first `outline` converted every heading position with a scan from the start of the text (O(n) per heading, quadratic); it hung for > 2 minutes. Fixed with `position_in_line` (O(line)). Lesson: the offset helper must take a known line start.

### Memory / leak check

10,000 `outline` (10 KB) + 1,000 `assign_stable_ids` calls: wasm linear memory 20,840,448 bytes before and after (does not grow after the first call's allocation), RSS +128 KB; a second 10k calls: +0 bytes. No leak with `&str -> String` signatures (wasm-bindgen frees the temporary buffers). (Linear memory starts at ~20 MB because of the stack/heap layout of this build; not investigated.)

### Native CLI spawn as fallback

See the latency table. Cold 3 ms / warm 2 ms for small documents, ~43 ms for 1 MB. Requires shipping a per-platform binary in the vsix (7-8 targets) and handling spawn errors, encodings (stdin UTF-8 only) and lifecycle; no instantiate cost; no memory sharing issue.

### Bundling with esbuild (replaces `deno bundle`)

Two variants, both verified to run under Node 22 (`harness/bundle/`):

```sh
# A. nodejs glue + sibling asset. JS 8.3 KB; extension.js must ship next to spike_wasm_bg.wasm (268,884)
esbuild entry-asset.cjs --bundle --platform=node --format=cjs --external:vscode --outfile=out-asset/extension.js
cp pkg-node/spike_wasm_bg.wasm out-asset/

# B. web glue + initSync + wasm embedded in the JS (single file, no fs, no asset)
wasm-bindgen --target web --out-dir pkg-web ...
esbuild entry-inline.mjs --bundle --platform=node --target=node20 --format=cjs --external:vscode \
  --loader:.wasm=binary --outfile=out-inline/extension.js          # 364,453 B; --minify 361,156 B (151,628 gz)
```

Friction: (1) in A the `__dirname`-relative `readFileSync` survives bundling only because the file is copied next to the bundle; the vsix must include it. (2) in B the esbuild `binary` loader emits `Uint8Array.fromBase64` for the default target, which Node 22 lacks (it runs at import and would crash the extension host on such Node versions); `--target=node20` selects the portable helper. (3) the `web` glue contains an `import.meta.url`/`fetch` fallback branch that is dead when `initSync({module})` is used; esbuild warns about `import.meta` in CJS (harmless; filter the warning). B is the more robust choice (one file, works in web hosts too).

### Build reproducibility in CI terms

`cargo build` + `wasm-bindgen` (version-pinned, `cargo install --locked` or a prebuilt release) is the whole chain; no Node step is needed to produce the `.wasm` + glue. `wasm-opt` is optional. Bit-for-bit reproducibility of the `.wasm` was not checked. The `pkg-node` output is generated, not committed.

## Friction summary

1. Homebrew rust lacks the wasm target: needs rustup (or mise's rust with targets).
2. `wasm-bindgen` CLI version must match the crate exactly (`=` pin).
3. Hidden engine semantics in "pure" TS: V8 date rollover, JS `\s` (includes U+FEFF, which Rust's `is_whitespace` excludes), `slice` with a negative end (`lastIndexOf` = -1), UTF-16 slicing, `toLowerCase`. A port must be differential-tested against V8, not just against the spec.
4. Regexes with lookahead/backtracking (`REVIEW_MARKER_RE`) cannot use the `regex` crate; hand-written scanners were needed (~90 lines). `ref-core.ts` would need the same treatment, more of it.
5. Lone surrogates cannot cross the wasm-bindgen string boundary (replaced by U+FFFD); VS Code documents can contain them in theory. Not tested.
6. Glue uses `fs.readFileSync(__dirname/...)` (nodejs target) or a missing-asset failure at activation time if the file is not packaged.
7. esbuild `binary` loader / Node 22 incompatibility (above).

## Verdict

- **wasm in-process: recommended** for the extension. Synchronous, ~5x faster than spawning for small documents, 4-9x faster than the current TS, no per- platform binaries, 115 KB gz, one import, no leak, byte-identical to native.
- **CLI spawn**: viable fallback, but 2-3 ms floor per call, async-ish plumbing, and per-platform binaries; only worth it if wasm breaks in some host.
- **Keep a TS copy**: rejected; it is exactly the divergence risk (the 21 corpus files, the V8 date rule) the migration is meant to remove.

## What the Rust workspace design must guarantee

Agreement between editor and CLI is structural, not tested-in: both adapters are 1:1 forwarders over `core::api`; the `wasm` crate and the `cli` crate contain no logic (only decoding of argv/stdin or wasm-bindgen types). Any behaviour is therefore in the one crate that both link. `parity.cjs` is the regression guard (wasm vs native on the corpus and on generated inputs).

Core purity rules:

1. No `std::fs`, `std::env`, `std::process`, `std::time`, threads, sockets, no `getrandom`/`rand`/system clock (they break or bloat wasm32-unknown-unknown). "Now" and the local timezone offset are parameters.
2. API surface: `&str`/numbers in, `String` (JSON) or `Result<String, String>` out. No lifetimes or iterators across the boundary; no `JsValue`, no `wasm-bindgen` in `core`.
3. Positions: core returns UTF-16 line/character for editor-facing data (conversion helper in core, tested with non-BMP text); never expose byte offsets to the extension. Offset helpers must take a known line start (avoid O(n) scans per item).
4. Text semantics that TS relied on (UTF-16 units for hashing and `slice`) are part of the contract: keep those ports on `Vec<u16>` and fix them with differential tests against the TS/V8 reference.
5. Dependencies must compile to `wasm32-unknown-unknown` without C toolchains (pulldown-cmark, sha2, serde_json do). Check new deps in CI with `cargo build --target wasm32-unknown-unknown -p core`.
6. Pin `wasm-bindgen` crate with `=` and install the identical CLI version.
7. CI: build native + wasm from the same commit, run `parity.cjs` (wasm vs native byte-identical) and the TS-reference comparison while TS still exists.

## Not verified

- Behaviour inside a real VS Code / Electron host or a web extension host.
- `collectReviewReferences`, `formatReferenceTarget`, `reference-map` (not ported).
- Lone-surrogate input; timestamps outside the generated families (e.g. far-future hangul legacy window beyond what the generator hits).
- opt-level 3 speed; bit-for-bit reproducible `.wasm`; Windows/macOS.
- Independence of the CommonMark oracle (pulldown only).

## Reproduce

```sh
./build.sh
deno -A harness/gen-reviewid.ts harness/expected-reviewid.json
deno -A harness/gen-corpus.ts <md-corpus-dir> harness/expected-corpus.json
node harness/parity.cjs          # writes harness/parity-result.json
node --expose-gc harness/bench.cjs
deno -A harness/bench-ts.ts
```
