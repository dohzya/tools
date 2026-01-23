---
name: worklog
description: Track work progress during development sessions. Activates when .worklog/ exists OR user says "track this", ">track", "let's track". Maintains a chronological worklog with on-demand consolidation via checkpoints.
---

# Worklog

Track work progress with append-only worklog and on-demand checkpoints.

## Activation

| Condition                                       | Action                                                |
| ----------------------------------------------- | ----------------------------------------------------- |
| `.worklog/` exists                              | Tracking is active, use `wllist` to see current tasks |
| User says "track this", ">track", "let's track" | Run `wladd --desc "..."`                              |

## Commands

```bash
wl add [--desc "description"]                    # Create task → outputs ID
wl trace <id> "message" [options]                # Log entry → "ok" or "checkpoint recommended"
wl logs <id>                                     # Get context (last checkpoint + recent entries)
wl checkpoint <id> "changes" "learnings"         # Create checkpoint
wl done <id> "changes" "learnings"               # Final checkpoint + close task
wl list [--all]                                  # List active tasks (--all includes done <30d)
wl summary [--since YYYY-MM-DD]                  # Aggregate all tasks
wl import [-p PATH | -b BRANCH] [--rm]           # Import from other worktree
```

Add `--json` to any command for JSON output. Add `--force` (or `-f`) to `trace`
or `checkpoint` to modify completed tasks.

**Timestamp option for `wl trace`:**

Use `--timestamp TS` or `-t TS` with flexible format:
`[YYYY-MM-DD]THH:mm[:SS][<tz>]`

- If date is missing, today's date is used
- If seconds are missing, `:00` is assumed
- If timezone is missing, local timezone is used

Examples:

- `T11:15` → today at 11:15:00 (local timezone)
- `T11:15:30` → today at 11:15:30 (local timezone)
- `2024-12-15T11:15` → Dec 15, 2024 at 11:15:00 (local timezone)
- `2024-12-15T11:15:30+01:00` → Dec 15, 2024 at 11:15:30 (UTC+1)

## Workflow

### Starting

```bash
wl add --desc "Implement feature X"
# → 250116a
```

Use the returned ID for all subsequent commands.

### During work

Log notable events:

```bash
wl trace 250116a "Goal: support multi-currency orders"
wl trace 250116a "Tried adding currency field - breaks 12 tests"
wl trace 250116a "Root cause: validator expects single total"
wl trace 250116a "Pivot to CurrencyBucket approach - tests pass"
```

**When to trace:**

- Starting something (goal, objective)
- Trying an approach
- Hitting an error or blocker
- Pivoting to different approach
- Making a decision
- Something works/is validated

Keep messages concise. Include "why" for failures and pivots.

**Importing historical entries:**

To preserve original timestamps when importing from other logs (e.g.,
WORKLOG.md):

```bash
# Full ISO timestamp
wl trace 250116a "Session resumed after break" --timestamp "2024-12-15T11:00:00+01:00"

# Date + time without timezone (local TZ assumed)
wl trace 250116a "Fixed validation bug" -t "2024-12-15T11:15"

# Time only (today's date assumed)
wl trace 250116a "Quick fix applied" -t T14:30
```

### Checkpointing

Create checkpoints when:

- `wltrace` outputs `checkpoint recommended` (≥50 entries since last)
- User asks for a summary of changes or learnings
- Before a long break or context switch
- You (the agent) judge it useful to consolidate

**Process:**

1. `wllogs <id>` — get current context
2. Synthesize entries into coherent changes and learnings
3. `wlcheckpoint <id> "<changes>" "<learnings>"`

```bash
wl logs 250116a
# [read output, generate consolidated summary]

wl checkpoint 250116a \
  "- Introduced CurrencyBucket for per-currency validation
- New error MIXED_CURRENCY_ZERO_BALANCE
- Single-currency orders unchanged" \
  "- Centraliser la validation évite la fragmentation
- Pattern Bucket utile pour agréger avant validation"
```

