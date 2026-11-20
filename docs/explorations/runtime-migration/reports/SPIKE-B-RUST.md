# Spike B (Rust, pulldown-cmark 0.13.5): AST locates, text splices edit

Project: `rust/experiment/md-ast-rust/` (lib `mdast` + bin `md`). Commands: `outline` (`--json --count --last --after`), `read` (`--deep --json`), `write`, `append` (`--deep --before --json`), `remove`. Not ported: magic expressions (`{date}`...), MRFI, `empty`, `search`, `concat`, `meta`, `--extent`.

## Design

- `Options::empty()` (pure CommonMark; no YAML-metadata option, frontmatter is our own prefix rule). `into_offset_iter`, a depth counter over `Start/End` events: a `Start(Heading)` at depth 0 is a document-level heading (blockquote/list/footnote content has depth > 0). Code, indented code and HTML blocks never emit `Heading`.
- Own line table (`ls`: start byte of every line; LF, CRLF and lone CR, because pulldown treats a lone CR as EOL). Every range is `[start line, end line)` converted to bytes through the table; an edit is `text[..a] + new + text[b..]`.
- Section end = next heading line (any level, or `<=` level with `--deep`); last section: trailing blank lines trimmed (same as TS). Ids: SHA-256 of `level:title.lower().trim():occurrence`, 8 hex (TS "Blake3" service actually uses SHA-256, matching the spec).
- Titles: ATX = raw text after the hashes, trimmed (closing `#`s and markup kept, as in TS); setext = text lines trimmed and joined with a space.
- EOL: dominant EOL of the file (CRLF if >= LF and CR). Inserted text is normalised then re-joined with it. "Ends with EOL / not" is preserved by the splice helper.
- Deliberate deviations from TS in write/append: (a) `write` of exactly the current body is a no-op (TS would insert a blank line when the body starts right under the heading; needed for P2); (b) a blank line is added after inserted text when the next heading is setext (otherwise the paragraph would swallow it as a lazy continuation line, found while designing P6); (c) `read` content is LF-normalised.

## Size

| item                                                                            | value                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib.rs`                                                                    | 325 lines                                                                                   |
| `src/main.rs` (CLI, hand-rolled arg parsing)                                    | 173 lines                                                                                   |
| tests (P1-P6)                                                                   | 270 lines                                                                                   |
| deps                                                                            | pulldown-cmark 0.13 (default-features off), sha2, serde_json                                |
| clean release build (lto, 1 CGU)                                                | 7.7 s                                                                                       |
| binary (stripped)                                                               | 804 KB                                                                                      |
| startup (`outline` on a tiny file)                                              | ~1 ms                                                                                       |
| 10.5 MB / 60k sections: outline / outline --json / read --deep / write / remove | 0.11 s / 0.14 s / 0.10 s / 0.14 s / 0.12 s (TS on deno: outline 3.0 s; deno startup 0.15 s) |

The perf file is 10.5 MB (60k sections of ~175 bytes), larger than the 6 MB asked. Each command re-parses the whole file; no caching needed.

Offsets: the parser gave the heading start/end byte directly in all cases; 0 of 5 operations needed an offset it could not give for the _heading_. But it knows nothing about sections, so the section end (3 ops: write, append, remove) is computed by us from the next heading, and all 5 ops go through our own line table. Frontmatter and the lone-CR line splitting are also ours.

## Property tests (`cargo test --release`, `tests/props.rs`)

Generator: hand-rolled xorshift64 (no proptest/quickcheck): the input space is the 80 fixed corpus files, only the (section, op, content, deep, before) choices are random; no shrinking needed (a failure prints file + round); no extra crate to resolve offline. 40 rounds per file.

| P                                            | result | scope                                                                                                                                                                                                             |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 bytes outside the touched range identical | pass   | 2935 random write/append/remove (shared with P6)                                                                                                                                                                  |
| P2 write(current body) is a byte no-op       | pass   | 874 writes (every section, deep and not)                                                                                                                                                                          |
| P3 append heading then remove it             | pass   | 435 round trips: 298 byte-exact, 137 "original + exactly one blank line" (the padding blank line `append` adds; for an unterminated file also a trailing EOL), 2 skipped (heading swallowed by an open construct) |
| P4 CRLF outline == LF outline                | pass   | 80 files (+ P4b: edits on CRLF files stay CRLF, final EOL status kept)                                                                                                                                            |
| P5 no heading in code/HTML/indented code     | pass   | corpus title oracle + structural overlap with pulldown CodeBlock/HtmlBlock ranges + inline case                                                                                                                   |
| P6 reparse gives expected outline            | pass   | write (incl. deep dropping children), remove (ids recomputed for duplicates), append (never produced a heading-count increase unexpectedly)                                                                       |

Weakness: P1's "touched range" is computed from the same parser; P5's structural oracle is pulldown itself (the title oracle is independent).

## Divergence vs TS (read commands, outline + read deep/non-deep, all sections)

59/80 files identical. 21 files differ = 29 headings (20 only in B, 9 only in TS). **Regressions: 0.** Content of `read` differs only where section boundaries differ for the reasons below.

| class                | headings | cases                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ts-bug-fixed         | 13       | CRLF files (TS finds 0 headings): `crlf`, `crlf-fence` (2+2); lone CR `cr-only` (2); fences: `fence-indented4` (indented "fence" is code, later heading missed by TS), `fence-info-close` (TS: "# still code" wrongly a heading + B missed), `fence-inline-triple`, `fence-longer`, `fence-mixed`, `heading-after-fence-same-line` (fence never closed by "``` # B": `## C` is code)      |
| intended-rule-change | 16       | setext headings (6: `setext`, `setext-multiline`, `thematic-vs-setext`, `dashes-no-frontmatter-late`, `frontmatter-not-first`); ATX indent 1-3 spaces (`atx-1sp`, `atx-3sp`: 3); empty ATX (`atx-empty`: 2); NBSP after `#` is not a heading in CommonMark (`atx-nbsp`: 1); `#` lines inside HTML blocks/comments/pre no longer headings (`html-block`, `html-comment` x2, `html-pre`: 4) |
| regression           | 0        |                                                                                                                                                                                                                                                                                                                                                                                           |

