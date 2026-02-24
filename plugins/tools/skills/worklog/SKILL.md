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

1. **Create & start**: `wl create --started "Task name"`
2. **Trace** with context: `wl trace <id> "Goal / action (cause: why failed) (piste: what next)"`
3. **Checkpoint** when prompted: `wl checkpoint <id> "changes" "learnings"`
4. **Commit**, then **review**: `wl show <id>` (check TODOs + pending traces)
5. **Close**: `wl done <id> "changes" "REX learnings"` (args optional if no new traces since last checkpoint)

**Critical:** commit before `done` · `wl show` before done · include causes & pistes in traces · REX = reusable insights (not a summary)

## Quick Reference

```bash
wl create "name" ["desc"]         # default: created state
wl create --started "name"        # create + start immediately
wl ready <id> / wl start <id>     # transition state
wl trace <id> [-t T14:30] "msg"   # log entry (flags before message)
wl checkpoint <id> "changes" "rx" # consolidate traces
wl done <id> ["changes" "rx"]     # final checkpoint + close
wl cancel <id> [reason]           # abandon task
wl update <id> --name "new"       # rename task

# Subtasks (sub-agent delegation)
wl create --parent <id> --started "Sub-task"
wl list --subtasks                # all tasks with subtasks indented
wl list --parent <id>             # only children of parent

# Context propagation
wl run <id> <cmd...>              # run cmd with WORKLOG_TASK_ID set
wl claude [id] [args...]          # launch Claude with task context

# TODOs
wl create "Task" --todo "Step 1"  # add TODOs at creation
wl todo list [<id>]               # list TODOs
wl todo set status=done <todo-id> # update TODO status
```

## References

- **[reference.md](reference.md)** — Full command reference, workflow guide, output formats
- **[todo-guide.md](todo-guide.md)** — TODO management in depth
- **[examples.md](examples.md)** — Good/bad trace & checkpoint examples
- **[internals.md](internals.md)** — File format (for debugging or manual edits)

## Language

Adapt to user's language for traces/checkpoints/REX.
