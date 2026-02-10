# Git Worktree Integration

This document explains how to integrate `wl` (worklog) with git worktrees for tracking work across multiple branches simultaneously.

## Overview

When working with git worktrees, each worktree can have its own `.worklog` directory to track tasks and progress independently. The `wl scopes` commands allow you to manage these worktree-based scopes.

## Commands

### Adding a worktree scope

**From the main repository (git root):**

```bash
# Add a worktree scope with id = branch name
wl scopes add feature/my-feature --worktree

# Add with a custom id (different from branch name)
wl scopes add my-feature --worktree --ref feature/my-feature

# Add with explicit path (non-worktree)
wl scopes add api --path packages/api
```

**From inside a worktree:**

```bash
# Auto-detects current worktree
wl scopes add feature/my-feature --worktree
```

### Syncing all worktrees

Automatically add missing worktrees and remove stale entries:

```bash
# Preview changes without applying
wl scopes sync-worktrees --dry-run

# Apply changes
wl scopes sync-worktrees
```

### Removing a worktree scope

**Before deleting a git worktree**, clean up the worklog scope to preserve or migrate tasks:

```bash
# Move tasks to another scope, then delete
wl scopes delete feature/my-feature --move-to main

# Or delete with tasks (data will be lost)
wl scopes delete feature/my-feature --delete-tasks
```

## Typical Workflow

### After creating a worktree

```bash
# Create git worktree
git worktree add ../my-feature feature/my-feature

# Option 1: Add scope manually
wl scopes add feature/my-feature --worktree

# Option 2: Sync all worktrees at once
wl scopes sync-worktrees
```

### Before removing a worktree

```bash
# First, handle worklog data
wl scopes delete feature/my-feature --move-to main

# Then remove git worktree
git worktree remove ../my-feature
```

### With worktrunk (automated)

If you use [worktrunk](https://github.com/your-repo/worktrunk) for worktree management, you can configure hooks in `.config/wt.toml`:

```toml
[hooks]
# After worktree creation
post-add = "wl scopes add ${BRANCH} --worktree"

# Before worktree removal (from inside the worktree)
pre-remove = "wl scopes delete ${BRANCH} --move-to main"
```

Or use sync-worktrees for simpler setup:

```toml
[hooks]
# Sync after any worktree change
post-add = "wl scopes sync-worktrees"
post-remove = "wl scopes sync-worktrees"
```

## Data Structure

Worktree scopes are stored in the root `.worklog/scope.json`:

```json
{
  "children": [
    { "path": "packages/api", "id": "api" },
    {
      "path": "../my-feature",
      "id": "feature/my-feature",
      "type": "worktree",
      "gitRef": "feature/my-feature"
    }
  ]
}
```

Each worktree has its own `.worklog/` directory with:

- `index.json` - Task index
- `tasks/` - Task details and traces
- `scope.json` - Parent reference
