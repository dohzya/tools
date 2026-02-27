---
name: worklog
description: Track work progress during development sessions. Activates when .worklog/ exists OR user says "track this", "let's track", "worktask", "work on worktask". Maintains a chronological worklog with on-demand consolidation via checkpoints.
---

# Worklog

Track work with traces and checkpoints. **Always work within a worktask.**

## Task Lifecycle

`created` → `ready` → `started` → `done` / `cancelled`

- **created**: defined, not ready yet
- **ready**: fully scoped, queued (use for backlog / future sub-agents)
- **started**: actively working NOW — always `start` before tracing
- **done**: completed with final checkpoint + REX learnings

## Orient Yourself

```bash
wl list                  # Active tasks (created + ready + started)
wl list --started        # In-progress only
wl list --all            # All including done/cancelled (<30d)
wl show <id>             # Status, history, traces, TODOs, subtasks
wl logs <id>             # Entries since last checkpoint
```

Output: `<id>  <status>  "<name>"  <date>`

## Essential Workflow

> **Delegating to sub-agents?** Create a subtask: `wl create --parent <id> --started "Sub-task"`, then launch with `wl claude <subtask-id>`.

1. **Create & start**: `wl create --started "Task name"`
2. **Trace** with context: `wl trace <id> "Goal / action (cause: why failed) (piste: what next)"`
3. **Checkpoint** when prompted: `wl checkpoint <id> "changes" "learnings"`
4. **Commit**, then **review**: `wl show <id>` (check TODOs + pending traces)
5. **Close**: `wl done <id> "changes" "REX learnings"` (args optional if no new traces since last checkpoint)

**Critical:** commit before `done` · `wl show` before done · include causes & pistes in traces · REX = reusable insights (not a summary)

## Quick Reference

```bash
# Orient
wl list                     # active tasks
wl list --parent <id>       # sub-agent subtasks progress
wl show <id>                # status, history, todos, subtasks

# Create
wl create --started "name" "desc"                    # create + start (desc = scope/goal)
wl create --parent <id> --started "Sub-task" "desc"  # subtask for sub-agent delegation

# Trace — one entry per event: action done / result observed / problem hit / pivot decided
wl trace <id> "msg"         # flags before message: wl trace <id> -t T14:30 "msg"

# Consolidate
wl checkpoint <id> "narrative (actions + pivots, incl. failures)" "REX (reusable insights, not a summary)"
wl done <id> ["same as checkpoint"]  # args optional if no new traces since last checkpoint
```

See [reference.md](reference.md) for full reference (TODOs, state transitions, metadata, etc.).

## Claude Code Hooks

Inject task context on session start, auto-checkpoint before compaction.
Add to `~/.claude/settings.json`:

```json
"PreCompact": [{"matcher": "*", "hooks": [{"type": "command", "command": "wl checkpoint --claude -q"}]}],
"SessionStart": [
  {"matcher": "startup", "hooks": [{"type": "command", "command": "wl show -q"}]},
  {"matcher": "compact", "hooks": [{"type": "command", "command": "wl show -q"}]}
]
```

The `-q` flag silently no-ops when no task is active — safe to configure globally.
`resume` and `clear` are intentionally excluded: they preserve conversation history.

## References

- **[reference.md](reference.md)** — Full command reference, workflow guide, output formats, common mistakes
- **[examples.md](examples.md)** — Good/bad trace & checkpoint examples, sub-agent delegation patterns
- **[internals.md](internals.md)** — File format, scopes setup (for debugging or manual editing)

## Language

Write traces, checkpoints, and REX in the user's language — follow their choice throughout the session.
