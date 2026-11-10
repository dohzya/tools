//! Real file system, git, processes, environment and clock.

use crate::path::slashes;
use crate::ports::{DirEntry, Env, Fs, Git, Ports, Proc, Worktree};
use std::io::{BufRead, Read, Write};
use std::process::{Command, Stdio};
use std::sync::Arc;
use worklog_core::time::Clock;

/// `std::fs`.
pub struct SystemFs;

impl Fs for SystemFs {
    fn read_to_string(&self, path: &str) -> Result<Option<String>, String> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn write(&self, path: &str, content: &str) -> Result<(), String> {
        // Write beside the target then rename, so a crash or a concurrent
        // reader never sees a half-written file.
        let tmp = format!("{path}.tmp-{}", std::process::id());
        std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    }

    fn exists(&self, path: &str) -> bool {
        std::fs::metadata(path).is_ok()
    }

    fn is_dir(&self, path: &str) -> bool {
        std::fs::metadata(path).is_ok_and(|m| m.is_dir())
    }

    fn create_dir_all(&self, path: &str) -> Result<(), String> {
        std::fs::create_dir_all(path).map_err(|e| e.to_string())
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, String> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let is_dir = std::fs::metadata(entry.path()).is_ok_and(|m| m.is_dir());
            out.push(DirEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir,
            });
        }
        Ok(out)
    }

    fn remove(&self, path: &str) {
        match std::fs::symlink_metadata(path) {
            Ok(m) if m.is_dir() => {
                let _ = std::fs::remove_dir_all(path);
            }
            Ok(_) => {
                let _ = std::fs::remove_file(path);
            }
            Err(_) => {}
        }
    }

    fn real_path(&self, path: &str) -> Result<String, String> {
        let p = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        Ok(strip_verbatim(&slashes(&p.to_string_lossy())))
    }
}

/// Drops the `//?/` prefix Windows adds to canonical paths.
fn strip_verbatim(p: &str) -> String {
    p.strip_prefix("//?/").unwrap_or(p).to_string()
}

/// The `git` executable.
pub struct SystemGit;

fn git_output(cwd: &str, args: &[&str]) -> Option<std::process::Output> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()
}

impl Git for SystemGit {
    fn root(&self, cwd: &str) -> Option<String> {
        let out = git_output(cwd, &["rev-parse", "--show-toplevel"])?;
        if !out.status.success() {
            return None;
        }
        Some(slashes(String::from_utf8_lossy(&out.stdout).trim()))
    }

    fn worktrees(&self, cwd: &str) -> Result<Vec<Worktree>, String> {
        let out = git_output(cwd, &["worktree", "list", "--porcelain"])
            .ok_or_else(|| "git is not available".to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let mut list: Vec<Worktree> = Vec::new();
        let mut current: Option<Worktree> = None;
        for line in text.trim().split('\n') {
            if let Some(path) = line.strip_prefix("worktree ") {
                if let Some(c) = current.take() {
                    list.push(c);
                }
                current = Some(Worktree {
                    path: slashes(path),
                    branch: None,
                    is_main: list.is_empty(),
                });
            } else if let Some(r) = line.strip_prefix("branch ")
                && let Some(c) = current.as_mut()
            {
                c.branch = Some(r.strip_prefix("refs/heads/").unwrap_or(r).to_string());
            } else if line == "detached"
                && let Some(c) = current.as_mut()
            {
                c.branch = None;
            }
        }
        if let Some(c) = current {
            list.push(c);
        }
        Ok(list)
    }

    fn current_branch(&self, cwd: &str) -> Option<String> {
        let out = git_output(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        if !out.status.success() {
            return None;
        }
        let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if b == "HEAD" { None } else { Some(b) }
    }
}

/// `std::process`.
pub struct SystemProc;

impl Proc for SystemProc {
    fn run(&self, cmd: &[String], env: &[(String, String)], cwd: &str) -> Result<i32, String> {
        let Some((exe, args)) = cmd.split_first() else {
            return Err("empty command".into());
        };
        let _ = std::io::stdout().flush();
        let status = Command::new(exe)
            .args(args)
            .envs(env.iter().map(|(k, v)| (k, v)))
            .current_dir(cwd)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .map_err(|e| format!("Failed to run {exe}: {e}"))?;
        Ok(status.code().unwrap_or(1))
    }

    fn capture(&self, cmd: &[String]) -> Option<String> {
        let (exe, args) = cmd.split_first()?;
        let out = Command::new(exe)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn page(&self, pager: &str, text: &str) -> Result<(), String> {
        // The pager may be a command line (`less -R`): run it through the shell.
        let mut command = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", pager]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", pager]);
            c
        };
        let mut child = command
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run pager: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            // A pager that quits early closes the pipe: not an error.
            let _ = stdin.write_all(text.as_bytes());
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Pager exited with code {}",
                status.code().unwrap_or(1)
            ))
        }
    }
}

/// Process environment.
pub struct SystemEnv;

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    if getrandom::fill(&mut buf).is_err() {
        // No entropy source: fall back on the clock, which only has to make
        // ids unlikely to collide within one worklog.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((nanos >> ((i % 16) * 8)) as u8) ^ (i as u8).wrapping_mul(131);
        }
    }
    buf
}

impl Env for SystemEnv {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn cwd(&self) -> String {
        std::env::current_dir()
            .map(|p| slashes(&p.to_string_lossy()))
            .unwrap_or_else(|_| ".".into())
    }

    fn stdin_is_terminal(&self) -> bool {
        std::io::IsTerminal::is_terminal(&std::io::stdin())
    }

    fn stdout_is_terminal(&self) -> bool {
        std::io::IsTerminal::is_terminal(&std::io::stdout())
    }

    fn read_stdin(&self) -> Result<String, String> {
        let mut buf = Vec::new();
        std::io::stdin()
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    fn read_line(&self) -> Option<String> {
        let mut line = String::new();
        let n = std::io::stdin().lock().read_line(&mut line).ok()?;
        if n == 0 {
            return None;
        }
        Some(line.trim_end_matches(['\n', '\r']).to_string())
    }

    fn uuid(&self) -> String {
        let mut b = random_bytes::<16>();
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
        format!(
            "{}-{}-{}-{}-{}",
            &h[0..8],
            &h[8..12],
            &h[12..16],
            &h[16..20],
            &h[20..32]
        )
    }

    fn todo_id(&self) -> String {
        const CHARS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        random_bytes::<7>()
            .iter()
            .map(|b| CHARS[usize::from(*b) % CHARS.len()] as char)
            .collect()
    }

    fn os(&self) -> &'static str {
        if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        }
    }
}

/// Wall clock and system time zone (`TZ` is honored).
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        jiff::Timestamp::now().as_millisecond()
    }

    fn local_offset_minutes(&self, utc_ms: i64) -> i32 {
        let Ok(ts) = jiff::Timestamp::from_millisecond(utc_ms) else {
            return 0;
        };
        jiff::tz::TimeZone::system().to_offset(ts).seconds() / 60
    }
}

/// The real ports.
pub fn system_ports() -> Ports {
    Ports {
        fs: Arc::new(SystemFs),
        git: Arc::new(SystemGit),
        proc_: Arc::new(SystemProc),
        env: Arc::new(SystemEnv),
        clock: Arc::new(SystemClock),
    }
}
