# Worklog Reference

Complete reference for the worklog skill.

## Workflow Guide

### Tracing well

```bash
# ✅ GOOD: include goal, cause, piste
wl trace <id> "Goal: support multi-currency"
wl trace <id> "Tried direct field - broke 12 tests (cause: validator expects single total)"
wl trace <id> "Pivot to CurrencyBucket pattern (piste: isolate currency logic)"
wl trace <id> "Tests pass - CurrencyBucket works"

# ❌ BAD: no context
wl trace <id> "Tried X" / "Didn't work" / "Fixed it"
```

**Batch tracing with timestamps:**

```bash
wl trace <id> -t T14:30 "Started investigation"
wl trace <id> -t T15:15 "Found root cause"
```

### Checkpoints

When `wl trace` says "checkpoint recommended":

```bash
wl logs <id>    # 1. Review traces first
wl checkpoint <id> \
  "- Implemented CurrencyBucket pattern
- Initial direct field approach failed (broke tests)
- Pivot to CurrencyBucket → all tests pass" \
  "- Direct field broke validators (wrong abstraction)
- Bucket pattern isolates concerns better"
```

### Reopening a task

If you need to work on a task again after closing it, **reopen it** instead of using `--force`:

```bash
wl start <id>    # reopen done or cancelled task → "task reopened"
```

This transitions the task back to `started`, clears the `done_at`/`cancelled_at` timestamp, and lets you trace normally without `--force`.

**Prefer reopen over `--force`**: `wl start` restores the task to a proper working state, keeps the history clean, and doesn't require `--force` on every subsequent trace.

### Completing a task

**Order matters:** commit → `wl show` → `wl done`

```bash
git commit -m "feat: multi-currency support"
wl show <id>      # check pending TODOs + traces to consolidate
wl done <id> \
  "Changes narrative (all actions including failed attempts)" \
  "1. Direct field broke validators - wrong abstraction
2. Bucket pattern isolates concerns - reusable pattern" \
  --meta commit=$(git rev-parse HEAD)
```

REX quality: ❌ "Tests pass" (result) · ❌ "Used CurrencyBucket" (action) · ✅ "Bucket pattern isolates concerns better than direct fields" (insight)

### Sub-agent communication via subtasks

```bash
# Main agent
wl create --started "Implement feature X"  # → <parent-id>
wl claude <parent-id>                       # launch sub-agent with task context

# Sub-agent creates its own scoped subtask
wl create --parent <parent-id> --started "Analyze existing API"
wl trace <subtask-id> "Found 3 endpoints to modify"

# Main agent monitors
wl show <parent-id>          # shows subtasks-since-checkpoint
wl list --subtasks           # all tasks with subtasks indented
wl list --parent <parent-id> # only children of this parent
```

Use `ready` (not `started`) for subtasks planned but not yet assigned to a sub-agent.

### `wl run` and `wl claude`

```bash
wl run <id> npm test             # run with WORKLOG_TASK_ID injected
wl run --create "Run tests" npm test   # create task on-the-fly + run
wl claude              # uses WORKLOG_TASK_ID if already set
wl claude <id>         # explicit task
wl claude <id> -c      # pass Claude args after taskId
wl run <id> claude -c --model opus    # complex Claude args
```

`WORKLOG_TASK_ID` is picked up automatically by `trace`, `checkpoint`, `done` — no need to specify `<id>` when running inside `wl run`.

### Common mistakes

1. **Working without worktask** → always create worktask first
2. **Vague traces** → include causes (why failed) & pistes (what next)
3. **Missing timestamps on batch traces** → use `-t`
4. **Checkpoint = conclusion** → NO: consolidate traces into narrative
5. **Done before commit** → commit first
6. **Done without reviewing** → always `wl show <id>` first
7. **REX = summary** → REX = critical distance, reusable insights
8. **Tracing without starting** → `wl start <id>` before tracing
9. **Using --force on a task you need to rework** → reopen with `wl start <id>` instead

## Task Lifecycle

```
created → ready → started → done
   │         │        │       │
   │         │        │       └──→ started (reopen)
   │         │        └──→ cancelled → started (reopen)
   │         └──→ cancelled
   └──→ cancelled
```

