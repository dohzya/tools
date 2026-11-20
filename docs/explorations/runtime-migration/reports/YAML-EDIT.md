# YAML frontmatter editing spike (Rust vs Bun)

Date: 2026-10-27. Reproduce: `cargo build --release && bun run.ts` (writes `matrix.md`, `results.json`, `out/`); `deno run -A baseline.ts` for the TS baseline; `bun fuzz.ts` for the robustness fuzz.

## 1. What the current TS code guarantees (read from source, then measured)

- `md meta set/delete` (`markdown-surgeon/domain/use-cases/manage-frontmatter.ts`) and worklog task rewrites (`worklog/adapters/markdown/surgeon-adapter.ts` l.304-335, l.472-485) all do **parse -> JS object -> mutate -> `@std/yaml` `stringify(obj, {lineWidth:-1})` -> `.trim()`** and replace the whole frontmatter block. There is NO lossless editing and no hand-rolled serializer (`yaml.ts` is a shim over `adapters/services/yaml-parser.ts`). Worklog also builds new task files from scratch with key order = object insertion order.
- Consequences measured with `baseline.ts` on the same 42 samples (only 14/42 are byte-identical after a no-op re-serialization): comments dropped; block scalar `>` folded onto one line; explicit quoting/unquoting changes (`'n'` quoted, `"bob \"x\""` -> `bob "x"`); `key:` empty -> `null`; `~` -> `null`; `""` -> `''`; timestamps with offset normalised to UTC `Z`; anchors renamed (`&ref_0`) and merge keys expanded; flow `[a, b]` -> block list; CRLF normalised.
- Failure mode today: `parse()` swallows errors and returns `{}`; duplicate keys throw -> `{}`; so a `set` on an unparseable frontmatter silently **replaces the whole frontmatter with one key** (data loss).
- Preserved today: top-level key order (JS object insertion order; note integer-like keys would be reordered), data semantics (values re-parse to the same data, except timestamp zone normalisation), dot-path set/delete.

**Guarantee the Rust version must meet (baseline, not stricter):** after `set/delete/add`, the frontmatter re-parses to the intended data, top-level key order is kept (new keys appended), and unparseable input must not be silently wiped (this is the one place Rust should be _better_). Comment/format preservation is a bonus, not a requirement.

## 2. Samples

42 samples in `samples/`: 29 `real*.yaml` extracted from every tracked `*.md` with frontmatter in the repo (docs/, plugins/ SKILL.md, agents) plus the `experiment/fixtures` md/worklog task files; 13 `hard*.yaml` hand-made (comments between keys / trailing, block scalars `|` `>-`, escapes, unicode, CRLF, anchors+aliases+merge, ISO timestamps, empty values, trailing spaces, look-alike keys `status`/`status_note`/nested `status`, multi-line plain + flow maps + explicit `?` keys, no trailing newline, empty file, comment-only file, duplicate keys, invalid YAML). `real15` is the repo's "unterminated frontmatter" fixture (not valid YAML as extracted) - effectively a negative sample.

Edits (per sample, target chosen automatically: first top-level string key / first sequence / first map+child): `noedit` (byte-identical), `set` scalar, `add` key at end, `del` key, `push` onto a sequence, `nested` child of a map, `block` (replace scalar by a multi-line string, `l1\nl2\n`). Verification: (1) output parsed by `yq` (Go reference parser) must equal expected JSON incl. top-level key order; (2) `diff -U0`: removed lines must lie inside the target top-level entry (none for `add`; for `noedit` bytes must be identical). `n/a` = sample has no suitable target. PASS = both checks pass. `fb` = textual approach declines (would fall back to re-serialisation). `E` = lib returned an error. `F` = fail. `!` = panic.

## 3. Summary (cells over 42 samples x 7 edits = 294; 71 are n/a)

| lib                                       | PASS | FAIL | ERR/fallback                       | panic/hang |
| ----------------------------------------- | ---- | ---- | ---------------------------------- | ---------- |
| yaml-edit 0.3.5                           | 215  | 4    | 4                                  | 0          |
| serde_yaml_ng 0.10                        | 53   | 163  | 7                                  | 0          |
| textual fallback (145 lines, `src/tx.rs`) | 220  | 3    | 0 (fb never needed on this corpus) | 0          |
| JS `yaml` 2.x (eemeli, Document API, Bun) | 169  | 47   | 7                                  | 0          |
| saphyr 0.3.3 (emit only, noedit)          | 1    | 38   | 3                                  | 0          |

