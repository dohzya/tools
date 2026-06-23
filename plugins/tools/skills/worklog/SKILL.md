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
- **done**: completed with final checkpoint + learnings

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

> **Delegating to sub-agents?** Create a subtask: `wl create --parent <id> --started "Sub-task"`, then launch with `wl claude <subtask-id>` (or `wl codex <subtask-id>`, or `wl agent <subtask-id>` to auto-detect).

1. **Create & start**: `wl create --started "Task name"`
2. **Trace** every event: `wl trace <id> "action taken / problem hit / idea / lead explored / finding / learning"`
3. **Checkpoint** when prompted: prefer `wl checkpoint --agent` (or `--claude` / `--codex`) for synthesis
4. **Commit**, then **review**: `wl show <id>` (check TODOs + pending traces), then close when the user asked for it or propose closing if the task appears complete
5. **Close**: prefer `wl done --agent` (args optional if no new traces since last checkpoint)

**Critical:** after committing, either close on an explicit user signal or propose closing when complete · commit before `done` · `wl show` before done · trace actions, problems, ideas, leads, findings, learnings · include causes & pistes in traces · checkpoints must be cumulative and self-contained · learnings = reusable discoveries (not a summary)

## Checkpoint Synthesis

A checkpoint is cumulative and self-contained: after this checkpoint, previous traces and checkpoints could be deleted without losing the useful story of the task.

Ordinary agents should not write manual checkpoint or done syntheses by default. Choose exactly one delegated synthesis command:

- `wl checkpoint --agent` when you need to synthesize progress and keep the task open.
- `wl done --agent` when you need to synthesize and close the task. Do not run `checkpoint` first.

Use `--claude` or `--codex` to choose a specific agent when auto-detection is not right. Write manual `wl checkpoint <id> "<changes>" "<learnings>"` or `wl done <id> "<changes>" "<learnings>"` only when delegation is unavailable, inappropriate, or explicitly requested.

Manual or delegated synthesis must preserve enough context for a future agent to resume without rereading raw traces. Put these in the first argument, `changes`:

- **Outcomes**: what changed and what state the task reached.
- **Root causes**: why the problem happened or why the chosen fix was needed.
- **Decisions**: chosen approach, constraints, and rejected alternatives.
- **Validation**: checks run, failures hit, fixes after failures, and final result.
- **Final state**: user acceptance, commit/release/status when relevant.

Put this in the second argument, `learnings`:

- **Reusable learnings**: durable patterns, gotchas, workflow rules, and codebase facts.

Do not turn learnings into an activity summary. "Tests passed" is validation; the learning is the reusable reason, constraint, or pattern discovered while getting there.

## Tracing Learnings

When you discover something educational or non-obvious about the codebase, technology, or patterns during your work, **trace it** so checkpoints can capture it:

```bash
wl trace <id> "Learning: <your observation>"
```

Don't just display learnings in the conversation — trace them. Checkpoints synthesize from traces only; untraceable conversation content is lost on compaction.

## Quick Reference

```bash
# Orient
wl list                     # active tasks
wl list --parent <id>       # sub-agent subtasks progress
wl list --subtasks-of-started # active tasks + children of started tasks
wl show <id>                # status, history, todos, subtasks

# Create
wl create --started "name" "desc"                    # create + start (desc = scope/goal)
wl create --started "name" --desc-src file.md        # desc from file (multiline context)
wl create --parent <id> --started "Sub-task" "desc"  # subtask for sub-agent delegation

# Trace — one entry per event: action taken / problem hit / idea / lead explored / finding / learning
wl trace <id> "msg"         # flags before message: wl trace <id> -t T14:30 "msg"

# Consolidate: choose exactly one delegated command
wl checkpoint --agent       # synthesize progress and keep working
# OR, if the task is ready to close:
wl done --agent             # synthesize and close; do not checkpoint first
wl checkpoint <id> "self-contained synthesis" "reusable learnings"  # manual fallback
wl done <id> ["same as checkpoint"]  # manual fallback; args optional if no new traces since last checkpoint
```

See [reference.md](reference.md) for full reference (TODOs, state transitions, metadata, etc.).

## Agent Support

`wl` supports Claude Code and Codex explicitly:

```bash
wl claude <task-id>
wl codex <task-id>
wl agent <task-id>          # auto-detect
wl checkpoint --agent -q    # progress synthesis; keep task open
wl done --agent             # final synthesis + completion; do not checkpoint first
```

Codex support is CLI-based through `wl codex`, `--codex`, and `--agent`. Claude Code hooks below do not configure Codex automatically unless the Codex environment provides an equivalent hook mechanism.

## Claude Code Hooks

Inject task context on session start, auto-checkpoint before compaction. Add to `~/.claude/settings.json`:

```json
"PreCompact": [{"matcher": "*", "hooks": [{"type": "command", "command": "wl checkpoint --agent -q"}]}],
"SessionStart": [
  {"matcher": "startup", "hooks": [{"type": "command", "command": "wl show -q"}]},
  {"matcher": "compact", "hooks": [{"type": "command", "command": "wl show -q"}]}
]
```

The `-q` flag silently no-ops when no task is active — safe to configure globally. `resume` and `clear` are intentionally excluded: they preserve conversation history.

## References

- **[reference.md](reference.md)** — Full command reference, workflow guide, output formats, common mistakes
- **[examples.md](examples.md)** — Good/bad trace & checkpoint examples, sub-agent delegation patterns
- **[internals.md](internals.md)** — File format, scopes setup (for debugging or manual editing)

## Language

Write traces, checkpoints, and learnings in the user's language — follow their choice throughout the session.
