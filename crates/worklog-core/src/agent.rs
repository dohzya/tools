//! Launching AI agents with task context: command lines for Claude and
//! Codex, and the prompts they receive.

use crate::output::ShowOutput;
use crate::types::{Todo, TodoStatus};

/// The synthesis contract shared by the prompts and the `checkpoint` help.
pub const CHECKPOINT_SYNTHESIS_CONTRACT: &str = include_str!("text/checkpoint_contract.txt");

/// Supported agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentType {
    /// Claude Code.
    Claude,
    /// OpenAI Codex.
    Codex,
}

impl AgentType {
    /// Lowercase name, as used in commands.
    pub fn as_str(self) -> &'static str {
        match self {
            AgentType::Claude => "claude",
            AgentType::Codex => "codex",
        }
    }

    /// Display name.
    pub fn display_name(self) -> &'static str {
        match self {
            AgentType::Claude => "Claude",
            AgentType::Codex => "Codex",
        }
    }
}

/// Claude subcommands that take no system prompt.
pub const CLAUDE_SUBCOMMANDS: [&str; 1] = ["agents"];

/// The agent running this process: `CLAUDECODE` set, or `AGENT=codex`.
pub fn detect_agent_type(get: &dyn Fn(&str) -> Option<String>) -> Option<AgentType> {
    if get("CLAUDECODE").is_some_and(|v| !v.is_empty()) {
        return Some(AgentType::Claude);
    }
    if get("AGENT").as_deref() == Some("codex") {
        return Some(AgentType::Codex);
    }
    None
}

/// Command line to launch an agent interactively.
pub fn interactive_cmd(
    agent: AgentType,
    system_prompt: &str,
    extra_args: &[String],
    existing_developer_instructions: Option<&str>,
) -> Vec<String> {
    match agent {
        AgentType::Claude => {
            if extra_args
                .first()
                .is_some_and(|a| CLAUDE_SUBCOMMANDS.contains(&a.as_str()))
            {
                let mut cmd = vec!["claude".to_string()];
                cmd.extend(extra_args.iter().cloned());
                return cmd;
            }
            let mut cmd = vec![
                "claude".to_string(),
                "--append-system-prompt".to_string(),
                system_prompt.to_string(),
            ];
            cmd.extend(extra_args.iter().cloned());
            cmd
        }
        AgentType::Codex => {
            let (args, override_instructions) = extract_codex_developer_instructions(extra_args);
            let existing = override_instructions
                .as_deref()
                .or(existing_developer_instructions)
                .filter(|s| !s.is_empty());
            let instructions = match existing {
                Some(e) => format!("{e}\n\n---\n\n{system_prompt}"),
                None => system_prompt.to_string(),
            };
            let mut cmd = vec!["codex".to_string()];
            cmd.extend(args);
            cmd.push("-c".into());
            cmd.push(format!(
                "developer_instructions={}",
                serde_json::to_string(&instructions).unwrap_or_default()
            ));
            cmd
        }
    }
}

/// Command line for a one-shot synthesis.
pub fn synthesis_cmd(agent: AgentType, system_prompt: &str, synthesis_prompt: &str) -> Vec<String> {
    match agent {
        AgentType::Claude => vec![
            "claude".into(),
            "--append-system-prompt".into(),
            system_prompt.into(),
            "-p".into(),
            synthesis_prompt.into(),
        ],
        AgentType::Codex => vec![
            "codex".into(),
            "exec".into(),
            "--dangerously-bypass-approvals-and-sandbox".into(),
            synthesis_prompt.into(),
        ],
    }
}

fn parse_toml_string(value: &str) -> String {
    if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        return value[1..value.len() - 1].to_string();
    }
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        return serde_json::from_str::<String>(value)
            .unwrap_or_else(|_| value[1..value.len() - 1].to_string());
    }
    value.to_string()
}

fn parse_developer_instructions_config(config: &str) -> Option<String> {
    let (key, value) = config.split_once('=')?;
    if key.trim() != "developer_instructions" {
        return None;
    }
    Some(parse_toml_string(value.trim()))
}

fn extract_codex_developer_instructions(args: &[String]) -> (Vec<String>, Option<String>) {
    let mut kept = Vec::new();
    let mut found = None;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if (arg == "-c" || arg == "--config")
            && let Some(value) = args.get(i + 1)
        {
            if let Some(parsed) = parse_developer_instructions_config(value) {
                found = Some(parsed);
            } else {
                kept.push(arg.clone());
                kept.push(value.clone());
            }
            i += 2;
            continue;
        }
        if let Some(value) = arg.strip_prefix("--config=")
            && let Some(parsed) = parse_developer_instructions_config(value)
        {
            found = Some(parsed);
            i += 1;
            continue;
        }
        if arg.starts_with("-c")
            && arg.len() > 2
            && let Some(parsed) = parse_developer_instructions_config(&arg[2..])
        {
            found = Some(parsed);
            i += 1;
            continue;
        }
        kept.push(arg.clone());
        i += 1;
    }
    (kept, found)
}