serde_yaml_ng PASS cells are only files that have no comments/special quoting and happen to match serde's canonical style. Fuzz (`fuzz.ts`: 12 truncations + 12 single-char structural mutations per sample, 6 ops, 5s timeout): 6048 runs each for yaml-edit and textual, **0 panics, 0 timeouts**.

### Notes on the non-PASS cells

- yaml-edit: `hard11_only_comment` (comment-only file) -> `Document::from_str` errors ("stream-level comments"; `YamlFile` might accept it - untested); `hard12` duplicate keys: data check fails only because yq/last-wins vs first-wins semantics (invalid YAML anyway); `hard13`/`real15` invalid -> error (good: no data loss); `hard08 add`: after an explicit `? complex : val` entry, the new key is emitted copying that style (`? zz_new` / `: added`) - data correct, style quirk.
- textual: only `hard12` dup keys (semantics as above). `hard09` (no trailing newline) is normalised to newline-terminated (a frontmatter body always is, before `---`).
- JS `yaml`: preserves comments and order but **not formatting**, even with no edit: `[a, b]` -> `[ a, b ]`, `>-` folded text re-flowed, `é` -> `é`, trailing spaces dropped, `? complex` key normalised, CRLF -> LF, and long double-quoted strings with `\n` get re-wrapped into a multi-line mess (real07: 1 line -> 56) unless a quoted `source`-preserving path is used. So the Bun-side "lossless" reference is only comment+order lossless, not byte-lossless.
- serde_yaml_ng: all comments lost, flow->block, quoting changes, anchors expanded; also timestamps/strings that look like other types get quoted.
- saphyr: parser+emitter only; emitter drops comments and re-formats (no editing API). marked-yaml: span-annotated read-only tree (not tried, would only help to _locate_ nodes for textual surgery).

## 4. API ergonomics (lines per edit)

- yaml-edit: 1-2 lines each: `doc.set("k","v")`, `doc.remove("k")`, `doc.get_sequence("k")?.push("v")`, `doc.get_mapping("k")?.set("c","v")`, `doc.set("k", ScalarValue::literal("l1\nl2\n"))`. `&str` values are quoted correctly when needed (tested: `yes`, `123`, `a: b`, `# x`, `null`, dates, quotes, unicode, empty string, multi-line -> emitted as `|-` block while keeping the trailing `# why` comment). Mutating API is infallible-ish (returns bool/Option).
- serde_yaml_ng: 3-5 lines (typed `Value` navigation).
- textual: ~145 lines total for set/add/del/push/nested/block at top-level + one nested level; everything else must fall back.
- JS `yaml`: 1-3 lines (`doc.set`, `doc.delete`, `seq.add`, `map.set`, `Scalar.type='BLOCK_LITERAL'`).

## 5. Maintenance signals (verified 2026-10-27 via crates.io API / `gh api`)

| lib                                                                                      | latest | last release | stars | open issues | last push  | recent dl                                       |
| ---------------------------------------------------------------------------------------- | ------ | ------------ | ----- | ----------- | ---------- | ----------------------------------------------- |
| yaml-edit                                                                                | 0.3.5  | 2026-10-22   | 12    | 1           | 2026-10-22 | 193k (230k total)                               |
| serde_yaml_ng                                                                            | 0.10.0 | 2024-05-26   | 114   | 21          | 2025-09-14 | 12.5M                                           |
| saphyr                                                                                   | 0.3.3  | 2026-10-27   | 339   | 22          | 2026-10-27 | 1.1M                                            |
| yaml-rust2                                                                               | 0.13.0 | 2026-09-11   | -     | -           | -          | 20M                                             |
| marked-yaml                                                                              | 0.8.0  | 2025-05-26   | 20    | 2           | 2025-05-26 | 160k                                            |
| serde_yml                                                                                | 0.0.13 | 2026-05-27   | -     | -           | -          | 4.9M (known as a questionable fork; not tested) |
| yaml-edit: single maintainer (jelmer), very young (0.x, 12 stars) but actively released. |        |              |       |             |            |                                                 |

## 6. Unverified / residual risk

