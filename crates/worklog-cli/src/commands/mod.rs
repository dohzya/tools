//! Command handlers. `dispatch` applies the global options, runs the command
//! and renders errors.

mod agent;
mod common;
mod import;
mod list;
mod scopes;
mod task;
mod todo;
mod trace;

use crate::cli::*;
use crate::ctx::{Ctx, DEFAULT_DEPTH_LIMIT, Fail, Res, fail, parse_purge_ttl};
use crate::path::{basename, dirname, resolve};
use crate::resolve::{resolve_across_scopes, resolve_env_across, resolve_task_id};
use common::*;
use list::ListOptions;
use std::io::Write;
use worklog_core::agent::{
    AgentType, CLAUDE_SUBCOMMANDS, build_checkpoint_prompt, detect_agent_type,
};
use worklog_core::error::Code;
use worklog_core::format::*;
use worklog_core::output::*;
use worklog_core::types::{LinkType, TaskStatus};

/// Runs a parsed command line; returns the exit status.
pub fn dispatch(
    cli: Cli,
    out: &mut dyn Write,
    err: &mut dyn Write,
    ports: &crate::ports::Ports,
) -> i32 {
    let Some(command) = cli.command else {
        return 0;
    };
    let json = json_flag(&command);
    let env_task_id = ports.env.var("WORKLOG_TASK_ID").filter(|v| !v.is_empty());
    let depth = ports
        .env
        .var("WORKLOG_DEPTH_LIMIT")
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_DEPTH_LIMIT);
    let mut ctx = Ctx {
        ports,
        out,
        err,
        cwd: ports.env.cwd(),
        wl_dir: ".worklog".to_string(),
        env_task_id,
        purge_ttl_cli: None,
        depth_limit: depth,
        locks: Default::default(),
    };
    match run_command(
        &mut ctx,
        &cli.cwd,
        &cli.worklog_dir,
        &cli.purge_ttl,
        command,
    ) {
        Ok(()) => 0,
        Err(Fail::Wt(e)) => {
            let text = if json { e.to_json() } else { e.to_text() };
            ctx.eprintln(&text);
            1
        }
        Err(Fail::Usage(msg)) => {
            ctx.eprintln(&msg);
            2
        }
        Err(Fail::Exit(code)) => code,
    }
}

fn json_flag(c: &Command) -> bool {
    match c {
        Command::Init(a) => a.json,
        Command::Create(a) => a.json,
        Command::Ready(a) => a.json,
        Command::Start(a) => a.json,
        Command::Run(a) => a.json,
        Command::Claude(a) | Command::Codex(a) | Command::Agent(a) => a.json,
        Command::Update(a) => a.json,
        Command::Trace(a) => a.json,
        Command::Traces(a) => match &a.command {
            Some(TracesCommand::Update(u)) => u.json,
            None => a.json,
        },
        Command::Show(a) => a.json,
        Command::Checkpoint(a) => a.json,
        Command::Done(a) => a.json,
        Command::Cancel(a) => a.json,
        Command::Meta(a) => a.json,
        Command::Link(a) => a.json,
        Command::Tags(a) => match &a.command {
            Some(TagsCommand::Add(t) | TagsCommand::Remove(t)) => t.json,
            Some(TagsCommand::Rename(r)) => r.json,
            None => a.json,
        },
        Command::List(a) => a.json,
        Command::Status(a) | Command::Dash(a) | Command::Dashboard(a) => a.json,
        Command::Summary(a) => a.json,
        Command::Import(a) => a.json,
        Command::Todo(a) => match &a.command {
            Some(TodoCommand::List(i) | TodoCommand::Next(i)) => i.json,
            Some(TodoCommand::Add(t)) => t.json,
            Some(TodoCommand::Set(t)) => t.json,
            None => false,
        },
        Command::AddParent(a) => a.json,
        Command::Scopes(a) => match &a.command {
            Some(ScopesCommand::List(l)) => l.json,
            Some(ScopesCommand::Add(x)) => x.json,
            Some(ScopesCommand::AddParent(x)) => x.json,
            Some(ScopesCommand::Rename(x)) => x.json,
            Some(ScopesCommand::Delete(x)) => x.json,
            Some(ScopesCommand::Assign(x)) => x.json,
            Some(ScopesCommand::Export(x)) => x.json,
            Some(ScopesCommand::SyncWorktrees(x)) => x.json,
            None => a.json,
        },
        Command::AgentInstructions(_) | Command::Completions { .. } => false,
    }
}

/// `applyDirOptions`: `-C` then `--worklog-dir`. Returns whether a worklog
/// directory was given explicitly.
fn apply_dir_options(
    ctx: &mut Ctx,
    cwd: &Option<String>,
    worklog_dir: &Option<String>,
) -> Res<bool> {
    ctx.wl_dir = ".worklog".into();
    if let Some(c) = cwd.as_ref().filter(|c| !c.is_empty()) {
        let target = resolve(&ctx.cwd, c);
        if !ctx.ports.fs.is_dir(&target) {
            return fail(Code::IoError, format!("Failed to change directory: {c}"));
        }
        ctx.cwd = target;
    }
    if let Some(w) = worklog_dir.as_ref().filter(|w| !w.is_empty()) {
        let resolved = resolve(&ctx.cwd, w);
        ctx.cwd = dirname(&resolved);
        ctx.wl_dir = basename(&resolved);
    }
    Ok(worklog_dir.as_ref().is_some_and(|w| !w.is_empty()))
}

fn palette(ctx: &Ctx) -> Palette {
    let env = &ctx.ports.env;
    let no_color = env.var("NO_COLOR").is_some_and(|v| !v.is_empty());
    let force = env.var("FORCE_COLOR").is_some_and(|v| !v.is_empty());
    Palette::new(!no_color && (force || env.stdout_is_terminal()))
}

/// Cliffy reports a missing required argument as a usage error.
fn require_usage(ctx: &Ctx, name: &str, missing: bool) -> Res<()> {
    if missing && !ctx.has_env_task_id() {
        return Err(Fail::Usage(format!("error: Missing argument(s): {name}")));
    }
    Ok(())
}

