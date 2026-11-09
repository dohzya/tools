//! Process-backed adapters: real file system, environment and shell.

use crate::domain::error::{ErrorCode, RecapError};
use crate::domain::ports::{Environment, FileSystem, ShellResult, ShellRunner};
use std::io::{ErrorKind, IsTerminal};
use std::process::{Command, Stdio};

/// `std::fs`.
pub struct SystemFs;

impl FileSystem for SystemFs {
    fn read_to_string(&self, path: &str) -> Result<Option<String>, RecapError> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(_) => Err(RecapError::new(
                ErrorCode::Io,
                format!("Failed to read config: {path}"),
            )),
        }
    }

    fn exists(&self, path: &str) -> bool {
        std::path::Path::new(path).exists()
    }

    fn ensure_dir(&self, path: &str) -> Result<(), RecapError> {
        std::fs::create_dir_all(path)
            .map_err(|e| RecapError::new(ErrorCode::Io, format!("Failed to create {path}: {e}")))
    }

    fn write_file(&self, path: &str, content: &str) -> Result<(), RecapError> {
        std::fs::write(path, content)
            .map_err(|_| RecapError::new(ErrorCode::Io, format!("Failed to write file: {path}")))
    }
}

/// The real process environment.
pub struct SystemEnv;

impl Environment for SystemEnv {
    fn get_env(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn is_terminal(&self) -> bool {
        std::io::stdout().is_terminal()
    }

    fn cwd(&self) -> String {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    fn home(&self) -> Option<String> {
        self.get_env("HOME").or_else(|| self.get_env("USERPROFILE"))
    }
}

/// Runs commands with `sh -c`. The TS tool used dax's cross-platform shell;
/// a POSIX shell is what users' commands are written for anyway.
pub struct SystemShell;

impl ShellRunner for SystemShell {
    fn run(&self, command: &str, env: &[(String, String)], cwd: Option<&str>) -> ShellResult {
        // Checked up front: the OS error for a missing cwd is the same
        // "No such file" as for a missing program, which would mislead.
        if let Some(dir) = cwd.filter(|d| !std::path::Path::new(d).is_dir()) {
            return ShellResult {
                stdout: String::new(),
                stderr: format!("Failed to launch command because the cwd does not exist ({dir})"),
                exit_code: 1,
            };
        }
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(command)
            .envs(env.iter().map(|(k, v)| (k, v)))
            // A command waiting on stdin would hang the whole recap.
            .stdin(Stdio::null());
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        match cmd.output() {
            Ok(out) => ShellResult {
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                // Killed by a signal: no code.
                exit_code: out.status.code().unwrap_or(1),
            },
            Err(e) => ShellResult {
                stdout: String::new(),
                stderr: e.to_string(),
                exit_code: 1,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_runs_in_cwd_with_env_and_reports_failures() {
        let dir = tempfile::tempdir().unwrap();
        let shell = SystemShell;
        let r = shell.run(
            "echo $A; pwd",
            &[("A".into(), "x".into())],
            Some(dir.path().to_str().unwrap()),
        );
        assert_eq!(r.exit_code, 0);
        assert!(r.stdout.starts_with("x\n"));
        let r = shell.run("echo oops >&2; exit 3", &[], None);
        assert_eq!((r.exit_code, r.stderr.trim()), (3, "oops"));
        let r = shell.run("true", &[], Some("/nonexistent-dir-for-recap"));
        assert_eq!(r.exit_code, 1);
        assert_eq!(
            r.stderr,
            "Failed to launch command because the cwd does not exist (/nonexistent-dir-for-recap)"
        );
    }

    #[test]
    fn missing_config_is_none_not_an_error() {
        assert_eq!(SystemFs.read_to_string("/nonexistent/recap.yaml"), Ok(None));
    }
}
