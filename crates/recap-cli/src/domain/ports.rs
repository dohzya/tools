//! Ports: everything the domain needs from the outside world. Adapters live
//! in `crate::adapters`; tests plug in fakes.

use super::config::RawConfig;
use super::error::RecapError;

/// Output of a shell command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellResult {
    /// Standard output.
    pub stdout: String,
    /// Standard error.
    pub stderr: String,
    /// Exit code.
    pub exit_code: i32,
}

/// Runs shell commands.
pub trait ShellRunner: Send + Sync {
    /// Runs `command`. Never fails: a command that cannot start yields exit
    /// code 1 and the reason on stderr, like a failing command.
    fn run(&self, command: &str, env: &[(String, String)], cwd: Option<&str>) -> ShellResult;
}

/// One file of `git status`, as seen by status enrichers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitStatusEntry {
    /// Path key used by enrichers.
    pub path: String,
    /// Rendered status line.
    pub line: String,
    /// Rendered diff stats such as `(3+ 4-)`.
    pub stats: Option<String>,
}

/// Lines of `git status`, with the per-file entries.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitStatusResult {
    /// Lines to display (entries plus aggregate notes).
    pub lines: Vec<String>,
    /// File lines with their path keys.
    pub entries: Vec<GitStatusEntry>,
}

/// Queries git. Every method degrades to an empty answer outside a repo.
pub trait GitInfo: Send + Sync {
    /// Description of the operation in progress (`merging 1a2b3c4`).
    fn ops(&self, cwd: &str) -> Option<String>;
    /// `(in ./sub/dir)` when below the repository root.
    fn subdir(&self, cwd: &str) -> Option<String>;
    /// At most `max_lines` commits not yet on the upstream.
    fn log(&self, cwd: &str, max_lines: i64, use_color: bool) -> Vec<String>;
    /// Working tree status; `local_only` hides what is outside `cwd`.
    fn status(&self, cwd: &str, local_only: bool, use_color: bool) -> GitStatusResult;
    /// `(N stashed entries)` or nothing.
    fn stash(&self, cwd: &str) -> Vec<String>;
}

/// Process environment.
pub trait Environment: Send + Sync {
    /// An environment variable, if set.
    fn get_env(&self, name: &str) -> Option<String>;
    /// Whether stdout is a terminal.
    fn is_terminal(&self) -> bool;
    /// Current directory.
    fn cwd(&self) -> String;
    /// Home directory (`HOME`, else `USERPROFILE`).
    fn home(&self) -> Option<String>;
}

/// File system.
pub trait FileSystem: Send + Sync {
    /// File content; `Ok(None)` when it does not exist.
    fn read_to_string(&self, path: &str) -> Result<Option<String>, RecapError>;
    /// Whether the path exists.
    fn exists(&self, path: &str) -> bool;
    /// Creates a directory and its parents.
    fn ensure_dir(&self, path: &str) -> Result<(), RecapError>;
    /// Writes a file.
    fn write_file(&self, path: &str, content: &str) -> Result<(), RecapError>;
}

/// Loads and validates config files.
pub trait ConfigResolver: Send + Sync {
    /// The parsed file; `Ok(None)` when it does not exist.
    fn load_config(&self, path: &str) -> Result<Option<RawConfig>, RecapError>;
}

/// All the ports a run needs, shareable across the section threads.
pub struct Ports {
    /// Shell commands.
    pub shell: std::sync::Arc<dyn ShellRunner>,
    /// Git queries.
    pub git: std::sync::Arc<dyn GitInfo>,
    /// Process environment.
    pub env: std::sync::Arc<dyn Environment>,
    /// File system.
    pub fs: std::sync::Arc<dyn FileSystem>,
    /// Config loading.
    pub config: std::sync::Arc<dyn ConfigResolver>,
}
