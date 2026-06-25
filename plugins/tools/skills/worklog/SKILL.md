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
2. **Trace** every event: `wl trace <id> -k action|info|state|hypothesis|finding|learning "message"`
3. **Checkpoint** when prompted: prefer `wl checkpoint --agent` (or `--claude` / `--codex`) for synthesis
4. **Commit**, then **review**: `wl show <id>` (check TODOs + pending traces), then close when the user asked for it or propose closing if the task appears complete
5. **Close**: prefer `wl done --agent` (args optional if no new traces since last checkpoint)

**Critical:** after committing, either close on an explicit user signal or propose closing when complete · commit before `done` · `wl show` before done · trace actions, info, states, hypotheses, findings, learnings · include causes & pistes in traces · checkpoints must be cumulative and self-contained · learnings = reusable discoveries (not a summary)

## Trace Kinds

Use `wl trace -k <kind> "message"` with these kinds:

- `action`: action performed, such as editing a file, reading code, or running a command.
- `info`: external information provided, such as a user spec change or new constraint.
- `state`: state observed or reached, such as a meaningful failure, validation result, blocker, or final state.
- `hypothesis`: open reflection, such as a lead, possible cause, or option being considered.
- `finding`: conclusion reached, such as an identified root cause, confirmed behavior, invalidated hypothesis, or local codebase fact.
- `learning`: reusable finding already analyzed as durable beyond the current task.

Action traces are evidence. State, finding, and learning traces are synthesis anchors. If an action produces a notable result, add a second trace with the result kind. An action trace should not be the only place where a durable result, blocker, root cause, validation result, or final state is recorded.

Filtering out actions is a good way to reduce trace volume with low risk of losing useful learning inputs:

```bash
wl traces <id> --exclude-kind action
wl traces <id> --kind finding,learning
wl traces update <id> <trace-id> --kind finding
```

Before checkpoint/done synthesis, use `wl traces <id> --kind finding,learning` as a cheap high-signal check for likely `learnings` candidates. It does not guarantee every reusable lesson is covered, but it catches most pre-identified candidates with little noise.

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

Use trace kinds as routing hints, not hard rules:

- `learning` -> candidate for `learnings`, almost always.
- `finding` -> candidate for `changes` or `learnings` depending on reusability.
- `state` -> candidate for `changes`, especially validation and final state.
- `info` / `hypothesis` -> candidate for `changes` if impactful, or `learnings` after analysis.
- `action` -> candidate for `changes` only when impactful, rarely `learnings`.

Before running a manual `wl checkpoint ...` or `wl done ...` command, review every candidate sentence. If it describes a thing done or final state, put it in `changes`. If it describes a lesson learned, put it in `learnings`. Then scan the traces for information that could be useful to other projects; when there is one, distill that reusable pattern into `learnings`.

Use `wl traces <id> --kind finding,learning` before finalizing `learnings` to check likely reusable candidates without rereading every action trace.

## Tracing Learnings

When you discover something educational or non-obvious about the codebase, technology, or patterns during your work, **trace it** so checkpoints can capture it:

```bash
wl trace <id> -k learning "<your observation>"
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

# Trace — one entry per event: action, info, state, hypothesis, finding, learning
wl trace <id> -k finding "msg"  # flags before message: wl trace <id> -k state -t T14:30 "msg"

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