### Completing

When task is done:

```bash
wl done 250116a \
  "<final changes summary>" \
  "<final learnings>"
```

This creates a final checkpoint and marks the task done.

### Modifying completed tasks

By default, completed tasks cannot be modified. To add entries or checkpoints to
a completed task, use the `--force` flag (or `-f`):

```bash
# Add post-completion entry
wl trace 250116a "Found edge case in production" --force

# Create post-completion checkpoint
wl checkpoint 250116a "Hotfix applied" "Edge case documented" --force
```

**When to use force:**

- Recording post-deployment issues
- Adding retrospective findings
- Documenting production learnings
- Appending missed context

**Purge protection:** Tasks with uncheckpointed entries (flag
`has_uncheckpointed_entries: true`) are not auto-purged. Create a checkpoint to
clear this flag and allow eventual cleanup.

### Getting overview

```bash
wl list              # Active tasks only
wl list --all        # Include recently completed (<30 days)
wl summary           # Full logs of all active tasks
wl summary --since 2025-01-10   # Include done tasks since date
```

Use `wlsummary` for end-of-worktree recaps.

### Importing from other worktrees

When working across multiple worktrees, import tasks before deleting the
worktree to preserve work history:

```bash
# Import by worktree path
wl import --path /path/to/other-worktree/.worklog

# Import by branch name (auto-resolves worktree path)
wl import --branch feature-x

# Remove source tasks after successful import
wl import --branch feature-x --rm
```

**Import behavior:**

- **Same task (matching UID)**: Merges new entries and checkpoints
  - Skips duplicate entries (same timestamp)
  - Warns if entry older than last checkpoint (skipped)
  - Updates `has_uncheckpointed_entries` if new entries added
- **Different task (ID collision)**: Renames imported task
  - Example: `260122a` → `260122c` if `260122a` and `260122b` exist
- **New task**: Imports as-is

**`--rm` flag:**

- Only removes fully-imported tasks (no errors/warnings)
- Tasks with skipped entries remain in source
- If all tasks removed, deletes entire source `.worklog/` directory

**Use case:**

```bash
# In feature worktree
cd ~/project-feature-x
wl add --desc "Implement feature X"
wl trace 260122a "Working on feature..."
# ... work ...

# Before deleting worktree, import to main
cd ~/project
wl import --branch feature-x --rm

# Now safe to delete feature worktree
git worktree remove ~/project-feature-x
```

## Output formats

Default output is human-readable text. Use `--json` for structured JSON.

**`wladd`:**

```
250116a
```

**`wltrace`:**

```
ok
```

or

```
checkpoint recommended (52 entries)
```

**`wllist`:**

```
250116a  active  "Multi-currency support"  2025-01-16 09:15
250116b  active  "Fix login bug"  2025-01-16 14:30
```

**`wllogs`:**

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

**`wlcheckpoint` / `wldone`:**

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

Use `wllist` to see all active tasks if you lose track.

## Guidelines

**Trace often, checkpoint occasionally.** Traces are cheap (append-only).
Checkpoints require synthesis.

**Be specific in traces.** "Tried X - failed because Y" is better than "Tried
X".

**Checkpoints are for consolidation.** Don't just concatenate traces. Synthesize
into coherent changes/learnings.

**Learnings are reusable insights.** Not just "what we did" but "what we learned
that applies elsewhere".

**Suggest checkpoints to user.** When you see `checkpoint recommended` or before
a natural break, offer to create one.

**Language.** Adapt to user's working language for traces and checkpoints.

## File structure

```
.worklog/
├── index.json           # Task list (for fast wllist)
└── tasks/
    └── 250116a.md       # Task file (frontmatter + entries + checkpoints)
```

Task files are Markdown with YAML frontmatter. Old completed tasks (>30 days)
are auto-purged.
