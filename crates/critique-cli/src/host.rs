//! Everything the commands need from the outside world. `system.rs` is the
//! real adapter; paths given to a host are resolved against its `cwd`.

use std::io;
use std::path::{Path, PathBuf};

/// Kind of a directory entry (symlinks are not followed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    /// Regular file.
    File,
    /// Directory.
    Dir,
    /// Symbolic link or anything else.
    Other,
}

/// Result of a git invocation.
#[derive(Debug, Clone)]
pub struct GitOutput {
    /// Exit status 0.
    pub success: bool,
    /// Standard output (lossy UTF-8).
    pub stdout: String,
    /// Standard error (lossy UTF-8).
    pub stderr: String,
}

/// An instant with the local UTC offset.
#[derive(Debug, Clone, Copy)]
pub struct Instant {
    /// Seconds since the epoch.
    pub unix_seconds: u64,
    /// Local offset in minutes east of UTC.
    pub offset_minutes: i32,
    /// Milliseconds after the second.
    pub millis: u32,
}

/// Broken-down local time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalTime {
    /// Year.
    pub year: i32,
    /// Month 1-12.
    pub month: u8,
    /// Day 1-31.
    pub day: u8,
    /// Hour.
    pub hour: u8,
    /// Minute.
    pub minute: u8,
    /// Second.
    pub second: u8,
}

/// File system, environment, git, clock and terminal.
pub trait Host {
    /// Current directory (what `-C` changes).
    fn cwd(&self) -> PathBuf;
    /// Changes the directory used to resolve relative paths.
    fn chdir(&mut self, dir: &Path) -> io::Result<()>;
    /// Environment variable.
    fn env(&self, name: &str) -> Option<String>;
    /// Whether stdout is a terminal.
    fn stdout_is_terminal(&self) -> bool;
    /// Whether stderr is a terminal.
    fn stderr_is_terminal(&self) -> bool;
    /// Whether stdin is a terminal.
    fn stdin_is_terminal(&self) -> bool;
    /// Whole stdin.
    fn read_stdin(&self) -> String;
    /// UTF-8 file content, invalid bytes replaced.
    fn read_to_string(&self, path: &str) -> io::Result<String>;
    /// Replaces a file.
    fn write(&self, path: &str, content: &str) -> io::Result<()>;
    /// `mkdir -p`.
    fn create_dir_all(&self, path: &str) -> io::Result<()>;
    /// Removes a file.
    fn remove_file(&self, path: &str) -> io::Result<()>;
    /// Whether anything exists at `path`.
    fn exists(&self, path: &str) -> bool;
    /// Whether `path` is a regular file (symlinks followed).
    fn is_file(&self, path: &str) -> bool;
    /// Whether `path` is a directory (symlinks followed).
    fn is_dir(&self, path: &str) -> bool;
    /// Kind of `path` without following symlinks.
    fn entry_kind(&self, path: &str) -> Option<EntryKind>;
    /// Names of a directory.
    fn read_dir(&self, path: &str) -> io::Result<Vec<String>>;
    /// Runs `git` in the cwd; `None` when git cannot be started.
    fn git(&self, args: &[&str]) -> Option<GitOutput>;
    /// Runs `$PAGER` (or `less`) with `text` on stdin.
    fn page(&self, text: &str) -> io::Result<()>;
    /// Now.
    fn now(&self) -> Instant;
    /// Modification time of a file, in epoch seconds.
    fn mtime_seconds(&self, path: &str) -> Option<u64>;
    /// UTC offset (minutes east) of the system time zone at an instant.
    fn local_offset_minutes(&self, unix_seconds: i64) -> i32;
    /// Local calendar time of an instant (system time zone, `TZ` honoured).
    fn local_time(&self, unix_seconds: u64) -> LocalTime;
}
