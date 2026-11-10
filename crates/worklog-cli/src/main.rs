//! `worklog` binary: wires the process streams to `worklog_cli::run`.

use std::process::ExitCode;

fn main() -> ExitCode {
    let (mut stdout, mut stderr) = (std::io::stdout().lock(), std::io::stderr().lock());
    let mut io = worklog_cli::Io {
        stdout: &mut stdout,
        stderr: &mut stderr,
    };
    let code = worklog_cli::run(std::env::args_os(), &mut io, &worklog_cli::system_ports());
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}
