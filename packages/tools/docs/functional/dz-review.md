---
category: functional
themes:
  - review-workflow
  - markdown
  - cli
  - agents
verified_at: 2026-06-18
source_ref: "packages/tools/dz-review/*.ts; imported dz-md-review-syntax docs and skill snapshot on 2026-06-18"
language: en-US
---

# DZ Review

`dz-review` is a Markdown review toolkit for inline conversations and local edit annotations. It keeps review state inside ordinary Markdown files so the same document can move through Git, VS Code, Obsidian, and plain text editors without a separate review database.

## Syntax

The portable conversation form is an HTML comment containing role markers:

```markdown
<!-- @agent Please validate this claim. @me ok -->
```

The compact discussion form is:

```markdown
{?? @agent Please validate this claim. ??}
```

Use these roles inside conversations:

| Marker   | Meaning                                                        |
| -------- | -------------------------------------------------------------- |
| `@agent` | Agent message, rationale, or response.                         |
| `@me`    | Human message or reply.                                        |
| `@`      | Human shortcut. Normalize to `@me` when rewriting the message. |

Conversation messages may carry timestamp metadata immediately after the role:

```markdown
<!-- @agent%1WzvP91W Please validate this claim. @me%2026-06-16T17:35:35+0200 ok -->
```

CriticMarkup-style annotations represent concrete edit proposals:

| Syntax                     | Meaning                        |
| -------------------------- | ------------------------------ |
| `{++new text++}`           | Proposed addition.             |
| `{--old text--}`           | Proposed deletion.             |
| `{~~old text~>new text~~}` | Proposed replacement.          |
| `{==text==}`               | Highlight requiring attention. |
| `{>>comment<<}`            | Comment-only note.             |
| `{?? discussion ??}`       | Inline discussion.             |

Annotations may carry timestamp metadata after the opening marker:

```markdown
{++%1WzvP91W|new text++} {--%2026-06-16T17:35:35+0200|old text--}
```

## Conversation Status

The status is derived from the final conversation message.

| Status     | Final message                                   |
| ---------- | ----------------------------------------------- |
| `open`     | Last message is `@agent ...`.                   |
| `wip`      | Last message is empty `@` or `@me`.             |
| `handled`  | Last message is a non-`ok` `@` or `@me` reply.  |
| `resolved` | Last message is `@ ok`, `@me ok`, or `@me: ok`. |

## CLI

The Deno module lives in `packages/tools/dz-review`. The integrated CLI surface includes:

```bash
dz-review -C path/to/repo status
dz-review --state-dir .cache/dz-review agent start file.md
dz-review --ignore-file config/dz-review.ignore status file.md
dz-review review file.md
dz-review r --pending file.md
dz-review r --conversation file.md
dz-review r --list --diff
dz-review r --context-before 2 --context-after 1 file.md
dz-review status file.md
dz-review status --oneline file.md
dz-review status --short file.md
dz-review status --recap file.md
dz-review status --recap --template '%(status)' file.md
dz-review list file.md
dz-review list --pending-conversations file.md
dz-review diff
dz-review timestamp -i file.md
dz-review timestamp --compact -o stamped.md file.md
dz-review now
dz-review now --iso --date 2026-06-18T12:00:00+02:00
dz-review agent start file.md
dz-review agent status file.md
dz-review me status file.md
dz-review agent done file.md
dz-review agent-instructions
dz-review completions bash
```

`dz-review stats` is intentionally removed and reports:

```text
dz-review stats was removed; use dz-review status --oneline.
```

Aliases from the standalone tool are preserved: `r`, `st`, `l`, `ls`, `d`, `ts`, and `timestamps`. With an explicit command and no files inside a Git worktree, `dz-review` reads the current `git diff HEAD --unified=0`. `status` defaults to one line per matching file; `status --oneline` is the aggregate form.

The global options are `-C` / `--cwd`, `--state-dir <dir>`, and `--ignore-file <file>`. `--state-dir` controls where agent session state is stored; it defaults to `DZ_REVIEW_STATE_DIR` or `.dz-review`. `--ignore-file` controls the project ignore file; it defaults to `DZ_REVIEW_IGNORE_FILE` or `.dz-review-ignore`. CLI options take precedence over environment variables, and both are resolved after `-C` changes the working directory.

The shared filter options are `--pending`, `--open`, `--wip`, `--handled`, `--resolved`, `--conversation`, `--conversations`, `--open-conversations`, `--wip-conversations`, `--handled-conversations`, `--resolved-conversations`, `--pending-conversations`, `--ignore-closed-conversations`, `--since`, `--color`, and `--no-color`. `review`, `status`, and `list` also accept `--git` and `--diff` to restrict output to lines added in the current Git diff.

The CLI reads the configured ignore file from the current directory. Matching paths are skipped in all modes, and negated patterns such as `!docs/` can re-include paths that are otherwise ignored by Git. The active agent state directory and the default `.dz-review/` directory are ignored by default even when no ignore file exists. Explicit file arguments for `dz-review agent start` and `dz-review agent add-file` bypass project ignore rules, but still respect the builtin state-directory protections.

## Agent Workflow

Agents should use the `markdown-review-workflow` skill when editing Markdown with active review blocks. The durable rules are:

1. Inspect the surrounding Markdown before editing a review block.
2. Preserve unresolved conversation history.
3. Append new `@agent` replies instead of rewriting earlier messages.
4. Edit the prose first when a review comment requests a text change.
5. Remove review chatter only after explicit validation, such as `@me ok`.
6. Report unresolved conversations in the final answer.

`dz-review agent start [file...]` is the agent-first session entry point. It scans the current review state, writes `agent-session.json` under the configured state directory, records each annotated file's original or dominant timestamp format, normalizes timestamps to ISO for editing, and prints an inbox with stable item IDs, file/line, likely state, last message, context, and suggested action. `--dry-run` prints the inbox without writing the snapshot or changing files. `--json` prints the same structured model for tools.

`dz-review agent status [file...]` reads the active start snapshot and prints an in-progress session view without changing files. It reports annotated files, modified files, answered conversations, cleanable conversations, remaining open items, guardrail failures, and current stable item IDs. `--json` prints the structured session status.

`dz-review me status [file...]` reads the same active session snapshot as `agent status`, but prints a human-facing TODO view: agent replies or open items to review, validated conversations to clean, and remaining review issues. `--json` prints the same structured session status as `agent status --json`. This command is intentionally scoped under `me` so the existing `status` command can remain unchanged while the human-facing view matures.

`dz-review agent add-file [file...]` adds files to the active session snapshot after `agent start`. Explicit files can be added even when they match the configured ignore file; the command still avoids builtin state directories.

`dz-review agent done [file...]` compares the current review state against the start snapshot, restores timestamps to the recorded file format when the start format was compact, hangul, or ISO, and prints a handoff with annotated files, modified files, answered conversations, cleanable conversations, remaining open items, and guardrail failures. Guardrails currently detect bare `@` human markers, validated `@me ok` or `@ ok` conversations that remain cleanable, missing timestamps, deleted started conversations, and timestamp format drift after restoration. `--json` prints the structured handoff.

V1 assumes one active agent session per configured state directory. A future job-based model could allow concurrent agents by giving each session a job id and routing edits through `dz-review`, but that is intentionally out of scope for the initial workflow.
