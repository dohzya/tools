/// Why a selector could not be turned into a section.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// Not a valid section id (8 hex characters) nor a heading selector.
    #[error("Invalid section ID: {0}")]
    InvalidId(String),
    /// Starts with `#` but has more than 6 hashes or no title.
    #[error("Invalid heading selector: {0}")]
    InvalidHeadingSelector(String),
    /// No section has this id, or this level and title.
    #[error("No section matches '{0}'")]
    SectionNotFound(String),
    /// Several sections have this level and title: use an id.
    #[error("Multiple sections match heading '{0}'")]
    AmbiguousSection(String),
    /// The frontmatter is not valid YAML (or has duplicate keys): it is read
    /// as nothing and never rewritten (spec decision 10).
    #[error("Cannot parse the frontmatter: {0}")]
    FrontmatterParse(String),
    /// The key path to delete does not exist.
    #[error("Key '{0}' not found")]
    KeyNotFound(String),
    /// The key path cannot be set (path, reason).
    #[error("Cannot set '{0}': {1}")]
    InvalidKeyPath(String, String),
    /// No edit mechanism produced a result that reads back as intended.
    #[error("Cannot edit '{0}' in the frontmatter without risking its content")]
    FrontmatterEdit(String),
}

impl Error {
    /// Stable machine-readable code (the `error: <code>` of the CLI).
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidId(_) | Self::InvalidHeadingSelector(_) => "invalid_id",
            Self::SectionNotFound(_) => "section_not_found",
            Self::AmbiguousSection(_) => "ambiguous_section",
            Self::FrontmatterParse(_)
            | Self::KeyNotFound(_)
            | Self::InvalidKeyPath(..)
            | Self::FrontmatterEdit(_) => "parse_error",
        }
    }
}
