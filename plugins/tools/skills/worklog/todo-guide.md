# TODO Management Guide

Track action items within tasks using the TODO system. TODOs have statuses, dependencies, and custom metadata.

## Quick Start

### Creating tasks with TODOs

```bash
# Create task with initial TODOs
wl task create "Feature X" --todo "Analyze code" --todo "Write tests" --todo "Implement"

# Shortcut: use first TODO as task description
wl task create --todo "Fix authentication bug"
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

## TODO Statuses

| Status    | Symbol | Description                    |
| --------- | ------ | ------------------------------ |
| todo      | `[ ]`  | Pending, ready to start        |
| wip       | `[/]`  | Work in progress               |
| blocked   | `[>]`  | Blocked, waiting on dependency |
| cancelled | `[-]`  | Cancelled, not needed          |
| done      | `[x]`  | Completed                      |

## Task Completion with TODOs

Tasks with pending TODOs (todo/wip/blocked) cannot be marked done:

```bash
wl done <task-id> "changes" "learnings"
# → Error: Task has 3 pending todo(s). Use --force to complete anyway.

# Force completion if TODOs are obsolete
wl done <task-id> "changes" "learnings" --force
```

## TODO Format (Internal)

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

## Best Practices

**Create TODOs upfront** when the task has clear sub-steps. This provides a roadmap and prevents forgetting steps.

**Use `wl todo next`** to see what to work on next, especially with blocked TODOs.

**Mark TODOs done as you complete them**, not all at once at the end. This tracks actual progress.

**Use dependencies sparingly**. Only block a TODO when it truly cannot start until another completes.

**Cancel obsolete TODOs** rather than leaving them pending. Use `status=cancelled` for clarity.

**Don't over-structure**. For simple tasks, traces are sufficient. TODOs are for tasks with clear, discrete sub-steps.
