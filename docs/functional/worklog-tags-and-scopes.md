---
category: functional
themes:
  - worklog
  - tags
  - scopes
verified_at: 2026-11-10
language: en-US
---

# Worklog tags and scopes

How tags and scopes relate in `wl` (binary `worklog`), what `list <pattern>` and `show` print, and where each piece of data lives. Verified against `crates/worklog-cli` and the black-box cases `tests/blackbox/cases/wl/{scoped,scopes,tags}`. The contract and its differences from the TypeScript tool are in [`docs/specs/worklog.md`](../specs/worklog.md) (D13, D14).

## Vocabulary

| Term        | Meaning                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tag         | A label of a task: letters, digits, `/`, `-`, `_`, at most 100 characters. `a/b` is a child of `a`.                       |
| Scope       | A `.worklog/` directory inside a git repository (root or sub-directory, or a git worktree). Each scope has its own tasks. |
| Scope id    | Display name of a scope: its relative path, `(root)`, or the `id` given in the root `scope.json` (`wl scopes rename`).    |
| Scope entry | An item of `children` in the root `.worklog/scope.json`: `path`, `id`, and optionally `type`, `gitRef` and `tags`.        |
| Scope tag   | A value of `tags` in a scope entry. It describes the scope as a whole (typically a worktree).                             |

## Where tags live

- The tags of a task are in its frontmatter (`tags:`) and copied into its entry of `index.json`.
- Scope tags are only in the scope entry. They are **not** copied into the tasks of the scope, in the task files or in the index. A tag set on a scope therefore never shows in `tags:` of a task file.
- `wl tags <id>` and `wl tags add|remove` work on the tags of the task. `wl tags <id>` prints the effective tags: the task tags plus the scope tags of the scope it lives in.
- `wl tags` (no id) counts task tags only, over all scopes.
- Hierarchy: a pattern `feat` matches the tags `feat` and `feat/auth`, not `feature`.

## What `list <pattern>` prints

Inside a git repository, `wl list <pattern>` shows the union, without duplicates, of:

1. every task, in any scope, that carries a tag matching `<pattern>`;
2. every task of the scope whose relative path or id is `<pattern>`;
3. every task of the scopes whose entry carries a scope tag matching `<pattern>`.

The usual filters apply to the union (`--all`, status flags, `--subtasks`, `--include-blocked`, ...). The tag equal to the pattern is not repeated on each line. If nothing designates a tag or a scope, the command fails with `error: task_not_found` (`No tag or scope matching: <pattern>`). Outside git the pattern is ignored.

Example: a task tagged `#api` in the root scope and a scope whose id is `api`: `wl list api` shows the task and the tasks of the scope `api`. Likewise, with `"tags": ["team"]` on the entry of `api` in the root `scope.json` and a root task tagged `#team`, `wl list team` shows both.

## What `show` prints

`wl show <id>` prints the own tags of the task (`tags: #docs`). It does not add the tags of the scope: the scope is already visible in `wl list` and `wl scopes`, and repeating its tags on each task would only duplicate that information.

## Moving tasks between scopes

- `wl scopes assign <scope> <ids...>` moves tasks; the index entry of a moved task is copied whole (tags, links, parent, timestamps).
- `wl scopes assign --tag <tag> [scope]` and `wl scopes export <tag> <path>` move the tasks that carry the tag and remove the tag from them (`--keep-tag` keeps it): the tag then stands for the scope.
- `wl import --scope-to-tag` does the opposite: it imports the tasks of a child worklog and tags them with the scope id (or `--tag-name`).
