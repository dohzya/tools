//! Task files: a YAML frontmatter followed by `# Entries`, `# Checkpoints` and
//! an optional `# TODO` section. The functions work on the text (LF line
//! endings) and splice it, so a command only touches what it changes.
//!
//! The section scanner mirrors the TS one on purpose (a line regex plus a
//! fence toggle, not CommonMark): the files are machine-written and the exact
//! line arithmetic decides where entries are inserted.

use crate::error::{Code, WtResult, err};
use crate::ordered::OrderedMap;
use crate::types::{
    Checkpoint, Entry, LinkType, TaskLink, TaskStatus, Todo, TodoStatus, TraceKind,
};
use crate::yaml::{self, Value};
use md_manipulator::section_id;

/// A heading of the task file.
#[derive(Debug, Clone)]
struct Section {
    level: usize,
    title: String,
    /// 1-based line of the heading.
    line: usize,
    /// 1-based last line of the section (up to the next heading, any level).
    line_end: usize,
}

struct Doc {
    lines: Vec<String>,
    sections: Vec<Section>,
    has_frontmatter: bool,
    /// 1-based line of the closing `---`; 0 without frontmatter.
    frontmatter_end_line: usize,
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

// `^(#{1,6})\s+(.+)$` (`.` excludes line terminators).
fn heading(line: &str) -> Option<(usize, String)> {
    let level = line.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &line[level..];
    let first = rest.chars().next()?;
    if !first.is_whitespace() || rest.chars().count() < 2 {
        return None;
    }
    if rest.contains(['\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some((level, js_trim(rest).to_string()))
}

fn parse_doc(content: &str) -> Doc {
    let lines: Vec<String> = content.split('\n').map(str::to_string).collect();
    let mut has_frontmatter = false;
    let mut frontmatter_end_line = 0;
    let mut start = 0;
    if lines.first().is_some_and(|l| js_trim(l) == "---") {
        for (i, l) in lines.iter().enumerate().skip(1) {
            if js_trim(l) == "---" {
                has_frontmatter = true;
                frontmatter_end_line = i + 1;
                start = i + 1;
                break;
            }
        }
    }
    let mut sections: Vec<Section> = Vec::new();
    let mut in_code = false;
    for (i, line) in lines.iter().enumerate().skip(start) {
        let t = js_trim(line);
        if t.starts_with("```") || t.starts_with("~~~") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        if let Some((level, title)) = heading(line) {
            sections.push(Section {
                level,
                title,
                line: i + 1,
                line_end: lines.len(),
            });
        }
    }
    for i in 0..sections.len() {
        if i + 1 < sections.len() {
            sections[i].line_end = sections[i + 1].line - 1;
        } else {
            let mut last = lines.len();
            while last > sections[i].line && js_trim(&lines[last - 1]).is_empty() {
                last -= 1;
            }
            sections[i].line_end = last;
        }
    }
    Doc {
        lines,
        sections,
        has_frontmatter,
        frontmatter_end_line,
    }
}

impl Doc {
    /// First level-1 heading with this (case-insensitive) title.
    fn find(&self, title: &str) -> Option<usize> {
        self.sections
            .iter()
            .position(|s| s.level == 1 && js_trim(&s.title).to_lowercase() == title)
    }

    fn end_line(&self, idx: usize, deep: bool) -> usize {
        let s = &self.sections[idx];
        if !deep {
            return s.line_end;
        }
        if let Some(n) = self.sections[idx + 1..].iter().find(|n| n.level <= s.level) {
            return n.line - 1;
        }
        let mut last = self.lines.len();
        while last > s.line && js_trim(&self.lines[last - 1]).is_empty() {
            last -= 1;
        }
        last
    }

    fn slice(&self, from: usize, to: usize) -> &[String] {
        let to = to.min(self.lines.len());
        if from >= to {
            &[]
        } else {
            &self.lines[from..to]
        }
    }

    fn frontmatter_yaml(&self) -> String {
        if !self.has_frontmatter {
            return String::new();
        }
        self.lines[1..self.frontmatter_end_line - 1].join("\n")
    }
}

/// `String(value)` of a frontmatter value.
fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => f.to_string(),
        Value::Str(s) => s.clone(),
        Value::Seq(s) => s.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Map(_) => "[object Object]".into(),
    }
}

/// Normalizes a description value to its non-empty parts.
pub fn normalize_desc(v: Option<&Value>) -> Vec<String> {
    match v {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Seq(items)) => items
            .iter()
            .map(js_string)
            .filter(|p| !p.is_empty())
            .collect(),
        Some(other) => {
            let t = js_string(other);
            if t.is_empty() { Vec::new() } else { vec![t] }
        }
    }
}