- **created** (default): Task defined, not ready yet
- **ready**: Task ready to be picked up
- **started**: Actively working on the task
- **done**: Task completed (final checkpoint)
- **cancelled**: Task abandoned

Transitions: `ready` allows `created → ready` and `started → ready`. `start` allows `created → started`, `ready → started`, `done → started` (reopen), and `cancelled → started` (reopen). `cancel` works from any state except `done`.

## Commands

### Core commands

```bash
wl create <name> [desc] [--ready|--started]  # Create task → outputs ID
wl ready <id>                                # Transition to ready
wl start <id>                                # Transition to started (or reopen done)
wl update <id> [--name <name>] [--desc <d>]  # Update task name or description
wl trace <id> [options] "message"            # Log entry → "ok" or "checkpoint recommended"
wl logs <id>                                 # Get context (last checkpoint + recent entries)
wl checkpoint <id> "changes" "learnings"     # Create checkpoint
wl done <id> ["changes" "learnings"]         # Final checkpoint + close task (args optional)
wl cancel <id> [reason]                      # Cancel/abandon task (marks as cancelled)
wl list [--created] [--ready] [--started] [--done] [--cancelled]  # Filter tasks
wl show <id>                                 # Detailed task view with history
wl meta <id> [<key> <value>]                 # View or set task metadata
wl summary [--since YYYY-MM-DD]              # Aggregate all tasks
wl import [-p PATH | -b BRANCH] [--rm]       # Import from other worktree
```

### Backward compatibility

```bash
wl task create <desc> [--todo]...            # Creates in 'started' state (legacy)
```

### TODO management

```bash
wl todo list [<task-id>]                     # List todos (all active tasks or specific task)
wl todo add <task-id> <text>                 # Add a todo to a task
wl todo set key=value <todo-id>              # Update todo (e.g., status=done)
wl todo next [<task-id>]                     # Show next available todo
```

### Global options

- `--json`: Output in JSON format (all commands)
- `--force` or `-f`: Modify completed tasks (`trace`, `checkpoint`, `done`)

## Create command

```bash
wl create <name> [desc] [options]
```

Creates a new task. The `name` is displayed in list views, `desc` is the detailed description (defaults to `name` if not provided).

**Options:**

- `--ready`: Create in 'ready' state
- `--started`: Create in 'started' state
- `--parent <id>`: Set parent task (creates a subtask — use for sub-agent delegation)
- `--todo <text>`: Add a TODO item (repeatable)
- `--meta <key=value>`: Set metadata (repeatable)
- `-t, --timestamp <ts>`: Custom creation timestamp

**Examples:**

```bash
# Default: created state
wl create "Fix login bug"

# With description
wl create "Fix login bug" "Users can't login after session timeout"

# Start immediately
wl create --started "Urgent hotfix"

# As a subtask (for sub-agent delegation)
wl create --parent <parent-id> --started "Analyze existing API"

# With TODOs
wl create "Feature X" --todo "Analyze" --todo "Implement" --todo "Test"
```

## State transition commands

### `wl ready <id>`

Marks task as ready to work on.

- Allowed from: `created`, `started`
- Rejected from: `done`, `cancelled`

### `wl start <id>`

Starts working on a task, or reopens a done/cancelled task.

- Allowed from: `created`, `ready`, `done` (reopen), `cancelled` (reopen)
- When reopening: clears `done_at`/`cancelled_at`, returns "task reopened"

### `wl update <id>`

Updates task name and/or description.

```bash
wl update <id> --name "New name"
wl update <id> --desc "New description"
wl update <id> --name "New name" --desc "New description"
```

Must provide at least one of `--name` or `--desc`.

## List command

```bash
wl list [options]
```

**Default:** Shows tasks in `created`, `ready`, and `started` states.

**Status filters** (cumulative):

- `--created`: Show created tasks
- `--ready`: Show ready tasks
- `--started`: Show started tasks
- `--done`: Show done tasks
- `--cancelled`: Show cancelled tasks

When any status filter is specified, only those statuses are shown. Multiple filters are combined with OR logic.

**Other options:**