- Corpus is 42 files; no property-based round-trip test against a big YAML corpus. Fuzz checked crashes/hangs only, not correctness of output.
- yaml-edit `set` on a deeply nested path / anchored node / flow-in-block, and sequences of maps were not exercised beyond the samples.
- Dates/timestamps: yq treats `2026-07-03` as timestamp in JSON; set values were always strings.
- Textual fallback was written by me for this spike; it is deliberately conservative (declines rather than guesses) but has had little adversarial testing beyond the fuzz.
- dz-review and recap YAML usage was not analysed (recap only reads config).

## 7. Full matrix (P pass, F fail, E error, fb textual-fallback, ! panic, - n/a; columns: noedit set add del push nested block)

### ye

| sample                      | noedit | set | add | del | push | nested | block |
| --------------------------- | ------ | --- | --- | --- | ---- | ------ | ----- |
| hard01_comments             | P      | P   | P   | P   | P    | P      | P     |
| hard02_blockscalars         | P      | P   | P   | P   | -    | -      | P     |
| hard03_quotes_unicode       | P      | P   | P   | P   | -    | -      | P     |
| hard04_crlf                 | P      | P   | P   | P   | P    | -      | P     |
| hard05_anchors              | P      | P   | P   | P   | -    | -      | P     |
| hard06_timestamps_empty     | P      | P   | P   | P   | -    | -      | P     |
| hard07_lookalike_keys       | P      | P   | P   | P   | P    | P      | P     |
| hard08_multiline_plain_flow | P      | P   | F   | P   | -    | -      | P     |
| hard09_no_trailing_newline  | P      | P   | P   | P   | -    | -      | P     |
| hard10_empty                | P      | -   | P   | -   | -    | -      | -     |
| hard11_only_comment         | E      | -   | E   | -   | -    | -      | -     |
| hard12_duplicate_keys       | P      | F   | P   | F   | -    | -      | F     |
| hard13_invalid              | E      | -   | -   | -   | -    | -      | -     |
| real01                      | P      | P   | P   | P   | P    | -      | P     |
| real02                      | P      | P   | P   | P   | P    | -      | P     |
| real03                      | P      | P   | P   | P   | P    | -      | P     |
| real04                      | P      | P   | P   | P   | P    | -      | P     |
| real05                      | P      | P   | P   | P   | P    | -      | P     |
| real06                      | P      | P   | P   | P   | P    | -      | P     |
| real07                      | P      | P   | P   | P   | -    | -      | P     |
| real08                      | P      | P   | P   | P   | -    | -      | P     |
| real09                      | P      | P   | P   | P   | -    | -      | P     |
| real10                      | P      | P   | P   | P   | -    | -      | P     |
| real11                      | P      | P   | P   | P   | -    | -      | P     |
| real12                      | P      | P   | P   | P   | -    | -      | P     |
| real13                      | P      | P   | P   | P   | -    | -      | P     |
| real14                      | P      | P   | P   | P   | -    | -      | P     |
| real15                      | E      | -   | -   | -   | -    | -      | -     |
| real16                      | P      | P   | P   | P   | -    | -      | P     |
| real17                      | P      | P   | P   | P   | P    | P      | P     |
| real18                      | P      | P   | P   | P   | P    | -      | P     |
| real19                      | P      | P   | P   | P   | P    | P      | P     |
| real20                      | P      | P   | P   | P   | P    | -      | P     |
| real21                      | P      | P   | P   | P   | P    | P      | P     |
| real22                      | P      | P   | P   | P   | P    | -      | P     |
| real23                      | P      | P   | P   | P   | P    | -      | P     |
| real24                      | P      | P   | P   | P   | P    | -      | P     |
| real25                      | P      | P   | P   | P   | P    | -      | P     |
| real26                      | P      | P   | P   | P   | P    | -      | P     |
| real27                      | P      | P   | P   | P   | P    | -      | P     |
| real28                      | P      | P   | P   | P   | P    | -      | P     |
| real29                      | P      | P   | P   | P   | P    | -      | P     |

### serde