fn run_command(
    ctx: &mut Ctx,
    cwd: &Option<String>,
    worklog_dir: &Option<String>,
    purge_ttl: &Option<String>,
    command: Command,
) -> Res<()> {
    if let Command::AgentInstructions(a) = &command {
        let text = dz_cli_support::agent_instructions::agent_instructions(
            dz_cli_support::agent_instructions::Tool::Worklog,
            a.mandatory,
        );
        ctx.println(text);
        return Ok(());
    }
    if let Command::Completions { shell } = &command {
        let mut cmd = <Cli as clap::CommandFactory>::command();
        let mut buf = Vec::new();
        clap_complete::generate(*shell, &mut cmd, "worklog", &mut buf);
        let _ = ctx.out.write_all(&buf);
        return Ok(());
    }
    if let Some(v) = purge_ttl {
        let n: f64 = v.trim().parse().unwrap_or(f64::NAN);
        if v.trim().is_empty() || n.is_nan() {
            return Err(Fail::Usage(format!(
                "error: Option \"--purge-ttl\" must be of type \"number\", but got \"{v}\"."
            )));
        }
        ctx.purge_ttl_cli = Some(parse_purge_ttl(v, "--purge-ttl")?);
    }
    let explicit = apply_dir_options(ctx, cwd, worklog_dir)?;
    ctx.lock_worklog()?;
    let pal = palette(ctx);
    match command {
        Command::Init(a) => task::init(ctx, a.json, &pal),
        Command::Create(a) => create(ctx, a, explicit, &pal),
        Command::Ready(a) => {
            let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
            let id = resolve_or_pick(ctx, a.task_id.as_deref(), a.scope.as_deref(), &root)?;
            ctx.purge()?;
            let id = resolve_task_id(ctx, &id)?;
            let out = task::ready(ctx, &id)?;
            emit(ctx, a.json, &out, || format_status(&out, &pal));
            Ok(())
        }
        Command::Start(a) => start(ctx, a, explicit, &pal),
        Command::Run(a) => run(ctx, a, explicit),
        Command::Claude(a) => agent_cmd(ctx, a, explicit, Some(AgentType::Claude)),
        Command::Codex(a) => agent_cmd(ctx, a, explicit, Some(AgentType::Codex)),
        Command::Agent(a) => agent_cmd(ctx, a, explicit, None),
        Command::AgentInstructions(_) | Command::Completions { .. } => Ok(()),
        Command::Update(a) => update(ctx, a, explicit, &pal),
        Command::Trace(a) => trace_cmd(ctx, a, explicit),
        Command::Traces(a) => traces(ctx, a, explicit, &pal),
        Command::Show(a) => show(ctx, a, explicit, &pal),
        Command::Checkpoint(a) => checkpoint(ctx, a, explicit, &pal),
        Command::Done(a) => done(ctx, a, explicit, &pal),
        Command::Cancel(a) => cancel(ctx, a, explicit, &pal),
        Command::Meta(a) => meta(ctx, a, explicit),
        Command::Link(a) => link(ctx, a, explicit),
        Command::Tags(a) => tags(ctx, a, explicit),
        Command::List(a) => list_cmd(ctx, a, explicit, &pal),
        Command::Status(a) | Command::Dash(a) | Command::Dashboard(a) => dashboard(ctx, a, &pal),
        Command::Summary(a) => {
            let out = list::summary(ctx, a.since.as_deref())?;
            emit(ctx, a.json, &out, || format_summary(&out));
            Ok(())
        }
        Command::Import(a) => import_cmd(ctx, a),
        Command::Todo(a) => todo_cmd(ctx, a, explicit, &pal),
        Command::AddParent(a) => add_parent(ctx, a, &pal),
        Command::Scopes(a) => scopes_cmd(ctx, a, &pal),
    }
}

fn resolve_or_pick(
    ctx: &mut Ctx,
    id: Option<&str>,
    scope: Option<&str>,
    root: &Option<String>,
) -> Res<String> {
    let git = root_for_ids(scope, root);
    if id.is_some() || ctx.env_task_id.is_some() {
        return resolve_env_across(ctx, id, git);
    }
    if list::can_select_interactively(ctx, id) {
        return list::select_task_interactively(ctx, git);
    }
    resolve_env_across(ctx, id, git)
}

fn run_with_cwd_restored<T>(ctx: &mut Ctx, f: impl FnOnce(&mut Ctx) -> Res<T>) -> Res<T> {
    let target = ctx.cwd.clone();
    let r = f(ctx);
    ctx.cwd = target;
    r
}

// ---- create ------------------------------------------------------------

fn create(ctx: &mut Ctx, a: CreateArgs, explicit: bool, _pal: &Palette) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let agent_type = agent::resolve_agent_flag(ctx, a.claude, a.codex, a.agent)?;
    let modes = [
        a.desc.is_some(),
        !a.desc_part.is_empty(),
        !a.desc_src.is_empty(),
        a.desc_from_clipboard,
    ]
    .iter()
    .filter(|b| **b)
    .count();
    if modes > 1 {
        return fail(
            Code::InvalidArgs,
            "Cannot specify both positional desc, --desc, --desc-src, or --desc-from-clipboard",
        );
    }
    let mut desc = a
        .desc
        .iter()
        .filter(|d| !d.is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if !a.desc_part.is_empty() {
        desc = desc_parts(&a.desc_part);
    } else if !a.desc_src.is_empty() {
        desc = desc_src_parts(ctx, &a.desc_src)?;
    } else if a.desc_from_clipboard {
        let c = read_clipboard(ctx)?;
        desc = if c.is_empty() { vec![] } else { vec![c] };
    }
    if a.ready && a.started {
        return fail(
            Code::InvalidArgs,
            "Cannot specify both --ready and --started flags",
        );
    }
    let status = if a.ready {
        TaskStatus::Ready
    } else if a.started {
        TaskStatus::Started
    } else {
        TaskStatus::Created
    };
    let mut timestamp: Option<String> = None;
    if let Some(t) = a.timestamp.as_ref().filter(|t| !t.is_empty()) {
        let mut v = flexible_timestamp(ctx, t)?;
        if !worklog_core::time::has_tz_suffix(&v) {
            let off = ctx
                .ports
                .clock
                .local_offset_minutes(ctx.ports.clock.now_ms());
            v.push_str(&worklog_core::time::offset_text(off));
        }
        timestamp = Some(v);
    }
    let mut parent_id = None;
    if let Some(p) = a.parent.as_ref().filter(|p| !p.is_empty()) {
        parent_id = Some(run_with_cwd_restored(ctx, |ctx| {
            let id = resolve_env_across(ctx, Some(p), root.as_deref())?;
            let index = ctx.load_index()?;
            if !index.contains(&id) {
                return fail(Code::TaskNotFound, format!("Parent task not found: {p}"));
            }
            Ok(id)
        })?);
    }
    let mut requested: Vec<(LinkType, String)> = Vec::new();
    requested.extend(
        a.depends_on
            .iter()
            .map(|t| (LinkType::DependsOn, t.clone())),
    );
    requested.extend(a.blocks.iter().map(|t| (LinkType::Blocks, t.clone())));
    requested.extend(a.related.iter().map(|t| (LinkType::Related, t.clone())));
    let mut links: Vec<(LinkType, String)> = Vec::new();
    if !requested.is_empty() {
        let git = root_for_ids(a.scope.as_deref(), &root).map(str::to_string);
        links = run_with_cwd_restored(ctx, |ctx| {
            let mut out = Vec::new();
            for (ty, t) in &requested {
                out.push((*ty, resolve_across_scopes(ctx, t, git.as_deref())?));
            }
            Ok(out)
        })?;
    }
    let metadata = parse_meta_option(&a.meta);
    let out = task::add_task(
        ctx,
        task::NewTask {
            name: a.name.clone(),
            desc,
            status,
            todos: a.todo.clone(),
            metadata,
            tags: a.tag.clone(),
            timestamp,
            parent: parent_id,
        },
    )?;
    let created = resolve_task_id(ctx, &out.id)?;
    for (ty, target) in links {
        task::link(ctx, &created, ty, &target)?;
    }
    emit(ctx, a.json, &out, || out.id.clone());
    if let Some(at) = agent_type {
        let res = agent::launch_with_env(ctx, at, Some(&out.id), &a.agent_args)?;
        agent::report_exit(ctx, at, &res);
    }
    Ok(())
}

