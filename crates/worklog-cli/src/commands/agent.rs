//! `run`, `claude`, `codex`, `agent`: processes launched with a task.

use super::task::{self, NewTask};
use crate::ctx::{Ctx, Fail, Res, fail};
use crate::path::join;
use crate::resolve::resolve_task_id;
use worklog_core::agent::{
    AgentType, build_system_prompt, codex_profile, detect_agent_type, interactive_cmd,
    parse_developer_instructions, synthesis_cmd,
};
use worklog_core::error::Code;
use worklog_core::output::RunOutput;
use worklog_core::types::TaskStatus;

fn run_process(ctx: &mut Ctx, cmd: &[String], task_id: &str) -> Res<i32> {
    let env = vec![("WORKLOG_TASK_ID".to_string(), task_id.to_string())];
    let cwd = ctx.cwd.clone();
    let _ = std::io::Write::flush(ctx.out);
    match ctx.ports.proc_.run(cmd, &env, &cwd) {
        Ok(code) => Ok(code),
        Err(msg) => fail(Code::IoError, msg),
    }
}

/// `RunCommandUseCase`
pub fn run_command(
    ctx: &mut Ctx,
    cmd: &[String],
    task_id: Option<&str>,
    create: Option<&str>,
) -> Res<RunOutput> {
    if task_id.is_none() && create.is_none() {
        return fail(
            Code::InvalidArgs,
            "Either taskId or --create must be provided",
        );
    }
    let (resolved, created) = if let Some(name) = create {
        let out = task::add_task(
            ctx,
            NewTask {
                name: name.to_string(),
                desc: vec![],
                status: TaskStatus::Created,
                todos: vec![],
                metadata: None,
                tags: vec![],
                timestamp: None,
                parent: None,
            },
        )?;
        (resolve_task_id(ctx, &out.id)?, true)
    } else {
        ctx.purge()?;
        (resolve_task_id(ctx, task_id.unwrap_or_default())?, false)
    };
    if !ctx.ports.fs.exists(&ctx.task_path(&resolved)) {
        return fail(Code::TaskNotFound, format!("Task not found: {resolved}"));
    }
    let exit_code = run_process(ctx, cmd, &resolved)?;
    Ok(RunOutput {
        task_id: resolved,
        exit_code,
        created,
    })
}

fn codex_instructions(ctx: &Ctx, args: &[String]) -> Option<String> {
    let home = ctx
        .ports
        .env
        .var("CODEX_HOME")
        .filter(|h| !h.is_empty())
        .or_else(|| {
            ctx.ports
                .env
                .var("HOME")
                .filter(|h| !h.is_empty())
                .map(|h| join(&h, ".codex"))
        })?;
    let read = |p: &str| -> Option<String> {
        let text = ctx.ports.fs.read_to_string(p).ok()??;
        parse_developer_instructions(&text)
    };
    let base = read(&join(&home, "config.toml"));
    match codex_profile(args) {
        None => base,
        Some(profile) => read(&join(&home, &format!("{profile}.config.toml"))).or(base),
    }
}

/// `AgentCommandUseCase`
pub fn launch_agent(
    ctx: &mut Ctx,
    agent: AgentType,
    task_id: &str,
    args: &[String],
    synthesis_prompt: Option<&str>,
) -> Res<RunOutput> {
    let resolved = resolve_task_id(ctx, task_id)?;
    let show = super::trace::show_task_no_purge(ctx, &resolved)?;
    let system_prompt = build_system_prompt(&show, &resolved, agent);
    let existing = if agent == AgentType::Codex {
        codex_instructions(ctx, args)
    } else {
        None
    };
    let cmd = match synthesis_prompt {
        Some(p) => synthesis_cmd(agent, &system_prompt, p),
        None => interactive_cmd(agent, &system_prompt, args, existing.as_deref()),
    };
    let exit_code = run_process(ctx, &cmd, &resolved)?;
    Ok(RunOutput {
        task_id: resolved,
        exit_code,
        created: false,
    })
}

/// `cmdClaude` / `cmdCodex`: purge, local resolution with the env fallback.
pub fn launch_with_env(
    ctx: &mut Ctx,
    agent: AgentType,
    task_id: Option<&str>,
    args: &[String],
) -> Res<RunOutput> {
    ctx.purge()?;
    let id = crate::resolve::resolve_with_env(ctx, task_id)?;
    launch_agent(ctx, agent, &id, args, None)
}

/// `cmdAgent`
pub fn launch_detected(
    ctx: &mut Ctx,
    task_id: Option<&str>,
    args: &[String],
) -> Res<(RunOutput, AgentType)> {
    let Some(detected) = detect_agent_type(&|n| ctx.ports.env.var(n)) else {
        return fail(
            Code::NoAgentDetected,
            "No AI agent detected in environment. Use 'wl claude' or 'wl codex' explicitly.",
        );
    };
    ctx.purge()?;
    let id = crate::resolve::resolve_with_env(ctx, task_id)?;
    Ok((launch_agent(ctx, detected, &id, args, None)?, detected))
}

/// `resolveAgentFlag`
pub fn resolve_agent_flag(
    ctx: &Ctx,
    claude: bool,
    codex: bool,
    agent: bool,
) -> Res<Option<AgentType>> {
    if [claude, codex, agent].iter().filter(|b| **b).count() > 1 {
        return fail(
            Code::InvalidArgs,
            "Only one of --claude, --codex, --agent can be specified",
        );
    }
    if claude {
        return Ok(Some(AgentType::Claude));
    }
    if codex {
        return Ok(Some(AgentType::Codex));
    }
    if agent {
        return match detect_agent_type(&|n| ctx.ports.env.var(n)) {
            Some(a) => Ok(Some(a)),
            None => fail(
                Code::NoAgentDetected,
                "No AI agent detected in environment. Use --claude or --codex explicitly.",
            ),
        };
    }
    Ok(None)
}

/// Reports a failed agent run.
pub fn report_exit(ctx: &mut Ctx, agent: AgentType, out: &RunOutput) {
    if out.exit_code != 0 {
        let msg = format!(
            "{} exited with code {}",
            agent.display_name(),
            out.exit_code
        );
        ctx.println(&msg);
    }
}

/// Turns a non-zero child status into the status of the command.
pub fn exit_with(code: i32) -> Res<()> {
    if code == 0 {
        Ok(())
    } else {
        Err(Fail::Exit(code))
    }
}
