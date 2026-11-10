//! The worklog index (`index.json`): a denormalized view of every task, used
//! to list and resolve tasks without opening their files.

use crate::json::J;
use crate::taskfile::normalize_desc;
use crate::types::{LinkType, TaskLink, TaskStatus};
use crate::yaml::Value;

/// The index, as JSON with ordered keys: `{ version, tasks: { id: entry } }`.
#[derive(Debug, Clone, PartialEq)]
pub struct Index {
    /// The whole document.
    pub root: J,
}

/// Typed view of an index entry.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexEntry {
    /// Short name (absent in v1 indexes).
    pub name: Option<String>,
    /// Description parts.
    pub desc: Vec<String>,
    /// Status, if a known one.
    pub status: Option<TaskStatus>,
    /// Creation timestamp.
    pub created: String,
    /// Last status change.
    pub status_updated_at: String,
    /// Completion timestamp.
    pub done_at: Option<String>,
    /// Cancellation timestamp.
    pub cancelled_at: Option<String>,
    /// Own tags.
    pub tags: Vec<String>,
    /// Parent task id.
    pub parent: Option<String>,
    /// Links.
    pub links: Vec<TaskLink>,
}

fn opt_str(j: &J, key: &str) -> Option<String> {
    match j.get(key) {
        Some(J::Str(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

impl IndexEntry {
    /// Reads an entry from its JSON object.
    pub fn from_json(j: &J) -> IndexEntry {
        let strings = |key: &str| -> Vec<String> {
            match j.get(key) {
                Some(J::Arr(a)) => a
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect(),
                _ => Vec::new(),
            }
        };
        let links = match j.get("links") {
            Some(J::Arr(a)) => a
                .iter()
                .filter_map(|l| {
                    Some(TaskLink {
                        kind: LinkType::parse(l.get("type")?.as_str()?)?,
                        task: l.get("task")?.as_str()?.to_string(),
                    })
                })
                .collect(),
            _ => Vec::new(),
        };
        IndexEntry {
            name: opt_str(j, "name"),
            desc: strings("desc"),
            status: j
                .get("status")
                .and_then(J::as_str)
                .and_then(TaskStatus::parse),
            created: j
                .get("created")
                .and_then(J::as_str)
                .unwrap_or_default()
                .to_string(),
            status_updated_at: j
                .get("status_updated_at")
                .and_then(J::as_str)
                .unwrap_or_default()
                .to_string(),
            done_at: opt_str(j, "done_at"),
            cancelled_at: opt_str(j, "cancelled_at"),
            tags: strings("tags"),
            parent: opt_str(j, "parent"),
            links,
        }
    }
}

/// JSON of a link list.
pub fn links_json(links: &[TaskLink]) -> J {
    J::Arr(
        links
            .iter()
            .map(|l| {
                J::Obj(vec![
                    ("type".into(), J::str(l.kind.as_str())),
                    ("task".into(), J::str(l.task.clone())),
                ])
            })
            .collect(),
    )
}

impl Index {
    /// `{ "version": 2, "tasks": {} }`
    pub fn empty() -> Index {
        Index {
            root: J::Obj(vec![
                ("version".into(), J::int(2)),
                ("tasks".into(), J::obj()),
            ]),
        }
    }

    /// Parses `index.json`; every `desc` is normalized to an array of parts.
    pub fn parse(text: &str, normalize: bool) -> Result<Index, serde_json::Error> {
        let mut root = J::parse(text)?;
        if normalize && let Some(J::Obj(tasks)) = root.get_mut("tasks") {
            for (_, entry) in tasks.iter_mut() {
                let parts = normalize_desc(entry.get("desc").map(to_yaml).as_ref());
                entry.set("desc", Some(J::strings(parts)));
            }
        }
        Ok(Index { root })
    }

    /// `JSON.stringify(index, null, 2)`
    pub fn to_text(&self) -> String {
        self.root.to_pretty()
    }

    /// Format version, 0 when absent.
    pub fn version(&self) -> i64 {
        match self.root.get("version") {
            Some(J::Num(n)) => n.as_i64().unwrap_or(0),
            _ => 0,
        }
    }

    /// Task ids in index order.
    pub fn ids(&self) -> Vec<String> {
        match self.root.get("tasks") {
            Some(J::Obj(m)) => m.iter().map(|(k, _)| k.clone()).collect(),
            _ => Vec::new(),
        }
    }

    /// Raw entries in index order.
    pub fn raw_entries(&self) -> &[(String, J)] {
        match self.root.get("tasks") {
            Some(J::Obj(m)) => m,
            _ => &[],
        }
    }

    /// Typed entries in index order.
    pub fn entries(&self) -> Vec<(String, IndexEntry)> {
        self.raw_entries()
            .iter()
            .map(|(id, j)| (id.clone(), IndexEntry::from_json(j)))
            .collect()
    }

    /// Typed entry of a task.
    pub fn entry(&self, id: &str) -> Option<IndexEntry> {
        self.raw(id).map(IndexEntry::from_json)
    }

    /// Raw entry of a task.
    pub fn raw(&self, id: &str) -> Option<&J> {
        self.root.get("tasks")?.get(id)
    }

    /// Whether a task is indexed.
    pub fn contains(&self, id: &str) -> bool {
        self.raw(id).is_some()
    }

    fn tasks_mut(&mut self) -> &mut J {
        if self.root.get("tasks").is_none() {
            self.root.set("tasks", Some(J::obj()));
        }
        self.root.get_mut("tasks").expect("tasks was just created")
    }

    /// Adds or replaces an entry (replacement keeps the position).
    pub fn put(&mut self, id: &str, entry: J) {
        self.tasks_mut().set(id, Some(entry));
    }

    /// Sets (`Some`) or drops (`None`) fields of an entry, like
    /// `{...existing, ...updates}` followed by `JSON.stringify`.
    pub fn update(&mut self, id: &str, updates: Vec<(&str, Option<J>)>) -> bool {
        let Some(entry) = self.tasks_mut().get_mut(id) else {
            return false;
        };
        for (k, v) in updates {
            entry.set(k, v);
        }
        true
    }

    /// Removes a task.
    pub fn remove(&mut self, id: &str) -> bool {
        self.tasks_mut().remove(id).is_some()
    }

    /// Sets the format version.
    pub fn set_version(&mut self, v: i64) {
        self.root.set("version", Some(J::int(v)));
    }

    /// Shortest unambiguous prefix (5 chars minimum) plus one char of margin.
    pub fn short_id(&self, id: &str) -> String {
        short_id(id, &self.ids())
    }
}

/// `getShortId`: the shortest prefix of at least 5 chars not shared with
/// another id, plus one char of margin.
pub fn short_id(id: &str, all: &[String]) -> String {
    let chars: Vec<char> = id.chars().collect();
    let mut len = 5;
    while len < chars.len() {
        let prefix: String = chars[..len].iter().collect::<String>().to_lowercase();
        let conflict = all
            .iter()
            .any(|o| o != id && o.to_lowercase().starts_with(&prefix));
        if !conflict {
            return chars[..(len + 1).min(chars.len())].iter().collect();
        }
        len += 1;
    }
    id.to_string()
}

/// Converts a JSON description value to the YAML model shared with task files.
fn to_yaml(j: &J) -> Value {
    match j {
        J::Null => Value::Null,
        J::Bool(b) => Value::Bool(*b),
        J::Num(n) => n
            .as_i64()
            .map_or_else(|| Value::Float(n.as_f64().unwrap_or(0.0)), Value::Int),
        J::Str(s) => Value::Str(s.clone()),
        J::Arr(a) => Value::Seq(a.iter().map(to_yaml).collect()),
        J::Obj(m) => Value::Map(m.iter().map(|(k, v)| (k.clone(), to_yaml(v))).collect()),
    }
}

/// Case-insensitive prefix matches among ids.
pub fn prefix_matches(prefix: &str, ids: &[String]) -> Vec<String> {
    let p = prefix.to_lowercase();
    ids.iter()
        .filter(|id| id.to_lowercase().starts_with(&p))
        .cloned()
        .collect()
}

/// `YYYY-MM-DDTHH:mm...` to `YYYY-MM-DD HH:mm` (`slice(0, 16)` then the first
/// `T` replaced).
pub fn format_short(iso: &str) -> String {
    let head: String = iso.chars().take(16).collect();
    head.replacen('T', " ", 1)
}

/// Validates a tag. Returns the error message.
pub fn validate_tag(tag: &str) -> Option<&'static str> {
    if tag.is_empty() {
        return Some("Tag cannot be empty");
    }
    if tag.encode_utf16().count() > 100 {
        return Some("Tag too long (max 100 characters)");
    }
    if tag.chars().any(char::is_whitespace) {
        return Some("Tag cannot contain whitespace");
    }
    if tag.starts_with('/') || tag.ends_with('/') {
        return Some("Tag cannot start or end with /");
    }
    if tag.contains("//") {
        return Some("Tag cannot contain consecutive slashes");
    }
    if !tag
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-'))
    {
        return Some("Tag contains invalid characters (allowed: a-z A-Z 0-9 / - _)");
    }
    None
}

/// Hierarchical tag match: `feat` matches `feat` and `feat/auth`.
pub fn matches_tag_pattern(pattern: &str, tag: &str) -> bool {
    pattern == tag
        || tag
            .strip_prefix(pattern)
            .is_some_and(|r| r.starts_with('/'))
}
