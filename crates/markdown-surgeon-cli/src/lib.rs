//! Markdown section editing CLI: command line, command handlers and output
//! formats. `run` is the whole program with its I/O injected, so the binary is
//! a few lines and the handlers can be exercised without a process.

mod cli;
mod commands;
mod create;
mod error;
mod magic;
mod meta;
mod mrfi_cmd;
mod output;

use clap::{CommandFactory, Parser};
use std::ffi::OsString;
use std::io::{Read, Write};

pub use jiff::Zoned;

/// What the program talks to.
pub struct Env<'a> {
    /// Standard input, read only when a command needs content from it.
    pub stdin: &'a mut dyn Read,
    /// Standard output.
    pub stdout: &'a mut dyn Write,
    /// Standard error.
    pub stderr: &'a mut dyn Write,
    /// Current time, for magic expressions such as `{datetime}`.
    pub now: Zoned,
}

/// Runs the CLI and returns its exit status: 0 on success, 1 when a command
/// fails (`error: <code>` on stderr), 2 on a usage error.
pub fn run<I, T>(args: I, env: &mut Env<'_>) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let cli = match cli::Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) => {
            let code = e.exit_code();
            let text = e.render().to_string();
            // Help and version go to stdout, usage errors to stderr.
            let _ = if code == 0 {
                env.stdout.write_all(text.as_bytes())
            } else {
                env.stderr.write_all(text.as_bytes())
            };
            return code;
        }
    };
    match commands::dispatch(cli.command, env) {
        Ok(()) => 0,
        Err(fail) => {
            let _ = writeln!(env.stderr, "{fail}");
            1
        }
    }
}

/// The command definition, for completions and documentation.
pub fn command() -> clap::Command {
    cli::Cli::command()
}