/// A parsed task file. `fm` keeps every frontmatter key, known or not.
#[derive(Debug, Clone)]
pub struct TaskFile {
    /// Raw frontmatter, in file order.
    pub fm: Vec<(String, Value)>,
    /// Trace entries, in file order.
    pub entries: Vec<Entry>,
    /// Checkpoints, in file order.
    pub checkpoints: Vec<Checkpoint>,
    /// Todos, in file order.
    pub todos: Vec<Todo>,
}

impl TaskFile {
    fn field(&self, key: &str) -> Option<&Value> {
        self.fm.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    fn text(&self, key: &str) -> Option<String> {
        match self.field(key)? {
            Value::Null => None,
            v => Some(js_string(v)),
        }
    }

    /// Full id.
    pub fn id(&self) -> String {
        self.text("id").unwrap_or_default()
    }

    /// Cross-worktree identity.
    pub fn uid(&self) -> Option<String> {
        self.text("uid").filter(|u| !u.is_empty())
    }

    /// Short name.
    pub fn name(&self) -> String {
        self.text("name").unwrap_or_default()
    }

    /// Description parts.
    pub fn desc(&self) -> Vec<String> {
        normalize_desc(self.field("desc"))
    }

    /// Status, when it is a known one.
    pub fn status(&self) -> Option<TaskStatus> {
        TaskStatus::parse(self.text("status")?.as_str())
    }

    /// `created_at`
    pub fn created_at(&self) -> String {
        self.text("created_at").unwrap_or_default()
    }

    /// A nullable timestamp field (`ready_at`, `started_at`, `done_at`, ...).
    pub fn timestamp(&self, key: &str) -> Option<String> {
        self.text(key).filter(|t| !t.is_empty())
    }

    /// `last_checkpoint`
    pub fn last_checkpoint(&self) -> Option<String> {
        self.timestamp("last_checkpoint")
    }

    /// `has_uncheckpointed_entries`
    pub fn has_uncheckpointed_entries(&self) -> bool {
        match self.field("has_uncheckpointed_entries") {
            Some(Value::Bool(b)) => *b,
            Some(Value::Null) | None => false,
            Some(Value::Str(s)) => !s.is_empty(),
            Some(Value::Int(i)) => *i != 0,
            Some(_) => true,
        }
    }

    /// Custom `metadata` key-values.
    pub fn metadata(&self) -> OrderedMap<String> {
        let mut out = OrderedMap::new();
        if let Some(Value::Map(m)) = self.field("metadata") {
            for (k, v) in m {
                out.insert(k.clone(), js_string(v));
            }
        }
        out
    }

    /// Own tags.
    pub fn tags(&self) -> Vec<String> {
        match self.field("tags") {
            Some(Value::Seq(items)) => items.iter().map(js_string).collect(),
            _ => Vec::new(),
        }
    }

    /// Parent task id.
    pub fn parent(&self) -> Option<String> {
        self.text("parent").filter(|p| !p.is_empty())
    }

    /// Non-hierarchical links.
    pub fn links(&self) -> Vec<TaskLink> {
        let Some(Value::Seq(items)) = self.field("links") else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|i| {
                let kind = LinkType::parse(i.get("type")?.as_str()?)?;
                let task = js_string(i.get("task")?);
                Some(TaskLink { kind, task })
            })
            .collect()
    }
}

