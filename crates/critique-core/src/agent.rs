//! Agent-facing view of review items (the JSON shape of `list --json`,
//! session snapshots and `agent` commands).

use crate::ids::fingerprint;
use crate::review::{self, ReviewItem};
use crate::scan::{self, Kind, Status};
use serde::{Deserialize, Serialize};

/// A message of a conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentMessage {
    /// `@`, `@me` or `@agent`.
    pub author: String,
    /// Text.
    pub body: String,
    /// Timestamp value as written.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub timestamp: Option<String>,
}

/// One item as seen by an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentItem {
    /// Persistent id.
    pub id: String,
    /// File (cwd-relative, `/`).
    pub file: String,
    /// First line.
    pub line_start: usize,
    /// Last line.
    pub line_end: usize,
    /// Kind name.
    pub kind: String,
    /// `open`, `wip`, `handled`, `resolved`, `discussion` or `annotation`.
    pub state: String,
    /// First message.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub first_message: Option<AgentMessage>,
    /// Last message.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_message: Option<AgentMessage>,
    /// Summary.
    pub context: String,
    /// What to do next.
    pub suggested_action: String,
    /// Timestamp-insensitive content hash.
    pub raw_hash: String,
}

/// Status name.
pub fn status_name(status: Status) -> &'static str {
    match status {
        Status::Open => "open",
        Status::Wip => "wip",
        Status::Handled => "handled",
        Status::Resolved => "resolved",
    }
}

fn state_of(item: &ReviewItem) -> String {
    match item.ann.kind {
        Kind::Conversation => status_name(scan::conversation_status(&item.ann.raw)).to_string(),
        Kind::Discussion => "discussion".to_string(),
        _ => "annotation".to_string(),
    }
}

fn suggested_action(item: &ReviewItem) -> &'static str {
    if item.ann.kind != Kind::Conversation {
        return "review annotation";
    }
    match scan::conversation_status(&item.ann.raw) {
        Status::Open => "answer",
        Status::Wip => "wait for human input",
        Status::Handled => "reply",
        Status::Resolved => "clean after validation",
    }
}

/// Agent view of a message.
pub fn message(m: review::Message) -> AgentMessage {
    AgentMessage {
        author: m.marker.as_str().to_string(),
        body: m.body,
        timestamp: m.timestamp,
    }
}

/// Builds the agent view of an item.
pub fn to_agent_item(file: &str, id: &str, item: &ReviewItem) -> AgentItem {
    let messages = if item.ann.kind == Kind::Conversation {
        review::messages(&item.ann.raw)
    } else {
        Vec::new()
    };
    AgentItem {
        id: id.to_string(),
        file: file.to_string(),
        line_start: item.ann.line_start,
        line_end: item.ann.line_end,
        kind: item.ann.kind.as_str().to_string(),
        state: state_of(item),
        first_message: messages.first().cloned().map(message),
        last_message: messages.last().cloned().map(message),
        context: review::summarize(&item.ann),
        suggested_action: suggested_action(item).to_string(),
        raw_hash: fingerprint(&item.ann.raw),
    }
}

/// Per-file part of a session snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    /// File (cwd-relative, `/`).
    pub path: String,
    /// `compact`, `hangul`, `iso`, `mixed` or `none`.
    pub timestamp_format: String,
    /// SHA-1 of the content at session start.
    pub content_hash: String,
    /// Ids of the items at session start.
    pub item_ids: Vec<String>,
    /// Content to restore on rollback.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub original_content: Option<String>,
}

/// `agent-session.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    /// Format version.
    pub version: i64,
    /// ISO start time.
    pub started_at: String,
    /// Directory the session started in.
    pub cwd: String,
    /// Files.
    pub files: Vec<FileSnapshot>,
    /// Items at start.
    pub items: Vec<AgentItem>,
    /// Items dismissed after human validation.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dismissed_item_ids: Option<Vec<String>>,
}

/// A violated rule of the agent protocol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Guardrail {
    /// Item id (or file for format drift).
    pub id: String,
    /// File.
    pub file: String,
    /// Line.
    pub line: usize,
    /// What is wrong.
    pub message: String,
}

/// Counters shown by `session done`, `agent status`, `agent diff`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    /// Format version.
    pub version: u32,
    /// Files holding items.
    pub files_annotated: usize,
    /// Files whose content changed since the snapshot.
    pub files_modified: usize,
    /// Conversations the agent answered.
    pub conversations_answered: usize,
    /// Resolved conversations.
    pub cleanable_conversations: Vec<AgentItem>,
    /// Open or wip conversations.
    pub remaining_open_items: Vec<AgentItem>,
    /// Protocol violations.
    pub guardrail_failures: Vec<Guardrail>,
}

/// A [`Handoff`] with the current items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionStatus {
    #[serde(flatten)]
    /// Counters.
    pub handoff: Handoff,
    /// Current items.
    pub items: Vec<AgentItem>,
}

/// Result of `agent respond` / `agent apply`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActionResult {
    /// Item id.
    pub id: String,
    /// File.
    pub file: String,
    /// Line.
    pub line: usize,
    /// `responded` or `applied`.
    pub action: String,
    /// Message.
    pub message: String,
}

/// Result of `agent clean`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    /// Format version.
    pub version: u32,
    /// Nothing was written.
    pub dry_run: bool,
    /// Conversations removed.
    pub cleaned: usize,
    /// Conversations concerned.
    pub cleanable: Vec<AgentItem>,
}

/// Result of `session rollback`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    /// Format version.
    pub version: u32,
    /// Restored files.
    pub rolled_back_files: Vec<String>,
    /// The snapshot was deleted.
    pub session_closed: bool,
}

/// Dominant timestamp format of a file (`mixed` below 90 %, `none` without timestamps).
pub fn detect_timestamp_format(stats: crate::scan::FormatStats) -> &'static str {
    let total = stats.compact + stats.hangul + stats.iso;
    if total == 0 {
        return "none";
    }
    for (name, count) in [
        ("compact", stats.compact),
        ("hangul", stats.hangul),
        ("iso", stats.iso),
    ] {
        if count as f64 / total as f64 >= 0.9 {
            return name;
        }
    }
    "mixed"
}