| sample                      | noedit | set | add | del | push | nested | block |
| --------------------------- | ------ | --- | --- | --- | ---- | ------ | ----- |
| hard01_comments             | F      | F   | F   | F   | F    | F      | F     |
| hard02_blockscalars         | F      | F   | F   | F   | -    | -      | F     |
| hard03_quotes_unicode       | F      | F   | F   | F   | -    | -      | F     |
| hard04_crlf                 | F      | F   | F   | F   | F    | -      | F     |
| hard05_anchors              | F      | F   | F   | F   | -    | -      | F     |
| hard06_timestamps_empty     | F      | F   | F   | F   | -    | -      | F     |
| hard07_lookalike_keys       | P      | P   | P   | P   | P    | P      | P     |
| hard08_multiline_plain_flow | F      | F   | F   | F   | -    | -      | F     |
| hard09_no_trailing_newline  | F      | P   | P   | P   | -    | -      | P     |
| hard10_empty                | F      | -   | P   | -   | -    | -      | -     |
| hard11_only_comment         | F      | -   | F   | -   | -    | -      | -     |
| hard12_duplicate_keys       | E      | E   | E   | E   | -    | -      | E     |
| hard13_invalid              | E      | -   | -   | -   | -    | -      | -     |
| real01                      | F      | F   | F   | F   | F    | -      | F     |
| real02                      | F      | F   | F   | F   | F    | -      | F     |
| real03                      | F      | F   | F   | F   | P    | -      | F     |
| real04                      | F      | F   | F   | F   | P    | -      | F     |
| real05                      | F      | F   | F   | F   | F    | -      | F     |
| real06                      | F      | F   | F   | F   | F    | -      | F     |
| real07                      | F      | F   | F   | F   | -    | -      | F     |
| real08                      | P      | P   | P   | P   | -    | -      | P     |
| real09                      | P      | P   | P   | P   | -    | -      | P     |
| real10                      | P      | P   | P   | P   | -    | -      | P     |
| real11                      | P      | P   | P   | P   | -    | -      | P     |
| real12                      | P      | P   | P   | P   | -    | -      | P     |
| real13                      | P      | P   | P   | P   | -    | -      | P     |
| real14                      | P      | P   | P   | P   | -    | -      | P     |
| real15                      | E      | -   | -   | -   | -    | -      | -     |
| real16                      | F      | P   | F   | P   | -    | -      | P     |
| real17                      | F      | F   | F   | F   | P    | F      | F     |
| real18                      | F      | F   | F   | F   | F    | -      | F     |
| real19                      | F      | F   | F   | F   | F    | F      | F     |
| real20                      | F      | F   | F   | F   | F    | -      | F     |
| real21                      | F      | F   | F   | F   | F    | F      | F     |
| real22                      | F      | F   | F   | F   | F    | -      | F     |
| real23                      | F      | F   | F   | F   | F    | -      | F     |
| real24                      | F      | F   | F   | F   | F    | -      | F     |
| real25                      | F      | F   | F   | F   | F    | -      | F     |
| real26                      | F      | F   | F   | F   | F    | -      | F     |
| real27                      | F      | F   | F   | F   | F    | -      | F     |
| real28                      | F      | F   | F   | F   | F    | -      | F     |
| real29                      | F      | F   | F   | F   | F    | -      | F     |

### tx

