//! `md` binary: wires the process streams to `markdown_surgeon_cli::run`.

use markdown_surgeon_cli::{Env, Zoned, run};
use std::process::ExitCode;

fn main() -> ExitCode {
    let (mut stdin, mut stdout, mut stderr) =
        (std::io::stdin(), std::io::stdout(), std::io::stderr());
    let mut env = Env {
        stdin: &mut stdin,
        stdout: &mut stdout,
        stderr: &mut stderr,
        now: Zoned::now(),
    };
    let code = run(std::env::args_os(), &mut env);
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}
