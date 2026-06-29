# Worklog Reference

Complete reference for the worklog skill.

## Workflow Guide

### Tracing well

```bash
# ✅ GOOD: include goal, cause, piste
wl trace <id> -k info "Goal: support multi-currency"
wl trace <id> -k state "Direct field broke 12 tests (cause: validator expects single total)"
wl trace <id> -k hypothesis "Pivot to CurrencyBucket pattern (piste: isolate currency logic)"
wl trace <id> -k state "Tests pass - CurrencyBucket works"

# ❌ BAD: no context
wl trace <id> "Tried X" / "Didn't work" / "Fixed it"
```

Kinds: `action`, `info`, `state`, `hypothesis`, `finding`, `learning`. Action traces are evidence; state/finding/learning traces are synthesis anchors. If an action produces a notable result, add a second trace with the result kind.

```bash
wl traces <id> --kind finding,learning
wl traces <id> --exclude-kind action
wl traces update <id> <trace-id> --kind finding
```

Before checkpoint/done synthesis, `wl traces <id> --kind finding,learning` is a cheap high-signal check for likely learnings. It does not guarantee full coverage, but it catches most pre-identified candidates with little noise.

**Batch tracing with timestamps:**

```bash
wl trace <id> -k action -t T14:30 "Started investigation"
wl trace <id> -k finding -t T15:15 "Found root cause"
```

### Checkpoints

When `wl trace` says "checkpoint recommended":

```bash
# Preferred: let the agent synthesize from all traces (preserves your context)
wl checkpoint --claude          # Claude Code
wl checkpoint --codex           # Codex
wl checkpoint --agent           # auto-detect (CLAUDECODE=1 → claude, AGENT=codex → codex)

# Manual: write the synthesis yourself
wl checkpoint <id> \
  "Implemented CurrencyBucket pattern after pivot from direct fields" \
  "Direct field approach broke validators — bucket pattern isolates concerns better"
```

### Reopening a task

If you need to work on a task again after closing it, **reopen it** instead of using `--force`:

```bash
wl start <id>    # reopen done or cancelled task → "task reopened"
```

This transitions the task back to `started`, clears the `done_at`/`cancelled_at` timestamp, and lets you trace normally without `--force`.

**Prefer reopen over `--force`**: `wl start` restores the task to a proper working state, keeps the history clean, and doesn't require `--force` on every subsequent trace.

### Completing a task

**Order matters:** commit → `wl show` → close when explicitly requested, otherwise propose closing if complete → `wl done`

```bash
git commit -m "feat: multi-currency support"
wl show <id>      # check pending TODOs + traces to consolidate

# If the user already asked to close, proceed. Otherwise, propose closing first.
# Preferred: let the agent synthesize the final checkpoint
wl done --claude                # Claude Code
wl done --codex                 # Codex
wl done --agent                 # auto-detect

# Manual: write the synthesis yourself
wl done <id> \
  "Changes narrative (all actions including failed attempts)" \
  "1. Direct field broke validators - wrong abstraction
2. Bucket pattern isolates concerns - reusable pattern" \
  --meta commit=$(git rev-parse HEAD)
```

Learning quality: ❌ "Tests pass" (result) · ❌ "Used CurrencyBucket" (action) · ✅ "Bucket pattern isolates concerns better than direct fields" (learning)

Before writing the Learnings argument, run:

```bash
wl traces <id> --kind finding,learning
```

Use it as a focused review pass for likely reusable lessons.

### Sub-agent communication via subtasks

```bash
# Main agent
wl create --started "Implement feature X"  # → <parent-id>
wl claude <parent-id>                       # launch Claude sub-agent with task context
wl codex <parent-id>                        # launch Codex sub-agent
wl agent <parent-id>                        # auto-detect agent from env

# Sub-agent creates its own scoped subtask
wl create --parent <parent-id> --started "Analyze existing API"
wl trace <subtask-id> -k finding "Found 3 endpoints to modify"

# Main agent monitors
wl show <parent-id>          # shows subtasks-since-checkpoint
wl list --subtasks           # all tasks with subtasks indented
wl list --subtasks-of-started # active tasks + children of started tasks
wl list --parent <parent-id> # only children of this parent
```

