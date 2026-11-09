//! Config entities: what a config file says (`Raw*`) and what a run executes
//! (`ResolvedSection`).

use serde::Serialize;

/// Ordered `KEY: value` pairs; a `Vec` because YAML order is observable in
/// `config show`.
pub type EnvVars = Vec<(String, String)>;

/// How sections are visually separated in the rendered output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Separator {
    /// An empty line.
    BlankLine,
    /// Nothing.
    None,
    /// A horizontal rule.
    Line,
}

impl Separator {
    /// The spelling used in config files.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BlankLine => "blank_line",
            Self::None => "none",
            Self::Line => "line",
        }
    }

    /// Parses the config spelling.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "blank_line" => Some(Self::BlankLine),
            "none" => Some(Self::None),
            "line" => Some(Self::Line),
            _ => None,
        }
    }
}

/// A built-in section provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builtin {
    /// Working tree status limited to the current directory.
    Status,
    /// Rebase, merge, cherry-pick or revert in progress.
    GitOps,
    /// Recent commits.
    GitLog,
    /// Number of stash entries.
    GitStash,
    /// Whole-repository working tree status.
    GitStatus,
    /// Same as `Status` (kept as an explicit spelling).
    GitStatusLocal,
    /// `(in ./sub/dir)` when started below the repository root.
    GitSubdir,
}

impl Builtin {
    /// The spelling used in config files.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::GitOps => "git-ops",
            Self::GitLog => "git-log",
            Self::GitStash => "git-stash",
            Self::GitStatus => "git-status",
            Self::GitStatusLocal => "git-status-local",
            Self::GitSubdir => "git-subdir",
        }
    }

    /// Parses the config spelling.
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "status" => Self::Status,
            "git-ops" => Self::GitOps,
            "git-log" => Self::GitLog,
            "git-stash" => Self::GitStash,
            "git-status" => Self::GitStatus,
            "git-status-local" => Self::GitStatusLocal,
            "git-subdir" => Self::GitSubdir,
            _ => return None,
        })
    }
}

/// Options shared by the section kinds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Common {
    /// Title printed above the section.
    pub title: Option<String>,
    /// Keep at most this many lines.
    pub max_lines: Option<i64>,
    /// Separator printed before the section.
    pub separator: Option<Separator>,
}

/// `id` + `sh`: a shell command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShEntry {
    /// Section id.
    pub id: String,
    /// Shell command.
    pub sh: String,
    /// Shared options.
    pub common: Common,
    /// Extra environment of the command.
    pub env: Option<EnvVars>,
    /// Working directory of the command.
    pub cwd: Option<String>,
}

/// `id` + `builtin`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltinEntry {
    /// Section id.
    pub id: String,
    /// Provider.
    pub builtin: Builtin,
    /// Shared options.
    pub common: Common,
}

/// `id` + `value`: static text with `${VAR}` interpolation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValueEntry {
    /// Section id.
    pub id: String,
    /// Text.
    pub value: String,
    /// Shared options.
    pub common: Common,
}

/// `ref`: a section of the parent level, with overrides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefEntry {
    /// Parent section id, an alias, or `*`.
    pub reference: String,
    /// Shared options (override the parent's).
    pub common: Common,
    /// Override.
    pub sh: Option<String>,
    /// Override; kept as written, an unknown name falls back to the parent's.
    pub builtin: Option<String>,
    /// Override.
    pub value: Option<String>,
    /// Override.
    pub env: Option<EnvVars>,
    /// Override.
    pub cwd: Option<String>,
}

/// `id` + `alias`: another name for a section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AliasEntry {
    /// The old name.
    pub id: String,
    /// The section it stands for.
    pub alias: String,
    /// Selecting it prints a warning.
    pub deprecated: Option<bool>,
}