| sample                      | noedit | set | add | del | push | nested | block |
| --------------------------- | ------ | --- | --- | --- | ---- | ------ | ----- |
| hard01_comments             | P      | P   | P   | P   | P    | P      | P     |
| hard02_blockscalars         | P      | P   | P   | P   | -    | -      | P     |
| hard03_quotes_unicode       | P      | P   | P   | P   | -    | -      | P     |
| hard04_crlf                 | P      | P   | P   | P   | P    | -      | P     |
| hard05_anchors              | P      | P   | P   | P   | -    | -      | P     |
| hard06_timestamps_empty     | P      | P   | P   | P   | -    | -      | P     |
| hard07_lookalike_keys       | P      | P   | P   | P   | P    | P      | P     |
| hard08_multiline_plain_flow | P      | P   | P   | P   | -    | -      | P     |
| hard09_no_trailing_newline  | P      | P   | P   | P   | -    | -      | P     |
| hard10_empty                | P      | -   | P   | -   | -    | -      | -     |
| hard11_only_comment         | P      | -   | P   | -   | -    | -      | -     |
| hard12_duplicate_keys       | P      | F   | P   | F   | -    | -      | F     |
| hard13_invalid              | P      | -   | -   | -   | -    | -      | -     |
| real01                      | P      | P   | P   | P   | P    | -      | P     |
| real02                      | P      | P   | P   | P   | P    | -      | P     |
| real03                      | P      | P   | P   | P   | P    | -      | P     |
| real04                      | P      | P   | P   | P   | P    | -      | P     |
| real05                      | P      | P   | P   | P   | P    | -      | P     |
| real06                      | P      | P   | P   | P   | P    | -      | P     |
| real07                      | P      | P   | P   | P   | -    | -      | P     |
| real08                      | P      | P   | P   | P   | -    | -      | P     |
| real09                      | P      | P   | P   | P   | -    | -      | P     |
| real10                      | P      | P   | P   | P   | -    | -      | P     |
| real11                      | P      | P   | P   | P   | -    | -      | P     |
| real12                      | P      | P   | P   | P   | -    | -      | P     |
| real13                      | P      | P   | P   | P   | -    | -      | P     |
| real14                      | P      | P   | P   | P   | -    | -      | P     |
| real15                      | P      | -   | -   | -   | -    | -      | -     |
| real16                      | P      | P   | P   | P   | -    | -      | P     |
| real17                      | P      | P   | P   | P   | P    | P      | P     |
| real18                      | P      | P   | P   | P   | P    | -      | P     |
| real19                      | P      | P   | P   | P   | P    | P      | P     |
| real20                      | P      | P   | P   | P   | P    | -      | P     |
| real21                      | P      | P   | P   | P   | P    | P      | P     |
| real22                      | P      | P   | P   | P   | P    | -      | P     |
| real23                      | P      | P   | P   | P   | P    | -      | P     |
| real24                      | P      | P   | P   | P   | P    | -      | P     |
| real25                      | P      | P   | P   | P   | P    | -      | P     |
| real26                      | P      | P   | P   | P   | P    | -      | P     |
| real27                      | P      | P   | P   | P   | P    | -      | P     |
| real28                      | P      | P   | P   | P   | P    | -      | P     |
| real29                      | P      | P   | P   | P   | P    | -      | P     |

### js

| sample                      | noedit | set | add | del | push | nested | block |
| --------------------------- | ------ | --- | --- | --- | ---- | ------ | ----- |
| hard01_comments             | F      | F   | F   | F   | P    | F      | F     |
| hard02_blockscalars         | F      | F   | F   | F   | -    | -      | F     |
| hard03_quotes_unicode       | F      | F   | F   | F   | -    | -      | F     |
| hard04_crlf                 | F      | F   | F   | F   | F    | -      | F     |
| hard05_anchors              | P      | P   | P   | P   | -    | -      | P     |
| hard06_timestamps_empty     | F      | F   | F   | F   | -    | -      | F     |
| hard07_lookalike_keys       | F      | F   | F   | F   | P    | F      | F     |
| hard08_multiline_plain_flow | F      | F   | F   | F   | -    | -      | F     |
| hard09_no_trailing_newline  | F      | P   | P   | P   | -    | -      | P     |
| hard10_empty                | F      | -   | P   | -   | -    | -      | -     |
| hard11_only_comment         | F      | -   | F   | -   | -    | -      | -     |
| hard12_duplicate_keys       | E      | E   | E   | E   | -    | -      | E     |
| hard13_invalid              | E      | -   | -   | -   | -    | -      | -     |
| real01                      | P      | P   | P   | P   | P    | -      | P     |
| real02                      | P      | P   | P   | P   | P    | -      | P     |
| real03                      | P      | P   | P   | P   | P    | -      | P     |
| real04                      | P      | P   | P   | P   | P    | -      | P     |
| real05                      | P      | P   | P   | P   | P    | -      | P     |
| real06                      | P      | P   | P   | P   | P    | -      | P     |
| real07                      | F      | F   | F   | F   | -    | -      | F     |
| real08                      | P      | P   | P   | P   | -    | -      | P     |
| real09                      | P      | P   | P   | P   | -    | -      | P     |
| real10                      | P      | P   | P   | P   | -    | -      | P     |
| real11                      | P      | P   | P   | P   | -    | -      | P     |
| real12                      | P      | P   | P   | P   | -    | -      | P     |
| real13                      | P      | P   | P   | P   | -    | -      | P     |
| real14                      | P      | P   | P   | P   | -    | -      | P     |
| real15                      | E      | -   | -   | -   | -    | -      | -     |
| real16                      | P      | P   | P   | P   | -    | -      | P     |
| real17                      | P      | P   | P   | P   | P    | P      | P     |
| real18                      | P      | P   | P   | P   | P    | -      | P     |
| real19                      | P      | P   | P   | P   | P    | P      | P     |
| real20                      | P      | P   | P   | P   | P    | -      | P     |
| real21                      | P      | P   | P   | P   | P    | P      | P     |
| real22                      | P      | P   | P   | P   | P    | -      | P     |
| real23                      | P      | P   | P   | P   | P    | -      | P     |
| real24                      | P      | P   | P   | P   | P    | -      | P     |
| real25                      | P      | P   | P   | P   | P    | -      | P     |
| real26                      | P      | P   | P   | P   | P    | -      | P     |
| real27                      | P      | P   | P   | P   | P    | -      | P     |
| real28                      | P      | P   | P   | P   | P    | -      | P     |
| real29                      | P      | P   | P   | P   | P    | -      | P     |

