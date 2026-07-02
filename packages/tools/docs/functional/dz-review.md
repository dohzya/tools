---
category: functional
themes:
  - review-workflow
  - markdown
  - cli
  - agents
verified_at: 2026-07-01
source_ref: "packages/tools/dz-review/*.ts; imported dz-md-review-syntax docs and skill snapshot on 2026-06-18"
language: en-US
---

# DZ Review

`dz-review` is a Markdown review toolkit for inline conversations and local edit annotations. It keeps review state inside ordinary Markdown files so the same document can move through Git, VS Code, Obsidian, and plain text editors without a separate review database.

`dz-review` is a review-workflow superset of the Markdown reference behavior owned by `md`. Passage and review references should follow the shared functional contract in [`../../../../docs/functional/markdown-fragment-references.md`](../../../../docs/functional/markdown-fragment-references.md): `^<anchor>` resolves a stable Markdown anchor, `~<mrfi>` resolves an opaque MRFI locator, and CLI inputs may use `~<mrfi>::<witness>` to pass witness text to the resolver. The `::witness` suffix is a CLI convention, not part of the MRFI inline syntax. Because `:` is a valid anchor character, `::` inside `^<anchor>` is treated as part of the anchor ID. When `dz-review` generates MRFI passage references, it should use the same `min`, `default`, and `full` field profiles as `md`; the shared default profile is the recommended normal authoring mode.

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

Passage references use HTML comments. `ref:` and timestamped `ref%...:` are both accepted:

```markdown
<!-- ref: source.md:82; ../other.md:80-82^stable-id -->
<!-- ref%궩거깇걸: 02_trame_commentee.md:82~GdwjSq -->
```

Line references are canonical without `L`: use `:82` for one line and `:80-82` for a range. The parser also accepts `:L82`, `:L80-L82`, and `:L80-82`; it rejects mixed suffix-only forms such as `:80-L82`.

Reference targets may combine independent hints:

| Marker       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `~GdwjSq`    | Opaque MRFI locator for the target passage or review item. |
| `^stable-id` | Stable passage id defined in the target doc.               |

Define a stable passage id in the target document with:

```markdown
<!-- ^stable-id -->
```

References can appear inside conversation messages:

```markdown
<!-- @me%궩거깇걸 Pourquoi parler du SAS ici ?
@agent%궩거깇걸 ref: 02_trame_commentee.md:82~GdwjSq
@ Je vois, on reformule.
-->
```

When a reference needs persisted previous or expected target text, use an explicit labelled snapshot next to the target. Witness text is resolver evidence. It must not be persisted into JSON output or silently override contradictory locator evidence. The persisted inline MRFI remains `~<mrfi>` or `~{<mrfi>}`; `::witness` is only the CLI transport form for commands that accept a reference argument.

References may embed an explicit snapshot with a labelled delimiter. Labels are generated per reference occurrence, and nested snapshots are allowed when labels differ:

```markdown
<!-- ref%궩거깇걸:
  02_trame_commentee.md:82~GdwjSq {&&rFZEOtB
  SAS : permet d'envoyer/récupérer des fichiers depuis le cloud.
  rFZEOtB&&};
-->
```

