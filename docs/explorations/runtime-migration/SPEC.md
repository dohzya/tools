# SPEC (black box) — `md read`, `wl list`, `wl show`

Reference implementation: TypeScript/Deno (`markdown-surgeon` v0.10.1, `worklog` v0.21.1). Target: re-implement ONLY the three read-only commands below in Bun, Rust, Mojo.

## 0. Contract

Entry point: **one executable command `<impl>`** invoked as

```
<impl> md read <file> <selector> [--deep] [--json]
<impl> wl list [--all] [--created|--ready|--started|--done|--cancelled]... [--subtasks] [--json]
<impl> wl show [taskId] [--json] [--active]
```

- Run with cwd = a directory (`wl` looks for `./.worklog/`, no upward search needed; see 3.1).
- Output is plain text, UTF-8, **never ANSI-coloured** (the harness sets `NO_COLOR=1`; stdout is not a TTY; you can simply never emit colours). Each stdout payload ends with exactly one `\n` (what `console.log` does), except when stdout is empty.
- Result goes to **stdout**, errors to **stderr** with exit code **1**. On error stdout is empty.
- Line separator in input files: `\n` only (CRLF not covered).
- `WORKLOG_TASK_ID`, `FORCE_COLOR` unset; `TZ=UTC` set by the harness (no output depends on the timezone: dates are sliced from strings, never converted).
- Tests check: exact stdout bytes, exit code, and — for errors — the first stderr line beginning with `error:` or `{"error"` (see 4). Other stderr text is free (the TS CLI prints a harmless `Download ...` line on a cold Deno cache; ignore it).

### Out of scope (do NOT implement / will not be tested)

- Every other command: `md outline|write|append|empty|remove|search|ref|resolve|concat|meta|create`, `wl create|trace|checkpoint|done|...|todo|tags|scopes|dash|summary|...`. No write command at all; the read commands MUST NOT modify any file (see "purge" in 3.6).
- MRFI / durable references: selectors starting with `~` or `^` are not supported (in the TS `md read` they simply fall into the "invalid id" error, see 2.4). `--extent/--strict/--force` options.
- `wl list` options: `[pattern]` argument, `--scope`, `--all-scopes`, `-p/--path`, `--parent`, `--depends-on/--blocks/--related-to/--linked-to`, `--include-blocked`, `--subtasks-of-started`, `--no-header`, `--pager/--no-pager`. `wl show` options `--scope`, `-q/--quiet`; env `WORKLOG_TASK_ID`; interactive task selection. Global options `-C`, `--worklog-dir`, `--purge-ttl`. Git scopes / child worklogs / `scope.json` / `config.json`.
- Task links (`links:` in frontmatter) and their rendering; index migration v1→v2; usage errors of the CLI parser (unknown option, missing arg → exit 2, not tested); `--help`, `--version`, completions, shell pager.
- Machine-specific behaviour: no colours, no TTY handling.

---

## 1. Fixtures (in `fixtures/`)

| Dir                             | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures/md/`                  | `doc-basic.md` (frontmatter, nested sections, lists, code fence containing `#` lines, link, inline code), `doc-nofm.md` (no frontmatter, empty section, duplicate headings, unicode/emoji, 4 heading levels, `~~~` fence, trailing blank lines), `doc-edge.md` (frontmatter, preamble text before first header, `#NoSpace`, 7 `#`, trailing spaces in a header, table, blockquote, indented `#`, file w/o final newline), `doc-unterminated-fm.md` (opening `---` never closed) |
| `fixtures/wl-project/.worklog/` | 7 tasks: statuses created/ready/started/done/cancelled, 2 subtasks of one parent (one started w/ entries+todos, one done w/ checkpoint), checkpoint + entries after it, todos with several states, multi-part description, unicode                                                                                                                                                                                                                                              |
| `fixtures/wl-empty/`            | directory with no `.worklog` (error case)                                                                                                                                                                                                                                                                                                                                                                                                                                       |

`cases.json` lists 39 cases; `expected/<id>.out` is the exact expected stdout. `run_cases.sh` copies `fixtures/` to a temp dir for every case (never mutates it).

---

