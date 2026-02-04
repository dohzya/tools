---
name: worklog
description: Track work progress during development sessions. Activates when .worklog/ exists OR user says "track this", ">track", "let's track", "worktask", "work on worktask". Maintains a chronological worklog with on-demand consolidation via checkpoints.
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
- Add `--meta key=value` to `trace` or `done` to attach metadata (commit SHA, PR number, author, session ID)
- Add `--json` to any command for JSON output

See `reference.md` for complete documentation (imports, advanced features, output formats).

## TODO Management

Track action items within tasks using the TODO system. TODOs have statuses, dependencies, and custom metadata.

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
# → Error: Task has 3 pending todo(s). Use --force to complete anyway.

# Force completion if TODOs are obsolete
wl done <task-id> "changes" "learnings" --force
```

### TODO Format (Internal)

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

### Guidelines

**Create TODOs upfront** when the task has clear sub-steps. This provides a roadmap and prevents forgetting steps.

**Use `wl todo next`** to see what to work on next, especially with blocked TODOs.

**Mark TODOs done as you complete them**, not all at once at the end. This tracks actual progress.

**Use dependencies sparingly**. Only block a TODO when it truly cannot start until another completes.

**Cancel obsolete TODOs** rather than leaving them pending. Use `status=cancelled` for clarity.

**Don't over-structure**. For simple tasks, traces are sufficient. TODOs are for tasks with clear, discrete sub-steps.

## Quick workflow

### Start tracking

```bash
wl add --desc "Implement feature X"
# → 250116a
```

Use the returned ID for all subsequent commands.

### Log progress

**IMPORTANT:** Always place options (like `-t`) BETWEEN the task ID and the message content.

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

**Adding metadata:**

Use `--meta key=value` to attach contextual information:

```bash
# Track which commit introduced a change
wl trace 250116a --meta commit=$(git rev-parse HEAD) "Implemented validation"

# Track session or author
wl trace 250116a --meta session=morning --meta author=alice "Started debugging"

# Track related issues or PRs
wl trace 250116a --meta issue=gh-123 --meta pr=456 "Fixed edge case"
```

Metadata is stored in the task's frontmatter and can be used later for filtering, reporting, or linking work to external systems.

### Timestamps for batch tracing

**Rule of thumb:**

- **Just did it?** Don't use `-t` (automatically uses current time)
- **Tracing after the fact?** ALWAYS use `-t` with the actual time

```bash
# Just completed the action → no timestamp needed
wl trace 260202a "Fixed the validation bug"

# Tracing multiple past actions → use -t with actual times
wl trace 260202a -t T14:30 "Started investigating the bug"
wl trace 260202a -t T15:15 "Found root cause in validator"
wl trace 260202a -t T15:45 "Applied fix + tests pass"
```

This keeps the worklog chronologically accurate when recreating a work session from memory or notes.

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

When task is done, create a final checkpoint that **consolidates all important information from traces**:

```bash
wl done 250116a \
  "<comprehensive changes summary>" \
  "<consolidated learnings>"
```

**IMPORTANT:** The `changes` and `learnings` passed to `wl done` must be a **synthesis of ALL significant traces**, not just a final status update. Review `wl logs <id>` to structure your summary.

**Format recommendations:**

- Use **bullet-lists** instead of dense paragraphs (much more readable)
- Start with a **one-line summary** of what was achieved
- Use **sections** (Actions, Résultat, etc.) to organize information
- **Numbered lists** for learnings make them easy to reference later

**First argument (changes)** should contain:

1. **One-line summary**: Brief description of what was accomplished
2. **Actions**: Bullet-list of what was concretely done (implementations, fixes, refactors, pivots)
3. **Résultat**: Bullet-list of final outcomes (what works, what was validated, metrics)

**Second argument (learnings)** should contain:

- **Numbered insights**: Reusable lessons for future work (what approach worked/failed and why, patterns discovered, things to remember)

**Good example:**

```bash
wl done 250116a \
  "Multi-currency validation implemented via CurrencyBucket pattern (12 tests passing)

Actions:
- Implemented CurrencyBucket pattern for per-currency validation
- Added MIXED_CURRENCY_ZERO_BALANCE error handling
- Refactored validator to support per-currency aggregation
- Initial attempt (direct currency field) failed → broke 12 tests
- Pivot to CurrencyBucket approach → all tests pass

Résultat:
- 12/12 tests passing
- Single-currency orders unchanged
- Multi-currency validation working correctly" \
  "1. Initial currency field approach broke existing validators (wrong abstraction layer)
2. CurrencyBucket pattern better isolates currency logic - reusable for other aggregations
3. Centralizing validation prevents fragmentation across codebase
4. Always validate aggregate before individual buckets - catches edge cases earlier"
```

**Bad example (avoid):**

```bash
wl done 250116a "Task completed" "All tests pass"
# ❌ Missing: what was implemented, what approaches failed, why pivots happened
```

**Git workflow (versioned projects):**

For version-controlled projects, follow this order:

1. **Create the commit first** (with all changes)
2. **Then mark worktask as done** with commit reference

```bash
# 1. Commit your changes
git add .
git commit -m "Implement multi-currency support

- Added CurrencyBucket pattern
- New validation error types
- Tests passing"

# 2. Mark worktask done with commit ref
wl done 250116a \
  "<comprehensive changes summary>" \
  "<consolidated learnings>" \
  --meta commit=$(git rev-parse HEAD)
```

This links the worktask to the actual code changes, making it easy to trace work history to specific commits.

This creates a final checkpoint and marks the task done.

## Guidelines

**Trace often, checkpoint occasionally.** Traces are cheap (append-only). Checkpoints require synthesis.

**Be specific in traces.** "Tried X - failed because Y" is better than "Tried X".

**Options go between ID and message.** Always use `wl trace <id> -t T11:35 "message"`, never `wl trace <id> "message" -t T11:35`. This keeps options visible in truncated UI displays.

**Learnings are reusable insights.** Not just "what we did" but "what we learned that applies elsewhere".

**Suggest checkpoints to user.** When you see `checkpoint recommended` or before a natural break, offer to create one.

**Language.** Adapt to user's working language for traces and checkpoints.
