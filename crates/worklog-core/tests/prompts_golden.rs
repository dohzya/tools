//! Prompts and agent command lines must equal the ones of the TS tool
//! (`prompts_golden.json` was produced by it from a fixed task).

use serde_json::Value as Json;
use worklog_core::agent::*;
use worklog_core::output::ShowOutput;
use worklog_core::types::*;

fn sample() -> ShowOutput {
    let entries = (0..7)
        .map(|i| Entry {
            id: None,
            ts: format!("2020-01-2{i} 10:00"),
            msg: format!("msg {i}"),
            kind: (i % 2 == 1).then_some(TraceKind::Finding),
            added_at: None,
        })
        .collect();
    let todo = |id: &str, text: &str, status| Todo {
        id: id.into(),
        text: text.into(),
        status,
        metadata: Default::default(),
    };
    ShowOutput {
        task: "9n3ksy".into(),
        full_id: "9n3ksypyyujvxajl4o1djfk67".into(),
        name: "Fix login bug".into(),
        desc: "Users can't log in\n\n---\n\nPart two".into(),
        desc_parts: vec!["Users can't log in".into(), "Part two".into()],
        status: "started".into(),
        created: "2020-01-10 09:00".into(),
        ready: None,
        started: Some("2020-01-20 10:00".into()),
        last_checkpoint: Some(Checkpoint {
            ts: "2020-01-20 10:00".into(),
            changes: "did x".into(),
            learnings: "learned y".into(),
        }),
        entries_since_checkpoint: entries,
        todos: vec![
            todo("a1", "first", TodoStatus::Todo),
            todo("b2", "second", TodoStatus::Wip),
            todo("c3", "third", TodoStatus::Done),
        ],
        tags: None,
        parent: None,
        links: None,
        subtasks: None,
    }
}

fn strings(j: &Json) -> Vec<String> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn agent_commands_match_ts() {
    let g: Json = serde_json::from_str(include_str!("prompts_golden.json")).unwrap();
    let show = sample();
    let id = "9n3ksypyyujvxajl4o1djfk67";
    let args = vec!["-m".to_string(), "x".to_string()];
    for (name, agent) in [("claude", AgentType::Claude), ("codex", AgentType::Codex)] {
        let prompt = build_system_prompt(&show, id, agent);
        let existing = (agent == AgentType::Codex).then_some("EXISTING instructions");
        let cmd = interactive_cmd(agent, &prompt, &args, existing);
        assert_eq!(cmd, strings(&g[name]), "{name} interactive");
        let synth = synthesis_cmd(agent, &prompt, "SYNTH");
        assert_eq!(
            synth,
            strings(&g[format!("{name}_synth")]),
            "{name} synthesis"
        );
    }
}

#[test]
fn checkpoint_prompts_match_ts() {
    let g: Json = serde_json::from_str(include_str!("prompts_golden.json")).unwrap();
    let show = sample();
    let id = "9n3ksypyyujvxajl4o1djfk67";
    assert_eq!(
        build_checkpoint_prompt(id, &show, false),
        g["checkpoint"].as_str().unwrap()
    );
    assert_eq!(
        build_checkpoint_prompt(id, &show, true),
        g["done"].as_str().unwrap()
    );
}
