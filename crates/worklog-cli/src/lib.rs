//! Worklog CLI: command handlers, git scopes and agent launchers over
//! `worklog-core`. `run` is the whole program with its I/O and ports
//! injected, so the binary is a few lines.

pub mod adapters;
mod cli;
mod commands;
mod ctx;
mod path;
pub mod ports;
mod resolve;
mod scope;

use clap::{CommandFactory, Parser};
use ports::Ports;
use std::ffi::OsString;
use std::io::Write;

/// Standard streams of the program.
pub struct Io<'a> {
    /// Standard output.
    pub stdout: &'a mut dyn Write,
    /// Standard error.
    pub stderr: &'a mut dyn Write,
}

/// The real adapters.
pub fn system_ports() -> Ports {
    adapters::system::system_ports()
}

/// Runs the CLI and returns its exit status: 0 on success, 1 on failure
/// (`error: <code>` on stderr), 2 on a usage error.
pub fn run<I, T>(args: I, io: &mut Io<'_>, ports: &Ports) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let args: Vec<OsString> = args.into_iter().map(Into::into).collect();
    if args.len() <= 1 {
        let _ = writeln!(io.stdout, "{}", cli::Cli::command().render_help());
        return 0;
    }
    let parsed = match cli::Cli::try_parse_from(&args) {
        Ok(c) => c,
        Err(e) => {
            let code = e.exit_code();
            let text = e.render().to_string();
            // Help and version go to stdout, usage errors to stderr.
            let _ = if code == 0 {
                io.stdout.write_all(text.as_bytes())
            } else {
                io.stderr.write_all(text.as_bytes())
            };
            return code;
        }
    };
    commands::dispatch(parsed, io.stdout, io.stderr, ports)
}

/// The command definition, for completions and documentation.
pub fn command() -> clap::Command {
    cli::Cli::command()
}