### saphyr

| sample                      | noedit | set | add | del | push | nested | block |
| --------------------------- | ------ | --- | --- | --- | ---- | ------ | ----- |
| hard01_comments             | F      | -   | -   | -   | -    | -      | -     |
| hard02_blockscalars         | F      | -   | -   | -   | -    | -      | -     |
| hard03_quotes_unicode       | F      | -   | -   | -   | -    | -      | -     |
| hard04_crlf                 | F      | -   | -   | -   | -    | -      | -     |
| hard05_anchors              | F      | -   | -   | -   | -    | -      | -     |
| hard06_timestamps_empty     | F      | -   | -   | -   | -    | -      | -     |
| hard07_lookalike_keys       | F      | -   | -   | -   | -    | -      | -     |
| hard08_multiline_plain_flow | F      | -   | -   | -   | -    | -      | -     |
| hard09_no_trailing_newline  | F      | -   | -   | -   | -    | -      | -     |
| hard10_empty                | P      | -   | -   | -   | -    | -      | -     |
| hard11_only_comment         | F      | -   | -   | -   | -    | -      | -     |
| hard12_duplicate_keys       | E      | -   | -   | -   | -    | -      | -     |
| hard13_invalid              | E      | -   | -   | -   | -    | -      | -     |
| real01                      | F      | -   | -   | -   | -    | -      | -     |
| real02                      | F      | -   | -   | -   | -    | -      | -     |
| real03                      | F      | -   | -   | -   | -    | -      | -     |
| real04                      | F      | -   | -   | -   | -    | -      | -     |
| real05                      | F      | -   | -   | -   | -    | -      | -     |
| real06                      | F      | -   | -   | -   | -    | -      | -     |
| real07                      | F      | -   | -   | -   | -    | -      | -     |
| real08                      | F      | -   | -   | -   | -    | -      | -     |
| real09                      | F      | -   | -   | -   | -    | -      | -     |
| real10                      | F      | -   | -   | -   | -    | -      | -     |
| real11                      | F      | -   | -   | -   | -    | -      | -     |
| real12                      | F      | -   | -   | -   | -    | -      | -     |
| real13                      | F      | -   | -   | -   | -    | -      | -     |
| real14                      | F      | -   | -   | -   | -    | -      | -     |
| real15                      | E      | -   | -   | -   | -    | -      | -     |
| real16                      | F      | -   | -   | -   | -    | -      | -     |
| real17                      | F      | -   | -   | -   | -    | -      | -     |
| real18                      | F      | -   | -   | -   | -    | -      | -     |
| real19                      | F      | -   | -   | -   | -    | -      | -     |
| real20                      | F      | -   | -   | -   | -    | -      | -     |
| real21                      | F      | -   | -   | -   | -    | -      | -     |
| real22                      | F      | -   | -   | -   | -    | -      | -     |
| real23                      | F      | -   | -   | -   | -    | -      | -     |
| real24                      | F      | -   | -   | -   | -    | -      | -     |
| real25                      | F      | -   | -   | -   | -    | -      | -     |
| real26                      | F      | -   | -   | -   | -    | -      | -     |
| real27                      | F      | -   | -   | -   | -    | -      | -     |
| real28                      | F      | -   | -   | -   | -    | -      | -     |
| real29                      | F      | -   | -   | -   | -    | -      | -     |

## 8. Code

`src/main.rs` (driver: yaml-edit / serde_yaml_ng / saphyr), `src/tx.rs` (textual fallback), `js-edit.ts` (JS yaml), `run.ts` (checker), `baseline.ts` (TS baseline), `fuzz.ts`.