- `--all` or `-a`: Show all tasks including completed (<30d)
- `-p <path>`: List tasks at specific path

**Examples:**

```bash
wl list                              # created + ready + started (default)
wl list --started                    # Only started tasks
wl list --created --ready            # Created OR ready tasks
wl list --done                       # Only done tasks
wl list --all                        # Everything including done/cancelled
```

## Show command

Displays detailed task information with lifecycle history.

```bash
wl show <id>
```

**Output format:**

```
id: 2u83qv
full id: 2u83qv12wsgi1oxty1d8gzfnd
name: Fix login bug
status: started
history:
  created: 2026-02-05 10:00
  ready: 2026-02-05 10:15
  started: 2026-02-05 10:30

desc:
  Description de la tâche.
  Peut-être sur plusieurs lignes.

last checkpoint: 2026-02-05 14:14
  CHANGES
    Consolidation des traces
    Peut être sur plusieurs lignes.
  LEARNINGS
    REX de cette tâche.
    Peut être sur plusieurs lignes.

entries since checkpoint: 2
  2025-01-16 11:30
    Contenu de la trace
    Peut être sur plusieurs lignes.
  2025-01-16 11:45
    Contenu de la trace
    Peut être sur plusieurs lignes.

todos: 2
  CphkaD [x] Première todo
  3cq2Ut [ ] Deuxième todo
```

## Trace options

**IMPORTANT:** Always place options BETWEEN the task ID and the message content. This ensures options remain visible in truncated UI displays.

✅ **Correct:** `wl trace <id> -t T11:35 "message"` ❌ **Incorrect:** `wl trace <id> "message" -t T11:35`

Available options:

- `--timestamp TS` or `-t TS`: Custom timestamp (see format below)
- `--force` or `-f`: Allow tracing on done/cancelled tasks without reopening (prefer `wl start <id>` if you need to work on it again)

**Warning behavior:** `wl trace` warns if the task is not in `started` state (but still records the trace). If the task is `done` or `cancelled`, it errors unless `--force` is used.

## Done command

```bash
wl done <id> ["changes" "learnings"] [--force] [--meta key=value]
```

**Arguments are optional** when there are no uncheckpointed entries (no new traces since last checkpoint). If there are uncheckpointed entries, `changes` and `learnings` are required.

```bash
# With final checkpoint (when traces exist)
wl done <id> "What changed" "What we learned"

# Without args (when no new traces since last checkpoint)
wl done <id>

# Force completion despite pending TODOs
wl done <id> "changes" "learnings" --force
```

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
wl trace <id> -t T11:15 "Quick fix"

# Time with seconds
wl trace <id> -t T11:15:30 "Detailed fix"

# Full date + time (local timezone)
wl trace <id> -t 2024-12-15T11:15 "Session resumed"

# Full ISO timestamp with timezone
wl trace <id> -t "2024-12-15T11:15:30+01:00" "Fixed validation"
```

**Use case:** Importing historical entries from other logs (e.g., WORKLOG.md) while preserving original timestamps.

## Modifying completed tasks

If you need to continue working on a done or cancelled task, **reopen it first**:

```bash
wl start <id>    # reopen → back to "started", then trace normally
```

If you only want to append a note without reopening (post-deployment observation, retrospective finding, etc.), use `--force`:

```bash
# Add post-completion entry without reopening
wl trace <id> -f "Found edge case in production"

# Create post-completion checkpoint without reopening
wl checkpoint <id> -f "Hotfix applied" "Edge case documented"
```

**Reopen vs force:**

| Situation                      | Preferred                |
| ------------------------------ | ------------------------ |
| Need to work on the task again | `wl start <id>` (reopen) |
| Quick retrospective note       | `wl trace <id> --force`  |
| Post-deployment observation    | `wl trace <id> --force`  |

**Purge protection:** Tasks with uncheckpointed entries (flag `has_uncheckpointed_entries: true`) are not auto-purged. Create a checkpoint to clear this flag and allow eventual cleanup.

## Cancelling tasks

Use `wl cancel` to abandon a task without completing it. This marks the task as `cancelled` instead of `done`.

```bash
# Cancel a task without reason
wl cancel <id>

