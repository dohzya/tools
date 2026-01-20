---
name: worklog
description: Track work progress during development sessions. Activates when .worklog/ exists OR user says "track this", ">track", "let's track". Maintains a chronological worklog with on-demand consolidation via checkpoints.
---

# Worklog

Track work progress with append-only worklog and on-demand checkpoints.

## Activation

| Condition | Action |
|-----------|--------|
| `.worklog/` exists | Tracking is active, use `wllist` to see current tasks |
| User says "track this", ">track", "let's track" | Run `wladd --desc "..."` |

## Commands

```bash
wladd [--desc "description"]     # Create task → outputs ID
wltrace <id> "message"           # Log entry → "ok" or "checkpoint recommended"
wllogs <id>                      # Get context (last checkpoint + recent entries)
wlcheckpoint <id> "changes" "learnings"   # Create checkpoint
wldone <id> "changes" "learnings"         # Final checkpoint + close task
wllist [--all]                   # List active tasks (--all includes done <30d)
wlsummary [--since YYYY-MM-DD]   # Aggregate all tasks
```

Add `--json` to any command for JSON output.

## Workflow

### Starting

```bash
wladd --desc "Implement feature X"
# → 250116a
```

Use the returned ID for all subsequent commands.

### During work

Log notable events:

```bash
wltrace 250116a "Goal: support multi-currency orders"
wltrace 250116a "Tried adding currency field - breaks 12 tests"
wltrace 250116a "Root cause: validator expects single total"
wltrace 250116a "Pivot to CurrencyBucket approach - tests pass"
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
- `wltrace` outputs `checkpoint recommended` (≥50 entries since last)
- User asks for a summary of changes or learnings
- Before a long break or context switch
- You (the agent) judge it useful to consolidate

**Process:**
1. `wllogs <id>` — get current context
2. Synthesize entries into coherent changes and learnings
3. `wlcheckpoint <id> "<changes>" "<learnings>"`

```bash
wllogs 250116a
# [read output, generate consolidated summary]

wlcheckpoint 250116a \
  "- Introduced CurrencyBucket for per-currency validation
- New error MIXED_CURRENCY_ZERO_BALANCE
- Single-currency orders unchanged" \
  "- Centraliser la validation évite la fragmentation
- Pattern Bucket utile pour agréger avant validation"
```

### Completing

When task is done:

```bash
wldone 250116a \
  "<final changes summary>" \
  "<final learnings>"
```

This creates a final checkpoint and marks the task done.

### Getting overview

```bash
wllist              # Active tasks only
wllist --all        # Include recently completed (<30 days)
wlsummary           # Full logs of all active tasks
wlsummary --since 2025-01-10   # Include done tasks since date
```

Use `wlsummary` for end-of-worktree recaps.

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
wltrace 250116a "Working on currency bucket"
wltrace 250116b "Fixed unrelated login bug"
```

Use `wllist` to see all active tasks if you lose track.

## Guidelines

**Trace often, checkpoint occasionally.** Traces are cheap (append-only). Checkpoints require synthesis.

**Be specific in traces.** "Tried X - failed because Y" is better than "Tried X".

**Checkpoints are for consolidation.** Don't just concatenate traces. Synthesize into coherent changes/learnings.

**Learnings are reusable insights.** Not just "what we did" but "what we learned that applies elsewhere".

**Suggest checkpoints to user.** When you see `checkpoint recommended` or before a natural break, offer to create one.

**Language.** Adapt to user's working language for traces and checkpoints.

## File structure

```
.worklog/
├── index.json           # Task list (for fast wllist)
└── tasks/
    └── 250116a.md       # Task file (frontmatter + entries + checkpoints)
```

Task files are Markdown with YAML frontmatter. Old completed tasks (>30 days) are auto-purged.
