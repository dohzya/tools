//! Recap CLI: compact project context snapshot. `run` is the whole program
//! with its I/O and ports injected, so the binary is a few lines and the
//! commands can be exercised without a process.

pub mod adapters;
mod cli;
mod commands;
pub mod domain;

use clap::{CommandFactory, Parser};
use domain::ports::Ports;
use std::ffi::OsString;
use std::io::Write;
use std::sync::Arc;

/// Standard streams of the program.
pub struct Io<'a> {
    /// Standard output.
    pub stdout: &'a mut dyn Write,
    /// Standard error.
    pub stderr: &'a mut dyn Write,
}

/// The real adapters: `git`, `sh`, the process environment and file system.
pub fn system_ports() -> Ports {
    let fs: Arc<adapters::system::SystemFs> = Arc::new(adapters::system::SystemFs);
    Ports {
        shell: Arc::new(adapters::system::SystemShell),
        git: Arc::new(adapters::git::SystemGit),
        env: Arc::new(adapters::system::SystemEnv),
        config: Arc::new(adapters::yaml_config::YamlConfigResolver::new(fs.clone())),
        fs,
    }
}

/// Runs the CLI and returns its exit status: 0 on success, 1 on failure
/// (`recap error: <message>` on stderr), 2 on a usage error.
pub fn run<I, T>(args: I, io: &mut Io<'_>, ports: &Ports) -> i32
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
                io.stdout.write_all(text.as_bytes())
            } else {
                io.stderr.write_all(text.as_bytes())
            };
            return code;
        }
    };
    match commands::dispatch(cli, io, ports) {
        Ok(code) => code,
        Err(e) => {
            let _ = writeln!(io.stderr, "recap error: {e}");
            1
        }
    }
}

/// The command definition, for completions and documentation.
pub fn command() -> clap::Command {
    cli::Cli::command()
}
