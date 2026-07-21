---
name: markdown-surgeon
description: Manipulate Markdown files surgically by section without loading entire content. Use when editing large .md files, updating specific sections, using Markdown as a lightweight database, working with MRFI (Markdown Robust Fragment Identifiers) or durable passage references, or when asked to work with sections in a Markdown file. Commands include outline, read, write, append, empty, remove, search, concat, meta, create, ref, resolve.
user-invocable: false
---

# Markdown Surgeon

CLI `md` to manipulate Markdown by section. Each section has an 8-char hex ID based on level + title + occurrence.

```bash
md <command> [options]
```

For repository development, use the local entrypoint so you test this checkout instead of the installed JSR version:

```bash
deno -A packages/tools/markdown-surgeon/cli.ts <command>
```

## Examples

```bash
# outline: list sections
md outline doc.md
# → # Project ^a3f2c1d0 L1
# → ## Installation ^7b2e4a1c L5

# outline --after ID: subsections only
md outline doc.md --after 7b2e4a1c --last   # last subsection
md outline doc.md --after 7b2e4a1c --count  # count

# read/write/empty sections
md read doc.md 7b2e4a1c
md write doc.md 7b2e4a1c "New content"
md empty doc.md 7b2e4a1c

# append: add content
md append doc.md 7b2e4a1c "Note"            # at end of section
md append --deep doc.md 7b2e4a1c "## New"   # after subsections
md append --before doc.md 7b2e4a1c "..."    # before section
md append --before doc.md "Start of file"   # no ID = file level
md append doc.md "End of file"              # no ID = file level

# remove: delete section + subsections
md remove doc.md 7b2e4a1c

# MRFI refs: use ~mrfi or ^anchor instead of section IDs
md write doc.md "^myanchor" -x sec "New content"   # replace whole section
md remove doc.md "^myanchor" -x sec                # remove heading + body
md remove doc.md "^myanchor" -x body               # keep heading, clear body
md empty doc.md "^myanchor" -x lead                # clear lead only
md append doc.md "^myanchor" -x body "Appended"    # append after body
md write doc.md '~{v0;r=1:1-1:8}' --force "New"   # plain ref, skip gate
md write doc.md '~{v0;r=1:1-1:8}' --strict "New"  # exact status only

# search
md search doc.md "TODO"
md search --summary doc.md "TODO"

# concat: merge files (use > for output)
md concat --shift=1 intro.md guide.md > full.md

# meta: YAML frontmatter
md meta doc.md                      # show all
md meta doc.md title                # get value
md meta doc.md author.name          # nested
md meta doc.md --set key "value"
md meta doc.md --del key
md meta doc.md --h1                 # get h1 title

# meta: multi-file aggregation
md meta --list tags *.md            # all values (with duplicates)
md meta --aggregate tags *.md       # unique values with counts
# → 3 foo
# → 2 bar
# → 1 baz
md meta --aggregate tags,category *.md  # grouped by field
# → tags:
# →   3 foo
# →   2 bar
# → category:
# →   2 tech
md meta --count tags *.md           # total count only → 8
md meta --count tags,category *.md  # per field → tags: 8 / category: 3

# create: new file
md create doc.md --title "Project" --meta author="John" "Initial content"

# --json: structured output
md outline doc.md --json
md read doc.md ID --json
```

## Magic expressions

`{datetime}` (or `{dt}`), `{dt:short}`, `{date}`, `{time}`, `{meta:key}`

```bash
md meta doc.md --set updated "{dt:short}"   # 2025-01-16 09:15
md create log.md --title "Log {date}"
```

## MRFI References

MRFI (Markdown Robust Fragment Identifiers) lets you reference a passage by durable evidence rather than a brittle section ID. References survive edits because multiple signals (hashes, structural path, context) are combined at resolution time.

Use `md outline --mrfi` to see MRFI refs for sections, `md ref` to generate or transcode them, and `md resolve` to resolve them. MRFI refs (`~...` or `^anchor`) work as selectors in `read`, `write`, `append`, `empty`, and `remove`.

See [references/mrfi.md](references/mrfi.md) for statuses, safety gate, extent selection, and generation profiles.

## Further Reading

- [reference.md](reference.md) — edge cases, `--deep` behavior, MRFI gate control
- [reference-api.md](reference-api.md) — API/tool development
- [references/mrfi.md](references/mrfi.md) — MRFI operational reference