// ---- start / update ----------------------------------------------------

fn start(ctx: &mut Ctx, a: StartArgs, explicit: bool, pal: &Palette) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let id = resolve_or_pick(ctx, a.task_id.as_deref(), a.scope.as_deref(), &root)?;
    if !a.desc.is_empty() && !a.append_desc.is_empty() {
        return fail(
            Code::InvalidArgs,
            "Cannot specify both --desc and --append-desc",
        );
    }
    ctx.purge()?;
    let rid = resolve_task_id(ctx, &id)?;
    let mut out = task::start(ctx, &rid)?;
    let name = a.name.clone();
    if name.is_some() || !a.desc.is_empty() || !a.append_desc.is_empty() {
        out = task::update_task(
            ctx,
            &rid,
            name.as_deref(),
            (!a.desc.is_empty()).then(|| desc_parts(&a.desc)),
            (!a.append_desc.is_empty()).then(|| desc_parts(&a.append_desc)),
        )?;
    }
    emit(ctx, a.json, &out, || format_status(&out, pal));
    Ok(())
}

fn update(ctx: &mut Ctx, a: UpdateArgs, explicit: bool, pal: &Palette) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    require_usage(ctx, "taskId", a.task_id.is_none())?;
    let replace_modes = [
        !a.desc.is_empty(),
        !a.desc_src.is_empty(),
        a.desc_from_clipboard,
    ]
    .iter()
    .filter(|b| **b)
    .count();
    let append_modes = [
        !a.append_desc.is_empty(),
        !a.append_desc_src.is_empty(),
        a.append_desc_from_clipboard,
    ]
    .iter()
    .filter(|b| **b)
    .count();
    if replace_modes > 1 {
        return fail(
            Code::InvalidArgs,
            "Cannot specify both --desc, --desc-src, or --desc-from-clipboard",
        );
    }
    if append_modes > 1 {
        return fail(
            Code::InvalidArgs,
            "Cannot specify both --append-desc, --append-desc-src, or --append-desc-from-clipboard",
        );
    }
    if replace_modes > 0 && append_modes > 0 {
        return fail(
            Code::InvalidArgs,
            "Cannot specify both replacement and append description options",
        );
    }
    let clip = |ctx: &Ctx| -> Res<Vec<String>> {
        let c = read_clipboard(ctx)?;
        Ok(if c.is_empty() { vec![] } else { vec![c] })
    };
    let desc = if !a.desc_src.is_empty() {
        Some(desc_src_parts(ctx, &a.desc_src)?)
    } else if a.desc_from_clipboard {
        Some(clip(ctx)?)
    } else if !a.desc.is_empty() {
        Some(desc_parts(&a.desc))
    } else {
        None
    };
    let append = if !a.append_desc_src.is_empty() {
        Some(desc_src_parts(ctx, &a.append_desc_src)?)
    } else if a.append_desc_from_clipboard {
        Some(clip(ctx)?)
    } else if !a.append_desc.is_empty() {
        Some(desc_parts(&a.append_desc))
    } else {
        None
    };
    let id = resolve_env_across(
        ctx,
        a.task_id.as_deref(),
        root_for_ids(a.scope.as_deref(), &root),
    )?;
    let out = task::update_task(ctx, &id, a.name.as_deref(), desc, append)?;
    emit(ctx, a.json, &out, || format_status(&out, pal));
    Ok(())
}

// ---- trace / traces / show ---------------------------------------------

fn trace_cmd(ctx: &mut Ctx, a: TraceArgs, explicit: bool) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    require_usage(
        ctx,
        "taskId, message",
        a.task_id.is_none() || a.message.is_none(),
    )?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    let (id, message);
    if ctx.has_env_task_id() && a.message.as_deref().is_none_or(str::is_empty) {
        let Some(m) = a.task_id.clone().filter(|m| !m.is_empty()) else {
            return fail(Code::InvalidArgs, "message is required");
        };
        message = m;
        id = resolve_env_across(ctx, None, git)?;
    } else {
        let (Some(t), Some(m)) = (
            a.task_id.clone().filter(|m| !m.is_empty()),
            a.message.clone().filter(|m| !m.is_empty()),
        ) else {
            return fail(
                Code::InvalidArgs,
                "taskId and message are required (or set WORKLOG_TASK_ID)",
            );
        };
        id = resolve_across_scopes(ctx, &t, git)?;
        message = m;
    }
    let timestamp = match a.timestamp.as_ref().filter(|t| !t.is_empty()) {
        Some(t) => Some(flexible_timestamp(ctx, t)?),
        None => None,
    };
    let kind = match a.kind.as_ref().filter(|k| !k.is_empty()) {
        Some(k) => Some(parse_trace_kind(k)?),
        None => None,
    };
    let out = trace::add_trace(ctx, &id, &message, kind, timestamp.as_deref(), a.force)?;
    emit(ctx, a.json, &out, || format_trace(&out));
    Ok(())
}

fn traces(ctx: &mut Ctx, a: TracesArgs, explicit: bool, pal: &Palette) -> Res<()> {
    if let Some(TracesCommand::Update(u)) = a.command {
        return traces_update(ctx, u, explicit);
    }
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    require_usage(ctx, "taskId", a.task_id.is_none())?;
    let id = resolve_env_across(
        ctx,
        a.task_id.as_deref(),
        root_for_ids(a.scope.as_deref(), &root),
    )?;
    let kinds = parse_trace_kind_list(a.kind.as_deref())?;
    let excluded = parse_trace_kind_list(a.exclude_kind.as_deref())?;
    let out = trace::list_traces(ctx, &id, &kinds, &excluded)?;
    emit(ctx, a.json, &out, || format_traces(&out, pal));
    Ok(())
}