`dz-review ref check` validates files, line ranges, `^` ids, snapshot freshness, and duplicate nested snapshot labels. It parses and preserves `~<mrfi>` targets, but full MRFI resolution/validation is delegated to the shared resolver work and is not yet a `ref check` guarantee. Snapshot comparison ignores only delimiter label changes. `dz-review ref list` lists each reference and the live referenced passage, using the pager for long text output. `dz-review ref show` prints a source-replaceable version of the document: refs without snapshots are rewritten with labelled `{&&...&&}` snapshots, while existing snapshots are preserved. `dz-review ref snapshots` prints only snapshot blocks with a short provenance header, and repeated `--ref <selector>` filters keep selected refs by source location, target location, or snapshot label. Generated snapshots include up to 10 source lines by default; use `--snapshot-lines <count>` to change the limit, or `--snapshot-lines 0` for unlimited snapshots.

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
dz-review --state-dir .cache/dz-review session start file.md
dz-review --ignore-file config/dz-review.ignore status file.md
dz-review review file.md
dz-review r --pending file.md
dz-review r --conversation file.md
dz-review r --list --diff
dz-review r --context-before 2 --context-after 1 file.md
dz-review me review file.md
dz-review me list file.md
dz-review status file.md
dz-review status --oneline file.md
dz-review status --short file.md
dz-review status --oneline --quiet file.md
dz-review status --recap file.md
dz-review status --recap --template '%(status)' file.md
dz-review me status --short file.md
dz-review list file.md
dz-review list --pending-conversations file.md
dz-review diff
dz-review ref check file.md
dz-review ref list file.md
dz-review ref show file.md
dz-review ref show --snapshot-lines 0 file.md
dz-review ref snapshots --ref rFZEOtB --ref source.md:82 file.md
dz-review timestamp -i file.md
dz-review timestamp --compact -o stamped.md file.md
dz-review now
dz-review now --iso --date 2026-06-18T12:00:00+02:00
dz-review session start file.md
dz-review agent status file.md
dz-review session status file.md
dz-review session active --template '[review session]'
dz-review me status
dz-review me diff
dz-review session done file.md
dz-review agent-instructions
dz-review completions bash
```

`dz-review stats` is intentionally removed and reports:

```text
dz-review stats was removed; use dz-review status --oneline.
```

Aliases from the standalone tool are preserved: `r`, `st`, `l`, `ls`, `d`, `ts`, and `timestamps`. When a command receives no files, `dz-review` first uses the active agent session files when a session exists, then falls back to files reported by `git status` inside a Git worktree, including untracked files. `status` defaults to one line per matching file and starts with `Review session: active` or `Review session: none`; `status --oneline` is the aggregate form. `status -q` / `status --quiet` prints nothing when there are no annotations and no active review session.

The global options are `-C` / `--cwd`, `--state-dir <dir>`, and `--ignore-file <file>`. `--state-dir` controls where agent session state is stored; it defaults to `DZ_REVIEW_STATE_DIR` or `.dz-review` at the Git root when running inside a worktree. Explicit `--state-dir` and `DZ_REVIEW_STATE_DIR` values stay relative to the effective cwd unless absolute. `--ignore-file` controls the project ignore file; it defaults to `DZ_REVIEW_IGNORE_FILE` or `.dz-review-ignore`. CLI options take precedence over environment variables, and both are resolved after `-C` changes the working directory.

The shared filter options are `--pending`, `--open`, `--wip`, `--handled`, `--resolved`, `--conversation`, `--conversations`, `--open-conversations`, `--wip-conversations`, `--handled-conversations`, `--resolved-conversations`, `--pending-conversations`, `--ignore-closed-conversations`, `--since`, `--color`, and `--no-color`. `review`, `status`, and `list` also accept `--git` and `--diff` to restrict output to lines added in the current Git diff. `ref list` text output uses the pager by default when appropriate, with `--pager` and `--no-pager` overrides. `ref show --snapshot-lines <count>` and `ref snapshots --snapshot-lines <count>` control generated snapshot size; `0` means unlimited. `ref snapshots --ref <selector>` is repeatable and matches snapshot labels, source ref locations such as `doc.md:12`, and target locations such as `source.md:82`.

The CLI reads the configured ignore file from the current directory. Matching paths are skipped in all modes, and negated patterns such as `!docs/` can re-include paths that are otherwise ignored by Git. The active agent state directory and the default `.dz-review/` directory are ignored by default even when no ignore file exists. Explicit file arguments for `dz-review session start` and `dz-review session add-file` bypass project ignore rules, but still respect the builtin state-directory protections.

The DZ Review VS Code extension recognizes passage refs in Markdown. Hovering a ref shows the referenced passage, including refs to HTML conversation comments, and go-to-definition opens the target file at the referenced line. The `dzMdReview.refSnapshotLines` setting limits hover previews with the same default of 10 lines; `0` means unlimited.

## Agent Workflow

Agents should use the `markdown-review-workflow` skill when editing Markdown with active review blocks. The durable rules are:

1. Inspect the surrounding Markdown before editing a review block.
2. Preserve unresolved conversation history.
3. Append new `@agent` replies instead of rewriting earlier messages.
4. Edit the prose first when a review comment requests a text change.
5. Remove review chatter only after explicit validation, such as `@me ok`.
6. Report unresolved conversations in the final answer.

`dz-review session start [file...]` is the review session entry point. It scans the current review state, writes `agent-session.json` under the configured state directory, records each annotated file's original or dominant timestamp format, normalizes timestamps to ISO for editing, and prints an inbox with stable item IDs, file/line, likely state, last message, context, and suggested action. `--dry-run` prints the inbox without writing the snapshot or changing files. `--json` prints the same structured model for tools.

`dz-review agent status [file...]` reads the active start snapshot and prints an in-progress session view without changing files. `dz-review session status [file...]` is available as a lifecycle alias. It reports annotated files, modified files, answered conversations, cleanable conversations, remaining open items, guardrail failures, and current stable item IDs. `--json` prints the structured session status.

`dz-review session active` prints `in a review session` when the configured session snapshot exists, and prints nothing otherwise. `--template <message>` replaces the active-session message. It is intended for compact status integrations such as `recap`.

`dz-review me` is the human-oriented command scope. `dz-review me review ...`, `dz-review me list ...`, and `dz-review me diff ...` reuse the regular `review`, `list`, and `diff` command behavior. Bare `dz-review me status` reads the active agent session snapshot and prints a human-facing TODO view: agent replies or open items to review, validated conversations to clean, and remaining review issues. When `me status` receives files or regular status options such as `--short`, `--recap`, or `--template`, it behaves like `dz-review status`. `--json` prints the same structured session status as `agent status --json`.

`dz-review session add-file [file...]` adds files to the active session snapshot after `session start`. Explicit files can be added even when they match the configured ignore file; the command still avoids builtin state directories.

`dz-review session done [file...]` compares the current review state against the start snapshot, restores timestamps to the recorded file format when the start format was compact, hangul, or ISO, and prints a handoff with annotated files, modified files, answered conversations, cleanable conversations, remaining open items, and guardrail failures. Guardrails currently detect bare `@` human markers, validated `@me ok` or `@ ok` conversations that remain cleanable, missing timestamps, deleted started conversations, and timestamp format drift after restoration. `--json` prints the structured handoff.

`dz-review session rollback` restores files from the active start snapshot and closes the session by deleting `agent-session.json`. When file arguments are provided, rollback is scoped to those files and the session remains active.

For compatibility, `dz-review agent start`, `agent add-file`, `agent done`, and `agent rollback` remain aliases for the session lifecycle commands.

V1 assumes one active agent session per configured state directory. A future job-based model could allow concurrent agents by giving each session a job id and routing edits through `dz-review`, but that is intentionally out of scope for the initial workflow.
