//! Errors of the worklog domain: a machine-readable code plus a message.

use serde::Serialize;

/// Machine-readable error code, printed as `error: <code>` and in JSON mode.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    NotInitialized,
    AlreadyInitialized,
    AlreadyHasParent,
    InvalidState,
    TaskNotFound,
    InvalidTaskFile,
    TaskAlreadyDone,
    NoUncheckpointedEntries,
    InvalidArgs,
    IoError,
    WorktreeNotFound,
    ImportSourceNotFound,
    NotInGitRepo,
    ScopeNotFound,
    ScopeAmbiguous,
    ScopeHasTasks,
    TodoNotFound,
    TraceNotFound,
    TaskHasPendingTodos,
    NoAgentDetected,
}

impl Code {
    /// The code as printed.
    pub fn as_str(self) -> &'static str {
        match self {
            Code::NotInitialized => "not_initialized",
            Code::AlreadyInitialized => "already_initialized",
            Code::AlreadyHasParent => "already_has_parent",
            Code::InvalidState => "invalid_state",
            Code::TaskNotFound => "task_not_found",
            Code::InvalidTaskFile => "invalid_task_file",
            Code::TaskAlreadyDone => "task_already_done",
            Code::NoUncheckpointedEntries => "no_uncheckpointed_entries",
            Code::InvalidArgs => "invalid_args",
            Code::IoError => "io_error",
            Code::WorktreeNotFound => "worktree_not_found",
            Code::ImportSourceNotFound => "import_source_not_found",
            Code::NotInGitRepo => "not_in_git_repo",
            Code::ScopeNotFound => "scope_not_found",
            Code::ScopeAmbiguous => "scope_ambiguous",
            Code::ScopeHasTasks => "scope_has_tasks",
            Code::TodoNotFound => "todo_not_found",
            Code::TraceNotFound => "trace_not_found",
            Code::TaskHasPendingTodos => "task_has_pending_todos",
            Code::NoAgentDetected => "no_agent_detected",
        }
    }
}

/// A domain error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WtError {
    /// Machine-readable code.
    pub code: Code,
    /// Human-readable message.
    pub message: String,
}

impl WtError {
    /// Builds an error.
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        WtError {
            code,
            message: message.into(),
        }
    }

    /// `{"error":..,"code":..,"message":..}` on one line.
    pub fn to_json(&self) -> String {
        #[derive(Serialize)]
        struct J<'a> {
            error: &'a str,
            code: &'a str,
            message: &'a str,
        }
        serde_json::to_string(&J {
            error: self.code.as_str(),
            code: self.code.as_str(),
            message: &self.message,
        })
        .unwrap_or_default()
    }

    /// `error: <code>\n<message>`
    pub fn to_text(&self) -> String {
        format!("error: {}\n{}", self.code.as_str(), self.message)
    }
}

impl std::fmt::Display for WtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for WtError {}

/// Result alias of the domain.
pub type WtResult<T> = Result<T, WtError>;

/// `Err(WtError)` shorthand.
pub fn err<T>(code: Code, message: impl Into<String>) -> WtResult<T> {
    Err(WtError::new(code, message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_text_and_json() {
        let e = WtError::new(Code::TaskNotFound, "No task: x");
        assert_eq!(e.to_text(), "error: task_not_found\nNo task: x");
        assert_eq!(
            e.to_json(),
            r#"{"error":"task_not_found","code":"task_not_found","message":"No task: x"}"#
        );
    }
}
