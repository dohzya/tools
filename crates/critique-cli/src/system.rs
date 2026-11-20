//! The real host: `std::fs`, `git` on the PATH, the process environment.

use crate::host::{EntryKind, GitOutput, Host, Instant, LocalTime};
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Host backed by the operating system.
pub struct SystemHost {
    cwd: PathBuf,
}

impl SystemHost {
    /// Starts in the process's current directory.
    pub fn new() -> Self {
        Self {
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }

    fn resolve(&self, path: &str) -> PathBuf {
        self.cwd.join(path)
    }
}

impl Default for SystemHost {
    fn default() -> Self {
        Self::new()
    }
}

impl Host for SystemHost {
    fn cwd(&self) -> PathBuf {
        self.cwd.clone()
    }

    fn chdir(&mut self, dir: &Path) -> io::Result<()> {
        self.cwd = self.cwd.join(dir);
        Ok(())
    }

    fn env(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn stdout_is_terminal(&self) -> bool {
        io::stdout().is_terminal()
    }

    fn stderr_is_terminal(&self) -> bool {
        io::stderr().is_terminal()
    }

    fn stdin_is_terminal(&self) -> bool {
        io::stdin().is_terminal()
    }

    fn read_stdin(&self) -> String {
        let mut bytes = Vec::new();
        let _ = io::stdin().read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn read_to_string(&self, path: &str) -> io::Result<String> {
        std::fs::read(self.resolve(path)).map(|b| String::from_utf8_lossy(&b).into_owned())
    }

    fn write(&self, path: &str, content: &str) -> io::Result<()> {
        std::fs::write(self.resolve(path), content)
    }

    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        std::fs::create_dir_all(self.resolve(path))
    }

    fn remove_file(&self, path: &str) -> io::Result<()> {
        std::fs::remove_file(self.resolve(path))
    }

    fn exists(&self, path: &str) -> bool {
        self.resolve(path).exists()
    }

    fn is_file(&self, path: &str) -> bool {
        self.resolve(path).is_file()
    }

    fn is_dir(&self, path: &str) -> bool {
        self.resolve(path).is_dir()
    }

    fn entry_kind(&self, path: &str) -> Option<EntryKind> {
        let meta = std::fs::symlink_metadata(self.resolve(path)).ok()?;
        Some(if meta.file_type().is_symlink() {
            EntryKind::Other
        } else if meta.is_file() {
            EntryKind::File
        } else if meta.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::Other
        })
    }

    fn read_dir(&self, path: &str) -> io::Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in std::fs::read_dir(self.resolve(path))? {
            names.push(entry?.file_name().to_string_lossy().into_owned());
        }
        Ok(names)
    }

    fn git(&self, args: &[&str]) -> Option<GitOutput> {
        let out = Command::new("git")
            .args(args)
            .current_dir(&self.cwd)
            .stdin(Stdio::null())
            .output()
            .ok()?;
        Some(GitOutput {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }

    fn page(&self, text: &str) -> io::Result<()> {
        let pager = self
            .env("PAGER")
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "less".into());
        // Like the TS tool, the pager is a shell command line.
        let mut command = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/d", "/s", "/c", &pager]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &pager]);
            c
        };
        let mut child = command
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            // The pager may quit early: a broken pipe is not an error.
            match stdin.write_all(text.as_bytes()) {
                Err(e) if e.kind() != io::ErrorKind::BrokenPipe => return Err(e),
                _ => {}
            }
        }
        let status = child.wait()?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "Pager exited with code {}",
                status.code().unwrap_or(1)
            )))
        }
    }

    fn now(&self) -> Instant {
        let now = jiff::Zoned::now();
        Instant {
            unix_seconds: u64::try_from(now.timestamp().as_second()).unwrap_or(0),
            offset_minutes: now.offset().seconds() / 60,
            millis: u32::try_from(now.timestamp().subsec_nanosecond() / 1_000_000).unwrap_or(0),
        }
    }

    fn mtime_seconds(&self, path: &str) -> Option<u64> {
        let modified = std::fs::metadata(self.resolve(path))
            .ok()?
            .modified()
            .ok()?;
        modified
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
    }

    fn local_offset_minutes(&self, unix_seconds: i64) -> i32 {
        let ts = jiff::Timestamp::from_second(unix_seconds).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
        jiff::tz::TimeZone::system().to_offset(ts).seconds() / 60
    }

    fn local_time(&self, unix_seconds: u64) -> LocalTime {
        let ts = jiff::Timestamp::from_second(i64::try_from(unix_seconds).unwrap_or(0))
            .unwrap_or(jiff::Timestamp::UNIX_EPOCH);
        let z = ts.to_zoned(jiff::tz::TimeZone::system());
        LocalTime {
            year: i32::from(z.year()),
            month: z.month().unsigned_abs(),
            day: z.day().unsigned_abs(),
            hour: z.hour().unsigned_abs(),
            minute: z.minute().unsigned_abs(),
            second: z.second().unsigned_abs(),
        }
    }
}
