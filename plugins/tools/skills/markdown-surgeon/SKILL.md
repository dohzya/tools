---
name: markdown-surgeon
description: Manipulate Markdown files surgically by section without loading entire content. Use when editing large .md files, updating specific sections, using Markdown as a lightweight database, or when asked to work with sections in a Markdown file. Commands include outline, read, write, append, empty, remove, search, concat, meta, create.
user-invocable: false
---

# Markdown Surgeon

CLI `md` to manipulate Markdown by section. Each section has an 8-char hex ID based on level + title + occurrence.

```bash
~/.claude/skills/markdown-surgeon/md <command> [options]
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

See [reference.md](reference.md) for edge cases. For API/tool development, see [reference-api.md](reference-api.md).