fn traces_update(ctx: &mut Ctx, a: TracesUpdateArgs, explicit: bool) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    require_usage(
        ctx,
        "taskId, traceId",
        a.task_id.is_none() || a.trace_id.is_none(),
    )?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    let (id, trace_id);
    if ctx.has_env_task_id() && a.trace_id.is_none() {
        let Some(t) = a.task_id.clone() else {
            return fail(Code::InvalidArgs, "traceId is required");
        };
        trace_id = t;
        id = resolve_env_across(ctx, None, git)?;
    } else {
        let (Some(t), Some(tr)) = (a.task_id.clone(), a.trace_id.clone()) else {
            return fail(
                Code::InvalidArgs,
                "taskId and traceId are required (or set WORKLOG_TASK_ID)",
            );
        };
        id = resolve_across_scopes(ctx, &t, git)?;
        trace_id = tr;
    }
    let kind = match a.kind.as_ref().filter(|k| !k.is_empty()) {
        Some(k) => Some(parse_trace_kind(k)?),
        None => None,
    };
    let out = trace::update_trace(ctx, &id, &trace_id, kind)?;
    emit(ctx, a.json, &out, || {
        format_status(&out, &Palette::new(false))
    });
    Ok(())
}

fn show(ctx: &mut Ctx, a: ShowArgs, explicit: bool, pal: &Palette) -> Res<()> {
    if a.quiet && a.task_id.is_none() && ctx.env_task_id.is_none() {
        return Ok(());
    }
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let id = resolve_or_pick(ctx, a.task_id.as_deref(), a.scope.as_deref(), &root)?;
    let git = ctx.ports.git.root(&ctx.cwd);
    let out = trace::show_task(ctx, &id, a.active, git.as_deref())?;
    emit(ctx, a.json, &out, || format_show(&out, pal));
    Ok(())
}

// ---- checkpoint / done / cancel ----------------------------------------

fn agent_synthesis(ctx: &mut Ctx, at: AgentType, id: &str, prompt: &str) -> Res<RunOutput> {
    agent::launch_agent(ctx, at, id, &[], Some(prompt))
}

fn checkpoint(ctx: &mut Ctx, a: CheckpointArgs, explicit: bool, pal: &Palette) -> Res<()> {
    if a.quiet && a.task_id.is_none() && ctx.env_task_id.is_none() {
        return Ok(());
    }
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    if let Some(at) = agent::resolve_agent_flag(ctx, a.claude, a.codex, a.agent)? {
        let id = resolve_env_across(ctx, a.task_id.as_deref(), git)?;
        let show = trace::show_task(ctx, &id, false, ctx.ports.git.root(&ctx.cwd).as_deref())?;
        if show.entries_since_checkpoint.is_empty() {
            return fail(
                Code::NoUncheckpointedEntries,
                "No uncheckpointed entries. Nothing to checkpoint.",
            );
        }
        let prompt = build_checkpoint_prompt(&id, &show, false);
        let res = agent_synthesis(ctx, at, &id, &prompt)?;
        agent::report_exit(ctx, at, &res);
        return Ok(());
    }
    let usage = if ctx.has_env_task_id() {
        "Usage: wl checkpoint [taskId] <changes> <learnings>"
    } else {
        "Usage: wl checkpoint <taskId> <changes> <learnings>"
    };
    let (id, changes, learnings);
    let nonempty = |o: &Option<String>| o.as_deref().is_some_and(|s| !s.is_empty());
    if ctx.has_env_task_id()
        && nonempty(&a.task_id)
        && nonempty(&a.changes)
        && !nonempty(&a.learnings)
    {
        id = resolve_env_across(ctx, None, git)?;
        changes = a.task_id.clone().unwrap_or_default();
        learnings = a.changes.clone().unwrap_or_default();
    } else if ctx.has_env_task_id() && !nonempty(&a.task_id) {
        return fail(Code::InvalidArgs, usage);
    } else {
        if !(nonempty(&a.task_id) && nonempty(&a.changes) && nonempty(&a.learnings)) {
            return fail(Code::InvalidArgs, usage);
        }
        id = resolve_across_scopes(ctx, a.task_id.as_deref().unwrap_or_default(), git)?;
        changes = a.changes.clone().unwrap_or_default();
        learnings = a.learnings.clone().unwrap_or_default();
    }
    let out = trace::checkpoint(ctx, &id, &changes, &learnings, a.force)?;
    emit(ctx, a.json, &out, || format_status(&out, pal));
    Ok(())
}

fn done(ctx: &mut Ctx, a: DoneArgs, explicit: bool, pal: &Palette) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    require_usage(ctx, "taskId", a.task_id.is_none())?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    let agent_type = agent::resolve_agent_flag(ctx, a.claude, a.codex, a.agent)?;
    let mut agent_id: Option<String> = None;
    if let Some(at) = agent_type {
        let id = resolve_env_across(ctx, a.task_id.as_deref(), git)?;
        let show = trace::show_task(ctx, &id, false, ctx.ports.git.root(&ctx.cwd).as_deref())?;
        if !show.entries_since_checkpoint.is_empty() {
            let prompt = build_checkpoint_prompt(&id, &show, true);
            let res = agent_synthesis(ctx, at, &id, &prompt)?;
            agent::report_exit(ctx, at, &res);
            return Ok(());
        }
        ctx.eprintln("No uncheckpointed entries — skipping agent synthesis.");
        agent_id = Some(id);
    }
    let (id, changes, learnings);
    if let Some(i) = agent_id {
        id = i;
        changes = a.changes.clone();
        learnings = a.learnings.clone();
    } else if ctx.has_env_task_id() && a.learnings.as_deref().is_none_or(str::is_empty) {
        id = resolve_env_across(ctx, None, git)?;
        changes = a.task_id.clone();
        learnings = a.changes.clone();
    } else {
        let Some(t) = a.task_id.clone().filter(|t| !t.is_empty()) else {
            return fail(
                Code::InvalidArgs,
                "taskId is required (or set WORKLOG_TASK_ID)",
            );
        };
        id = resolve_across_scopes(ctx, &t, git)?;
        changes = a.changes.clone();
        learnings = a.learnings.clone();
    }
    let meta = parse_meta_option(&a.meta);
    let out = task::done(
        ctx,
        &id,
        changes.as_deref(),
        learnings.as_deref(),
        a.force,
        meta,
    )?;
    emit(ctx, a.json, &out, || format_status(&out, pal));
    Ok(())
}

