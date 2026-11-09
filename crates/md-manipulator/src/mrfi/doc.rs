//! The document view MRFI works on: LF-normalized text, addressed in Unicode
//! scalar values, plus the section list.
//!
//! Units: `*_offset` are **scalar-value offsets** into the normalized text,
//! `*_column` are 1-based **scalar-value columns**. UTF-16 columns (what JS
//! and VS Code use) are never accepted here: convert at the boundary with
//! [`MrfiDoc::column_from_utf16`] and [`MrfiDoc::column_to_utf16`].

use super::codec::SourceRange;
use super::text::{is_js_whitespace, js_trim};
use crate::Document;

/// A heading seen by MRFI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocSection {
    /// Heading level, 1 to 6.
    pub level: usize,
    /// 1-based first line of the heading.
    pub line: usize,
    /// 1-based last line of the heading (the underline of a setext heading).
    pub heading_last_line: usize,
    /// 1-based last line of the section: up to the next heading of any level,
    /// trailing blank lines of the document excluded.
    pub line_end: usize,
    /// Raw heading text.
    pub title: String,
}

/// An LF-normalized document (`\r\n` and lone `\r` become `\n`, as the spec
/// requires before any offset or hash is computed).
#[derive(Debug, Clone)]
pub struct MrfiDoc {
    chars: Vec<char>,
    /// Scalar offset where each line starts, plus the end of the text.
    line_starts: Vec<usize>,
    sections: Vec<DocSection>,
    text: String,
}