/// Codex profile selected by `-p` / `--profile`.
pub fn codex_profile(args: &[String]) -> Option<String> {
    let mut profile = None;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "-p" || arg == "--profile" {
            if let Some(next) = args.get(i + 1) {
                profile = Some(next.clone());
                i += 1;
            }
        } else if let Some(v) = arg.strip_prefix("--profile=") {
            profile = Some(v.to_string());
        } else if arg.starts_with("-p") && arg.len() > 2 {
            profile = Some(arg[2..].to_string());
        }
        i += 1;
    }
    profile
}

/// Top-level `developer_instructions` of a Codex `config.toml`.
pub fn parse_developer_instructions(config: &str) -> Option<String> {
    let lines: Vec<&str> = config
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    for (i, raw) in lines.iter().enumerate() {
        let line = raw.trim_start();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            return None;
        }
        let Some(rest) = line.strip_prefix("developer_instructions") else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(value) = rest.strip_prefix('=') else {
            continue;
        };
        let value = value.trim_start();
        if value.starts_with("\"\"\"") || value.starts_with("'''") {
            return Some(parse_multiline(value, &lines[i + 1..]));
        }
        return Some(parse_single_line(value));
    }
    None
}

fn parse_multiline(first: &str, following: &[&str]) -> String {
    let delim = &first[..3];
    let start = &first[3..];
    if let Some(end) = start.find(delim) {
        return start[..end].to_string();
    }
    let mut parts = vec![start.to_string()];
    for line in following {
        if let Some(end) = line.find(delim) {
            parts.push(line[..end].to_string());
            break;
        }
        parts.push((*line).to_string());
    }
    let content = parts.join("\n");
    content
        .strip_prefix('\n')
        .map_or(content.clone(), str::to_string)
}

fn parse_single_line(value: &str) -> String {
    let trimmed = value.trim();
    let no_comment = strip_inline_comment(trimmed);
    let v = no_comment.trim();
    if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') {
        return v[1..v.len() - 1].to_string();
    }
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        return serde_json::from_str::<String>(v).unwrap_or_else(|_| v[1..v.len() - 1].to_string());
    }
    v.to_string()
}

fn strip_inline_comment(value: &str) -> &str {
    let (mut basic, mut literal, mut escaped) = (false, false, false);
    for (i, c) in value.char_indices() {
        if basic {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                basic = false;
            }
            continue;
        }
        if literal {
            if c == '\'' {
                literal = false;
            }
            continue;
        }
        match c {
            '"' => basic = true,
            '\'' => literal = true,
            '#' => return &value[..i],
            _ => {}
        }
    }
    value
}

/// System prompt given to an interactive agent.
pub fn build_system_prompt(task: &ShowOutput, resolved_task_id: &str, agent: AgentType) -> String {
    let n = task.entries_since_checkpoint.len();
    let recent = task.entries_since_checkpoint[n.saturating_sub(5)..]
        .iter()
        .map(|e| format!("  - [{}] {}", e.ts, e.msg))
        .collect::<Vec<_>>()
        .join("\n");
    let todos = task
        .todos
        .iter()
        .filter(|t: &&Todo| t.status == TodoStatus::Todo)
        .map(|t| format!("  - [ ] {}", t.text))
        .collect::<Vec<_>>()
        .join("\n");
    let started = task
        .started
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("**Started**: {s}"))
        .unwrap_or_default();
    let desc = if task.desc.is_empty() {
        "(no description)"
    } else {
        task.desc.as_str()
    };
    let traces = if recent.is_empty() {
        String::new()
    } else {
        format!("## Recent Traces\n{recent}")
    };
    let todo_section = if todos.is_empty() {
        String::new()
    } else {
        format!("## TODO\n{todos}")
    };
    let at = agent.as_str();
    let name = agent.display_name();
    format!(
        "
# Current Worktask Context

You are working on the following task:

**Task ID**: {full} (short: {short})
**Name**: {tname}
**Status**: {status}
**Created**: {created}
{started}

## Description
{desc}

{traces}

{todo_section}

---

## Tracing

Trace every significant event with a kind (action, info, state, hypothesis, finding, learning):
  wl trace -k <kind> \"message\"

Action traces are evidence. If an action has a notable result, also trace it as state/finding/learning.
Include causes (why failed) and pistes (what next) for context.

## WORKLOG_TASK_ID

The environment variable is set to: {resolved_task_id}

**All commands work without taskId** — the env var is used automatically:
  wl trace -k finding \"msg\", wl checkpoint \"changes\" \"learnings\", wl done \"changes\" \"learnings\",
  wl show, wl start, wl ready, wl traces, wl update, wl cancel, wl meta, wl todo next

To trace in a **different** task (e.g. a subtask), pass its ID as first argument:
  wl trace <other-id> -k finding \"msg\"

To fix trace metadata:
  wl traces update <trace-id> --kind finding

**Never** prefix a command with `WORKLOG_TASK_ID=... wl ...` — the variable is already set.

## Checkpoints

When it's time to consolidate traces, prefer **`wl checkpoint --{at}`** — it feeds all your traces to a fresh {name} instance with quality guidelines, so you don't have to write the synthesis yourself. It preserves your context window.

If you write a manual `wl checkpoint \"changes\" \"learnings\"` or `wl done \"changes\" \"learnings\"` synthesis, follow this contract:

{CHECKPOINT_SYNTHESIS_CONTRACT}

Before finalizing Learnings, run:
  wl traces --kind finding,learning

This is a cheap high-signal pass over likely Learnings candidates. It does not guarantee full coverage, but it catches most pre-identified reusable findings with little noise.

## Subtasks

To delegate sub-work to another agent, create a subtask linked to this task:
  wl create --parent {resolved_task_id} --started \"Sub-task name\"

Then launch the sub-agent with its own context:
  wl {at} <subtask-id>

Check subtask progress:
  wl show {resolved_task_id}   # shows subtasks-since-checkpoint section
  wl list --parent {resolved_task_id}   # only children of this task
",
        full = task.full_id,
        short = task.task,
        tname = task.name,
        status = task.status,
        created = task.created,
    )
    .trim()
    .to_string()
}