fn cancel(ctx: &mut Ctx, a: CancelArgs, explicit: bool, pal: &Palette) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let (id, reason);
    if a.reason.as_deref().is_none_or(str::is_empty) && a.task_id.is_some() && ctx.has_env_task_id()
    {
        reason = a.task_id.clone();
        id = resolve_env_across(ctx, None, root_for_ids(a.scope.as_deref(), &root))?;
    } else {
        id = resolve_or_pick(ctx, a.task_id.as_deref(), a.scope.as_deref(), &root)?;
        reason = a.reason.clone();
    }
    let out = task::cancel(ctx, &id, reason.as_deref())?;
    emit(ctx, a.json, &out, || format_status(&out, pal));
    Ok(())
}

// ---- meta / link / tags -------------------------------------------------

fn meta(ctx: &mut Ctx, a: MetaArgs, explicit: bool) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    require_usage(ctx, "taskId", a.task_id.is_none())?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    let (id, key, value);
    if ctx.has_env_task_id() && a.task_id.is_some() && a.value.is_none() {
        id = resolve_env_across(ctx, None, git)?;
        key = a.task_id.clone();
        value = a.key.clone();
    } else {
        id = resolve_env_across(ctx, a.task_id.as_deref(), git)?;
        key = a.key.clone();
        value = a.value.clone();
    }
    let mut parent = None;
    if let Some(p) = a.parent.as_ref().filter(|p| !p.is_empty()) {
        parent = Some(run_with_cwd_restored(ctx, |ctx| {
            resolve_env_across(ctx, Some(p), git)
        })?);
    }
    ctx.purge()?;
    let id = resolve_task_id(ctx, &id)?;
    let out = task::update_meta(
        ctx,
        &id,
        key.as_deref(),
        value.as_deref(),
        a.delete.as_deref(),
        parent.as_deref(),
        a.detach,
        a.force,
    )?;
    emit(ctx, a.json, &out, || task::meta_text(&out));
    Ok(())
}

fn link(ctx: &mut Ctx, a: LinkArgs, explicit: bool) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let ty = task::parse_link_type(&a.link_type)?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    let (s, t) = run_with_cwd_restored(ctx, |ctx| {
        let s = resolve_across_scopes(ctx, &a.source, git)?;
        let t = resolve_across_scopes(ctx, &a.target, git)?;
        Ok((s, t))
    })?;
    let out = task::link(ctx, &s, ty, &t)?;
    emit(ctx, a.json, &out, || task::link_text(&out));
    Ok(())
}

fn tags_text(out: &todo::TagsOutput) -> Option<String> {
    if let Some(all) = &out.all_tags {
        if all.is_empty() {
            return Some("No tags found".into());
        }
        let mut lines = vec!["Available tags:".to_string()];
        for t in all {
            lines.push(format!(
                "  {} ({} {})",
                t.tag,
                t.count,
                if t.count == 1 { "task" } else { "tasks" }
            ));
        }
        return Some(lines.join("\n"));
    }
    out.tags.as_ref().map(|t| {
        if t.is_empty() {
            "(no tags)".to_string()
        } else {
            t.iter()
                .map(|x| format!("#{x}"))
                .collect::<Vec<_>>()
                .join(" ")
        }
    })
}

fn tags(ctx: &mut Ctx, a: TagsArgs, explicit: bool) -> Res<()> {
    match a.command {
        Some(TagsCommand::Rename(r)) => {
            let out = todo::rename_tag(ctx, &r.old_tag, &r.new_tag)?;
            emit(ctx, r.json, &out, || {
                if out.status == "tag_not_found" {
                    format!("Tag '#{}' not found", out.old_tag)
                } else {
                    format!(
                        "Renamed '#{}' → '#{}' ({} {} updated)",
                        out.old_tag,
                        out.new_tag,
                        out.updated_count,
                        if out.updated_count == 1 {
                            "task"
                        } else {
                            "tasks"
                        }
                    )
                }
            });
            Ok(())
        }
        Some(TagsCommand::Add(t)) => tag_one(ctx, t, explicit, true),
        Some(TagsCommand::Remove(t)) => tag_one(ctx, t, explicit, false),
        None => {
            let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
            let id = match a.task_id.as_deref() {
                Some(t) => Some(resolve_across_scopes(
                    ctx,
                    t,
                    root_for_ids(a.scope.as_deref(), &root),
                )?),
                None => None,
            };
            let cwd = ctx.cwd.clone();
            let eff = root.clone().or_else(|| ctx.ports.git.root(&cwd));
            let out =
                todo::manage_tags(ctx, id.as_deref(), &a.add, &a.remove, eff.as_deref(), &cwd)?;
            emit(ctx, a.json, &out, || tags_text(&out).unwrap_or_default());
            Ok(())
        }
    }
}

fn tag_one(ctx: &mut Ctx, t: TagTaskArgs, explicit: bool, add: bool) -> Res<()> {
    let (_, root) = scope_context(ctx, t.scope.as_deref(), explicit)?;
    let id = resolve_across_scopes(ctx, &t.task_id, root_for_ids(t.scope.as_deref(), &root))?;
    let cwd = ctx.cwd.clone();
    let eff = root.clone().or_else(|| ctx.ports.git.root(&cwd));
    let (adds, removes) = if add {
        (vec![t.tag.clone()], vec![])
    } else {
        (vec![], vec![t.tag.clone()])
    };
    let out = todo::manage_tags(ctx, Some(&id), &adds, &removes, eff.as_deref(), &cwd)?;
    if t.json {
        ctx.println(&to_json(&out));
    } else if let Some(text) = tags_text(&out) {
        ctx.println(&text);
    }
    Ok(())
}

// ---- list / dashboard ---------------------------------------------------

