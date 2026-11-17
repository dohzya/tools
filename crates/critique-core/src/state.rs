//! Where state files live.

/// State directory name, placed at the Git root (else the cwd).
pub const STATE_DIR: &str = ".critique";
/// Ignore file name, relative to the cwd.
pub const IGNORE_FILE: &str = ".critique-ignore";
/// Session snapshot file name inside a state directory.
pub const SESSION_FILE: &str = "agent-session.json";
/// Reference map file name inside a state directory.
pub const MAP_FILE: &str = "reference-map.json";

/// Resolves a state location. `configured` lists the configured values by
/// priority (option, then environment variables): the first non-blank one
/// wins, trimmed and as given (a relative path stays relative to the
/// caller's cwd). Otherwise `default` (a name) under `base`, or alone when
/// there is no base.
pub fn locate(default: &str, configured: &[Option<&str>], base: Option<&str>) -> String {
    if let Some(dir) = configured
        .iter()
        .flatten()
        .map(|v| v.trim())
        .find(|v| !v.is_empty())
    {
        return dir.to_string();
    }
    match base {
        Some(root) => format!("{}/{default}", root.trim_end_matches('/')),
        None => default.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_name_under_the_base() {
        assert_eq!(locate(STATE_DIR, &[], Some("/repo")), "/repo/.critique");
        assert_eq!(locate(STATE_DIR, &[], Some("/repo/")), "/repo/.critique");
        assert_eq!(locate(STATE_DIR, &[], Some("/")), "/.critique");
        assert_eq!(locate(IGNORE_FILE, &[None], None), ".critique-ignore");
    }

    #[test]
    fn the_caller_chooses_the_default_name() {
        assert_eq!(locate(".dz-review", &[], Some("/repo")), "/repo/.dz-review");
    }

    #[test]
    fn first_non_blank_configured_value_wins() {
        assert_eq!(
            locate(
                STATE_DIR,
                &[None, Some("  "), Some(" state "), Some("other")],
                Some("/repo")
            ),
            "state"
        );
        assert_eq!(
            locate(STATE_DIR, &[Some("/abs/dir")], Some("/repo")),
            "/abs/dir"
        );
    }
}
