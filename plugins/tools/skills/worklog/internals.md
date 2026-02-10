# Worklog Internals

File format and structure documentation for debugging and manual editing.

## Directory Structure

```
.worklog/
├── tasks/
│   ├── 260205a.md          # Task file (ID as filename)
│   ├── 260205b.md
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
id: 260205a
desc: Implement feature X
status: active
created: 2026-02-05T09:30:00+01:00
updated: 2026-02-05T15:45:00+01:00
metadata:
  commit: abc1234567890def
  author: alice
---

# TODO

- [ ] Analyze code [id:: abc1234] ^abc1234
- [x] Implement [id:: def5678] ^def5678

# Log

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

- `id` (string): Task ID (7-char base62, e.g., "260205a")
- `desc` (string): Task description
- `status` (string): "active" or "done"
- `created` (ISO timestamp): Creation time
- `updated` (ISO timestamp): Last modification time

### Optional

- `metadata` (object): Custom key-value pairs
  - Common: `commit`, `author`, `session`, `pr`, `issue`
- `scope` (string): Scope ID for multi-scope setups

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

**Block reference:** `^todo-id` enables Obsidian linking via `[[task-id#^todo-id]]`

## Task ID Generation

Format: `YYMMDD{base62}` where base62 is a counter.

Examples:

- `260205a` - First task on 2026-02-05
- `260205b` - Second task on 2026-02-05
- `2602051` - 62nd task on 2026-02-05

Base62 alphabet: `0-9a-zA-Z`

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

## Obsidian Integration

Task files are designed for Obsidian:

- **Wikilinks**: Reference tasks via `[[260205a]]`
- **Block references**: Reference TODOs via `[[260205a#^abc1234]]`
- **Frontmatter**: Compatible with Dataview queries
- **Daily notes**: Link tasks to daily notes for context

Example Dataview query:

```dataview
TABLE desc, status, created
FROM ".worklog/tasks"
WHERE status = "active"
SORT created DESC
```

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