Use `ready` (not `started`) for subtasks planned but not yet assigned to a sub-agent.

### `wl run` / `wl claude` / `wl codex` / `wl agent`

```bash
wl run <id> npm test             # run with WORKLOG_TASK_ID injected
wl run --create "Run tests" npm test   # create task on-the-fly + run
wl claude              # uses WORKLOG_TASK_ID if already set
wl claude <id>         # explicit task
wl claude <id> -c      # pass Claude args after taskId
wl codex <id>          # launch Codex with task context
wl agent               # auto-detect agent (CLAUDECODE=1 → claude, AGENT=codex → codex)
wl agent <id>          # auto-detect with explicit task
wl run <id> claude -c --model opus    # complex Claude args
```

`WORKLOG_TASK_ID` is picked up automatically by **all commands** including `trace`, `checkpoint`, `done` — no need to specify `<id>` when running inside `wl run`, `wl claude`, `wl codex`, or `wl agent`. Pass an explicit `<id>` only to target a **different** task (e.g. a subtask). Never prefix with `WORKLOG_TASK_ID=... wl ...` — the variable is already set.

### Common mistakes

1. **Working without worktask** → always create worktask first
2. **Vague traces** → include causes (why failed) & pistes (what next)
3. **Narrow traces** → trace typed events: action, info, state, hypothesis, finding, learning
4. **Missing timestamps on batch traces** → use `-t`
5. **Checkpoint = conclusion** → NO: consolidate traces into narrative
6. **Done before commit** → commit first
7. **Done without reviewing** → always `wl show <id>` first
8. **Learnings = summary** → learnings need critical distance, reusable discoveries
9. **Tracing without starting** → `wl start <id>` before tracing
10. **Using --force on a task you need to rework** → reopen with `wl start <id>` instead

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
wl create <name> --desc <d> [--desc <d2>]    # Description parts
wl create <name> --desc-src <file>           # Description part from file
wl create <name> --desc-src -                # Description from stdin
wl ready <id>                                # Transition to ready
wl start <id>                                # Transition to started (or reopen done)
wl update <id> [--name <name>] [--desc <d>]  # Replace task name or description
wl update <id> --append-desc <d>             # Append a description part
wl update <id> --desc-src <file>             # Description from file
wl update <id> --desc-src -                  # Description from stdin
wl trace <id> [options] "message"            # Log entry → "ok" or "checkpoint recommended"
wl traces <id> [--kind k1,k2] [--exclude-kind k3] # List traces, optionally filtered by kind
wl traces update <id> <trace-id> --kind <kind> # Update trace kind
wl logs <id>                                 # Get context (last checkpoint + recent entries)
wl checkpoint --claude|--codex|--agent        # Agent synthesizes checkpoint from all traces
wl checkpoint <id> "changes" "learnings"     # Create checkpoint manually
wl done --claude|--codex|--agent             # Agent synthesizes final checkpoint + closes task
wl done <id> ["changes" "learnings"]         # Final checkpoint + close task manually
wl cancel <id> [reason]                      # Cancel/abandon task (marks as cancelled)
wl list [--created] [--ready] [--started] [--done] [--cancelled]  # Filter tasks
wl status [-q]                               # Compact active-work status
wl show <id>                                 # Detailed task view with history
wl meta <id> [<key> <value>]                 # View or set task metadata
wl summary [--since YYYY-MM-DD]              # Aggregate all tasks
wl import [-p PATH | -b BRANCH] [--rm]       # Import from other worktree
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

Creates a new task. The `name` is displayed in list views. `desc` is stored as ordered description parts; legacy positional `desc` is accepted as one part.

