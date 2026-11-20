//! Critique CLI. `run` is the whole program with its I/O and host injected,
//! so the binary is a few lines and the commands can be exercised without a
//! process.

mod args;
mod commands;
pub mod config;
mod ctx;
pub mod definition;
mod files;
mod format;
pub mod host;
mod ignore;
mod paths;
mod subargs;
pub mod system;

use args::{CliError, Mode, Options, Result};
use ctx::Ctx;
use host::Host;
use std::io::Write;

/// Standard streams of the program.
pub struct Io<'a> {
    /// Standard output.
    pub stdout: &'a mut dyn Write,
    /// Standard error.
    pub stderr: &'a mut dyn Write,
}

fn finish_options(ctx: &Ctx<'_>, o: &mut Options) -> Result<()> {
    let program = ctx.program();
    if o.mode == Mode::Timestamp && o.files.is_empty() && !ctx.host.stdin_is_terminal() {
        o.stdin = true;
    }
    if o.mode == Mode::Timestamp && o.stdin {
        if !o.files.is_empty() {
            return Err(CliError(format!(
                "{program} ts --stdin cannot be combined with file arguments."
            )));
        }
        match o.output {
            args::OutputMode::Inline => {
                return Err(CliError("--inline cannot be used with stdin.".into()));
            }
            args::OutputMode::File(_) => {
                return Err(CliError("-o/--output cannot be used with stdin.".into()));
            }
            args::OutputMode::Stdout => {}
        }
    }
    let exempt = o.mode == Mode::Now
        || (o.mode == Mode::Timestamp && o.stdin)
        || (o.mode == Mode::Status && o.quiet);
    if !exempt
        && o.files.is_empty()
        && !o.git
        && !files::inside_work_tree(ctx)
        && !ctx.has_session()
    {
        return Err(CliError(format!(
            "{program} requires at least one Markdown file, an active agent session, or a Git worktree."
        )));
    }
    Ok(())
}

fn dispatch(ctx: &mut Ctx<'_>, args: &[String]) -> Result<i32> {
    let program = ctx.program();
    let Some(first) = args.first() else {
        ctx.print(&definition::help_for(&[]));
        return Ok(0);
    };
    if args.iter().any(|a| a == "--help" || a == "-h") {
        let path: Vec<&str> = args
            .iter()
            .map(String::as_str)
            .take_while(|a| !a.starts_with('-'))
            .collect();
        ctx.print(&definition::help_for(&path));
        return Ok(0);
    }
    if first == "completions" {
        let Some(shell) = args
            .get(1)
            .and_then(|s| <clap_complete::Shell as clap::ValueEnum>::from_str(s, true).ok())
        else {
            return Err(CliError(
                "completions expects a shell: bash, elvish, fish, powershell or zsh.".into(),
            ));
        };
        ctx.print(&definition::completions(shell));
        return Ok(0);
    }
    if first == "--version" || first == "-V" {
        ctx.print(&format!("{program} {}\n", env!("CARGO_PKG_VERSION")));
        return Ok(0);
    }
    if first == "session" || first == "agent" {
        let Some(sub) = args.get(1) else {
            return Err(CliError(format!(
                "{program} {first}: a subcommand is required."
            )));
        };
        if !commands::session::run(ctx, first, sub, &args[2..])? {
            return Err(CliError(format!(
                "Unknown command \"{sub}\" for {program} {first}."
            )));
        }
        return Ok(0);
    }
    if first == "ref" {
        let Some(sub) = args.get(1) else {
            return Err(CliError(format!(
                "{program} ref: a subcommand is required."
            )));
        };
        if !commands::refs::run(ctx, sub, &args[2..])? {
            return Err(CliError(format!(
                "Unknown command \"{sub}\" for {program} ref."
            )));
        }
        return Ok(0);
    }
    if first == "agent-instructions" {
        let text = dz_cli_support::agent_instructions::agent_instructions(
            dz_cli_support::agent_instructions::Tool::DzReview,
            false,
        );
        // The shared text still uses the historical tool name.
        let text = if config::compat(ctx.host) {
            text.to_string()
        } else {
            text.replace("dz-review", "critique")
        };
        ctx.print(&format!("{}\n", text.trim_matches('\n')));
        return Ok(0);
    }
    if first == "me" {
        return me(ctx, &args[1..]);
    }
    let Some(mode) = Mode::from_name(first) else {
        return Err(CliError(if first == "stats" {
            format!("{program} stats was removed; use {program} status --oneline.")
        } else {
            format!("Unknown command: {first}. Use {program} r {first} to review files.")
        }));
    };
    run_mode(ctx, mode, &args[1..])
}

