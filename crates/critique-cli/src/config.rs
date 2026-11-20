//! State directory and ignore file resolution, from the host's options and
//! environment (the rule itself is [`critique_core::state`]).
//!
//! Setting `CRITIQUE_COMPAT_DZ_REVIEW` (to anything but empty or `0`)
//! switches every default name, legacy variable and message back to
//! `dz-review`: it is how the legacy black-box suite runs against this
//! binary. Without it, nothing named `dz-review` is read.

use crate::host::Host;
use crate::paths;
use critique_core::state::{self, IGNORE_FILE, STATE_DIR};
pub use critique_core::state::{MAP_FILE, SESSION_FILE};
use std::path::{Path, PathBuf};

/// Legacy compatibility switch.
pub const COMPAT_ENV: &str = "CRITIQUE_COMPAT_DZ_REVIEW";
const COMPAT_STATE_DIR: &str = ".dz-review";
const COMPAT_IGNORE_FILE: &str = ".dz-review-ignore";

/// Resolved settings of one invocation.
#[derive(Debug, Clone, Default)]
pub struct Settings {
    /// `--state-dir`
    pub state_dir_option: Option<String>,
    /// `--ignore-file`
    pub ignore_file_option: Option<String>,
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

/// Git work tree root, if any.
pub fn git_root(host: &dyn Host) -> Option<PathBuf> {
    let out = host.git(&["rev-parse", "--show-toplevel"])?;
    let root = out.stdout.trim();
    (out.success && !root.is_empty()).then(|| PathBuf::from(root))
}

/// Default state directory name.
fn state_dir_name(host: &dyn Host) -> &'static str {
    if compat(host) {
        COMPAT_STATE_DIR
    } else {
        STATE_DIR
    }
}

/// Environment variable `name`, read only under the compat switch.
fn compat_env(host: &dyn Host, name: &str) -> Option<String> {
    compat(host).then(|| host.env(name)).flatten()
}

fn locate(default: &str, configured: &[Option<String>], base: Option<&str>) -> PathBuf {
    let configured: Vec<_> = configured.iter().map(Option::as_deref).collect();
    paths::normalize(Path::new(&state::locate(default, &configured, base)))
}

/// Resolves the state directory.
pub fn state_dir(host: &dyn Host, settings: &Settings) -> PathBuf {
    let configured = [
        settings.state_dir_option.clone(),
        host.env("CRITIQUE_STATE_DIR"),
        compat_env(host, "DZ_REVIEW_STATE_DIR"),
    ];
    let base = git_root(host).map(|root| paths::slashes(&root));
    locate(state_dir_name(host), &configured, base.as_deref())
}

/// `dir/name` as a `/`-separated string.
pub fn file_in(dir: &Path, name: &str) -> String {
    paths::slashes(&dir.join(name))
}

/// Ignore file path to read.
pub fn ignore_file(host: &dyn Host, settings: &Settings) -> String {
    let configured = [
        settings.ignore_file_option.clone(),
        host.env("CRITIQUE_IGNORE_FILE"),
        compat_env(host, "DZ_REVIEW_IGNORE_FILE"),
    ];
    let default = if compat(host) {
        COMPAT_IGNORE_FILE
    } else {
        IGNORE_FILE
    };
    paths::slashes(&locate(default, &configured, None))
}

/// Directory ignore patterns that always apply (state directories).
pub fn default_ignore_patterns(host: &dyn Host, settings: &Settings) -> Vec<String> {
    let state = state_dir(host, settings);
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
    for p in [
        pattern(state_dir_name(host)),
        pattern(&paths::slashes(&state)),
    ] {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}