/// Replaces `\r\n` and lone `\r` by `\n`.
pub fn normalize_line_endings(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

impl MrfiDoc {
    /// Normalizes line endings, then parses sections with the same rules as `md`.
    pub fn new(text: &str) -> Self {
        let text = normalize_line_endings(text);
        let parsed = Document::parse(&text);
        let sections = parsed
            .sections()
            .iter()
            .enumerate()
            .map(|(i, s)| DocSection {
                level: s.level,
                line: s.line,
                heading_last_line: s.heading_last_line,
                line_end: parsed.end_line(i, false),
                title: s.title.clone(),
            })
            .collect();
        let chars: Vec<char> = text.chars().collect();
        let mut line_starts = vec![0];
        for (i, &c) in chars.iter().enumerate() {
            if c == '\n' {
                line_starts.push(i + 1);
            }
        }
        line_starts.push(chars.len() + 1);
        Self {
            chars,
            line_starts,
            sections,
            text,
        }
    }

    /// The normalized text.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The text as scalar values.
    pub fn chars(&self) -> &[char] {
        &self.chars
    }

    /// Headings in document order.
    pub fn sections(&self) -> &[DocSection] {
        &self.sections
    }

    /// Number of lines (`split("\n")` semantics: a final newline adds an empty line).
    pub fn line_count(&self) -> usize {
        self.line_starts.len() - 1
    }

    /// Scalar-value slice of the 1-based line, without its newline.
    pub fn line(&self, line: usize) -> &[char] {
        if line == 0 || line > self.line_count() {
            return &[];
        }
        let start = self.line_starts[line - 1];
        let end = self.line_starts[line] - 1;
        &self.chars[start..end.max(start)]
    }

    /// The 1-based line as text.
    pub fn line_string(&self, line: usize) -> String {
        self.line(line).iter().collect()
    }

    /// Length of a line in scalar values.
    pub fn line_len(&self, line: usize) -> usize {
        self.line(line).len()
    }

    /// Column just past the end of the line.
    pub fn line_end_column(&self, line: usize) -> usize {
        self.line_len(line) + 1
    }

    /// Converts a UTF-16 column of `line` (what JS/VS Code count) to a scalar column.
    /// A column inside a surrogate pair rounds up to the next character.
    pub fn column_from_utf16(&self, line: usize, utf16_column: usize) -> usize {
        let mut units = 0;
        for (i, c) in self.line(line).iter().enumerate() {
            if units >= utf16_column.saturating_sub(1) {
                return i + 1;
            }
            units += c.len_utf16();
        }
        self.line_len(line) + 1 + (utf16_column.saturating_sub(1)).saturating_sub(units)
    }

    /// Converts a scalar column of `line` to a UTF-16 column.
    pub fn column_to_utf16(&self, line: usize, scalar_column: usize) -> usize {
        let l = self.line(line);
        let taken = scalar_column.saturating_sub(1).min(l.len());
        let units: usize = l[..taken].iter().map(|c| c.len_utf16()).sum();
        units + 1 + scalar_column.saturating_sub(1).saturating_sub(taken)
    }

    /// Scalar offset of a position; lines past the end clamp to the last line start.
    pub fn line_column_to_offset(&self, line: usize, column: usize) -> usize {
        let index = line.saturating_sub(1).min(self.line_starts.len() - 1);
        (self.line_starts[index] + column).saturating_sub(1)
    }

    /// Position of a scalar offset (clamped to the end of the last line).
    pub fn offset_to_line_column(&self, offset: usize) -> (usize, usize) {
        let mut remaining = offset;
        for line in 1..=self.line_count() {
            let len = self.line_len(line);
            if remaining <= len {
                return (line, remaining + 1);
            }
            remaining -= len + 1;
        }
        let last = self.line_count().max(1);
        (last, self.line_len(last) + 1)
    }

    /// Range between two scalar offsets.
    pub fn range_from_offsets(&self, start: usize, end: usize) -> SourceRange {
        let (sl, sc) = self.offset_to_line_column(start);
        let (el, ec) = self.offset_to_line_column(end);
        SourceRange {
            start_line: sl as u64,
            start_column: sc as u64,
            end_line: el as u64,
            end_column: ec as u64,
        }
    }

    /// Scalar offsets of a range.
    pub fn offsets_of(&self, range: &SourceRange) -> (usize, usize) {
        (
            self.line_column_to_offset(range.start_line as usize, range.start_column as usize),
            self.line_column_to_offset(range.end_line as usize, range.end_column as usize),
        )
    }

    /// Whether the range lies in the document, columns included (end of line allowed).
    pub fn contains_range(&self, range: &SourceRange) -> bool {
        if !range.is_valid_shape() || range.end_line < range.start_line {
            return false;
        }
        let n = self.line_count() as u64;
        if range.start_line > n || range.end_line > n {
            return false;
        }
        range.start_column <= self.line_end_column(range.start_line as usize) as u64
            && range.end_column <= self.line_end_column(range.end_line as usize) as u64
    }

    /// Text of a range, with the TS slicing rules (see `getRangeText`).
    pub fn range_text(&self, range: &SourceRange) -> String {
        let first = range.start_line as usize;
        let last = (range.end_line as usize).min(self.line_count());
        if first == 0 || first > last {
            return String::new();
        }
        let slice = |line: usize, from: usize, to: usize| -> String {
            let l = self.line(line);
            let a = from.saturating_sub(1).min(l.len());
            let b = to.saturating_sub(1).min(l.len()).max(a);
            l[a..b].iter().collect()
        };
        if range.start_line == range.end_line {
            return slice(
                first,
                range.start_column as usize,
                range.end_column as usize,
            );
        }
        let mut parts = vec![slice(first, range.start_column as usize, usize::MAX)];
        parts.extend((first + 1..last).map(|l| self.line_string(l)));
        // Mirrors `[firstLine, ...lines.slice(1, -1), lastLine]` when the
        // clipped range has a single line: that line then appears twice.
        parts.push(slice(last, 1, range.end_column as usize));
        parts.join("\n")
    }

    /// Text of scalar offsets `start..end`.
    pub fn slice(&self, start: usize, end: usize) -> String {
        let end = end.min(self.chars.len());
        self.chars[start.min(end)..end].iter().collect()
    }

    /// First section whose `[line, line_end]` contains the line.
    pub fn section_containing_line(&self, line: usize) -> Option<usize> {
        self.sections
            .iter()
            .position(|s| s.line <= line && line <= s.line_end)
    }

    /// Section-tree parent: the last preceding heading of a lower level.
    pub fn parent_section(&self, index: usize) -> Option<usize> {
        let s = &self.sections[index];
        let mut parent = None;
        for (i, c) in self.sections.iter().enumerate() {
            if c.line >= s.line {
                break;
            }
            if c.level < s.level {
                parent = Some(i);
            }
        }
        parent
    }

    /// `line_end` without the trailing blank lines.
    pub fn trimmed_end_line(&self, index: usize) -> usize {
        let s = &self.sections[index];
        let mut end = s.line_end;
        while end > s.line && js_trim(&self.line_string(end)).is_empty() {
            end -= 1;
        }
        end
    }

    /// Lines of the section up to its trimmed end, joined with `\n` (the `hh` input).
    pub fn section_scope_text(&self, index: usize) -> String {
        self.lines_text(self.sections[index].line, self.trimmed_end_line(index))
    }

    /// Lines `first..=last` joined with `\n`.
    pub fn lines_text(&self, first: usize, last: usize) -> String {
        (first..=last.min(self.line_count()))
            .map(|l| self.line_string(l))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Anchor ids of `<!-- ^id -->` lines outside naive code-fence toggles
    /// (any line starting with three backticks or tildes toggles), as the TS does.
    pub fn anchor_lines(&self, anchor: &str) -> Vec<usize> {
        let mut in_code = false;
        let mut matches = vec![];
        for line in 1..=self.line_count() {
            let text = self.line_string(line);
            let trimmed = js_trim(&text);
            if is_code_fence_line(trimmed) {
                in_code = !in_code;
                continue;
            }
            if in_code {
                continue;
            }
            if parse_anchor_comment(trimmed) == Some(anchor) {
                matches.push(line);
            }
        }
        matches
    }

    /// First anchor comment found at or after the section's heading, up to its end.
    pub fn first_section_anchor(&self, index: usize) -> Option<String> {
        let s = &self.sections[index];
        let mut in_code = false;
        for line in 1..=s.line_end {
            let text = self.line_string(line);
            let trimmed = js_trim(&text);
            if is_code_fence_line(trimmed) {
                in_code = !in_code;
                continue;
            }
            if line < s.line || in_code {
                continue;
            }
            if let Some(a) = parse_anchor_comment(trimmed) {
                return Some(a.to_owned());
            }
        }
        None
    }
}

fn is_code_fence_line(trimmed: &str) -> bool {
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

/// `<!-- ^id -->` with `id` in `[A-Za-z0-9_.:-]+`.
fn parse_anchor_comment(trimmed: &str) -> Option<&str> {
    let rest = trimmed.strip_prefix("<!--")?;
    let rest = rest
        .trim_start_matches(is_js_whitespace)
        .strip_prefix('^')?;
    let rest = rest.strip_suffix("-->")?;
    let id = rest.trim_end_matches(is_js_whitespace);
    (!id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c)))
    .then_some(id)
}
