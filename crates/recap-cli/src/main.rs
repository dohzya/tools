//! `recap` binary: wires the process streams to `recap_cli::run`.

use std::process::ExitCode;

fn main() -> ExitCode {
    let (mut stdout, mut stderr) = (std::io::stdout().lock(), std::io::stderr().lock());
    let mut io = recap_cli::Io {
        stdout: &mut stdout,
        stderr: &mut stderr,
    };
    let code = recap_cli::run(std::env::args_os(), &mut io, &recap_cli::system_ports());
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}
