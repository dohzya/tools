# Worklog Internals

File format and structure documentation for debugging and manual editing.

## Directory Structure

```
.worklog/
├── index.json                          # Fast lookup index (v2)
├── tasks/
│   ├── 04vcuwpmxiygt1oq3hdrf3kob.md   # Task file (full ID as filename)
│   ├── 0bcxbtkydvyqfr46n0juf4zgy.md
│   └── ...
├── scopes/                  # Optional: multi-scope setup
│   ├── main/
│   │   └── tasks/
│   └── feature-x/
│       └── tasks/
└── config.json              # Optional: scope configuration
```

## Task File Format

Each task is a markdown file with YAML frontmatter:

```markdown
---
id: 04vcuwpmxiygt1oq3hdrf3kob
uid: 7c8b6bbb-22f9-4b17-a3cb-0c383369826e
name: Implement feature X
desc: Implement feature X with detailed description
status: started
created_at: "2026-02-05T09:30:00+01:00"
ready_at: "2026-02-05T09:45:00+01:00"
started_at: "2026-02-05T10:00:00+01:00"
done_at: null
cancelled_at: null
last_checkpoint: "2026-02-05T14:30:00+01:00"
has_uncheckpointed_entries: true
metadata:
  commit: abc1234567890def
  author: alice
parent: null
tags: []
---

# TODO

- [ ] Analyze code [id:: abc1234] ^abc1234
- [x] Implement [id:: def5678] ^def5678

# Entries

## 2026-02-05T09:30:00+01:00

Goal: implement feature X

## 2026-02-05T10:15:00+01:00

Tried approach A - failed because...

## 2026-02-05T11:00:00+01:00 [checkpoint]

### Changes

- Tried approach A (failed due to X)
- Pivoted to approach B
- Approach B working

### Learnings

1. Approach A fails because...
2. Approach B better because...

## 2026-02-05T14:30:00+01:00

Completed implementation
```

## Frontmatter Fields

### Required

- `id` (string): Short task ID (25-char base36 UUID encoding, e.g., `04vcuwpmxiygt1oq3hdrf3kob`)
- `uid` (string): Original UUID (for cross-worktree deduplication on import)
- `name` (string): Short display name (shown in `wl list`)
- `desc` (string): Full description
- `status` (string): One of `created`, `ready`, `started`, `done`, `cancelled`
- `created_at` (ISO timestamp): Creation time
- `last_checkpoint` (ISO timestamp or null): Time of last checkpoint
- `has_uncheckpointed_entries` (boolean): True if traces exist since last checkpoint

### Optional (null when not set)

- `ready_at` (ISO timestamp): When task transitioned to `ready`
- `started_at` (ISO timestamp): When task transitioned to `started`
- `done_at` (ISO timestamp): When task was completed
- `cancelled_at` (ISO timestamp): When task was cancelled
- `metadata` (object): Custom key-value pairs — common: `commit`, `author`, `pr`, `ticket`
- `tags` (array): Tag strings
- `parent` (string): Parent task ID for subtasks

## Log Entry Format

### Regular Trace

```markdown
## YYYY-MM-DDTHH:mm:ss+TZ

Message content
```

### Checkpoint

```markdown
## YYYY-MM-DDTHH:mm:ss+TZ [checkpoint]

### Changes

Consolidated changes narrative

### Learnings

Numbered insights
```

## TODO Format

```markdown
- [status] Text [id:: todo-id] [metadata...] ^todo-id
```

**Status symbols:**

- `[ ]` - todo
- `[/]` - wip
- `[>]` - blocked
- `[-]` - cancelled
- `[x]` - done

**Metadata examples:**

- `[dependsOn:: other-id]`
- `[due:: 2026-02-15]`
- `[priority:: high]`

**Block reference:** `^todo-id` enables direct TODO references via `[[task-id#^todo-id]]`

## Task ID Generation

Task IDs are UUIDs encoded in base36 (lowercase `0-9a-z`), producing 25-character strings.

Examples:

- `04vcuwpmxiygt1oq3hdrf3kob`
- `0bcxbtkydvyqfr46n0juf4zgy`

The encoding is **case-insensitive** and collision-safe across parallel sessions and multi-worktree setups. Any unambiguous prefix can be used (like git short SHAs).

**Note:** Old date-based IDs (`260205a`) from prior versions are still supported.

## Scopes (Multi-Scope Setup)

For monorepos or worktree-based workflows:

```json
{
  "scopes": {
    "main": {
      "name": "Main",
      "path": ".worklog/scopes/main"
    },
    "feature-x": {
      "name": "Feature X",
      "path": ".worklog/scopes/feature-x",
      "parent": "main"
    }
  },
  "defaultScope": "main"
}
```

Commands accept `--scope <name>` to target specific scope:

```bash
wl list --scope feature-x
wl trace 260205a --scope main "message"
```

## Manual Editing

You can manually edit task files, but:

1. **Preserve frontmatter format** - YAML must be valid
2. **Keep timestamps in ISO format** - Parser is strict
3. **Don't modify IDs** - Used for references
4. **Preserve checkpoint markers** - `[checkpoint]` is significant
5. **Keep TODO IDs unique** - Base62 7-char format

## Backup and Migration

### Export

```bash
# JSON export
wl list --all --json > tasks-export.json

# Include completed tasks from last 30 days
wl summary --since 2026-01-01 --json > summary.json
```

### Import from other worktree

```bash
# Import tasks from branch
wl import -b feature-branch

# Import and remove from source
wl import -b feature-branch --rm
```

### Manual backup

```bash
# Backup entire worklog
tar -czf worklog-backup-$(date +%Y%m%d).tar.gz .worklog/
```

## Troubleshooting

### Corrupted task file

```bash
# Check task file syntax
cat .worklog/tasks/260205a.md

# Look for:
# - Invalid YAML frontmatter
# - Missing required fields (id, desc, status, created, updated)
# - Malformed timestamps
# - Unclosed markdown blocks
```

### Checkpoint not recognized

Ensure format is exact:

```markdown
## 2026-02-05T14:30:00+01:00 [checkpoint]

### Changes

...

### Learnings

...
```

Common mistakes:

- Missing space before `[checkpoint]`
- `### Changes` instead of `### Changes` (case-sensitive)
- Missing newline after `### Changes` or `### Learnings`

### TODO not appearing

Check format:

```markdown
- [ ] Text [id:: abc1234] ^abc1234
```

Common mistakes:

- Missing space after checkbox: `[ ]` not `[]`
- ID not in brackets: `[id:: abc1234]` not `id: abc1234`
- Missing block reference: `^abc1234` is required
