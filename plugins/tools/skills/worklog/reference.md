# Worklog Reference

Complete reference for the worklog skill.

## Commands

### Core commands

```bash
wl add [--desc "description"]                    # Create task → outputs ID
wl trace <id> [options] "message"                # Log entry → "ok" or "checkpoint recommended"
wl logs <id>                                     # Get context (last checkpoint + recent entries)
wl checkpoint <id> "changes" "learnings"         # Create checkpoint
wl done <id> "changes" "learnings"               # Final checkpoint + close task
wl list [--all] [-p PATH]                        # List active tasks (--all includes done <30d)
wl summary [--since YYYY-MM-DD]                  # Aggregate all tasks
wl import [-p PATH | -b BRANCH] [--rm]           # Import from other worktree
```

### Global options

- `--json`: Output in JSON format (all commands)
- `--force` or `-f`: Modify completed tasks (`trace`, `checkpoint`)

### Trace options

**IMPORTANT:** Always place options BETWEEN the task ID and the message content.
This ensures options remain visible in truncated UI displays.

✅ **Correct:** `wl trace 250116a -t T11:35 "message"` ❌ **Incorrect:**
`wl trace 250116a "message" -t T11:35`

Available options:

- `--timestamp TS` or `-t TS`: Custom timestamp (see format below)
- `--force` or `-f`: Allow modifying completed tasks

## Timestamp format

Use `--timestamp TS` or `-t TS` with flexible format:
`[YYYY-MM-DD]THH:mm[:SS][<tz>]`

Rules:

- **Date optional:** If missing, today's date is used
- **Seconds optional:** If missing, `:00` is assumed
- **Timezone optional:** If missing, local timezone is used
- **T prefix required:** Time must start with uppercase `T`

Examples:

```bash
# Time only (today's date, local timezone)
wl trace 250116a -t T11:15 "Quick fix"

# Time with seconds
wl trace 250116a -t T11:15:30 "Detailed fix"

# Full date + time (local timezone)
wl trace 250116a -t 2024-12-15T11:15 "Session resumed"

# Full ISO timestamp with timezone
wl trace 250116a -t "2024-12-15T11:15:30+01:00" "Fixed validation"
```

**Use case:** Importing historical entries from other logs (e.g., WORKLOG.md)
while preserving original timestamps.

## Modifying completed tasks

By default, completed tasks cannot be modified. Use `--force` (or `-f`) to add
entries or checkpoints after completion:

```bash
# Add post-completion entry
wl trace 250116a -f "Found edge case in production"

# Create post-completion checkpoint
wl checkpoint 250116a -f "Hotfix applied" "Edge case documented"
```

**When to use force:**

- Recording post-deployment issues
- Adding retrospective findings
- Documenting production learnings
- Appending missed context

**Purge protection:** Tasks with uncheckpointed entries (flag
`has_uncheckpointed_entries: true`) are not auto-purged. Create a checkpoint to
clear this flag and allow eventual cleanup.

## Importing from other worktrees

When working across multiple worktrees, import tasks before deleting the
worktree to preserve work history:

```bash
# Import by worktree path
wl import -p /path/to/other-worktree/.worklog

# Import by branch name (auto-resolves worktree path)
wl import -b feature-x

# Remove source tasks after successful import
wl import -b feature-x --rm
```

### Import behavior

**Same task (matching UID):** Merges new entries and checkpoints

- Skips duplicate entries (same timestamp)
- Warns if entry older than last checkpoint (skipped)
- Updates `has_uncheckpointed_entries` if new entries added

**Different task (ID collision):** Renames imported task

- Example: `260122a` → `260122c` if `260122a` and `260122b` exist

**New task:** Imports as-is

### `--rm` flag

- Only removes fully-imported tasks (no errors/warnings)
- Tasks with skipped entries remain in source
- If all tasks removed, deletes entire source `.worklog/` directory

### Complete workflow example

```bash
# In feature worktree
cd ~/project-feature-x
wl add --desc "Implement feature X"
wl trace 260122a "Working on feature..."
# ... work ...

# Before deleting worktree, import to main
cd ~/project
wl import -b feature-x --rm

# Now safe to delete feature worktree
git worktree remove ~/project-feature-x
```

## Output formats

Default output is human-readable text. Use `--json` for structured JSON.

### `wl add`

```
250116a
```

### `wl trace`

```
ok
```

or

```
checkpoint recommended (52 entries)
```

### `wl list`

```
250116a  active  "Multi-currency support"  2025-01-16 09:15
250116b  active  "Fix login bug"  2025-01-16 14:30
```

### `wl logs`

```
task: 250116a
desc: Multi-currency support
status: active

last checkpoint: 2025-01-16 11:00
changes:
  - Introduced CurrencyBucket
learnings:
  - Centraliser la validation

entries since checkpoint: 2
  2025-01-16 11:30: Added edge case handling
  2025-01-16 11:45: Tests passing
```

### `wl checkpoint` / `wl done`

```
checkpoint created
```

```
task completed
```

## Multiple tasks

You can have multiple active tasks. Always specify the task ID:

```bash
wl trace 250116a "Working on currency bucket"
wl trace 250116b "Fixed unrelated login bug"
```

Use `wl list` to see all active tasks if you lose track.

## File structure

```
.worklog/
├── index.json           # Task list (for fast wl list)
└── tasks/
    └── 250116a.md       # Task file (frontmatter + entries + checkpoints)
```

Task files are Markdown with YAML frontmatter. Old completed tasks (>30 days)
are auto-purged.

## JSON output format

Add `--json` to any command for machine-readable output.

### Task object

```json
{
  "uid": "01234567-89ab-cdef-0123-456789abcdef",
  "id": "250116a",
  "desc": "Implement feature X",
  "status": "active",
  "created_at": "2025-01-16T09:15:00Z",
  "completed_at": null,
  "has_uncheckpointed_entries": true,
  "entries": [
    {
      "timestamp": "2025-01-16T09:30:00Z",
      "message": "Starting implementation"
    }
  ],
  "checkpoints": [
    {
      "timestamp": "2025-01-16T11:00:00Z",
      "changes": "- Added initial structure",
      "learnings": "- Pattern X works well"
    }
  ]
}
```
