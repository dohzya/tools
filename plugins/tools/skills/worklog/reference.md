# Worklog Reference

Complete reference for the worklog skill.

## Commands

### Core commands

```bash
wl add [--desc "description"] [--todo "text"]... # Create task → outputs ID
wl trace <id> [options] "message"                # Log entry → "ok" or "checkpoint recommended"
wl logs <id>                                     # Get context (last checkpoint + recent entries)
wl checkpoint <id> "changes" "learnings"         # Create checkpoint
wl done <id> "changes" "learnings"               # Final checkpoint + close task
wl cancel <id> [reason]                          # Cancel/abandon task (marks as cancelled)
wl list [--all] [-p PATH]                        # List active tasks (--all includes done <30d)
wl meta <id> [<key> <value>]                     # View or set task metadata
wl summary [--since YYYY-MM-DD]                  # Aggregate all tasks
wl import [-p PATH | -b BRANCH] [--rm]           # Import from other worktree
```

### TODO management

```bash
wl todo list [<task-id>]                         # List todos (all active tasks or specific task)
wl todo add <task-id> <text>                     # Add a todo to a task
wl todo set key=value <todo-id>                  # Update todo (e.g., status=done)
wl todo next [<task-id>]                         # Show next available todo
```

### Global options

- `--json`: Output in JSON format (all commands)
- `--force` or `-f`: Modify completed tasks (`trace`, `checkpoint`)

### Trace options

**IMPORTANT:** Always place options BETWEEN the task ID and the message content. This ensures options remain visible in truncated UI displays.

✅ **Correct:** `wl trace 250116a -t T11:35 "message"` ❌ **Incorrect:** `wl trace 250116a "message" -t T11:35`

Available options:

- `--timestamp TS` or `-t TS`: Custom timestamp (see format below)
- `--force` or `-f`: Allow modifying completed tasks

## Timestamp format

Use `--timestamp TS` or `-t TS` with flexible format: `[YYYY-MM-DD]THH:mm[:SS][<tz>]`

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

**Use case:** Importing historical entries from other logs (e.g., WORKLOG.md) while preserving original timestamps.

## Modifying completed tasks

By default, completed tasks cannot be modified. Use `--force` (or `-f`) to add entries or checkpoints after completion:

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

**Purge protection:** Tasks with uncheckpointed entries (flag `has_uncheckpointed_entries: true`) are not auto-purged. Create a checkpoint to clear this flag and allow eventual cleanup.

## Cancelling tasks

Use `wl cancel` to abandon a task without completing it. This marks the task as `cancelled` instead of `done`.

```bash
# Cancel a task without reason
wl cancel 250116a

# Cancel with a reason (stored in metadata)
wl cancel 250116a "Requirements changed, no longer needed"
```

**When to cancel:**

- Requirements or priorities changed
- Task is no longer relevant
- Work superseded by another approach
- Abandoned due to blockers

**What happens:**

- Task status set to `cancelled`
- `cancelled_at` timestamp recorded
- Optional reason stored in `metadata.cancellation_reason`
- No checkpoint required (unlike `done`)
- TODOs not verified (can cancel with pending TODOs)

**Difference from done:**

- `done` = task completed successfully (requires changes + learnings)
- `cancel` = task abandoned (optional reason)

Cancelled tasks appear in `wl list --all` but not in default `wl list` (which shows only active tasks).

## Importing from other worktrees

When working across multiple worktrees, import tasks before deleting the worktree to preserve work history:

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

### `wl todo list`

```
Task: 260203a "Implement feature X"
  abc1234  [ ] Analyze existing code
  def5678  [>] Write tests  [dependsOn:: abc1234]
  ghi9012  [x] Setup environment  [due:: 2026-02-10]

Task: 260203b "Fix bug Y"
  jkl3456  [/] Debug issue
```

### `wl todo add` / `wl todo set`

```
todo added: abc1234
```

```
todo updated
```

### `wl todo next`

```
Next TODO: abc1234
Task: 260203a "Implement feature X"
Text: Analyze existing code
Status: todo
```

## Multiple tasks

You can have multiple active tasks. Always specify the task ID:

```bash
wl trace 250116a "Working on currency bucket"
wl trace 250116b "Fixed unrelated login bug"
```

Use `wl list` to see all active tasks if you lose track.

## TODO Management

TODOs allow tracking discrete action items within a task.

### Creating tasks with TODOs

```bash
# Create task with initial TODOs
wl add "Feature X" --todo "Analyze code" --todo "Write tests" --todo "Implement"

# Shortcut: use first TODO as task description
wl add --todo "Fix authentication bug"
```

