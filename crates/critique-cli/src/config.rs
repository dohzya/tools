//! State directory and ignore file resolution.
//!
//! The tool was called `dz-review`. The state directory is now `.critique`
//! (and the ignore file `.critique-ignore`); when the new name does not
//! exist but the old one does, it is *read* instead and files are still
//! *written* under the new name. Setting `CRITIQUE_COMPAT_DZ_REVIEW` (to
//! anything but empty or `0`) switches every default name and message back
//! to `dz-review`, without fallback: it is how the legacy black-box suite
//! runs against this binary.

use crate::host::Host;
use crate::paths;
use std::path::{Path, PathBuf};

/// Legacy compatibility switch.
pub const COMPAT_ENV: &str = "CRITIQUE_COMPAT_DZ_REVIEW";
const NEW_STATE_DIR: &str = ".critique";
const LEGACY_STATE_DIR: &str = ".dz-review";
const NEW_IGNORE_FILE: &str = ".critique-ignore";
const LEGACY_IGNORE_FILE: &str = ".dz-review-ignore";

/// Resolved settings of one invocation.
#[derive(Debug, Clone, Default)]
pub struct Settings {
    /// `--state-dir`
    pub state_dir_option: Option<String>,
    /// `--ignore-file`
    pub ignore_file_option: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Whether legacy names are forced.
pub fn compat(host: &dyn Host) -> bool {
    host.env(COMPAT_ENV)
        .is_some_and(|v| !v.is_empty() && v != "0")
}

/// Name of the program in messages.
pub fn program(host: &dyn Host) -> &'static str {
    if compat(host) {
        "dz-review"
    } else {
        "critique"
    }
}

/// Where state files are written, and where they are read (differs only for the legacy fallback).
#[derive(Debug, Clone)]
pub struct StateDirs {
    /// Directory written to.
    pub write: PathBuf,
    /// Directory read from.
    pub read: PathBuf,
}

fn configured_state_dir(host: &dyn Host, settings: &Settings) -> Option<PathBuf> {
    [
        settings.state_dir_option.clone(),
        host.env("CRITIQUE_STATE_DIR"),
        host.env("DZ_REVIEW_STATE_DIR"),
    ]
    .into_iter()
    .find_map(non_empty)
    .map(|v| paths::normalize(Path::new(&v)))
}

/// Git work tree root, if any.
pub fn git_root(host: &dyn Host) -> Option<PathBuf> {
    let out = host.git(&["rev-parse", "--show-toplevel"])?;
    let root = out.stdout.trim();
    (out.success && !root.is_empty()).then(|| PathBuf::from(root))
}

/// Resolves the state directories.
pub fn state_dirs(host: &dyn Host, settings: &Settings) -> StateDirs {
    if let Some(dir) = configured_state_dir(host, settings) {
        return StateDirs {
            write: dir.clone(),
            read: dir,
        };
    }
    let base = git_root(host);
    let join = |name: &str| match &base {
        Some(root) => root.join(name),
        None => PathBuf::from(name),
    };
    if compat(host) {
        let dir = join(LEGACY_STATE_DIR);
        return StateDirs {
            write: dir.clone(),
            read: dir,
        };
    }
    let write = join(NEW_STATE_DIR);
    let legacy = join(LEGACY_STATE_DIR);
    let read = if !host.exists(&write.to_string_lossy()) && host.exists(&legacy.to_string_lossy()) {
        legacy
    } else {
        write.clone()
    };
    StateDirs { write, read }
}

/// Session snapshot file name inside a state directory.
pub const SESSION_FILE: &str = "agent-session.json";
/// Reference map file name inside a state directory.
pub const MAP_FILE: &str = "reference-map.json";

/// `dir/name` as a `/`-separated string.
pub fn file_in(dir: &Path, name: &str) -> String {
    paths::slashes(&dir.join(name))
}

/// Ignore file path to read.
pub fn ignore_file(host: &dyn Host, settings: &Settings) -> String {
    if let Some(v) = non_empty(settings.ignore_file_option.clone())
        .or_else(|| non_empty(host.env("CRITIQUE_IGNORE_FILE")))
        .or_else(|| non_empty(host.env("DZ_REVIEW_IGNORE_FILE")))
    {
        return paths::slashes(&paths::normalize(Path::new(&v)));
    }
    if compat(host) {
        return LEGACY_IGNORE_FILE.to_string();
    }
    if !host.exists(NEW_IGNORE_FILE) && host.exists(LEGACY_IGNORE_FILE) {
        return LEGACY_IGNORE_FILE.to_string();
    }
    NEW_IGNORE_FILE.to_string()
}

/// Directory ignore patterns that always apply (state directories).
pub fn default_ignore_patterns(host: &dyn Host, settings: &Settings) -> Vec<String> {
    let state = state_dirs(host, settings).write;
    let mut names = vec![LEGACY_STATE_DIR.to_string()];
    if !compat(host) {
        names.insert(0, NEW_STATE_DIR.to_string());
    }
    let pattern = |dir: &str| {
        let relative = if Path::new(dir).is_absolute() {
            paths::relative_to(&host.cwd(), dir)
        } else {
            dir.replace('\\', "/")
        };
        let trimmed = relative.trim_end_matches('/');
        if trimmed.is_empty() {
            "./".to_string()
        } else {
            format!("{trimmed}/")
        }
    };
    let mut out: Vec<String> = Vec::new();
    for p in names
        .iter()
        .map(|n| pattern(n))
        .chain(std::iter::once(pattern(&paths::slashes(&state))))
    {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}