Note `html-block-blank.md` is identical: a blank line ends an HTML block (type 6), so that heading is real in both.

## Friction (honest)

1. **Pulldown ranges**: `Start(Heading)` range for ATX starts at the first `#` (indent excluded) and ends _after_ the EOL (or at EOF when there is none); setext range = text lines + underline, also incl. EOL. Usable, but "end - 1" must be used to get the last line; indentation must be recovered by going back to the line start. No sections, no "end of section" notion at all.
2. **ATX title**: the parser gives inline events, not the raw text; to keep TS ids (raw title, closing `#`s kept) we re-read the source line. Setext multi-line titles are a new case (joined with a space; one-line output is lossy).
3. **Lone CR**: pulldown treats `\r` as a line break; a naive `\n` line splitter then silently mismatches (found by the corpus: `cr-only.md`). Our line table must follow CommonMark EOLs. EOL choice for files with no EOL at all defaults to LF.
4. **Last-section / trailing blank rules** are ours (TS rule kept): last range drops trailing blank lines, non-last ranges include the blank lines before the next heading. Unterminated last line makes every splice a special case (4 branches in `splice_lines`); P3 shows the residual: append+remove on such a file ends with a trailing EOL.
5. **Structure capture**: text inserted after a section can be absorbed by an open construct (unterminated fence, HTML block type 1-5) so the new heading is not a heading (2 cases of 437 in P3, reported as `appended`, not `created`). A setext heading following inserted paragraph text needs a guard blank line (see deviations). TS has no such hazards because it has no setext.
6. **HTML blocks**: pulldown follows the spec (types 1-5 run to their end marker, 6-7 end at a blank line). That is correct but surprising to users used to the TS behaviour.
7. Pulldown's `Heading` tag has id/classes/attrs fields that stay empty without the attribute option; nothing needed.

## Verdict

Approach B in Rust works: ~500 LOC for the five commands, zero regressions on the corpus, all six properties green, 25x faster than TS/deno on a 10 MB file with ~1 ms startup and an 800 KB binary. The parser's contribution is small but precisely the hard part (which `#` lines are headings, setext, containers, HTML/code blocks); everything else (sections, ends, EOL, frontmatter, ids) is ~300 lines of our own line-oriented code. Residual risks: behaviour changes for users (setext/HTML/indent), the lone-CR/unterminated-file edge cases, and parser upgrades changing block rules (pin the version, keep the corpus as a regression suite).
