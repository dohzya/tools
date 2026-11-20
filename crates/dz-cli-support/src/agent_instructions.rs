//! Static text printed by the `agent-instructions` command of each tool.

/// The tool whose instructions are wanted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    /// `wl`
    Worklog,
    /// `md`
    MarkdownSurgeon,
    /// `recap`
    Recap,
    /// `dz-review`
    DzReview,
}

const WORKLOG: &str = r#"
Worklog (`wl`): local task log for agent work.
- Create a worktask at the start of substantive work. If already working in a task, use it or create a subtask. `wl create [--parent <taskid>] "short task name"`.
- Link related but non-hierarchical tasks with `wl link <id> depends-on|blocks|related <other-id>`; `wl create` also accepts repeatable `--depends-on`, `--blocks`, and `--related`.
- Trace significant events with kind (action, info, state, hypothesis, finding, learning): `wl trace <id> -k <kind> "message"`; use `state`/`finding`/`learning` for notable results.
- Show context with `wl show <id>`; filter likely learnings with `wl traces <id> --kind finding,learning`; fix kind with `wl traces update <id> <trace-id> --kind finding`.
- Agents do not write manual checkpoint/done content when delegation is available; use only one command: choose `wl checkpoint --agent` or `wl done --agent`. Do not checkpoint before done.
- Manual synthesis must be self-contained: previous traces/checkpoints could be deleted afterward.
- Help: `wl --help`.
"#;

const MANDATORY_WORKLOG: &str = r#"
Worklog (`wl`): mandatory local task log for agent work.
- You MUST create a worktask at the start of any substantive work. If already working in a task, use it or create a subtask. `wl create [--parent <taskid>] "short task name"`.
- You MAY link related but non-hierarchical tasks with `wl link <id> depends-on|blocks|related <other-id>`; `wl create` also accepts repeatable `--depends-on`, `--blocks`, and `--related`.
- You MUST trace significant events with kind (action, info, state, hypothesis, finding, learning): `wl trace <id> -k <kind> "message"`; use `state`/`finding`/`learning` for notable results.
- Show context with `wl show <id>`; filter likely learnings with `wl traces <id> --kind finding,learning`; fix kind with `wl traces update <id> <trace-id> --kind finding`.
- Agents do not write manual checkpoint/done content when delegation is available; use only one command: choose `wl checkpoint --agent` or `wl done --agent`. Do not checkpoint before done.
- When the user validates completion, close the task, preferably with `wl done --agent`; manual synthesis must be self-contained.
- Help: `wl --help`.
"#;

const MARKDOWN_SURGEON: &str = r#"
Markdown Surgeon (`md`): Markdown inspection and section-level editing.
- Outline a file: `md outline <file>` lists headings, section IDs, and line numbers; `--json` gives structured output.
- Read a section: `md read <file> <selector>`; `--deep` includes subsections.
- Replace a section: `md write <file> <selector> [content]`; omitted content is read from stdin.
- Append content: `md append <file> [selector] [content]`.
- Frontmatter: `md meta <file> ...` reads or updates YAML metadata.
- Selectors can be section IDs from `md outline` or heading selectors; heading selectors can be ambiguous.
- Find a passage: `md search <file> <pattern>` prints matching lines with their current line number and section ID.
- Get a stable content anchor (MRFI) that survives future edits: `md ref <file> <startLine>:<startColumn>-<endLine>:<endColumn>` (e.g. `md ref notes.md 3:1-3:18`) generates a reference from a source range; use it instead of a raw `file:line` pointer in cross-file audits or notes that must stay valid after the file is edited.
- Re-locate an MRFI reference after edits: `md resolve <file> <ref...>` prints each reference's current line/column position (or reports drift/removal) without you having to recompute line numbers by hand.
- Compare references without a document: `md compare <A> <B>` says whether two MRFI references probably designate the same passage (verdict, scores, matching and conflicting fields); `md rank <target> <candidate...>` (or `--stdin`, one per line) orders candidates from most to least likely, to choose the order of `md resolve` attempts. Both are prefilters, not proof; `--json` is available.
- Help: `md --help`.
"#;

const RECAP: &str = r#"
Recap (`recap`): compact project context snapshot; it can be useful as assistant context.
- Snapshot current directory: `recap`.
- Snapshot another directory: `recap -C <dir>`.
- Show selected sections: `recap show <section...>`.
- Structured output: `recap --json`.
- Project-specific context can be added via recap configuration.
- Help: `recap --help`.
"#;

const DZ_REVIEW: &str = r#"
DZ Review (`dz-review`): Markdown review syntax scanner and helper CLI.
- Start a review session once with `dz-review session start [file...]`; it records an `agent-session.json` snapshot in the configured state directory, normalizes timestamps for editing, and prints stable item IDs with suggested actions.
- During that session, use `dz-review agent status [file...]` for progress checks; do not rerun `session start` just to refresh state.
- Before handing work back, run `dz-review session done [file...]`; it restores each file's recorded timestamp format and reports the final handoff.
- Rerun `session start --force [file...]` only when intentionally replacing the active snapshot.
- For passage references, use `dz-review ref check [file...]` to validate links, `dz-review ref list [file...]` to inspect referenced passages, `dz-review ref show [file...]` to print source-replaceable refs with snapshots, and `dz-review ref snapshots [--ref <selector>] [file...]` to print only selected snapshot blocks by label, source location, or target location.
- Reply by editing the Markdown thread: append a new `@agent` message and preserve unresolved history until human validation.
- Conversation statuses: `handled` means a `@me` message awaits agent action; `open` means the last message is from `@agent`, awaiting human validation; `resolved` means the human approved with `ok`. Always follow the `suggested action` column from `agent status`.
- After `agent clean --validated`, the cleaned items are recorded in the session snapshot so `session done` won't flag them as missing.
- If a conversation was deleted outside `agent clean` (e.g. manual edit), use `session done --acknowledge <id>` to dismiss the guardrail for that item.
- Never include `<!--` or `-->` inside a reply message; these corrupt the enclosing HTML comment block. Use plain text references instead, e.g. `(source: file:line)`.
- Help: `dz-review --help`.
"#;

/// Instructions of a tool; `mandatory` only changes the `wl` text.
pub fn agent_instructions(tool: Tool, mandatory: bool) -> &'static str {
    let text = match tool {
        Tool::Worklog if mandatory => MANDATORY_WORKLOG,
        Tool::Worklog => WORKLOG,
        Tool::MarkdownSurgeon => MARKDOWN_SURGEON,
        Tool::Recap => RECAP,
        Tool::DzReview => DZ_REVIEW,
    };
    text.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_are_trimmed_and_start_with_the_tool_name() {
        assert!(agent_instructions(Tool::MarkdownSurgeon, false).starts_with("Markdown Surgeon"));
        assert!(agent_instructions(Tool::Worklog, true).contains("mandatory"));
        assert!(!agent_instructions(Tool::DzReview, false).ends_with('\n'));
    }
}
