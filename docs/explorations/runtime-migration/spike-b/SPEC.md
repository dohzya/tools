# Spike B: CommonMark AST for locating sections, text-level edits

Goal: validate that a CommonMark parser (Rust `pulldown-cmark`, JS `commonmark`) can drive the section commands of `md` (markdown-surgeon) while all edits are done on the source text, so the untouched bytes stay identical. The TS parser is known to be wrong in several cases (see `../reports/MD-PARSING.md`); we do not aim at parity with it.

## Commands (same CLI and output formats as the TS reference)

`md outline <file> [--json]`, `md read <file> <id|title> [--deep] [--json]`, `md write <file> <id|title> [content]` (replace section body, keep heading), `md append <file> <id|title> [content]`, `md remove <file> <id|title>`. Read the TS reference for exact flags, outputs and errors; reproduce them, except where a rule below says otherwise.

## Rules (decided, differ from TS)

1. Parse the body with CommonMark 0.31.2. Headings are the document-level ATX **and setext** headings (not those inside blockquotes or list items). `#` lines in fenced/indented code, HTML blocks and similar are never headings. ATX may be indented by 0–3 spaces; empty headings count.
2. Frontmatter is outside the Markdown: a file whose first line is `---` and that has a closing `---` or `...` line has a frontmatter prefix, opaque to section logic. Unterminated: no frontmatter.
3. A section runs from its heading to the next heading of level <= its own (`--deep`), or to the next heading of any level (default), or EOF. Same as TS.
4. Section id and title rules: same as TS (SHA-256, 8 hex chars, of `level:title.toLowerCase().trim():occurrence`). For setext, the title is the heading text.
5. Line endings: CRLF files work like LF files; edits keep the file's dominant EOL; text inserted by `write`/`append` is converted to that EOL. Final newline status is preserved.
6. Edits are text splices on byte ranges obtained from the parser. No re-rendering of Markdown.

## Acceptance

A. Property tests (generate them with the corpus `../md-corpus/` and random choices of section/content):

- P1: after `write`/`append`/`remove` on one section, every byte outside the touched range is identical to the original.
- P2: `write` with the section's current body is a no-op (byte-identical file).
- P3: `append X` then `remove` of the appended text restores the original (or the documented equivalent).
- P4: the outline of the CRLF-converted file equals the outline of the LF file (same ids, levels, titles).
- P5: no heading is reported inside code, HTML blocks, or indented code.
- P6: after any edit, reparsing gives the expected outline. B. Divergences vs the TS reference on `../md-corpus/` (read commands): list each one and classify as `ts-bug-fixed`, `intended-rule-change`, or `regression` (must be zero). C. Report: lines of code, the dependency used, how many of the operations needed a byte offset the parser could not give directly, perf on a 6 MB file with 60k sections, and honest friction notes.
