//! Text and JSON renderings of command results. JSON field names and order
//! are the ones of the TS CLI.

use md_manipulator::{Edit, Match, Section, SectionMatches};
use serde::Serialize;

/// Compact JSON of any serializable value.
pub fn json<T: Serialize + ?Sized>(v: &T) -> String {
    serde_json::to_string(v).expect("plain data serializes")
}

#[derive(Serialize)]
pub struct OutlineEntry<'a> {
    id: &'a str,
    level: usize,
    title: &'a str,
    line: usize,
}

impl<'a> From<&'a Section> for OutlineEntry<'a> {
    fn from(s: &'a Section) -> Self {
        Self {
            id: &s.id,
            level: s.level,
            title: &s.title,
            line: s.line,
        }
    }
}

/// `outline --mrfi --json` entry: the TS puts `mrfi` right after `id`.
#[derive(Serialize)]
pub struct MrfiOutlineEntry<'a> {
    id: &'a str,
    mrfi: &'a str,
    level: usize,
    title: &'a str,
    line: usize,
}

impl<'a> MrfiOutlineEntry<'a> {
    pub fn new(s: &'a Section, mrfi: &'a str) -> Self {
        Self {
            id: &s.id,
            mrfi,
            level: s.level,
            title: &s.title,
            line: s.line,
        }
    }
}

pub fn outline_line_with_ref(s: &Section, mrfi: &str) -> String {
    format!(
        "{} {} ^{} {} L{}",
        "#".repeat(s.level),
        s.title,
        s.id,
        mrfi,
        s.line
    )
}

pub fn outline_line(s: &Section) -> String {
    format!("{} {} ^{} L{}", "#".repeat(s.level), s.title, s.id, s.line)
}

pub fn read_header(s: &Section, end_line: usize) -> String {
    format!(
        "{} {} ^{} L{}-L{}",
        "#".repeat(s.level),
        s.title,
        s.id,
        s.line,
        end_line
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadJson<'a> {
    id: &'a str,
    level: usize,
    title: &'a str,
    line_start: usize,
    line_end: usize,
    content: &'a str,
}

impl<'a> ReadJson<'a> {
    pub fn new(s: &'a Section, line_end: usize, content: &'a str) -> Self {
        Self {
            id: &s.id,
            level: s.level,
            title: &s.title,
            line_start: s.line,
            line_end,
            content,
        }
    }
}

pub fn mutation_text(edit: &Edit) -> String {
    let m = &edit.mutation;
    let range = match m.line_end {
        Some(e) if e > 0 => format!("L{}-L{}", m.line_start, e),
        _ => format!("L{}", m.line_start),
    };
    let mut delta = vec![];
    if m.lines_added > 0 {
        delta.push(format!("+{}", m.lines_added));
    }
    if m.lines_removed > 0 {
        delta.push(format!("-{}", m.lines_removed));
    }
    let delta = if delta.is_empty() {
        String::new()
    } else {
        format!(" ({})", delta.join(", "))
    };
    format!("{} ^{} {}{}", m.action.as_str(), m.id, range, delta)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationJson<'a> {
    action: &'static str,
    id: &'a str,
    line_start: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_end: Option<usize>,
    lines_added: usize,
    lines_removed: usize,
}

impl<'a> From<&'a Edit> for MutationJson<'a> {
    fn from(e: &'a Edit) -> Self {
        let m = &e.mutation;
        Self {
            action: m.action.as_str(),
            id: &m.id,
            line_start: m.line_start,
            line_end: m.line_end,
            lines_added: m.lines_added,
            lines_removed: m.lines_removed,
        }
    }
}

pub fn match_line(m: &Match) -> String {
    let section = m.section_id.as_deref().unwrap_or("-");
    format!("^{section} L{} {}", m.line, m.content)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchJson<'a> {
    section_id: Option<&'a str>,
    line: usize,
    content: &'a str,
}

impl<'a> From<&'a Match> for MatchJson<'a> {
    fn from(m: &'a Match) -> Self {
        Self {
            section_id: m.section_id.as_deref(),
            line: m.line,
            content: &m.content,
        }
    }
}

pub fn summary_line(s: &SectionMatches) -> String {
    let lines: Vec<String> = s.lines.iter().map(|l| format!("L{l}")).collect();
    let word = if s.match_count == 1 {
        "match"
    } else {
        "matches"
    };
    format!(
        "{} {} ^{} {} ({} {word})",
        "#".repeat(s.level),
        s.title,
        s.id,
        lines.join(","),
        s.match_count
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryJson<'a> {
    id: &'a str,
    level: usize,
    title: &'a str,
    lines: &'a [usize],
    match_count: usize,
}

impl<'a> From<&'a SectionMatches> for SummaryJson<'a> {
    fn from(s: &'a SectionMatches) -> Self {
        Self {
            id: &s.id,
            level: s.level,
            title: &s.title,
            lines: &s.lines,
            match_count: s.match_count,
        }
    }
}
