//! Ports: what the commands need from the outside world. The adapters of
//! `crate::adapters` implement them on the real system; tests can plug fakes.

use std::sync::Arc;
use worklog_core::time::Clock;

/// An entry of a directory listing.
#[derive(Debug, Clone)]
pub struct DirEntry {
    /// File name.
    pub name: String,
    /// Whether it is a directory (symlinks are followed).
    pub is_dir: bool,
}

/// File system. Paths use `/` separators.
pub trait Fs: Send + Sync {
    /// Whole file as text. `Ok(None)` when it does not exist.
    fn read_to_string(&self, path: &str) -> Result<Option<String>, String>;
    /// Writes a file, replacing it atomically.
    fn write(&self, path: &str, content: &str) -> Result<(), String>;
    /// Whether the path exists.
    fn exists(&self, path: &str) -> bool;
    /// Whether the path is a directory.
    fn is_dir(&self, path: &str) -> bool;
    /// Creates a directory and its parents.
    fn create_dir_all(&self, path: &str) -> Result<(), String>;
    /// Entries of a directory.
    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, String>;
    /// Removes a file or a directory tree; missing paths are ignored.
    fn remove(&self, path: &str);
    /// Canonical absolute path.
    fn real_path(&self, path: &str) -> Result<String, String>;
    /// Takes an exclusive advisory lock on `path` (created when missing),
    /// waiting up to `timeout_ms`. The lock is held until the guard is
    /// dropped, or the process dies.
    fn lock(&self, path: &str, timeout_ms: u64) -> Result<LockGuard, String>;
}

/// Releases the lock it stands for when dropped.
pub struct LockGuard(pub Box<dyn Send>);

/// A git worktree.
#[derive(Debug, Clone)]
pub struct Worktree {
    /// Directory.
    pub path: String,
    /// Checked-out branch; `None` when detached.
    pub branch: Option<String>,
    /// Whether it is the main working tree.
    pub is_main: bool,
}

/// Git queries.
pub trait Git: Send + Sync {
    /// Top level of the repository containing `cwd`.
    fn root(&self, cwd: &str) -> Option<String>;
    /// Worktrees of the repository containing `cwd`.
    fn worktrees(&self, cwd: &str) -> Result<Vec<Worktree>, String>;
    /// Current branch; `None` when detached or outside a repository.
    fn current_branch(&self, cwd: &str) -> Option<String>;
}

/// Spawns processes.
pub trait Proc: Send + Sync {
    /// Runs a command with inherited standard streams. `Err` when it cannot
    /// be started.
    fn run(&self, cmd: &[String], env: &[(String, String)], cwd: &str) -> Result<i32, String>;
    /// Runs a command and returns its stdout when it succeeds.
    fn capture(&self, cmd: &[String]) -> Option<String>;
    /// Pipes `text` to the pager command.
    fn page(&self, pager: &str, text: &str) -> Result<(), String>;
}

/// Process environment and randomness.
pub trait Env: Send + Sync {
    /// Environment variable.
    fn var(&self, name: &str) -> Option<String>;
    /// Current directory, with `/` separators.
    fn cwd(&self) -> String;
    /// Whether stdin is a terminal.
    fn stdin_is_terminal(&self) -> bool;
    /// Whether stdout is a terminal.
    fn stdout_is_terminal(&self) -> bool;
    /// Reads all of stdin.
    fn read_stdin(&self) -> Result<String, String>;
    /// Reads one line of stdin (without the line ending).
    fn read_line(&self) -> Option<String>;
    /// Asks the user to pick one of `options` (fuzzy filter while typing,
    /// arrows, enter). `None` when cancelled or not possible.
    fn select(&self, prompt: &str, options: &[String]) -> Option<usize>;
    /// A random UUID v4.
    fn uuid(&self) -> String;
    /// A random 7-char base62 id.
    fn todo_id(&self) -> String;
    /// Name of the operating system (`linux`, `macos`, `windows`).
    fn os(&self) -> &'static str;
}

/// All the ports.
#[derive(Clone)]
pub struct Ports {
    /// File system.
    pub fs: Arc<dyn Fs>,
    /// Git.
    pub git: Arc<dyn Git>,
    /// Processes.
    pub proc_: Arc<dyn Proc>,
    /// Environment.
    pub env: Arc<dyn Env>,
    /// Clock and time zone.
    pub clock: Arc<dyn Clock + Send + Sync>,
}
