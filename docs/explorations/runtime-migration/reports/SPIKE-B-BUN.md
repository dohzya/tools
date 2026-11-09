# Spike B (Bun + commonmark.js): sections from the CommonMark AST, text-splice edits

Dir: `experiment/md-ast-js/`. Run: `bun install && bun test`, `bun tools/ref-ts.ts` is `deno -A tools/ref-ts.ts` (TS reference dump) then `bun tools/compare.ts`, `bun tools/perf.ts`. CLI: `bun src/cli.ts <outline|read|write|append|remove> ...`. Dependency: `commonmark@0.31.2` (runtime); dev: `fast-check` (property tests), `typescript`, `@types/*`.

## What it does

- `src/md.ts` (379 lines incl. comments): `parseDoc` (frontmatter prefix, commonmark block parse, top-level headings only), section ranges, ids (SHA-256/8 hex of `level:title:occurrence`; the TS "Blake3" service is really SHA-256, ids match the reference on all unaffected files), selectors (id / `## Title`, same errors), `spliceLines`, `write`, `append` (`--before`, `--deep`, no-selector), `remove`. `src/cli.ts` (127 lines): hand-rolled argv (no cliffy), `--json`, `--deep`, `--before`, `--count/--last/--after` for outline. Not done: `empty`, `search`, MRFI, `concat`, `meta`, magic expansion.
- Output formats copied from the TS formatters (text and JSON). Read output always joins with `\n` (CRLF files print LF); edits write the file's dominant EOL.

## Offset model (decision)

All offsets are UTF-16 code-unit indices into the string obtained by decoding the file as UTF-8. commonmark.js gives `[line, column]` only, so **only lines are consumed from the parser**; a line table (`starts`, `contentEnds`) is built by us with `/\r\n|\r|\n/` (the same line splitter commonmark.js uses, so line numbers agree, including bare CR). Columns (UTF-16) are never used, byte offsets are never computed: a splice is `text.slice(0,a) + insertion + text.slice(b)` and the result is re-encoded as UTF-8; untouched code units stay byte-identical for valid UTF-8 (P1 checks it on `Buffer`s, corpus has non-BMP). Limits: invalid UTF-8 would become U+FFFD; a BOM stays as a character on line 1 (so a BOM + `# x` is not a heading line start... commonmark treats U+FEFF as text; not handled).

## Property tests (`bun:test`, `fast-check` 4, 400-800 runs each; domain = 80 corpus files x {as-is, CRLF-converted}, random section, random op/content)

| Property                                                                                      | Result                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 bytes outside touched range identical (also final-newline status, EOL consistency on CRLF) | pass                                                                                                                                                                                                                                                |
| P2 `write` with current body is a no-op                                                       | pass on 1552 cases; **3 documented exceptions inherited from TS rules** (24 bodies starting non-blank get a forced blank line; 172 sections whose body is exactly one blank line: content `""` means "empty the body"). 0 unexplained               |
| P3 append then remove restores                                                                | pass up to "one blank line more/less" (the separator, or the original blank that now belongs to the removed section) and "no final newline" variant; exempt: `--before` in front of a non-blank preamble (preamble becomes part of the new section) |
| P4 CRLF outline == LF outline (ids, levels, titles, lines)                                    | pass, 80/80 (also original CR/mixed == LF-normalised)                                                                                                                                                                                               |
| P5 no heading in code/HTML/indented code                                                      | pass: corpus check against the full AST + generated documents (ATX vs fences of varying char/length, indented code, 4 HTML block kinds, LF/CRLF)                                                                                                    |
| P6 reparse gives expected outline                                                             | pass (783 compared, 16 skipped because the text is placed near an unterminated fence, which an edit can legitimately close)                                                                                                                         |

Found by the tests and fixed or documented: (1) text inserted right above a heading can swallow it (HTML block type 6/7, setext paragraph merge, list item); `guardedSplice` re-parses and adds a blank line, or **refuses** (`parse_error`) when no blank helps (e.g. `1. one` above `# A`: the indented heading becomes list content). Not in TS. (2) `remove` of the unterminated last section leaves the preceding blank line as an unterminated last line (same bytes as TS).