/// Prompt of the delegated synthesis agent (`checkpoint --agent`, `done --agent`).
pub fn build_checkpoint_prompt(task_id: &str, show: &ShowOutput, done: bool) -> String {
    let mode = if done { "done" } else { "checkpoint" };
    let mut sections: Vec<String> = Vec::new();
    sections.push(if done {
        "You are the dedicated synthesis agent creating a final checkpoint that closes the task."
            .into()
    } else {
        "You are the dedicated synthesis agent creating a checkpoint.".into()
    });
    sections.push(format!("# Task: {}\n\n{}", show.name, show.desc));
    if show.entries_since_checkpoint.is_empty() {
        sections.push("## Traces since last checkpoint\n\nNo traces recorded.".into());
    } else {
        let entries = show
            .entries_since_checkpoint
            .iter()
            .map(|e| {
                let kind = e
                    .kind
                    .map(|k| format!(" [kind: {}]", k.as_str()))
                    .unwrap_or_default();
                format!("- [{}]{kind} {}", e.ts, e.msg)
            })
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!("## Traces since last checkpoint\n\n{entries}"));
    }
    if let Some(cp) = &show.last_checkpoint {
        sections.push(format!(
            "## Previous checkpoint\n\n**Changes:** {}\n**Learnings:** {}",
            cp.changes, cp.learnings
        ));
    }
    let active: Vec<String> = show
        .todos
        .iter()
        .filter(|t| !t.status.is_closed())
        .map(|t| {
            let s = match t.status {
                TodoStatus::Todo => "todo",
                TodoStatus::Wip => "wip",
                TodoStatus::Blocked => "blocked",
                TodoStatus::Cancelled => "cancelled",
                TodoStatus::Done => "done",
            };
            format!("- [{s}] {}", t.text)
        })
        .collect();
    if !active.is_empty() {
        sections.push(format!("## Active TODOs\n\n{}", active.join("\n")));
    }
    sections.push(format!(
        "## Checkpoint synthesis contract\n\n{CHECKPOINT_SYNTHESIS_CONTRACT}"
    ));
    sections.push(format!(
        "## Agent delegation rule\n\n\
Ordinary agents should not write manual {mode} syntheses by default; agents do not write manual {mode} content when delegation is available. Prefer `wl {mode} --agent` for this synthesis.\n\n\
For an ordinary agent, this is the preferred handoff path.\n\n\
Use manual `wl {mode} <id> \"<changes>\" \"<learnings>\"` only when delegation is unavailable, inappropriate, or explicitly requested.\n\n\
This prompt is already running inside the delegated synthesis path. Do not call `wl {mode} --agent` again; produce the synthesis now and run the direct command below."
    ));
    sections.push(
        "## Output quality\n\n\
**Changes**: Write a compact but self-contained narrative of outcomes, important pivots, and final state. Include validation when it proves the outcome.\n\n\
**Learnings**: Capture reusable learnings, not a work log. Preserve root causes, decisions and why, rejected alternatives, gotchas, workflow rules, and codebase facts.\n\n\
Good learning: \"Deno tests for worklog must run from packages/tools because that directory owns deno.json dependency resolution.\"\n\
Bad learning: \"Used TDD and tests passed.\"\n\n\
Trace kind routing hints: learning is almost always a candidate for Learnings. Finding may belong in Changes or Learnings depending on reusability. State usually belongs in Changes, especially validation or final state. Info and hypothesis belong in Changes only when they materially changed the work, and may become Learnings after analysis. Action usually belongs in Changes only when impactful. Treat these as routing hints, not hard rules.\n\n\
Cheap Learnings check: review the finding and learning traces as the highest-signal candidates for Learnings. This does not prove there are no other reusable lessons, but it catches most pre-identified candidates with little noise."
            .into(),
    );
    sections.push(format!(
        "## Command\n\nRun this command directly without asking for confirmation:\n\n  wl {mode} {task_id} \"<changes>\" \"<learnings>\"\n\nReplace `<changes>` and `<learnings>` with your synthesis."
    ));
    sections.join("\n\n")
}
