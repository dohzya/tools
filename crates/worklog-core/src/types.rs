//! Plain data of a worklog: statuses, trace kinds, entries, checkpoints, todos
//! and task links. Field order is the JSON key order of the command outputs.

use crate::ordered::OrderedMap;
use serde::{Deserialize, Serialize};

/// Lifecycle status of a task.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Created,
    Ready,
    Started,
    Done,
    Cancelled,
}

impl TaskStatus {
    /// All statuses, in lifecycle order.
    pub const ALL: [TaskStatus; 5] = [
        TaskStatus::Created,
        TaskStatus::Ready,
        TaskStatus::Started,
        TaskStatus::Done,
        TaskStatus::Cancelled,
    ];

    /// Name as written in files and output.
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Created => "created",
            TaskStatus::Ready => "ready",
            TaskStatus::Started => "started",
            TaskStatus::Done => "done",
            TaskStatus::Cancelled => "cancelled",
        }
    }

    /// Parses a status name.
    pub fn parse(s: &str) -> Option<TaskStatus> {
        TaskStatus::ALL.into_iter().find(|t| t.as_str() == s)
    }

    /// Done or cancelled.
    pub fn is_closed(self) -> bool {
        matches!(self, TaskStatus::Done | TaskStatus::Cancelled)
    }
}

/// Classification of a trace entry.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TraceKind {
    Action,
    Info,
    State,
    Hypothesis,
    Finding,
    Learning,
}

impl TraceKind {
    /// All kinds.
    pub const ALL: [TraceKind; 6] = [
        TraceKind::Action,
        TraceKind::Info,
        TraceKind::State,
        TraceKind::Hypothesis,
        TraceKind::Finding,
        TraceKind::Learning,
    ];

    /// Name as written in files and output.
    pub fn as_str(self) -> &'static str {
        match self {
            TraceKind::Action => "action",
            TraceKind::Info => "info",
            TraceKind::State => "state",
            TraceKind::Hypothesis => "hypothesis",
            TraceKind::Finding => "finding",
            TraceKind::Learning => "learning",
        }
    }

    /// Parses a kind name.
    pub fn parse(s: &str) -> Option<TraceKind> {
        TraceKind::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

/// A timestamped trace of a task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    /// Stable id within the task (hash of the timestamp and its occurrence).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// `YYYY-MM-DD HH:mm`.
    pub ts: String,
    /// Message.
    pub msg: String,
    /// Optional kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<TraceKind>,
    /// Wall-clock time of the call, set when `ts` was given explicitly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
}

/// A synthesis of the traces before it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Checkpoint {
    /// `YYYY-MM-DD HH:mm`.
    pub ts: String,
    /// What changed.
    pub changes: String,
    /// What was learned.
    pub learnings: String,
}

/// Status of a todo.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TodoStatus {
    Todo,
    Wip,
    Blocked,
    Cancelled,
    Done,
}

impl TodoStatus {
    /// Char between the brackets of the checkbox.
    pub fn marker(self) -> char {
        match self {
            TodoStatus::Todo => ' ',
            TodoStatus::Wip => '/',
            TodoStatus::Blocked => '>',
            TodoStatus::Cancelled => '-',
            TodoStatus::Done => 'x',
        }
    }

    /// Status of a checkbox char; anything unknown is `todo`.
    pub fn from_marker(c: char) -> TodoStatus {
        match c {
            '/' => TodoStatus::Wip,
            '>' => TodoStatus::Blocked,
            '-' => TodoStatus::Cancelled,
            'x' => TodoStatus::Done,
            _ => TodoStatus::Todo,
        }
    }

    /// Status named on the command line.
    pub fn parse(s: &str) -> Option<TodoStatus> {
        match s {
            "todo" => Some(TodoStatus::Todo),
            "wip" => Some(TodoStatus::Wip),
            "blocked" => Some(TodoStatus::Blocked),
            "cancelled" => Some(TodoStatus::Cancelled),
            "done" => Some(TodoStatus::Done),
            _ => None,
        }
    }

    /// Done or cancelled.
    pub fn is_closed(self) -> bool {
        matches!(self, TodoStatus::Done | TodoStatus::Cancelled)
    }
}

/// An action item of a task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Todo {
    /// 7-char base62 id.
    pub id: String,
    /// Text.
    pub text: String,
    /// Status.
    pub status: TodoStatus,
    /// `[key:: value]` fields.
    pub metadata: OrderedMap<String>,
}

/// Non-hierarchical link kinds.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkType {
    #[serde(rename = "depends_on")]
    DependsOn,
    #[serde(rename = "blocks")]
    Blocks,
    #[serde(rename = "related")]
    Related,
}

impl LinkType {
    /// Name as written in files.
    pub fn as_str(self) -> &'static str {
        match self {
            LinkType::DependsOn => "depends_on",
            LinkType::Blocks => "blocks",
            LinkType::Related => "related",
        }
    }

    /// Parses the file spelling.
    pub fn parse(s: &str) -> Option<LinkType> {
        match s {
            "depends_on" => Some(LinkType::DependsOn),
            "blocks" => Some(LinkType::Blocks),
            "related" => Some(LinkType::Related),
            _ => None,
        }
    }

    /// The type seen from the other task.
    pub fn reciprocal(self) -> LinkType {
        match self {
            LinkType::DependsOn => LinkType::Blocks,
            LinkType::Blocks => LinkType::DependsOn,
            LinkType::Related => LinkType::Related,
        }
    }
}

/// A link to another task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskLink {
    /// Link type.
    #[serde(rename = "type")]
    pub kind: LinkType,
    /// Full id of the other task.
    pub task: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_roundtrip() {
        for s in TaskStatus::ALL {
            assert_eq!(TaskStatus::parse(s.as_str()), Some(s));
        }
        for k in TraceKind::ALL {
            assert_eq!(TraceKind::parse(k.as_str()), Some(k));
        }
        assert_eq!(TaskStatus::parse("active"), None);
        assert!(TaskStatus::Cancelled.is_closed() && !TaskStatus::Started.is_closed());
    }

    #[test]
    fn todo_markers_and_link_reciprocals() {
        for s in [
            TodoStatus::Todo,
            TodoStatus::Wip,
            TodoStatus::Blocked,
            TodoStatus::Cancelled,
            TodoStatus::Done,
        ] {
            assert_eq!(TodoStatus::from_marker(s.marker()), s);
        }
        assert_eq!(TodoStatus::from_marker('?'), TodoStatus::Todo);
        assert_eq!(LinkType::DependsOn.reciprocal(), LinkType::Blocks);
        assert_eq!(LinkType::Related.reciprocal(), LinkType::Related);
        assert_eq!(LinkType::parse("depends_on"), Some(LinkType::DependsOn));
    }
}