## Divergences vs TS reference (80 files; compared: id, level, title, line, and read content/endLine for plain and `--deep`)

59 identical (all 16 real docs). 21 divergent, **0 regressions**:

- ts-bug-fixed (15): atx-1sp, atx-3sp, atx-empty, cr-only, crlf, crlf-fence, fence-indented4, fence-info-close, fence-inline-triple, fence-longer, fence-mixed, heading-after-fence-same-line, html-block, html-comment, html-pre.
- intended-rule-change (6): setext, setext-multiline, thematic-vs-setext, dashes-no-frontmatter-late, frontmatter-not-first (all: setext headings now exist; `text`+`---` is a section), atx-nbsp (TS accepted NBSP after `#`; CommonMark does not: a heading that disappears, user-visible). Reference run: `deno -A tools/ref-ts.ts` uses the real `ParseDocumentUseCase`/`ReadSectionUseCase` (not the installed `md`).

## Numbers (WSL2, bun 1.3.14, 5.7 MB / 60 000 headings; `tools/perf.ts`)

|                                                | cold (1st) | warm   |
| ---------------------------------------------- | ---------- | ------ |
| commonmark full parse                          | 640 ms     | 416 ms |
| blocks only (inline parse disabled)            | 293 ms     | 99 ms  |
| `parseDoc` (blocks + SHA-256 ids + line table) | 471 ms     | 221 ms |

`Reflect.get(parser, "inlineParser").parse = () => {}` skips inline work (not typed in `@types/commonmark`; `parseReference` is kept because block-level link-reference extraction decides setext). Process end-to-end `outline` on the big file: ~0.56 s (bun), 0.40 s (compiled). `write` on it re-parses (edit + guard): ~0.6 s. Cannot avoid the full block parse (no incremental/partial parse in commonmark.js). `bun build --compile`: 95 MB binary, startup 28 ms on a small file. TS regex scanner reference: 41 ms for the same file, so B is ~10x slower on huge files; irrelevant below ~1 MB (10-20 ms). Parser-could-not-give counts: byte offsets needed by the 5 operations: 0 (lines suffice); operations needing something the parser did not give directly: 1 kind of data, setext heading true start line + title (see friction); section end is always our own rule.

## Friction

1. **Setext sourcepos**: start is the _paragraph_ start, which includes link-reference definitions that were stripped from the content (`[r]: /u\nT\n===` reports lines 1-3 for a heading whose text is line 2). We recompute the start from `_string_content` (private field, no type) = `endLine - lineCount(content)`; the ref def line stays with the previous section. Title for multi-line setext = trimmed lines joined by a space (arbitrary).
2. **Section end**: parser knows nothing about sections; end = next heading line - 1, trailing blanks trimmed only at EOF (TS quirk kept). ATX `sourcepos` end is the heading line; setext end is the underline line.
3. **Titles**: must come from the raw source line (closing `#`s are part of the id hash), so the AST text is unusable; ATX titles are re-read from the line with a regex (`ATX`), `literal`s do not exist anyway with inlines off.
4. **HTML blocks/containers**: detection is free, but _edits_ interact with them: inserting text above a heading can turn it into HTML-block/list/paragraph content. Needs a re-parse guard (above). A line-based splice model is only safe when verified by the parser.
5. **Frontmatter** is invisible to commonmark (`---` would be a thematic break/setext): we cut the prefix, parse the rest, add the line offset. `dashes`/`title: x` + `---` after a blank line becomes a setext h2 (surprising, but per spec rule 1).
6. **UTF-16 vs bytes**: no issue as long as only lines are used; columns would be UTF-16 code units (not code points, not bytes). Whole-string decode loses invalid UTF-8.
7. Types: `@types/commonmark` lacks `inlineParser` and `_string_content`; both reached via `Reflect.get` (returns `any`, no `as` cast needed).
8. No `commonmark.js` mode to stop after block structure, and super-linear risks were not hit (linear on the benchmark).

## Verdict

Approach B works in Bun: correct on fences, HTML blocks, CRLF/CR, indent; zero regressions on the corpus; edits are exact text splices. Costs: ~10x scanner time on multi-MB files, a re-parse guard for edits, and the setext/start-line workaround. Acceptable for the real workload; the 21 behaviour changes must be versioned.