fn list_cmd(ctx: &mut Ctx, a: ListArgs, explicit: bool, pal: &Palette) -> Res<()> {
    let mut status_filters: Vec<TaskStatus> = Vec::new();
    for (flag, s) in [
        (a.created, TaskStatus::Created),
        (a.ready, TaskStatus::Ready),
        (a.started, TaskStatus::Started),
        (a.done, TaskStatus::Done),
        (a.cancelled, TaskStatus::Cancelled),
    ] {
        if flag {
            status_filters.push(s);
        }
    }
    let mut parent_filter = None;
    if let Some(p) = a.parent.as_ref().filter(|p| !p.is_empty()) {
        let root = ctx.ports.git.root(&ctx.cwd);
        parent_filter = Some(resolve_env_across(ctx, Some(p), root.as_deref())?);
    }
    let inputs: Vec<(Option<LinkType>, &String)> = [
        a.depends_on
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(|s| (Some(LinkType::DependsOn), s)),
        a.blocks
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(|s| (Some(LinkType::Blocks), s)),
        a.related_to
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(|s| (Some(LinkType::Related), s)),
        a.linked_to
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(|s| (None, s)),
    ]
    .into_iter()
    .flatten()
    .collect();
    if inputs.len() > 1 {
        return fail(
            Code::InvalidArgs,
            "Use only one link filter: --depends-on, --blocks, --related-to, or --linked-to",
        );
    }
    let mut link_filter = None;
    if let Some((ty, id)) = inputs.first() {
        let root = ctx.ports.git.root(&ctx.cwd);
        link_filter = Some((resolve_env_across(ctx, Some(id), root.as_deref())?, *ty));
    }
    let mut opts = ListOptions {
        show_all: a.all,
        filter_pattern: a.pattern.clone(),
        status_filters: (!status_filters.is_empty()).then_some(status_filters),
        show_subtasks: a.subtasks,
        show_subtasks_of_started: a.subtasks_of_started,
        parent_filter,
        link_filter,
        include_blocked: a.include_blocked,
        ..Default::default()
    };
    if explicit {
        if a.scope.is_some() {
            return fail(Code::InvalidArgs, "Cannot use --scope with --worklog-dir");
        }
        if a.all_scopes {
            return fail(
                Code::InvalidArgs,
                "Cannot use --all-scopes with --worklog-dir",
            );
        }
        if a.path.is_some() {
            return fail(Code::InvalidArgs, "Cannot use --path with --worklog-dir");
        }
        opts.base_dir = Some(ctx.wl_dir.clone());
        opts.cwd = Some(ctx.cwd.clone());
        let out = list_tasks_cmd(ctx, &opts)?;
        return emit_list(ctx, &out, &a, pal);
    }
    let cwd = ctx.cwd.clone();
    let git_root = ctx.ports.git.root(&cwd);
    let mut current_scope = None;
    if a.scope.is_none() && !a.all_scopes && git_root.is_some() {
        current_scope =
            crate::scope::resolve_active_scope(ctx, &cwd, None, git_root.as_deref()).ok();
    }
    opts.base_dir = a.path.clone();
    opts.scope_identifier = a.scope.clone();
    opts.all_scopes = a.all_scopes;
    opts.git_root = git_root;
    opts.current_scope = current_scope;
    opts.cwd = Some(cwd);
    let out = list_tasks_cmd(ctx, &opts)?;
    emit_list(ctx, &out, &a, pal)
}

fn list_tasks_cmd(ctx: &mut Ctx, opts: &ListOptions) -> Res<ListOutput> {
    // Reading another worklog (`--path`, `--worklog-dir`) never purges.
    if opts.base_dir.is_none() {
        ctx.purge()?;
    }
    list::list_tasks(ctx, opts)
}

fn emit_list(ctx: &mut Ctx, out: &ListOutput, a: &ListArgs, pal: &Palette) -> Res<()> {
    let text = if a.json {
        to_json(out)
    } else {
        format_list(out, a.all, pal, !a.no_header, ctx.ports.clock.as_ref())
    };
    let use_pager = if a.json {
        false
    } else if a.pager || a.no_pager {
        a.pager && !a.no_pager
    } else if ctx.ports.env.var("NO_PAGER").is_some_and(|v| !v.is_empty()) {
        false
    } else if ctx
        .ports
        .env
        .var("FORCE_PAGER")
        .is_some_and(|v| !v.is_empty() && v != "0")
    {
        true
    } else {
        ctx.ports.env.stdout_is_terminal()
    };
    if use_pager {
        let pager = ctx
            .ports
            .env
            .var("PAGER")
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "less".into());
        return ctx
            .ports
            .proc_
            .page(&pager, &format!("{text}\n"))
            .or_else(|e| fail(Code::IoError, e));
    }
    ctx.println(&text);
    Ok(())
}

fn dashboard(ctx: &mut Ctx, a: DashArgs, pal: &Palette) -> Res<()> {
    let r = (|| -> Res<()> {
        let cwd = ctx.cwd.clone();
        let git_root = ctx.ports.git.root(&cwd);
        let current_scope = git_root
            .as_deref()
            .and_then(|r| crate::scope::resolve_active_scope(ctx, &cwd, None, Some(r)).ok());
        let limit = match a.limit.as_ref() {
            None => None,
            Some(l) => {
                let n: f64 = l.trim().parse().unwrap_or(f64::NAN);
                if n.is_nan() {
                    return Err(Fail::Usage(format!(
                        "error: Option \"--limit\" must be of type \"number\", but got \"{l}\"."
                    )));
                }
                if n.fract() != 0.0 || n < 1.0 {
                    return fail(Code::InvalidArgs, "--limit must be a positive integer");
                }
                Some(n as usize)
            }
        };
        ctx.purge()?;
        let opts = ListOptions {
            git_root,
            current_scope,
            cwd: Some(cwd),
            status_filters: Some(vec![
                TaskStatus::Created,
                TaskStatus::Ready,
                TaskStatus::Started,
            ]),
            show_subtasks: true,
            include_blocked: a.include_blocked,
            include_source_path: true,
            ..Default::default()
        };
        let list = list::list_tasks(ctx, &opts)?;
        let out = list::build_dashboard(ctx, list, limit)?;
        if a.quiet
            && out.tasks.is_empty()
            && out
                .child_worklog
                .as_ref()
                .is_none_or(|c| c.warning.is_none())
        {
            return Ok(());
        }
        emit(ctx, a.json, &out, || format_dashboard(&out, pal));
        Ok(())
    })();
    match r {
        Err(Fail::Wt(e)) if a.quiet && e.code == Code::NotInitialized => Ok(()),
        other => other,
    }
}

// ---- todo ----------------------------------------------------------------

