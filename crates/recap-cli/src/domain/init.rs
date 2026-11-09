//! Content of the config file written by `recap init`.

use super::config::hardcoded_sections;

const GLOBAL_COMMENT: &str = "# recap global configuration
# See: https://github.com/dohzya/dz-tools
#
# This is your global config (~/.config/recap.yaml).
# Project-level configs (.config/recap.yaml) override this.
#
# Use ref: \"*\" to include all sections from the parent level.
# Use ref: \"<id>\" to include a specific section from the parent level.
";

const LOCAL_COMMENT: &str = "# recap project configuration
# See: https://github.com/dohzya/dz-tools
#
# Sections from the global config (~/.config/recap.yaml) or hardcoded defaults
# can be included with:
#   - ref: \"*\"         (all parent sections)
#   - ref: \"<id>\"      (specific section, with optional overrides)
#
";

/// Local files inherit everything; the global one lists each built-in
/// section (so it can be reordered or dropped) and adds a `worktasks` one.
pub fn generate_config_content(is_global: bool) -> String {
    if !is_global {
        return format!(
            "{LOCAL_COMMENT}sections:\n  - ref: \"*\"\n  # - id: my-section\n  #   sh: echo hello\n  #   title: My Section\n"
        );
    }
    let mut lines: Vec<String> = Vec::new();
    for section in hardcoded_sections() {
        lines.push(format!("  - ref: {}", section.id));
        if let Some(n) = section.common.max_lines {
            lines.push(format!("    max_lines: {n}"));
        }
    }
    lines.push("  - id: worktasks".into());
    lines.push("    sh: wl list".into());
    lines.push("    max_lines: 6".into());
    format!("{GLOBAL_COMMENT}sections:\n{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_inherits_everything() {
        let c = generate_config_content(false);
        assert!(c.starts_with("# recap project configuration\n"));
        assert!(c.ends_with("sections:\n  - ref: \"*\"\n  # - id: my-section\n  #   sh: echo hello\n  #   title: My Section\n"));
    }

    #[test]
    fn global_lists_builtins_and_worktasks() {
        let c = generate_config_content(true);
        assert!(c.contains("  - ref: git-log\n    max_lines: 6\n  - ref: git-stash\n"));
        assert!(c.ends_with("  - id: worktasks\n    sh: wl list\n    max_lines: 6\n"));
    }
}