fn parse_entry_title(title: &str) -> (String, Option<TraceKind>) {
    // /^(.*?)\s{2}\[kind::\s+([^\]]+)\]\s*$/
    if let Some(end) = title.trim_end().strip_suffix(']')
        && let Some(open) = end.rfind("[kind::")
    {
        let before = &end[..open];
        let kind_text = &end[open + "[kind::".len()..];
        let ws_len = kind_text.len() - kind_text.trim_start().len();
        if ws_len > 0
            && !kind_text.contains(']')
            && before.ends_with(|c: char| c.is_whitespace())
            && before
                .chars()
                .rev()
                .take(2)
                .filter(|c| c.is_whitespace())
                .count()
                == 2
            && !kind_text.trim().is_empty()
        {
            let kind = TraceKind::parse(js_trim(kind_text));
            let ts = before.trim_end().to_string();
            return (ts, kind);
        }
    }
    (title.to_string(), None)
}

// /^\[added::\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\n?([\s\S]*)$/
fn split_added(raw: &str) -> Option<(String, String)> {
    let rest = raw.strip_prefix("[added::")?;
    let t = rest.trim_start();
    if t.len() == rest.len() {
        return None;
    }
    let b = t.as_bytes();
    let digit = |i: usize| b.get(i).is_some_and(u8::is_ascii_digit);
    if !((0..4).all(digit)
        && b.get(4) == Some(&b'-')
        && (5..7).all(digit)
        && b.get(7) == Some(&b'-')
        && (8..10).all(digit))
    {
        return None;
    }
    let after_date = &t[10..];
    let t2 = after_date.trim_start();
    if t2.len() == after_date.len() {
        return None;
    }
    let b2 = t2.as_bytes();
    let digit2 = |i: usize| b2.get(i).is_some_and(u8::is_ascii_digit);
    if !(digit2(0) && digit2(1) && b2.get(2) == Some(&b':') && digit2(3) && digit2(4)) {
        return None;
    }
    if b2.get(5) != Some(&b']') {
        return None;
    }
    let date_text = format!("{} {}", &t[..10], &t2[..5]);
    let msg = &t2[6..];
    let msg = msg.strip_prefix('\n').unwrap_or(msg);
    Some((date_text, msg.to_string()))
}

fn is_ws_only_after(line: &str, prefix: &str) -> bool {
    line.strip_prefix(prefix)
        .is_some_and(|r| js_trim(r).is_empty())
}

// /^###\s+Changes\s*$/
fn is_h3(line: &str, names: &[&str]) -> bool {
    let Some(rest) = line.strip_prefix("###") else {
        return false;
    };
    let t = rest.trim_start();
    if t.len() == rest.len() {
        return false;
    }
    names.iter().any(|n| is_ws_only_after(t, n))
}

