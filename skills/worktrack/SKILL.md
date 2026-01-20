---
name: worktrack
description: Track work progress during development sessions. Activates when .worktrack/ exists OR user says "track this", ">track", "let's track". Maintains a chronological worklog with on-demand consolidation via checkpoints.
---

# Worktrack

Track work progress with append-only worklog and on-demand checkpoints.

## Activation

| Condition | Action |
|-----------|--------|
| `.worktrack/` exists | Tracking is active, use `wt list` to see current tasks |
| User says "track this", ">track", "let's track" | Run `wt add --desc "..."` |

## Commands

```bash
wt add [--desc "description"]     # Create task → outputs ID
wt trace <id> "message"           # Log entry → "ok" or "checkpoint recommended"
wt logs <id>                      # Get context (last checkpoint + recent entries)
wt checkpoint <id> "changes" "learnings"   # Create checkpoint
wt done <id> "changes" "learnings"         # Final checkpoint + close task
wt list [--all]                   # List active tasks (--all includes done <30d)
wt summary [--since YYYY-MM-DD]   # Aggregate all tasks
```

Add `--json` to any command for JSON output.

## Workflow

### Starting

```bash
wt add --desc "Implement feature X"
# → 250116a
```

Use the returned ID for all subsequent commands.

### During work

Log notable events:

```bash
wt trace 250116a "Goal: support multi-currency orders"
wt trace 250116a "Tried adding currency field - breaks 12 tests"
wt trace 250116a "Root cause: validator expects single total"
wt trace 250116a "Pivot to CurrencyBucket approach - tests pass"
```

**When to trace:**
- Starting something (goal, objective)
- Trying an approach
- Hitting an error or blocker
- Pivoting to different approach
- Making a decision
- Something works/is validated

Keep messages concise. Include "why" for failures and pivots.

### Checkpointing

Create checkpoints when:
- `wt trace` outputs `checkpoint recommended` (≥50 entries since last)
- User asks for a summary of changes or learnings
- Before a long break or context switch
- You (the agent) judge it useful to consolidate

**Process:**
1. `wt logs <id>` — get current context
2. Synthesize entries into coherent changes and learnings
3. `wt checkpoint <id> "<changes>" "<learnings>"`

```bash
wt logs 250116a
# [read output, generate consolidated summary]

wt checkpoint 250116a \
  "- Introduced CurrencyBucket for per-currency validation
- New error MIXED_CURRENCY_ZERO_BALANCE
- Single-currency orders unchanged" \
  "- Centraliser la validation évite la fragmentation
- Pattern Bucket utile pour agréger avant validation"
```

### Completing

When task is done:

```bash
wt done 250116a \
  "<final changes summary>" \
  "<final learnings>"
```

This creates a final checkpoint and marks the task done.

### Getting overview

```bash
wt list              # Active tasks only
wt list --all        # Include recently completed (<30 days)
wt summary           # Full logs of all active tasks
wt summary --since 2025-01-10   # Include done tasks since date
```

Use `wt summary` for end-of-worktree recaps.

## Output formats

Default output is human-readable text. Use `--json` for structured JSON.

**`wt add`:**
```
250116a
```

**`wt trace`:**
```
ok
```
or
```
checkpoint recommended (52 entries)
```

**`wt list`:**
```
250116a  active  "Multi-currency support"  2025-01-16 09:15
250116b  active  "Fix login bug"  2025-01-16 14:30
```

**`wt logs`:**
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

**`wt checkpoint` / `wt done`:**
```
checkpoint created
```
```
task completed
```

## Multiple tasks

You can have multiple active tasks. Always specify the task ID:

```bash
wt trace 250116a "Working on currency bucket"
wt trace 250116b "Fixed unrelated login bug"
```

Use `wt list` to see all active tasks if you lose track.

## Guidelines

**Trace often, checkpoint occasionally.** Traces are cheap (append-only). Checkpoints require synthesis.

**Be specific in traces.** "Tried X - failed because Y" is better than "Tried X".

**Checkpoints are for consolidation.** Don't just concatenate traces. Synthesize into coherent changes/learnings.

**Learnings are reusable insights.** Not just "what we did" but "what we learned that applies elsewhere".

**Suggest checkpoints to user.** When you see `checkpoint recommended` or before a natural break, offer to create one.

**Language.** Adapt to user's working language for traces and checkpoints.

## File structure

```
.worktrack/
├── index.json           # Task list (for fast wt list)
└── tasks/
    └── 250116a.md       # Task file (frontmatter + entries + checkpoints)
```

Task files are Markdown with YAML frontmatter. Old completed tasks (>30 days) are auto-purged.