fn todo_cmd(ctx: &mut Ctx, a: TodoArgs, explicit: bool, pal: &Palette) -> Res<()> {
    match a.command {
        None => {
            let mut cmd = <Cli as clap::CommandFactory>::command();
            let help = cmd
                .find_subcommand_mut("todo")
                .map(|c| c.render_help().to_string())
                .unwrap_or_default();
            ctx.println(&help);
            Ok(())
        }
        Some(TodoCommand::List(i)) => {
            let (_, root) = scope_context(ctx, i.scope.as_deref(), explicit)?;
            let id = match i.task_id.as_deref() {
                Some(t) => Some(resolve_across_scopes(
                    ctx,
                    t,
                    root_for_ids(i.scope.as_deref(), &root),
                )?),
                None => None,
            };
            let out = todo::list_todos(ctx, id.as_deref())?;
            emit(ctx, i.json, &out, || format_todo_list(&out.todos));
            Ok(())
        }
        Some(TodoCommand::Add(t)) => {
            let (_, root) = scope_context(ctx, t.scope.as_deref(), explicit)?;
            let id =
                resolve_across_scopes(ctx, &t.task_id, root_for_ids(t.scope.as_deref(), &root))?;
            let out = todo::add_todo(ctx, &id, &t.text.join(" "))?;
            emit(ctx, t.json, &out, || out.id.clone());
            Ok(())
        }
        Some(TodoCommand::Set(t)) => {
            scope_context(ctx, t.scope.as_deref(), explicit)?;
            let mut updates: Vec<(String, String)> = Vec::new();
            let mut todo_id = String::new();
            for arg in &t.args {
                match arg.find('=') {
                    Some(i) if i > 0 => {
                        let (k, v) = (arg[..i].to_string(), arg[i + 1..].to_string());
                        match updates.iter_mut().find(|(ek, _)| *ek == k) {
                            Some(slot) => slot.1 = v,
                            None => updates.push((k, v)),
                        }
                    }
                    _ => todo_id = arg.clone(),
                }
            }
            if todo_id.is_empty() {
                return fail(
                    Code::InvalidArgs,
                    "Missing todo-id in: wl todo set key=value <todo-id>",
                );
            }
            let out = todo::set_todo(ctx, &todo_id, &updates)?;
            emit(ctx, t.json, &out, || format_status(&out, pal));
            Ok(())
        }
        Some(TodoCommand::Next(i)) => {
            let (_, root) = scope_context(ctx, i.scope.as_deref(), explicit)?;
            require_usage(ctx, "taskId", i.task_id.is_none())?;
            let id = resolve_env_across(
                ctx,
                i.task_id.as_deref(),
                root_for_ids(i.scope.as_deref(), &root),
            )?;
            let next = todo::next_todo(ctx, Some(&id))?;
            emit(ctx, i.json, &next, || format_todo_next(next.as_ref()));
            Ok(())
        }
    }
}

// ---- import ----------------------------------------------------------------

fn import_cmd(ctx: &mut Ctx, a: ImportArgs) -> Res<()> {
    let r = (|| -> Res<()> {
        if a.path.is_some() && a.branch.is_some() {
            return fail(Code::InvalidArgs, "Cannot specify both --path and --branch");
        }
        if a.path.is_none() && a.branch.is_none() {
            return fail(Code::InvalidArgs, "Must specify either --path or --branch");
        }
        if a.tag_name.is_some() && !a.scope_to_tag {
            return fail(Code::InvalidArgs, "--tag-name requires --scope-to-tag");
        }
        let source = match &a.branch {
            Some(b) => import::resolve_worktree_path(ctx, b)?,
            None => a.path.clone().unwrap_or_default(),
        };
        if a.scope_to_tag {
            let root = ctx.ports.git.root(&ctx.cwd);
            ctx.auto_init()?;
            let out = import::import_scope_to_tag(
                ctx,
                &source,
                a.rm,
                a.tag_name.as_deref(),
                root.as_deref(),
            )?;
            if a.json {
                ctx.println(&to_json(&out));
            } else {
                ctx.println(&format_import(&out));
                ctx.println(&format!(
                    "\nImported with tag: #{}",
                    out.tag.clone().unwrap_or_default()
                ));
            }
        } else {
            ctx.auto_init()?;
            let out = import::import_tasks(ctx, &source, a.rm)?;
            emit(ctx, a.json, &out, || format_import(&out));
        }
        Ok(())
    })();
    match r {
        Err(Fail::Wt(e))
            if a.allow_missing
                && matches!(e.code, Code::WorktreeNotFound | Code::ImportSourceNotFound) =>
        {
            let empty = ImportOutput {
                imported: 0,
                merged: 0,
                skipped: 0,
                tasks: vec![],
                tag: None,
            };
            emit(ctx, a.json, &empty, || {
                "Source not found, nothing imported.".into()
            });
            Ok(())
        }
        other => other,
    }
}

// ---- scopes --------------------------------------------------------------

fn add_parent(ctx: &mut Ctx, a: AddParentArgs, pal: &Palette) -> Res<()> {
    let out = scopes::add_parent(ctx, &a.path, a.id.as_deref())?;
    emit(ctx, a.json, &out, || format_status(&out, pal));
    Ok(())
}

fn scopes_cmd(ctx: &mut Ctx, a: ScopesArgs, pal: &Palette) -> Res<()> {
    let show_list = |ctx: &mut Ctx, json: bool, refresh: bool, id: Option<&str>| -> Res<()> {
        match scopes::list_or_detail(ctx, refresh, id)? {
            scopes::ListResult::All(o) => emit(ctx, json, &o, || format_scopes(&o)),
            scopes::ListResult::One(d) => emit(ctx, json, &d, || format_scope_detail(&d)),
        }
        Ok(())
    };
    match a.command {
        None => show_list(ctx, a.json, false, None),
        Some(ScopesCommand::List(l)) => show_list(ctx, l.json, l.refresh, l.scope_id.as_deref()),
        Some(ScopesCommand::Add(x)) => {
            let path = x.path.clone().or(x.path_arg.clone());
            if path.is_some() && x.worktree {
                return fail(
                    Code::InvalidArgs,
                    "Cannot use path and --worktree together. Choose one.",
                );
            }
            let out = scopes::add(
                ctx,
                &x.scope_id,
                path.as_deref(),
                x.worktree,
                x.git_ref.as_deref(),
            )?;
            emit(ctx, x.json, &out, || format_status(&out, pal));
            if x.assign {
                let o = scopes::assign_by_tag(ctx, &x.scope_id, &x.scope_id)?;
                emit(ctx, x.json, &o, || format_assign_by_tag(&o));
            }
            Ok(())
        }
        Some(ScopesCommand::AddParent(x)) => add_parent(ctx, x, pal),
        Some(ScopesCommand::Rename(x)) => {
            let out = scopes::rename(ctx, &x.scope_id, &x.new_id)?;
            emit(ctx, x.json, &out, || format_status(&out, pal));
            Ok(())
        }
        Some(ScopesCommand::Delete(x)) => {
            let out = scopes::delete(ctx, &x.scope_id, x.move_to.as_deref(), x.delete_tasks)?;
            emit(ctx, x.json, &out, || format_status(&out, pal));
            Ok(())
        }
        Some(ScopesCommand::Assign(x)) => {
            let (scope, ids) = match x.args.split_first() {
                Some((s, rest)) => (Some(s.clone()), rest.to_vec()),
                None => (None, vec![]),
            };
            if let Some(tag) = x.tag.as_ref().filter(|t| !t.is_empty()) {
                if !ids.is_empty() {
                    return fail(
                        Code::InvalidArgs,
                        "Cannot combine --tag with task ID arguments.",
                    );
                }
                let target = scope.unwrap_or_else(|| tag.clone());
                let out = scopes::assign_by_tag(ctx, &target, tag)?;
                emit(ctx, x.json, &out, || format_assign_by_tag(&out));
            } else {
                let Some(scope) = scope else {
                    return fail(
                        Code::InvalidArgs,
                        "Scope ID is required. Use --tag to assign by tag.",
                    );
                };
                if ids.is_empty() {
                    return fail(
                        Code::InvalidArgs,
                        "Provide at least one task ID, or use --tag to assign by tag.",
                    );
                }
                let out = scopes::assign(ctx, &scope, &ids)?;
                emit(ctx, x.json, &out, || format_assign(&out));
            }
            Ok(())
        }
        Some(ScopesCommand::Export(x)) => {
            let out = scopes::export(
                ctx,
                &x.tag,
                &x.target_path,
                !x.keep_tag,
                x.scope_id.as_deref(),
            )?;
            if x.json {
                ctx.println(&to_json(&out));
            } else {
                ctx.println(&format!(
                    "Exported {} tasks to {}",
                    out.exported, out.target_path
                ));
                ctx.println(&format!("Scope ID: {}", out.scope_id));
            }
            Ok(())
        }
        Some(ScopesCommand::SyncWorktrees(x)) => {
            let out = scopes::sync_worktrees(ctx, x.dry_run)?;
            if x.json {
                ctx.println(&to_json(&out));
            } else {
                for w in &out.warnings {
                    ctx.eprintln(&format!("Warning: {w}"));
                }
                if !out.added.is_empty() {
                    ctx.println(&format!("Added: {}", out.added.join(", ")));
                }
                if !out.removed.is_empty() {
                    ctx.println(&format!("Removed: {}", out.removed.join(", ")));
                }
                if out.added.is_empty() && out.removed.is_empty() && out.warnings.is_empty() {
                    ctx.println("All worktrees are in sync.");
                }
                if x.dry_run {
                    ctx.println("(dry-run mode, no changes made)");
                }
            }
            Ok(())
        }
    }
}