fn run_mode(ctx: &mut Ctx<'_>, mode: Mode, rest: &[String]) -> Result<i32> {
    let mut options = args::parse_options(mode, rest, ctx.program())?;
    finish_options(ctx, &mut options)?;
    match mode {
        Mode::List | Mode::Diff => commands::list::run(ctx, &options)?,
        Mode::Status => commands::status::run(ctx, &options)?,
        Mode::Now => commands::now::run(ctx, &options)?,
        Mode::Timestamp => commands::timestamp::run(ctx, &options)?,
        Mode::Review => commands::review::run(ctx, &options)?,
    }
    Ok(0)
}

/// `me review|list|diff|status`: human-side aliases of the root commands.
fn me(ctx: &mut Ctx<'_>, args: &[String]) -> Result<i32> {
    let program = ctx.program();
    let Some(sub) = args.first() else {
        return Err(CliError(format!("{program} me: a subcommand is required.")));
    };
    let rest = &args[1..];
    match sub.as_str() {
        "review" | "r" => run_mode(ctx, Mode::Review, rest),
        "list" | "ls" | "l" => run_mode(ctx, Mode::List, rest),
        "diff" | "d" => run_mode(ctx, Mode::Diff, rest),
        "status" => {
            let json = rest.iter().any(|a| a == "--json");
            let others: Vec<String> = rest.iter().filter(|a| *a != "--json").cloned().collect();
            let has_options = others.iter().any(|a| a.starts_with('-'));
            let files: Vec<String> = others
                .iter()
                .filter(|a| !a.starts_with('-'))
                .cloned()
                .collect();
            if json || (files.is_empty() && !has_options && ctx.has_session()) {
                commands::session::me_status(ctx, &files, json)?;
                return Ok(0);
            }
            run_mode(ctx, Mode::Status, &others)
        }
        other => Err(CliError(format!(
            "Unknown command \"{other}\" for {program} me."
        ))),
    }
}

/// Runs the CLI and returns its exit status: 0 on success, 1 on failure
/// (`error: invalid_args` plus the message on stderr).
pub fn run(args: Vec<String>, io: &mut Io<'_>, host: &mut dyn Host) -> i32 {
    let (global, rest) = match args::split_global(&args) {
        Ok(v) => v,
        Err(e) => return report(io, host, &e),
    };
    if let Some(dir) = &global.cwd
        && let Err(e) = host.chdir(std::path::Path::new(dir))
    {
        return report(io, host, &e.into());
    }
    let settings = config::Settings {
        state_dir_option: global.state_dir,
        ignore_file_option: global.ignore_file,
    };
    let host: &dyn Host = host;
    let mut ctx = Ctx {
        host,
        settings,
        out: io.stdout,
        errw: io.stderr,
    };
    match dispatch(&mut ctx, &rest) {
        Ok(code) => code,
        Err(e) => report_to(ctx.errw, host, &e),
    }
}

fn report(io: &mut Io<'_>, host: &dyn Host, e: &CliError) -> i32 {
    report_to(io.stderr, host, e)
}

fn report_to(w: &mut dyn Write, host: &dyn Host, e: &CliError) -> i32 {
    let header = "error: invalid_args";
    let force = host
        .env("FORCE_COLOR")
        .is_some_and(|v| !v.is_empty() && v != "0");
    let color = force || (host.env("NO_COLOR").is_none() && host.stderr_is_terminal());
    let header = if color {
        format!("\x1b[31m{header}\x1b[0m")
    } else {
        header.to_string()
    };
    let _ = writeln!(w, "{header}\n{}", e.0);
    1
}