## 2. `md read <file> <selector> [--deep] [--json]`

Prints the content of one Markdown section selected by id or heading.

### 2.1 Parsing the document

1. Read the file as UTF-8 text, `lines = content.split("\n")` (a final `\n` yields a last empty element; keep it — it matters for 2.3).
2. **Frontmatter**: if `lines[0].trim() == "---"`, look for the first later line `i ≥ 1` with `lines[i].trim() == "---"`. If found, lines `0..i` are frontmatter and header scanning starts at line index `i+1`. If never closed: **no frontmatter**, scanning starts at line 0 (the lines are then ordinary text). The YAML content is not interpreted by `md read`; but its lines are never scanned for headers.
3. **Headers**: scan the remaining lines in order. Keep a boolean `inCode` : for every line, if `line.trim()` starts with `` ``` `` or `~~~` → toggle `inCode` and skip the line (fence kind and length are NOT matched: any fence toggles; an unclosed fence hides the rest of the file). While `inCode`, skip lines. Otherwise the line is a header iff it matches the regex `^(#{1,6})\s+(.+)$` on the **raw (untrimmed) line** — so an indented `# x`, `#x` and `#######  x` (7 hashes) are NOT headers; `level` = number of `#`; `title` = group 2 **trimmed** (`.trim()` of whitespace). Title is raw text (markup kept; a `## ##  Weird` line gives level 2, title `##  Weird`). Note `\s+(.+)`: a line `#` or `##` alone (no non-space char after spaces) is not a header... (`##` matches only if something follows the whitespace; trailing-space-only → `(.+)` can capture spaces, e.g. `##` + 3 spaces gives title `""` — avoid, untested).
4. **Section record**: `{id, level, title, line (1-indexed line of the header), lineEnd}`.
   - `lineEnd` of section _k_ (not the last) = `line(k+1) - 1` (next header of ANY level, minus one).
   - `lineEnd` of the last section = number of lines (`lines.length`), then decremented while `lineEnd > line` and `lines[lineEnd-1].trim() == ""` (i.e. trailing blank lines — including the phantom empty element after the final `\n` — are trimmed, but never below the header line).
5. **Section id**: `sha256( utf8( "<level>:<lowercase(title)>:<occ>" ) )` → lowercase hex → first 8 chars. `lowercase` = Unicode lowercase (JS `toLowerCase()`), then trim; `occ` = 0-based count of previous sections with the same `(level, lowercase(title).trim())` key (so two `## Repeated` get `…:0` and `…:1`). Example: `2:background:0` → `074ff574`. The id of a section does not depend on its position, only on level/title/occurrence.

### 2.2 Selector

`<selector>` is the 2nd positional argument:

- Starts with `#` → **heading selector**: `hashes` = leading run of `#` (must be 1..6, else error `invalid_id` "Invalid heading selector: <sel>"); `title` = rest after the hashes, trimmed (empty → `invalid_id`). It matches sections with `level == hashes` AND `title == title` — **exact, case-sensitive** comparison against the stored title. 0 matches → `section_not_found`; ≥2 → `ambiguous_section`. (Space after the hashes is optional for the selector: `##Usage` == `## Usage`.)
- Otherwise it must match `^[0-9a-f]{8}$` case-insensitively (`isValidId`), else error `invalid_id`. Then exact-string compare with section ids (the stored ids are lowercase, so an UPPERCASE id is valid but finds nothing → `section_not_found`). Not found → `section_not_found`.
- Anything else (including `~…`, `^…`) → `invalid_id`.

### 2.3 Content window

- `--deep` absent: window = lines `line .. lineEnd` (1-indexed), i.e. body = `lines.slice(line, lineEnd)` (0-indexed slice, skips the header line itself). `endLine` = `lineEnd`.
- `--deep`: `endLine` = (line of the next section **after this one in document order** whose `level <= this.level`) − 1; if none: `lines.length`, decremented while `endLine > line` and `lines[endLine-1].trim()==""` (same trailing-blank trim). Body = `lines.slice(line, endLine)`.
- `content = body.join("\n")` (it may start with `\n` when the first body line is blank, and may end with `\n` when the last included line is blank — keep them as-is).

### 2.4 Output

Text (default):

```
<'#' × level> <title> ^<id> L<line>-L<endLine>
```

- if `content.trim() == ""` → only that header line (+ final `\n`).
- else header line, blank line, then `content` (verbatim), then final `\n`: `"<header>\n\n<content>\n"`. Since `content` usually begins with the blank line that followed the header, you typically see two blank lines after the header: that is expected, copy it.

`--json`: a single line, compact JSON (`JSON.stringify`, no spaces, key order fixed), then `\n`:

```
{"id":"074ff574","level":2,"title":"Background","lineStart":18,"lineEnd":31,"content":"..."}
```

Keys in order: `id` (string), `level` (int), `title`, `lineStart` (= `line`), `lineEnd` (= `endLine`), `content`. JSON string escaping as JSON.stringify: `\n`, `\"`, `\\`, `\t`, `\r`, other controls `\u00XX`; **non-ASCII is emitted raw (UTF-8), not `\uXXXX`**; `/` not escaped. (A lone surrogate cannot occur.)

### 2.5 Errors (stderr, exit 1, stdout empty)

stderr = `error: <code>\n<message>`. Codes tested:

| Situation                                               | code                | message (informative; only the first line is checked) |
| ------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| file does not exist                                     | `file_not_found`    | `File not found: <path as given>`                     |
| other IO failure                                        | `io_error`          | `Failed to read file: <path>`                         |
| selector not `#…` and not 8 hex chars (incl. `^…`/`~…`) | `invalid_id`        | `Invalid section ID: <sel>`                           |
| bad heading selector (no title, >6 `#`)                 | `invalid_id`        | `Invalid heading selector: <sel>`                     |
| 8-hex id with no such section                           | `section_not_found` | `No section with id '<sel>' in <file>`                |
| heading with no match (also wrong level)                | `section_not_found` | `No section matching heading '<sel>' in <file>`       |
| heading matching ≥ 2 sections                           | `ambiguous_section` | `Multiple sections match heading '<sel>' in <file>`   |

Missing positional args → CLI usage error, exit 2 (not tested). `md read` on a file with no headers: any selector yields `section_not_found` / `invalid_id` as above.

---

## 3. `wl list` and `wl show`

### 3.1 Locating the worklog

Both commands use `./.worklog` relative to cwd. If `./.worklog/index.json` does not exist → error `not_initialized`, message `Worklog not initialized. Run 'wl init' first.` Nothing is ever created. (The TS CLI also walks git roots/scopes; the test harness runs outside any git repo, so only the single-worklog path matters.)

### 3.2 Storage layout

```
.worklog/
  index.json                 # summary of all tasks (source for `wl list`, and for resolving ids in `wl show`)
  tasks/<fullTaskId>.md      # one file per task (source for `wl show`)
```

Task ids: 25 chars, `[0-9a-z]`, e.g. `9n3ksypyyujvxajl4o1djfk67`. Short id = first 6 chars (see 3.3).

#### `index.json` (JSON, pretty-printed 2 spaces in the fixtures; any JSON whitespace must be accepted)

```json
{
  "version": 2,
  "tasks": {
    "<fullId>": {
      "name": "Fix login bug",
      "desc": ["part 1", "part 2"],         // array of strings (a bare string is also tolerated => [string]; "" => [])
      "status": "created|ready|started|done|cancelled",
      "created": "2026-01-10T09:00:00+01:00",  // ISO 8601 with offset
      "status_updated_at": "...",
      "done_at": null | "ISO",
      "cancelled_at": "ISO"      // optional (cancelled tasks)
      "tags": ["backend"],       // optional
      "parent": "<fullParentId>" // optional: present => this is a subtask
      // "links": [...] exists in the format but is out of scope
    }
  }
}
```

`version` ≥ 2 in all fixtures (no migration).

#### `tasks/<fullId>.md` (Markdown + YAML frontmatter)

```
---
id: 9n3ksypyyujvxajl4o1djfk67
uid: ee640a0e-29f7-4bb6-a76d-d7bff40a8582
name: Fix login bug
desc:
  - |-
    Users can't log in with **SSO**.
    Second paragraph with unicode: café ☕
status: started
created_at: '2026-01-10T09:00:00+01:00'
ready_at: null
started_at: '2026-01-20T10:00:00+01:00'
done_at: null
last_checkpoint: '2026-01-20T10:00:00+01:00'
has_uncheckpointed_entries: true
metadata:                 # optional, ignored by list/show
  owner: alice
tags:                     # optional
  - backend
parent: <fullParentId>    # optional
---

# Entries

## 2026-01-10 09:05  [kind:: info]
[added:: 2026-01-20 10:00]
Reproduced the bug locally


## 2026-01-10 11:00  [kind:: action]
[added:: 2026-01-20 10:00]
Patched comparison to use UTC
multi-line message

## 2026-02-01 09:30
[added:: 2026-02-01 09:45]
Untyped entry (no kind)


# Checkpoints

## 2026-01-20 10:00

### Changes
Root cause: UTC vs local time.

### Learnings
Always store timestamps in UTC.

# TODO

- [x] write tests  [id:: WlLc1BE] ^WlLc1BE
- [/] refactor  [owner:: bob] ^VzXKmmB
```

The frontmatter is standard YAML (`desc` may be a string, a list of strings, or null; block scalars `|-`/`|`, single/double quoted strings, `null`, lists, nested maps must be supported by the YAML parser; unparsable YAML ⇒ treated as `{}`). If the file has no frontmatter (no closing `---`) → error `invalid_task_file` "Invalid task file: missing frontmatter" (exit 1; untested).

**Parsing the body** uses exactly the Markdown model of section 2.1 (frontmatter skipped, fences respected, same header regex; ids = hash). Concretely:

- **Entries**: the level-1 section titled exactly `Entries` (matched by its id = hash of `1:entries:0`) and level-2 sections located after it and before the `# Checkpoints` header (or to the end of `Entries` with `--deep` semantics if there is no Checkpoints section). Each such `##` section is one entry:
  - title = `<ts>` or `<ts>  [kind:: <kind>]` — regex `^(.*?)\s{2}\[kind::\s+([^\]]+)\]\s*$` (two or more whitespace chars before `[kind::`; `ts` = group 1 right-trimmed). If no match, `ts` = whole title, no kind. `kind` is kept only if it is one of `action, info, state, hypothesis, finding, learning`; otherwise it is dropped (but the entry stays).
  - body = lines after the header up to the next header (any level), joined by `\n`, then `.trim()`. If the body starts with `[added:: YYYY-MM-DD HH:MM]` (regex `^\[added::\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\n?([\s\S]*)$`) then `added_at` = that stamp and `msg` = the rest trimmed; else `msg` = body, no `added_at`.
  - entry `id` = `sha256("2:<lowercase(ts)>:<occ>")[0:8]`, `occ` = 0-based count of previous entries with the _same ts string_ (case-sensitive count key, hash input lowercased/trimmed). (Hash identical to 2.1.5 with level 2 and the ts as title.)
- **Checkpoints**: level-2 sections, after `# Checkpoints`, whose title starts with `\d{4}-\d{2}-\d{2}`. Each ends at the next such section (or the end of the `# Checkpoints` section incl. subsections — this is also where `# TODO` begins, since it's a level-1 header). `ts` = title. Inside, scan lines for `^###\s+Changes\s*$` and `^###\s+(Learnings|Insights)\s*$` (the last occurrence of each wins). `changes` = lines after the Changes header up to the Learnings header (or end of checkpoint), joined `\n`, trimmed; `learnings` = lines after the Learnings header to the end of the checkpoint, trimmed. Missing header ⇒ `""`.
- **Todos**: under level-1 `TODO`; for every line in that section matching `^-\s*\[(.)\]\s*(.+)$`: status char map ``→`todo`, `/`→`wip`, `>`→`blocked`, `-`→`cancelled`, `x`→`done` (anything else → `todo`); the rest must end with a block ref `\^(\w+)\s*$` (else the line is ignored) → `id`; text before it is trimmed; metadata = all `\[(\w+)::\s*([^\]]+)\]` pairs (value trimmed) except key `id`; `text` = that text with all those `[k:: v]` removed (`\s*\[(\w+)::\s*([^\]]+)\]` →``), trimmed. Order = file order.

Dates: `ts` inside entries/checkpoints is already `YYYY-MM-DD HH:MM`. ISO frontmatter/index timestamps are shortened by `iso.slice(0,16).replace("T"," ")` — plain string slicing, **no timezone conversion** (`2026-01-10T09:00:00+01:00` → `2026-01-10 09:00`).

### 3.3 Short ids

For a list of full ids `ALL` and an id `X`: start with `len = 5`; while `len < len(X)`: prefix = `X[:len]`; if no other id in `ALL` (case-insensitively) starts with that prefix → return `X[:min(len+1, len(X))]` (so normally **6 chars**); else `len += 1`. If it falls through, return `X`. Todo ids (7 chars like `WlLc1BE`) use the same function over the todos of the same list (→ `WlLc1B`).

### 3.4 `wl list [flags]`

Flags: `--all`, `--created`, `--ready`, `--started`, `--done`, `--cancelled`, `--subtasks`, `--json`.

Selection (from `index.json`, no task files read):

1. Status filter: if `--all` → every status. Else if any of the five status flags is given → union of the given statuses. Else default = `created`, `ready`, `started`. (`--all` wins over the status flags.)
2. Subtasks: without `--subtasks`, tasks having a `parent` key are hidden. With `--subtasks`, they are shown. Subtask status is filtered by the same rule (e.g. a done subtask appears only with `--all` / `--done`). (But see grouping below: in text mode a subtask whose parent is not selected is not displayed at all; in `--json` it is still listed.)
3. Tasks blocked by open dependencies are hidden in the real tool; out of scope (no links in fixtures).

**JSON** (`--json`): `{"tasks":[ ... ]}` compact, tasks sorted by **full id ascending** (plain code-point/ASCII order is fine for `[0-9a-z]`). Each item, key order: `id` (full), `name`, `desc` (parts joined with `"\n\n---\n\n"`), `desc_parts` (array), `status`, `created` (short form `YYYY-MM-DD HH:MM`), `tags` (only if the index entry has a `tags` key; copied as is), `parent` (only when `--subtasks` is given AND the task has a parent; full parent id). `name` = index `name` (if missing: the joined desc). Empty list → `{"tasks":[]}`.

**Text**:

- Empty selection: `no active tasks` (or `no tasks` when `--all`). Exit code 0.
- Else sort by `created` **descending** (compare the short `created` strings / dates; for equal values keep the by-id ascending order — stable sort).
- Short ids computed over the ids of the _selected_ tasks.
- One row = `<tags><shortId>  <status>  "<name>"  <created>` where `<tags>` = `#tag1 #tag2` + two spaces if the task has ≥1 tag, else empty; separators are **two spaces**. Example: `#backend #urgent  cq3984  created  "Refactor auth module"  2026-01-12 08:30`.
- If at least one _selected_ task has a `parent` (only possible with `--subtasks`, which is the only time `parent` is set): grouping mode. Walk the sorted list; every task without a parent is a top-level row, immediately followed by its children (same sort order), each child row **indented by two spaces** (`7natz8  started  "..."  ...`). A child whose parent is not in the selection is silently **not displayed** in this mode (and in no other row). Children rows never carry the group-level logic again (no nesting beyond one level).
- Join rows with `\n`; the program prints it plus a final `\n`.

### 3.5 `wl show [taskId] [--json] [--active]`

1. `taskId` omitted (and no env var) → error `invalid_args`: `taskId argument is required (or set WORKLOG_TASK_ID environment variable)`.
2. Resolve: load `index.json`; candidates = full ids whose lowercase starts with lowercase(`taskId`). 0 → `task_not_found`: `No task found matching prefix: <taskId>`. ≥2 → `invalid_args` (first stderr line must be `error: invalid_args` — plain mode; in `--json` mode see 4). 1 → proceed. A full 25-char id is just a prefix.
3. Read `tasks/<fullId>.md` (missing → `task_not_found`, `Task not found: <fullId>`), parse as 3.2.
4. Build the output model:
   - `task` = short id of the task among all index ids; `fullId`; `name` = frontmatter `name`; `desc_parts` = normalized frontmatter `desc` (null→[]; string→[string] unless ""→[]; list→each item stringified, empty strings dropped); `desc` = parts joined by `"\n\n---\n\n"`; `status` = frontmatter `status`; `created` = short(`created_at`); `ready` = short(`ready_at`) or `null`; `started` = short(`started_at`) or `null`.
   - `last_checkpoint` = the **last** checkpoint in file order as `{ts, changes, learnings}`, or `null`.
   - `entries_since_checkpoint`: if frontmatter `last_checkpoint` is null/absent → ALL entries. Otherwise let `C = short(frontmatter.last_checkpoint)` (`YYYY-MM-DD HH:MM`); keep entries whose `(added_at ?? ts) > C`, comparing as date-times **at minute precision** (string comparison of `YYYY-MM-DD HH:MM` is equivalent). Strictly greater: equal ⇒ excluded. Then sort ascending by `ts` (string compare, stable). Entry objects: `{id, ts, msg, kind?, added_at?}` in that key order (kind/added_at omitted when absent).
   - `todos`: all todos in file order; with `--active`, drop `done` and `cancelled`. Todo object: `{id, text, status, metadata}` (metadata `{}` if none; key order of metadata = order of appearance).
   - `tags` = frontmatter `tags` (array) if non-empty, else omitted.
   - `parent` (only if frontmatter has `parent` AND that id exists in the index): `{id (full), shortId, name, status}` taken from the **index** entry of the parent.
   - `subtasks` (omitted if no child; children = index entries whose `parent == this fullId`, in `index.json` key order, i.e. insertion order): build recursively, max depth 3 (`depth>=3` ⇒ []):
     - for each child: if its index status is `done`/`cancelled` and it has `done_at` (or `cancelled_at`) and the parent's frontmatter `last_checkpoint` is set and `Date(done_at) <= Date(parent.last_checkpoint)` (true instants, offsets taken into account) ⇒ skip child. If the child's task file is missing ⇒ skip.
     - closed child → `{id, shortId, name, status, doneAt (frontmatter done_at or null), cancelledAt (frontmatter cancelled_at or null), lastCheckpoint (child's last checkpoint {ts,changes,learnings} or null)}` — full ISO strings for doneAt/cancelledAt as stored.
     - open child → `{id, shortId, name, status, activeTodos?, subtasks?}`: `activeTodos` = child's todos not done/cancelled (key omitted when empty); `subtasks` = recursion with the child's own `last_checkpoint` (omitted when empty).
     - `name`/`status` of children come from the child's **task file** frontmatter. Short ids over all index ids.
   - `subtasks` is omitted only if the task has no child in the index. If it has children but all are skipped, the value is `[]` (kept in JSON as `"subtasks":[]`; no subtasks section in text).
5. Output.

**JSON** (`--json`): `JSON.stringify` compact of the object with keys in this order, absent/undefined keys omitted: `task, fullId, name, desc, desc_parts, status, created, ready, started, last_checkpoint, entries_since_checkpoint, todos, tags, parent, links, subtasks` (`ready`, `started`, `last_checkpoint` are present as `null` when empty; `links` never appears in this slice). Non-ASCII raw UTF-8.

**Text** (lines joined by `\n`, final `\n` added; blank lines are really empty — no trailing spaces except where a desc line is empty, see below):

```
id: <short>
full id: <full>
name: <name>
status: <status>
parent: <parentShort>  "<parentName>"  (<parentStatus>)      # only if parent object exists
tags: #t1 #t2                                                   # only if tags
history:
  created: <created>
  ready: <ready>                                                # only if not null
  started: <started>                                            # only if not null
<empty line>
desc:
  <desc line 1>                                                 # desc.split("\n"), each prefixed with 2 spaces, even empty ones
  ...
<empty line>                                                    # next blocks only if last_checkpoint != null
last checkpoint: <ts>
  CHANGES
    <changes line>        # changes.split("\n"), each prefixed by 4 spaces (an empty `changes` gives one line of 4 spaces)
  LEARNINGS
    <learnings line>
<empty line>                                                    # only if entries_since_checkpoint non-empty
entries since checkpoint: <n>
  <ts>  <kind>            # "  " + ts, then two spaces + kind if kind present, else just ts
    <msg line>            # msg.split("\n"), each prefixed by 4 spaces
<empty line>                                                    # only if todos non-empty
todos: <n>
  <todoShortId> [<c>] <text>  [k:: v] [k2:: v2]                 # c: ' ' todo, '/' wip, '>' blocked, '-' cancelled, 'x' done
<empty line>                                                    # only if subtasks non-empty
subtasks since checkpoint: <n>
  <subShort>  <status>  "<name>"
    CHANGES                                                     # only closed child with lastCheckpoint (indent = child indent + 2)
      <line>                                                    # indent + 4
    LEARNINGS
      <line>
    <todoShort> [<c>] <text>                                    # each activeTodo (indent+2); todo short ids computed within this child's activeTodos; no metadata printed
    subtasks: <m>                                               # only if nested subtasks; then recursion with indent + 2
      <grandchild...>
```

Details that bite:

- The `desc:` block is always printed; an empty description prints `desc:` followed by one line ``(two spaces) — **trailing whitespace is part of the expected output** (see `expected/wl-show-todos.out`). Multi-part descriptions appear as `part1`, empty line (``), `---`, ``, `part2` (because of the `\n\n---\n\n` separator, each line prefixed by two spaces, empty lines → exactly two spaces).
- For todos, metadata is printed after the text as `[key:: value]` (two spaces before the first, one space between pairs). (Metadata of todos inside subtasks is not printed.)
- Todo short ids use the same short-id rule over the todos _printed in that list_ (after `--active` filtering for the main list).
- Task `tags` come from the task file frontmatter, not from the index.

### 3.6 Side effects of the TS reference (do not reproduce)

The TS CLI "purges" `done` tasks whose `done_at` is older than 30 days (deletes file and index entry) before `list`/`show`. **Fixtures avoid this by giving done tasks a `done_at` in year 2099.** Implementations must be read-only and need no purge logic.

---

## 4. Error output

Format (stderr, exit 1):

- text mode: `error: <code>\n<message>`
- `--json` mode: single line `{"error":"<code>","code":"<code>","message":"<message>"}`.

Tested stderr first lines (see `cases.json` → `expected_stderr_first_line`): `error: ambiguous_section`, `error: section_not_found`, `error: invalid_id`, `error: file_not_found`, `error: not_initialized`, `error: task_not_found`, `error: invalid_args`, and JSON ones `{"error":"not_initialized",...}` / `{"error":"task_not_found",...}` (the full line is compared; the message text for those two is: `Worklog not initialized. Run 'wl init' first.` and `No task found matching prefix: zzzzzz`).

## 5. Known ambiguities / quirks

- A1. For the ambiguous-prefix error, the TS message body lists `<shortId>  "<name>"` but prints a buggy name (comma-joined desc array / empty); only `error: invalid_args` is checked.
- A2. `entries since checkpoint` compares the entry's `added_at` (when it was recorded) — NOT its `ts` (logical time) — to the checkpoint date whenever `added_at` exists; `ts` is the fallback. In the fixture, task `9n3ksy` has 5 entries recorded at `2026-01-20 10:00` (== checkpoint, hence excluded) and 2 with `added_at` 2026-02-01 (shown).
- A3. All children closed before the parent's checkpoint gives `"subtasks":[]` in JSON (see 3.5). Not covered by a fixture.
- A4. Sorting in `list` text uses `new Date("YYYY-MM-DD HH:MM")` (local time) of the short strings; equal minutes keep id order. Do a lexicographic compare on the short strings — equivalent for all fixtures.
- A5. Section hashes lowercase the title with JS `toLowerCase()` (full Unicode, locale-independent). Rust `to_lowercase`, Mojo equivalents may differ for exotic characters (e.g. final sigma); fixtures use only `Café ☕ Crème brûlée`.
- A6. The `md` header regex uses `\s`, JS whitespace (includes NBSP and Unicode spaces) — fixtures use plain spaces.