// ---- run / agents ----------------------------------------------------------

fn run(ctx: &mut Ctx, a: RunArgs, explicit: bool) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let git = root_for_ids(a.scope.as_deref(), &root).map(str::to_string);
    let args = a.args.clone();
    let (task_id, cmd): (Option<String>, Vec<String>);
    if a.create.is_some() {
        task_id = None;
        cmd = args;
    } else if ctx.has_env_task_id() {
        if args.is_empty() {
            return fail(Code::InvalidArgs, "No command provided to execute");
        }
        if args.len() >= 2 {
            match resolve_across_scopes(ctx, &args[0], git.as_deref()) {
                Ok(id) => {
                    task_id = Some(id);
                    cmd = args[1..].to_vec();
                }
                Err(Fail::Wt(e)) if e.code == Code::TaskNotFound => {
                    task_id = Some(resolve_env_across(ctx, None, git.as_deref())?);
                    cmd = args;
                }
                Err(e) => return Err(e),
            }
        } else {
            task_id = Some(resolve_env_across(ctx, None, git.as_deref())?);
            cmd = args;
        }
    } else {
        let usage = "Usage: wl run <taskId> <cmd...> OR wl run --create <name> <cmd...>";
        if args.is_empty() {
            return fail(Code::InvalidArgs, usage);
        }
        if args.len() >= 2 {
            match resolve_across_scopes(ctx, &args[0], git.as_deref()) {
                Ok(id) => {
                    task_id = Some(id);
                    cmd = args[1..].to_vec();
                }
                Err(Fail::Wt(e))
                    if e.code == Code::TaskNotFound
                        && list::can_select_interactively(ctx, None) =>
                {
                    task_id = Some(list::select_task_interactively(ctx, git.as_deref())?);
                    cmd = args;
                }
                Err(e) => return Err(e),
            }
        } else if list::can_select_interactively(ctx, None) {
            task_id = Some(list::select_task_interactively(ctx, git.as_deref())?);
            cmd = args;
        } else {
            return fail(Code::InvalidArgs, usage);
        }
    }
    if cmd.is_empty() {
        return fail(Code::InvalidArgs, "No command provided to execute");
    }
    let out = agent::run_command(ctx, &cmd, task_id.as_deref(), a.create.as_deref())?;
    if a.json {
        ctx.println(&to_json(&out));
    } else {
        let prefix = if out.created {
            "Created and ran"
        } else {
            "Ran"
        };
        ctx.println(&format!(
            "{prefix} task {} (exit code: {})",
            out.task_id, out.exit_code
        ));
    }
    agent::exit_with(out.exit_code)
}

fn agent_cmd(ctx: &mut Ctx, a: AgentArgs, explicit: bool, fixed: Option<AgentType>) -> Res<()> {
    let (_, root) = scope_context(ctx, a.scope.as_deref(), explicit)?;
    let git = root_for_ids(a.scope.as_deref(), &root);
    let mut args = a.args.clone();
    let mut first = if args.is_empty() {
        None
    } else {
        Some(args.remove(0))
    };
    // `--` only separates the agent arguments from the task id.
    if first.as_deref() == Some("--") {
        first = None;
    } else if args.first().map(String::as_str) == Some("--") {
        args.remove(0);
    }
    let (mut task_arg, mut rest) = (first.clone(), args);
    if let Some(f) = &first {
        let looks_like_option = f.starts_with('-')
            || (fixed == Some(AgentType::Claude) && CLAUDE_SUBCOMMANDS.contains(&f.as_str()));
        if looks_like_option {
            task_arg = None;
            rest.insert(0, f.clone());
        }
    }
    if fixed == Some(AgentType::Claude)
        && let Some(model) = a.advisor.as_ref().filter(|m| !m.is_empty())
    {
        let mut v = vec!["--advisor".to_string(), model.clone()];
        v.append(&mut rest);
        rest = v;
    }
    let id = match task_arg {
        Some(t) => resolve_across_scopes(ctx, &t, git)?,
        None => resolve_or_pick(ctx, None, a.scope.as_deref(), &root)?,
    };
    let (out, at) = match fixed {
        Some(at) => (agent::launch_with_env(ctx, at, Some(&id), &rest)?, at),
        None => agent::launch_detected(ctx, Some(&id), &rest)?,
    };
    if a.json {
        ctx.println(&to_json(&out));
    } else {
        let name = if fixed.is_some() {
            at.display_name().to_string()
        } else {
            detect_agent_type(&|n| ctx.ports.env.var(n))
                .map_or("Agent".into(), |t| t.display_name().to_string())
        };
        if out.exit_code != 0 {
            ctx.println(&format!("{name} exited with code {}", out.exit_code));
        }
    }
    Ok(())
}
