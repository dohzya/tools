//! Failures of a recap run, reported as `recap error: <message>` (exit 1).

use std::fmt;

/// Machine-readable kind of failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// A config path was expected but is missing.
    ConfigNotFound,
    /// A config file is not valid YAML.
    ConfigParse,
    /// A config file or a selection does not match the expected shape.
    ConfigValidation,
    /// A `ref:` entry points to a section the parent level does not have.
    RefNotFound,
    /// A file or directory could not be read or written.
    Io,
}

/// A recap failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecapError {
    /// What kind of failure it is.
    pub code: ErrorCode,
    /// Human-readable description.
    pub message: String,
}

impl RecapError {
    /// Builds an error.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for RecapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RecapError {}
