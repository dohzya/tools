//! `critique` binary: wires the process streams to `critique_cli::run`.

use std::process::ExitCode;

fn main() -> ExitCode {
    let (mut stdout, mut stderr) = (std::io::stdout().lock(), std::io::stderr().lock());
    let mut io = critique_cli::Io {
        stdout: &mut stdout,
        stderr: &mut stderr,
    };
    let mut host = critique_cli::system::SystemHost::new();
    let code = critique_cli::run(std::env::args().skip(1).collect(), &mut io, &mut host);
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}