### Managing TODOs

```bash
# List all TODOs across all active tasks
wl todo list

# List TODOs for a specific task
wl todo list <task-id>

# Add a new TODO to an existing task
wl todo add <task-id> "Deploy to staging"

# Update TODO status or metadata
wl todo set status=done <todo-id>
wl todo set status=wip <todo-id>
wl todo set status=blocked <todo-id>
wl todo set status=cancelled <todo-id>

# Add custom metadata
wl todo set due=2026-02-15 <todo-id>
wl todo set priority=high <todo-id>

# Set dependency
wl todo set status=blocked dependsOn=<other-todo-id> <todo-id>

# Find next available TODO
wl todo next <task-id>
```

### TODO Statuses

| Status    | Symbol | Description                    |
| --------- | ------ | ------------------------------ |
| todo      | `[ ]`  | Pending, ready to start        |
| wip       | `[/]`  | Work in progress               |
| blocked   | `[>]`  | Blocked, waiting on dependency |
| cancelled | `[-]`  | Cancelled, not needed          |
| done      | `[x]`  | Completed                      |

### Task completion with TODOs

Tasks with pending TODOs (todo/wip/blocked) cannot be marked done:

```bash
wl done <task-id> "changes" "learnings"
# Error: Task has 3 pending todo(s). Use --force to complete anyway.

# Force completion if TODOs are obsolete
wl done <task-id> "changes" "learnings" --force
```

### TODO Format

TODOs are stored in the task markdown file under `# TODO` section:

```markdown
# TODO

- [ ] Analyze existing code [id:: abc1234] ^abc1234
- [>] Write tests [id:: def5678] [dependsOn:: abc1234] ^def5678
- [x] Setup environment [id:: ghi9012] [due:: 2026-02-10] ^ghi9012
```

Each TODO has:

- **Unique ID** (7-char base62): Shown in listings, used for `wl todo set`
- **Status checkbox**: `[ ]`, `[/]`, `[>]`, `[-]`, or `[x]`
- **Text**: The TODO description
- **Metadata** (optional): Custom key-value pairs like `[dependsOn:: xyz]`, `[due:: date]`
- **Block reference** (^id): For Obsidian cross-referencing with `[[task-id#^todo-id]]`

## Task IDs

Task IDs use UUID base36 encoding to eliminate collision risks in parallel execution and multi-worktree scenarios.

### ID Generation

- **Full ID**: UUID converted to base36 (25 characters, case-insensitive)
- **Short ID**: 5 characters minimum (displayed in most commands)
- **Prefix resolution**: Any unambiguous prefix can be used (like git)

Examples:

```bash
# Full ID: acjold3x5q1m8h2k9n7p0r4w6
# Short ID: acjold
# You can use any prefix: acjo, acjol, acjold, etc.

wl trace acjold "Working on feature"  # Uses prefix
wl logs acj "message"                  # Works if unambiguous
```

### Prefix Resolution

If multiple tasks share the same prefix, worklog shows an error with details:

```
Error: Ambiguous task ID prefix "ac"
Matches:
  acjold  "Implement feature X"  2026-02-03 09:15
  actb2w  "Fix bug Y"  2026-02-03 10:30
```

### Backward Compatibility

Old date-based IDs (e.g., `250116a`) are still supported and resolved correctly.

## Task Metadata

Tasks can have custom metadata for traceability (commit SHA, PR number, author, etc.).

### Viewing metadata

```bash
wl meta <task-id>
```

Output:

```
Task: acjold "Implement feature X"
Metadata:
  commit: a1b2c3d4e5f6
  pr: 123
  author: alice
```

### Setting metadata

```bash
# Set a single key-value pair
wl meta <task-id> <key> <value>

# Example
wl meta acjold commit a1b2c3d4e5f6
wl meta acjold pr 123
```

### Deleting metadata

```bash
wl meta <task-id> --delete <key>

# Example
wl meta acjold --delete pr
```

### Common metadata keys

- `commit`: Git commit SHA
- `pr`: Pull request number
- `author`: Person who worked on the task
- `branch`: Git branch name
- `ticket`: Issue/ticket reference

Metadata is stored in the task's YAML frontmatter and preserved across imports.

## File structure

```
.worklog/
├── index.json           # Task list (for fast wl list)
└── tasks/
    └── 250116a.md       # Task file (frontmatter + entries + checkpoints)
```

Task files are Markdown with YAML frontmatter. Old completed tasks (>30 days) are auto-purged.

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