fn parse_todos(doc: &Doc) -> Vec<Todo> {
    let mut todos = Vec::new();
    let Some(ti) = doc.find("todo") else {
        return todos;
    };
    let section_line = doc.sections[ti].line;
    let end = doc.end_line(ti, true);
    for i in section_line + 1..end {
        let Some(line) = doc.lines.get(i) else { break };
        if let Some(todo) = parse_todo_line(line) {
            todos.push(todo);
        }
    }
    todos
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Parses `- [x] text  [k:: v] ^id`.
pub fn parse_todo_line(line: &str) -> Option<Todo> {
    // /^-\s*\[(.)\]\s*(.+)$/
    let rest = line.strip_prefix('-')?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('[')?;
    let mut chars = rest.chars();
    let marker = chars.next()?;
    if matches!(marker, '\r' | '\u{2028}' | '\u{2029}') {
        return None;
    }
    let rest = chars.as_str().strip_prefix(']')?;
    let rest_trim = rest.trim_start();
    // `.+` needs one char: backtrack into the whitespace when nothing else.
    let rest = if rest_trim.is_empty() {
        let last = rest.chars().last()?;
        &rest[rest.len() - last.len_utf8()..]
    } else {
        rest_trim
    };
    if rest.contains(['\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    // block reference: /\^(\w+)\s*$/
    let body = rest.trim_end();
    let id_len = body
        .chars()
        .rev()
        .take_while(|&c| is_word(c))
        .map(char::len_utf8)
        .sum::<usize>();
    if id_len == 0 {
        return None;
    }
    let caret = body.len() - id_len;
    if !body[..caret].ends_with('^') {
        return None;
    }
    let id = body[caret..].to_string();
    let before = js_trim(&body[..caret - 1]);
    let mut metadata = OrderedMap::new();
    for (key, value, _, _) in metadata_matches(before) {
        if key != "id" {
            metadata.insert(key, value);
        }
    }
    let text = js_trim(&strip_metadata(before)).to_string();
    Some(Todo {
        id,
        text,
        status: TodoStatus::from_marker(marker),
        metadata,
    })
}

/// `\[(\w+)::\s*([^\]]+)\]` matches: (key, trimmed value, start, end).
fn metadata_matches(s: &str) -> Vec<(String, String, usize, usize)> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(off) = s[pos..].find('[') {
        let start = pos + off;
        let after = &s[start + 1..];
        let key_len = after
            .chars()
            .take_while(|&c| is_word(c))
            .map(char::len_utf8)
            .sum::<usize>();
        if key_len > 0
            && let Some(rest) = after[key_len..].strip_prefix("::")
            && let Some(close) = rest.find(']')
            && close > 0
        {
            let value = js_trim(&rest[..close]).to_string();
            let end = start + 1 + key_len + 2 + close + 1;
            out.push((after[..key_len].to_string(), value, start, end));
            pos = end;
            continue;
        }
        pos = start + 1;
    }
    out
}

// text.replace(/\s*\[(\w+)::\s*([^\]]+)\]/g, "")
fn strip_metadata(s: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    for (_, _, start, end) in metadata_matches(s) {
        out.push_str(s[last..start].trim_end_matches(|c: char| c.is_whitespace()));
        last = end;
    }
    out.push_str(&s[last..]);
    out
}

/// Parses a task file.
pub fn parse_task_file(content: &str) -> WtResult<TaskFile> {
    let doc = parse_doc(content);
    if !doc.has_frontmatter {
        return err(
            Code::InvalidTaskFile,
            "Invalid task file: missing frontmatter",
        );
    }
    let fm = yaml::parse_mapping(&doc.frontmatter_yaml());
    let entries_idx = doc.find("entries");
    let checkpoints_idx = doc.find("checkpoints");

    let mut entries = Vec::new();
    let mut occurrences: Vec<(String, usize)> = Vec::new();
    if let Some(ei) = entries_idx {
        let e_line = doc.sections[ei].line;
        let entries_end = match checkpoints_idx {
            Some(ci) => doc.sections[ci].line - 1,
            None => doc.end_line(ei, true),
        };
        for (si, s) in doc.sections.iter().enumerate() {
            if s.level == 2 && s.line > e_line && s.line <= entries_end {
                let end = doc.end_line(si, false);
                let raw = doc.slice(s.line, end).join("\n");
                let raw = js_trim(&raw);
                let (ts, kind) = parse_entry_title(&s.title);
                let occ = match occurrences.iter_mut().find(|(t, _)| *t == ts) {
                    Some((_, n)) => {
                        let o = *n;
                        *n += 1;
                        o
                    }
                    None => {
                        occurrences.push((ts.clone(), 1));
                        0
                    }
                };
                let id = Some(section_id(2, &ts, occ));
                match split_added(raw) {
                    Some((added, msg)) => entries.push(Entry {
                        id,
                        ts,
                        msg: js_trim(&msg).to_string(),
                        kind,
                        added_at: Some(added),
                    }),
                    None => entries.push(Entry {
                        id,
                        ts,
                        msg: raw.to_string(),
                        kind,
                        added_at: None,
                    }),
                }
            }
        }
    }

    let mut checkpoints = Vec::new();
    if let Some(ci) = checkpoints_idx {
        let c_line = doc.sections[ci].line;
        let cp_end = doc.end_line(ci, true);
        let starts_with_date = |t: &str| {
            let b = t.as_bytes();
            b.len() >= 10
                && b[..4].iter().all(u8::is_ascii_digit)
                && b[4] == b'-'
                && b[5..7].iter().all(u8::is_ascii_digit)
                && b[7] == b'-'
                && b[8..10].iter().all(u8::is_ascii_digit)
        };
        let cps: Vec<&Section> = doc
            .sections
            .iter()
            .filter(|s| {
                s.level == 2 && s.line > c_line && s.line <= cp_end && starts_with_date(&s.title)
            })
            .collect();
        for (i, s) in cps.iter().enumerate() {
            let end = cps.get(i + 1).map_or(cp_end, |n| n.line - 1);
            let mut changes_idx: Option<usize> = None;
            let mut learnings_idx: Option<usize> = None;
            for idx in s.line..end {
                let Some(line) = doc.lines.get(idx) else {
                    break;
                };
                if is_h3(line, &["Changes"]) {
                    changes_idx = Some(idx);
                } else if is_h3(line, &["Learnings", "Insights"]) {
                    learnings_idx = Some(idx);
                }
            }
            let mut changes = String::new();
            let mut learnings = String::new();
            if let Some(ch) = changes_idx {
                let to = learnings_idx.unwrap_or(end);
                changes = js_trim(&doc.slice(ch + 1, to).join("\n")).to_string();
            }
            if let Some(le) = learnings_idx {
                learnings = js_trim(&doc.slice(le + 1, end).join("\n")).to_string();
            }
            checkpoints.push(Checkpoint {
                ts: s.title.clone(),
                changes,
                learnings,
            });
        }
    }

    let todos = parse_todos(&doc);
    Ok(TaskFile {
        fm,
        entries,
        checkpoints,
        todos,
    })
}

fn format_entry_title(entry: &Entry) -> String {
    match entry.kind {
        Some(k) => format!("{}  [kind:: {}]", entry.ts, k.as_str()),
        None => entry.ts.clone(),
    }
}

/// Text of a new entry block, as inserted before `# Checkpoints`.
fn entry_text(entry: &Entry) -> String {
    let added = entry
        .added_at
        .as_ref()
        .map(|a| format!("[added:: {a}]\n"))
        .unwrap_or_default();
    format!(
        "\n## {}\n{}{}\n",
        format_entry_title(entry),
        added,
        entry.msg
    )
}

/// Inserts an entry before `# Checkpoints` (or at the end of `# Entries`).
pub fn append_entry(content: &str, entry: &Entry) -> WtResult<String> {
    let doc = parse_doc(content);
    let Some(ei) = doc.find("entries") else {
        return err(
            Code::InvalidTaskFile,
            "Invalid task file: missing # Entries section",
        );
    };
    let insert = match doc.find("checkpoints") {
        Some(ci) => doc.sections[ci].line.saturating_sub(2),
        None => doc.end_line(ei, true),
    };
    let mut lines = doc.lines.clone();
    let at = insert.min(lines.len());
    let new: Vec<String> = entry_text(entry).split('\n').map(str::to_string).collect();
    lines.splice(at..at, new);
    Ok(lines.join("\n"))
}

/// Appends a checkpoint at the end of `# Checkpoints`.
pub fn append_checkpoint(content: &str, cp: &Checkpoint) -> WtResult<String> {
    let doc = parse_doc(content);
    let Some(ci) = doc.find("checkpoints") else {
        return err(
            Code::InvalidTaskFile,
            "Invalid task file: missing # Checkpoints section",
        );
    };
    let end = doc.end_line(ci, true);
    let text = format!(
        "\n## {}\n\n### Changes\n{}\n\n### Learnings\n{}\n",
        cp.ts, cp.changes, cp.learnings
    );
    let mut lines = doc.lines.clone();
    let at = end.min(lines.len());
    let new: Vec<String> = text.split('\n').map(str::to_string).collect();
    lines.splice(at..at, new);
    Ok(lines.join("\n"))
}

/// Sets (`Some`) or deletes (`None`) frontmatter keys. New keys go last; the
/// rest of the document is untouched.
pub fn update_frontmatter(content: &str, updates: &[(&str, Option<Value>)]) -> String {
    let doc = parse_doc(content);
    let mut fm = yaml::parse_mapping(&doc.frontmatter_yaml());
    for (key, value) in updates {
        match value {
            None => fm.retain(|(k, _)| k != key),
            Some(v) => match fm.iter_mut().find(|(k, _)| k == key) {
                Some(slot) => slot.1 = v.clone(),
                None => fm.push((key.to_string(), v.clone())),
            },
        }
    }
    let new_yaml = if fm.is_empty() {
        String::new()
    } else {
        js_trim(&yaml::dump_map(&fm)).to_string()
    };
    let new_fm = if new_yaml.is_empty() {
        None
    } else {
        Some(format!("---\n{new_yaml}\n---"))
    };
    match (doc.has_frontmatter, new_fm) {
        (true, Some(fmt)) => {
            let mut lines: Vec<&str> = fmt.split('\n').collect();
            lines.extend(
                doc.lines[doc.frontmatter_end_line..]
                    .iter()
                    .map(String::as_str),
            );
            lines.join("\n")
        }
        (false, Some(fmt)) => {
            let mut lines: Vec<&str> = fmt.split('\n').collect();
            lines.push("");
            lines.extend(doc.lines.iter().map(String::as_str));
            lines.join("\n")
        }
        _ => doc.lines.join("\n"),
    }
}

/// Content of a new task file.
pub fn new_task_content(fm: &[(String, Value)], todos: &[(String, String)]) -> String {
    let yaml = js_trim(&yaml::dump_map(fm)).to_string();
    let mut todo_section = String::new();
    if !todos.is_empty() {
        todo_section.push_str("\n# TODO\n\n");
        for (id, text) in todos {
            todo_section.push_str(&format!("- [ ] {text}  [id:: {id}] ^{id}\n"));
        }
    }
    format!("---\n{yaml}\n---\n\n# Entries\n\n# Checkpoints{todo_section}\n")
}

/// Adds a todo line to the `# TODO` section, creating it before
/// `# Checkpoints` when missing.
pub fn add_todo(content: &str, text: &str, id: &str, metadata: &[(String, String)]) -> String {
    let mut meta = format!("  [id:: {id}]");
    for (k, v) in metadata {
        meta.push_str(&format!(" [{k}:: {v}]"));
    }
    let line = format!("- [ ] {text}{meta} ^{id}");
    if content.contains("\n# TODO\n") || content.contains("\n# TODO\r\n") {
        let mut lines: Vec<String> = content.split('\n').map(str::to_string).collect();
        let mut end = None;
        let mut in_todo = false;
        for (i, l) in lines.iter().enumerate() {
            if js_trim(l) == "# TODO" {
                in_todo = true;
                continue;
            }
            if in_todo && l.starts_with("# ") {
                end = Some(i);
                break;
            }
        }
        let at = end.unwrap_or(lines.len());
        lines.insert(at, line);
        lines.join("\n")
    } else if let Some(idx) = content.find("\n# Checkpoints") {
        format!("{}\n# TODO\n\n{line}\n{}", &content[..idx], &content[idx..])
    } else {
        format!("{content}\n# TODO\n\n{line}\n")
    }
}

/// Rewrites the todo line holding `^id`: sets the status and the `[key:: v]`
/// fields. Returns the new content.
pub fn update_todo_line(
    content: &str,
    id: &str,
    status: Option<TodoStatus>,
    fields: &[(String, String)],
) -> String {
    let mut lines: Vec<String> = content.split('\n').map(str::to_string).collect();
    let needle = format!("^{id}");
    for line in lines.iter_mut() {
        if !line.contains(&needle) {
            continue;
        }
        // /^(-\s*\[)(.)\](\s*)(.+)$/
        let Some(after_dash) = line.strip_prefix('-') else {
            continue;
        };
        let ws1 = after_dash.len() - after_dash.trim_start().len();
        let Some(after_open) = after_dash[ws1..].strip_prefix('[') else {
            continue;
        };
        let prefix = format!("-{}[", &after_dash[..ws1]);
        let mut chars = after_open.chars();
        let Some(marker) = chars.next() else { continue };
        let Some(after_close) = chars.as_str().strip_prefix(']') else {
            continue;
        };
        let ws2 = after_close.len() - after_close.trim_start().len();
        let spacing = after_close[..ws2].to_string();
        let mut rest = after_close[ws2..].to_string();
        if rest.is_empty() {
            continue;
        }
        let mut marker = marker;
        if let Some(s) = status {
            marker = s.marker();
        }
        for (key, value) in fields {
            if let Some((start, end)) = find_field(&rest, key) {
                rest = format!("{}[{key}:: {value}]{}", &rest[..start], &rest[end..]);
            } else if let Some(pos) = block_ref_start(&rest) {
                rest = format!("{} [{key}:: {value}]{}", &rest[..pos], &rest[pos..]);
            }
        }
        *line = format!("{prefix}{marker}]{spacing}{rest}");
        break;
    }
    lines.join("\n")
}

// `\[key::\s*([^\]]+)\]` first match.
fn find_field(rest: &str, key: &str) -> Option<(usize, usize)> {
    let open = format!("[{key}::");
    let mut from = 0;
    while let Some(off) = rest[from..].find(&open) {
        let start = from + off;
        let after = &rest[start + open.len()..];
        if let Some(close) = after.find(']')
            && close > 0
        {
            return Some((start, start + open.len() + close + 1));
        }
        from = start + 1;
    }
    None
}

// start of `(\s+\^\w+)$`
fn block_ref_start(rest: &str) -> Option<usize> {
    let id_len = rest
        .chars()
        .rev()
        .take_while(|&c| is_word(c))
        .map(char::len_utf8)
        .sum::<usize>();
    if id_len == 0 {
        return None;
    }
    let caret = rest.len() - id_len;
    let head = rest[..caret].strip_suffix('^')?;
    let trimmed = head.trim_end();
    if trimmed.len() == head.len() {
        return None;
    }
    Some(trimmed.len())
}

/// Changes the kind of the entry `trace_id` by editing its heading only.
/// Returns `None` when no entry has this id.
pub fn set_entry_kind(content: &str, trace_id: &str, kind: TraceKind) -> Option<String> {
    let doc = parse_doc(content);
    let ei = doc.find("entries")?;
    let e_line = doc.sections[ei].line;
    let entries_end = match doc.find("checkpoints") {
        Some(ci) => doc.sections[ci].line - 1,
        None => doc.end_line(ei, true),
    };
    let mut occurrences: Vec<(String, usize)> = Vec::new();
    for s in &doc.sections {
        if s.level == 2 && s.line > e_line && s.line <= entries_end {
            let (ts, _) = parse_entry_title(&s.title);
            let occ = match occurrences.iter_mut().find(|(t, _)| *t == ts) {
                Some((_, n)) => {
                    let o = *n;
                    *n += 1;
                    o
                }
                None => {
                    occurrences.push((ts.clone(), 1));
                    0
                }
            };
            if section_id(2, &ts, occ) == trace_id {
                let mut lines = doc.lines.clone();
                lines[s.line - 1] = format!("## {ts}  [kind:: {}]", kind.as_str());
                return Some(lines.join("\n"));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const TASK: &str = "---\nid: abc\nuid: u1\nname: Demo\ndesc: []\nstatus: started\n\
created_at: '2020-01-21T09:00:00+01:00'\nready_at: null\nstarted_at: null\ndone_at: null\n\
last_checkpoint: null\nhas_uncheckpointed_entries: false\n---\n\n# Entries\n\n\
## 2020-01-22 10:00  [kind:: finding]\nfirst\nline\n\n## 2020-01-22 11:00\n[added:: 2020-01-23 08:00]\nsecond\n\n\
# Checkpoints\n\n## 2020-01-24 12:00\n\n### Changes\nc1\n\n### Learnings\nl1\n\n# TODO\n\n\
- [/] write tests  [due:: soon] ^Ab12CdE\n- [x] done one  [id:: ZZZ] ^ZZZ\n\n";

    #[test]
    fn parses_entries_checkpoints_and_todos() {
        let t = parse_task_file(TASK).unwrap();
        assert_eq!(t.name(), "Demo");
        assert_eq!(t.entries.len(), 2);
        assert_eq!(t.entries[0].ts, "2020-01-22 10:00");
        assert_eq!(t.entries[0].kind, Some(TraceKind::Finding));
        assert_eq!(t.entries[0].msg, "first\nline");
        assert_eq!(t.entries[1].added_at.as_deref(), Some("2020-01-23 08:00"));
        assert_eq!(t.entries[1].msg, "second");
        assert_eq!(t.entries[0].id.as_deref().map(str::len), Some(8));
        assert_eq!(t.checkpoints[0].changes, "c1");
        assert_eq!(t.checkpoints[0].learnings, "l1");
        assert_eq!(t.todos.len(), 2);
        assert_eq!(t.todos[0].status, TodoStatus::Wip);
        assert_eq!(t.todos[0].text, "write tests");
        assert_eq!(
            t.todos[0].metadata.get("due").map(String::as_str),
            Some("soon")
        );
        assert_eq!(t.todos[1].id, "ZZZ");
        assert!(t.todos[1].metadata.is_empty());
    }

    #[test]
    fn append_entry_goes_before_checkpoints() {
        let e = Entry {
            id: None,
            ts: "2020-02-01 09:00".into(),
            msg: "new".into(),
            kind: Some(TraceKind::State),
            added_at: None,
        };
        let out = append_entry(TASK, &e).unwrap();
        let t = parse_task_file(&out).unwrap();
        assert_eq!(t.entries.len(), 3);
        assert_eq!(t.entries[2].msg, "new");
        assert!(out.contains("## 2020-02-01 09:00  [kind:: state]\nnew\n\n\n# Checkpoints"));
    }

    #[test]
    fn update_frontmatter_keeps_order_and_appends_new_keys() {
        let out = update_frontmatter(
            TASK,
            &[
                ("status", Some(Value::str("done"))),
                ("tags", Some(Value::Seq(vec![Value::str("a")]))),
                ("uid", None),
            ],
        );
        let t = parse_task_file(&out).unwrap();
        assert_eq!(t.status(), Some(TaskStatus::Done));
        assert_eq!(t.tags(), vec!["a".to_string()]);
        assert!(t.uid().is_none());
        assert!(out.contains("status: done\n"));
        assert!(out.ends_with("\n\n"));
    }

    #[test]
    fn set_entry_kind_only_edits_the_heading() {
        let t = parse_task_file(TASK).unwrap();
        let id = t.entries[1].id.clone().unwrap();
        let out = set_entry_kind(TASK, &id, TraceKind::Learning).unwrap();
        assert!(out.contains("## 2020-01-22 11:00  [kind:: learning]\n[added:: 2020-01-23 08:00]"));
        assert!(set_entry_kind(TASK, "nope", TraceKind::Info).is_none());
    }

    #[test]
    fn add_and_update_todos() {
        let out = add_todo(TASK, "more", "Q1", &[]);
        let t = parse_task_file(&out).unwrap();
        assert_eq!(t.todos.len(), 3);
        let out = update_todo_line(
            &out,
            "Q1",
            Some(TodoStatus::Done),
            &[("due".into(), "now".into())],
        );
        let t = parse_task_file(&out).unwrap();
        assert_eq!(t.todos[2].status, TodoStatus::Done);
        assert_eq!(
            t.todos[2].metadata.get("due").map(String::as_str),
            Some("now")
        );
    }

    #[test]
    fn missing_frontmatter_is_an_error() {
        assert_eq!(
            parse_task_file("# Entries\n").unwrap_err().code,
            Code::InvalidTaskFile
        );
    }
}
