---
name: worklog
description: Track work progress during development sessions. Activates when .worklog/ exists OR user says "track this", ">track", "let's track". Maintains a chronological worklog with on-demand consolidation via checkpoints.
---

# Worklog

Track work progress with append-only worklog and on-demand checkpoints.

## Activation

| Condition                                       | Action                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| `.worklog/` exists                              | Tracking is active, use `wl list` to see current tasks |
| User says "track this", ">track", "let's track" | Run `wl add --desc "..."`                              |

## Commands

```bash
wl add --desc "description"                      # Create task → outputs ID
wl trace <id> [options] "message"                # Log entry → "ok" or "checkpoint recommended"
wl logs <id>                                     # Get context (last checkpoint + recent entries)
wl checkpoint <id> "changes" "learnings"         # Create checkpoint
wl done <id> "changes" "learnings"               # Final checkpoint + close task
wl list [--all]                                  # List active tasks (--all includes done <30d)
```

**Common options:**

- Add `-t TS` to `trace` for custom timestamp (e.g., `-t T11:35`)
- Add `-f` to `trace` or `checkpoint` to modify completed tasks
- Add `--json` to any command for JSON output

See `reference.md` for complete documentation (imports, advanced features,
output formats).

## Quick workflow

### Start tracking

```bash
wl add --desc "Implement feature X"
# → 250116a
```

Use the returned ID for all subsequent commands.

### Log progress

**IMPORTANT:** Always place options (like `-t`) BETWEEN the task ID and the
message content.

```bash
wl trace 250116a "Goal: support multi-currency orders"
wl trace 250116a "Tried adding currency field - breaks 12 tests"
wl trace 250116a "Root cause: validator expects single total"
wl trace 250116a -t T11:35 "Pivot to CurrencyBucket approach - tests pass"
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

- `wl trace` outputs `checkpoint recommended` (≥50 entries since last)
- User asks for a summary
- Before a long break or context switch
- You judge it useful to consolidate

**Process:**

```bash
wl logs 250116a
# [read output, synthesize into coherent summary]

wl checkpoint 250116a \
  "- Introduced CurrencyBucket for per-currency validation
- New error MIXED_CURRENCY_ZERO_BALANCE
- Single-currency orders unchanged" \
  "- Centraliser la validation évite la fragmentation
- Pattern Bucket utile pour agréger avant validation"
```

Don't just concatenate traces. Synthesize into coherent changes/learnings.

### Complete task

```bash
wl done 250116a \
  "<final changes summary>" \
  "<final learnings>"
```

This creates a final checkpoint and marks the task done.

## Guidelines

**Trace often, checkpoint occasionally.** Traces are cheap (append-only).
Checkpoints require synthesis.

**Be specific in traces.** "Tried X - failed because Y" is better than "Tried
X".

**Options go between ID and message.** Always use
`wl trace <id> -t T11:35 "message"`, never `wl trace <id> "message" -t T11:35`.
This keeps options visible in truncated UI displays.

**Learnings are reusable insights.** Not just "what we did" but "what we learned
that applies elsewhere".

**Suggest checkpoints to user.** When you see `checkpoint recommended` or before
a natural break, offer to create one.

**Language.** Adapt to user's working language for traces and checkpoints.