**Options:**

- `--ready`: Create in 'ready' state
- `--started`: Create in 'started' state
- `--parent <id>`: Set parent task (creates a subtask — use for sub-agent delegation)
- `--todo <text>`: Add a TODO item (repeatable)
- `--meta <key=value>`: Set metadata (repeatable)
- `-t, --timestamp <ts>`: Custom creation timestamp
- `--desc <text>`: Add a description part (repeatable)
- `--desc-src <source>`: Add a description part from file path, or `-` for stdin (repeatable; `-` cannot be combined with another `--desc-src`)
- `-P, --desc-from-clipboard`: Read one description part from the clipboard

**Examples:**

```bash
# Default: created state
wl create "Fix login bug"

# With description
wl create "Fix login bug" "Users can't login after session timeout"

# With explicit description parts
wl create "Investigate auth" --desc "Scope" --desc "Prior context"

# Description from file (multiline, rich context)
wl create "Investigate auth" --desc-src ~/notes/auth-context.md

# Description from stdin
cat briefing.md | wl create "Deploy v2" --desc-src -

# Start immediately
wl create --started "Urgent hotfix"

# As a subtask (for sub-agent delegation)
wl create --parent <parent-id> --started "Analyze existing API"

# With TODOs
wl create "Feature X" --todo "Analyze" --todo "Implement" --todo "Test"
```

**Conflicts:** positional `desc`, `--desc`, `--desc-src`, and `--desc-from-clipboard` are mutually exclusive sources.

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
wl update <id> --desc "New description"        # replace all desc parts
wl update <id> --desc "Part 1" --desc "Part 2" # replace with two parts
wl update <id> --append-desc "Added context"   # append one part
wl update <id> --desc-src context.md           # from file
pbpaste | wl update <id> --desc-src -          # from stdin
```

Must provide at least one of `--name`, a replacement description option, or an append description option. Replacement options (`--desc`, `--desc-src`, `--desc-from-clipboard`) and append options (`--append-desc`, `--append-desc-src`, `--append-desc-from-clipboard`) cannot be mixed. Empty `--desc ""` clears the description; empty `--append-desc ""` is a noop.

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
- `--subtasks`: Include all subtasks, indented under their parent when present
- `--subtasks-of-started`: Include subtasks whose parent task is `started`
- `--parent <id>`: Show only direct children of a parent task

**Examples:**

```bash
wl list                              # created + ready + started (default)
wl list --started                    # Only started tasks
wl list --subtasks-of-started        # Active tasks + children of started tasks
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
    Learnings de cette tâche.
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

✅ **Correct:** `wl trace <id> -k finding -t T11:35 "message"` ❌ **Incorrect:** `wl trace <id> "message" -k finding`

Available options:

- `--timestamp TS` or `-t TS`: Custom timestamp (see format below)
- `--kind KIND` or `-k KIND`: Trace kind (`action`, `info`, `state`, `hypothesis`, `finding`, `learning`)
- `--force` or `-f`: Allow tracing on done/cancelled tasks without reopening (prefer `wl start <id>` if you need to work on it again)

`wl trace --meta` is intentionally unsupported. Trace-local classification uses `--kind`; task-level metadata uses `wl meta`, `wl create --meta`, or `wl done --meta`.

**Warning behavior:** `wl trace` warns if the task is not in `started` state (but still records the trace). If the task is `done` or `cancelled`, it errors unless `--force` is used.

## Trace editing

`wl traces` shows generated trace IDs. Use them to update trace metadata:

```bash
wl traces <id>
wl traces update <id> <trace-id> --kind finding
```

Trace IDs are generated from the trace timestamp and duplicate occurrence, so changing only the kind keeps the same ID. Existing traces without kind can be updated.

## Done command

```bash
wl done <id> ["changes" "learnings"] [--force] [--meta key=value] [--claude|--codex|--agent]
```

