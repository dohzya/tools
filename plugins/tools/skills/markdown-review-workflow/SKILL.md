---
name: markdown-review-workflow
description: Use this skill when reviewing, annotating, replying to, resolving, or cleaning Markdown files that use DZ Markdown Review Syntax, custom review annotations, HTML review comments, or {?? ??} discussion blocks.
---

# Markdown Review Workflow

Use this skill to run Markdown review loops with inline discussion blocks, in the spirit of GitHub or GitLab review threads. The document is the shared source of truth: preserve unresolved discussion history, answer inside the thread, and clean only after human validation.

For exact syntax examples and edge cases, read `references/review-syntax.md`.

## CLI Checks

Use `dz-review` as a non-interactive inspection and timestamp helper:

1. For an agent session, run `dz-review agent start [file...]` once. It records `.dz-review/agent-session.json`, detects each annotated file's original or dominant timestamp format, normalizes timestamps to ISO for editing, and prints stable item IDs with suggested actions.
2. Edit the Markdown threads directly. Use `dz-review agent status [file...]` for in-progress checks tied to the active start snapshot; do not rerun `agent start` just to refresh state.
3. Before handing edited annotated files back, run `dz-review agent done [file...]`. It compares against the start snapshot, restores each file's recorded timestamp format when possible, and reports answered, cleanable, remaining, and guardrail-failed conversations.
4. Rerun `dz-review agent start --force [file...]` only when intentionally replacing the active snapshot.
5. Outside an agent session, use the ordinary `dz-review` inspection and timestamp commands as a manual fallback.

Agents should edit the Markdown threads directly. Do not use the interactive `dz-review review` flow from an agent session.

## Workflow

1. Inspect the Markdown around each active review block before editing.
2. Normalize quick human notes inside discussion blocks from `@ ...` to `@me ...`. Preserve any timestamp attached to the marker.
3. When responding, append a new `@agent` line inside the same block. Do not rewrite earlier `@me` or `@agent` messages unless the user explicitly asks.
4. When a review comment requires a text change, edit the prose first, then add an `@agent` reply that states what changed.
5. Leave unresolved conversations in place and mention them in the final answer.
6. Clean a conversation only when the human has validated it, for example with `@me ok`, `OK`, `ok`, or an explicit resolution request.

## Discussion Blocks

Active discussions can use either syntax:

```markdown
<!--
@agent I chose this wording because it matches the glossary.
@me Can we make this less categorical?
@agent Done. I softened the claim and kept the glossary term.
-->
```

```markdown
{?? @agent I chose this wording because it matches the glossary. @me Can we make this less categorical? @agent Done. I softened the claim and kept the glossary term. ??}
```

Use `@agent` for agent messages and `@me` for human messages. Create and normalize messages without a colon after the role marker. A marker may carry a timestamp, such as `@agent%2026-06-16T17:35:35+0200`, `@agent%1WzvP91W`, or `@agent%궨눭녇걸`. Treat timestamps as marker metadata, not message text, and preserve them when editing older messages.

## Custom Review Annotations

Use the custom review annotation syntax for concrete proposed text edits:

- `{++new text++}` means added text.
- `{++%1WzvP91W|new text++}` means timestamped added text.
- `{--old text--}` means deleted text.
- `{~~old text~>new text~~}` means replacement.
- `{==text==}` means highlighted text to review.
- `{>>comment<<}` means comment-only annotation.
- `{?? discussion ??}` means discussion.

When cancelling an annotation, keep the original text where one exists. When applying an annotation, keep the accepted text. For discussions and comments, remove the annotation unless a durable note is still useful.

## Resolution

When a thread is validated, remove the active discussion block. If the thread contains durable rationale that should remain visible to future readers, replace it with a plain Markdown or Obsidian comment:

```markdown
<!-- Justification: The term matches the project glossary. -->
```

```markdown
%% Justification : The term matches the project glossary. %%
```

If the thread only tracked normal review chatter, delete it without leaving a note.

## Reporting

In the final answer, briefly report:

- files edited;
- conversations answered or resolved;
- unresolved conversations left in the document;
- any durable comments inserted during cleanup.
