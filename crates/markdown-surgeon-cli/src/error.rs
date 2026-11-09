//! Failures reported as `error: <code>` on stderr with exit status 1.

use std::fmt;

/// A command failure. `code` is the machine-readable part of the contract.
#[derive(Debug)]
pub struct Fail {
    pub code: &'static str,
    pub message: String,
}

impl Fail {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn parse(message: impl Into<String>) -> Self {
        Self::new("parse_error", message)
    }
}

impl From<md_manipulator::Error> for Fail {
    fn from(e: md_manipulator::Error) -> Self {
        Self::new(e.code(), e.to_string())
    }
}

impl fmt::Display for Fail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "error: {}\n{}", self.code, self.message)
    }
}