**Arguments are optional** when there are no uncheckpointed entries (no new traces since last checkpoint). If there are uncheckpointed entries, `changes` and `learnings` are required.

```bash
# Preferred: let the agent synthesize the final checkpoint + close task
wl done --claude                # Claude Code
wl done --codex                 # Codex
wl done --agent                 # auto-detect

# Manual: write the synthesis yourself
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
wl trace <id> -k action -t T11:15 "Quick fix"

# Time with seconds
wl trace <id> -k action -t T11:15:30 "Detailed fix"

# Full date + time (local timezone)
wl trace <id> -k state -t 2024-12-15T11:15 "Session resumed"

# Full ISO timestamp with timezone
wl trace <id> -k state -t "2024-12-15T11:15:30+01:00" "Fixed validation"
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
wl trace <id> -k finding -f "Found edge case in production"

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

## Agent Hooks

`wl` supports Claude Code and Codex through explicit agent commands:

```bash
wl claude <task-id>
wl codex <task-id>
wl agent <task-id>
wl checkpoint --agent -q
```

Use the Claude Code hook configuration below for Claude Code. Codex support is available through `wl codex`, `--codex`, and `--agent`, but these hooks do not install a Codex hook unless the Codex environment provides an equivalent mechanism.

### Claude Code Hooks

Configure `wl` as Claude Code hooks for automatic checkpoints on context compaction and context injection on session start.

**Add to `~/.claude/settings.json`** (or per-project `settings.json`):

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "wl checkpoint --agent -q" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{ "type": "command", "command": "wl show -q" }]
      },
      {
        "matcher": "compact",
        "hooks": [{ "type": "command", "command": "wl show -q" }]
      }
    ]
  }
}
```

- **`PreCompact`**: Before compaction, synthesizes a checkpoint via the active agent (`--agent` auto-detects claude or codex) so no trace is lost.
- **`SessionStart startup`**: On fresh session start, injects task context if `WORKLOG_TASK_ID` is set.
- **`SessionStart compact`**: After compaction, reprints task context into the new window.

`resume` and `clear` are intentionally excluded: they preserve conversation history. The `-q` flag silently no-ops when no task is active — safe to configure globally.

## Scopes

For monorepos or worktree-based workflows with separate task namespaces:

```bash
wl list --scope main
wl trace <id> -k finding --scope feature-x "message"
```

See [internals.md](internals.md) for scope configuration (`config.json` format and directory structure).

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
wl trace <id> -k action "Working on feature..."
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

### `wl status`

Compact active-work status. Use `wl status -q` to print nothing when there are no active tasks.

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
wl trace <id1> -k action "Working on currency bucket"
wl trace <id2> -k state "Fixed unrelated login bug"
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
- **Block reference** (`^id`): Enables direct TODO references via `[[task-id#^todo-id]]`

### TODO Best Practices

- **Create TODOs upfront** when the task has clear sub-steps — provides a roadmap and prevents forgetting steps.
- **Use `wl todo next`** to see what to work on next, especially with blocked TODOs.
- **Mark TODOs done as you complete them**, not all at once at the end — tracks actual progress.
- **Use dependencies sparingly** — only block a TODO when it truly cannot start until another completes.
- **Cancel obsolete TODOs** rather than leaving them pending. Use `status=cancelled` for clarity.
- **Don't over-structure** — for simple tasks, traces are sufficient. TODOs are for tasks with clear, discrete sub-steps.

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

wl trace acjold -k action "Working on feature" # Uses prefix
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

## File structure and internals

See [internals.md](internals.md) for file structure, index format, frontmatter fields, and scope configuration.

## JSON output format

Add `--json` to any command for machine-readable output.

### Show output

```json
{
  "task": "acjold",
  "fullId": "acjold3x5q1m8h2k9n7p0r4w6",
  "name": "Implement feature X",
  "desc": "Implement feature X\n\n---\n\nAdditional context",
  "desc_parts": ["Implement feature X", "Additional context"],
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