/// A `sections:` entry of a config file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawEntry {
    /// Shell section.
    Sh(ShEntry),
    /// Built-in section.
    Builtin(BuiltinEntry),
    /// Static text section.
    Value(ValueEntry),
    /// Reference to a parent section.
    Ref(RefEntry),
    /// Alias declaration.
    Alias(AliasEntry),
}

/// Per-file text appended to status lines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusEnricher {
    /// A command printing `path<TAB>text` lines.
    Sh {
        /// Enricher id (a later layer with the same id replaces it).
        id: String,
        /// Shell command.
        sh: String,
        /// Extra environment.
        env: Option<EnvVars>,
        /// Working directory.
        cwd: Option<String>,
    },
    /// Diff stats computed by the git adapter.
    GitStats {
        /// Enricher id.
        id: String,
    },
}

impl StatusEnricher {
    /// Enricher id.
    pub fn id(&self) -> &str {
        match self {
            Self::Sh { id, .. } | Self::GitStats { id } => id,
        }
    }
}

/// What one config file says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RawConfig {
    /// Dotenv paths. Accepted but never loaded, like the TS tool.
    pub dotenv: Option<Vec<String>>,
    /// Sections.
    pub sections: Option<Vec<RawEntry>>,
    /// Status enrichers.
    pub status_enrichers: Option<Vec<StatusEnricher>>,
}

/// A section ready to run. `sh` wins over `builtin`, which wins over `value`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolvedSection {
    /// Section id.
    pub id: String,
    /// Shell command.
    pub sh: Option<String>,
    /// Built-in provider.
    pub builtin: Option<Builtin>,
    /// Static text.
    pub value: Option<String>,
    /// Shared options.
    pub common: Common,
    /// Extra environment.
    pub env: Option<EnvVars>,
    /// Working directory.
    pub cwd: Option<String>,
}

/// The fully resolved configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecapConfig {
    /// Sections, in display order.
    pub sections: Vec<ResolvedSection>,
    /// Status enrichers.
    pub status_enrichers: Vec<StatusEnricher>,
    /// Section aliases.
    pub section_aliases: Vec<AliasEntry>,
    /// Warnings gathered while resolving.
    pub warnings: Vec<String>,
    /// Dotenv files, most local layer first (the first file wins).
    pub dotenv: Vec<String>,
}

/// Output of one section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SectionData {
    /// Section id.
    pub id: String,
    /// Title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Non-empty output lines.
    pub lines: Vec<String>,
    /// Separator printed before the section.
    pub separator: Separator,
    /// Why the section failed, if it did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The sections every config starts from.
pub fn hardcoded_sections() -> Vec<ResolvedSection> {
    let sh = |id: &str, sh: &str| ResolvedSection {
        id: id.into(),
        sh: Some(sh.into()),
        ..Default::default()
    };
    let builtin = |id: &str, b: Builtin, separator, max_lines| ResolvedSection {
        id: id.into(),
        builtin: Some(b),
        common: Common {
            separator,
            max_lines,
            title: None,
        },
        ..Default::default()
    };
    vec![
        sh(
            "git-branch-track",
            "git status --short --branch --ahead-behind | head -1 | cut -c4-",
        ),
        builtin(
            "git-subdir",
            Builtin::GitSubdir,
            Some(Separator::None),
            None,
        ),
        builtin("git-ops", Builtin::GitOps, None, None),
        builtin("git-log", Builtin::GitLog, None, Some(6)),
        builtin("git-stash", Builtin::GitStash, None, None),
        builtin("status", Builtin::Status, None, None),
    ]
}

/// The enrichers every config starts from.
pub fn hardcoded_status_enrichers() -> Vec<StatusEnricher> {
    vec![StatusEnricher::GitStats {
        id: "git-stats".into(),
    }]
}

/// The aliases every config starts from.
pub fn hardcoded_section_aliases() -> Vec<AliasEntry> {
    vec![AliasEntry {
        id: "git-status".into(),
        alias: "status".into(),
        deprecated: Some(true),
    }]
}