# Cancel with a reason (stored in metadata)
wl cancel <id> "Requirements changed, no longer needed"
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

- `done` = task completed successfully (requires changes + learnings if traces exist)
- `cancel` = task abandoned (optional reason)

Cancelled tasks appear in `wl list --cancelled` but not in default `wl list`.

## Claude Code Hooks

Configure `wl` as Claude Code hooks for automatic checkpoints on context compaction:

```json
"PreCompact":  [{"type": "command", "command": "wl checkpoint --claude -q"}],
"PostCompact": [{"type": "command", "command": "wl show -q"}]
```

- **`PreCompact`**: Before compaction, synthesizes a checkpoint via Claude (`--claude`) so no trace is lost. The `-q` flag silently no-ops when no task is active — safe to configure globally.
- **`PostCompact`**: After compaction, `wl show -q` reprints task context into the new window. Same `-q` guard.

**Add to `~/.claude/settings.json`** (or per-project `settings.json`):

```json
{
  "hooks": {
    "PreCompact": [
      { "type": "command", "command": "wl checkpoint --claude -q" }
    ],
    "PostCompact": [{ "type": "command", "command": "wl show -q" }]
  }
}
```

These hooks are idempotent: if no `WORKLOG_TASK_ID` is set, both commands exit silently.

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
wl create --started "Implement feature X"
wl trace <id> "Working on feature..."
# ... work ...

# Before deleting worktree, import to main
cd ~/project
wl import -b feature-x --rm

# Now safe to delete feature worktree
git worktree remove ~/project-feature-x
```

## Output formats

Default output is human-readable text. Use `--json` for structured JSON.

### `wl create`

```
acjold
```

### `wl list`

```
acjold  started  "Multi-currency support"  2025-01-16 09:15
b2x9kf  created  "Fix login bug"  2025-01-16 14:30
```

### `wl show`

See [Show command](#show-command) section above.

### `wl trace`

```
ok
```

or

```
checkpoint recommended (52 entries)
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
Task: acjold "Implement feature X"
  abc1234  [ ] Analyze existing code
  def5678  [>] Write tests  [dependsOn:: abc1234]
  ghi9012  [x] Setup environment  [due:: 2026-02-10]

Task: b2x9kf "Fix bug Y"
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
Task: acjold "Implement feature X"
Text: Analyze existing code
Status: todo
```

## Multiple tasks

You can have multiple active tasks. Always specify the task ID:

```bash
wl trace <id1> "Working on currency bucket"
wl trace <id2> "Fixed unrelated login bug"
```

Use `wl list` to see all active tasks if you lose track.

## TODO Management

TODOs allow tracking discrete action items within a task.

### Creating tasks with TODOs

```bash
# Create task with initial TODOs
wl create "Feature X" --todo "Analyze code" --todo "Write tests" --todo "Implement"

# Shortcut: use first TODO as task description
wl create --todo "Fix authentication bug"
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
├── index.json           # Task list with version (for fast wl list)
└── tasks/
    └── <id>.md          # Task file (frontmatter + entries + checkpoints)
```

Task files are Markdown with YAML frontmatter. Old completed tasks (>30 days) are auto-purged.

### Index format (v2)

```json
{
  "version": 2,
  "tasks": {
    "<full-id>": {
      "name": "Short name",
      "desc": "Full description",
      "status": "started",
      "created": "2026-02-05T10:00:00+01:00",
      "status_updated_at": "2026-02-05T10:30:00+01:00"
    }
  }
}
```

## JSON output format

Add `--json` to any command for machine-readable output.

### Show output

```json
{
  "task": "acjold",
  "fullId": "acjold3x5q1m8h2k9n7p0r4w6",
  "name": "Implement feature X",
  "desc": "Implement feature X",
  "status": "started",
  "created": "2026-02-05 10:00",
  "ready": null,
  "started": "2026-02-05 10:30",
  "last_checkpoint": {
    "ts": "2025-01-16 11:00",
    "changes": "- Added initial structure",
    "learnings": "- Pattern X works well"
  },
  "entries_since_checkpoint": [
    {
      "ts": "2025-01-16 11:30",
      "msg": "Added edge case handling"
    }
  ],
  "todos": []
}
```
