use crate::{Document, Error};

/// What an edit did, for the CLI to report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// `write`
    Updated,
    /// `append` of text starting a new section
    Created,
    /// `append` of other text
    Appended,
    /// `empty`
    Emptied,
    /// `remove`
    Removed,
}

impl Action {
    /// Word printed by the CLI.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Updated => "updated",
            Self::Created => "created",
            Self::Appended => "appended",
            Self::Emptied => "emptied",
            Self::Removed => "removed",
        }
    }
}

/// Numbers describing an edit (the JSON output of the CLI).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mutation {
    /// What happened.
    pub action: Action,
    /// Section id, or `-` for an append that targets no section and creates none.
    pub id: String,
    /// 1-based first line of the affected range.
    pub line_start: usize,
    /// 1-based last line, only reported by `write` and by `append` of a new section.
    pub line_end: Option<usize>,
    /// Lines inserted.
    pub lines_added: usize,
    /// Lines deleted.
    pub lines_removed: usize,
}

/// Result of an operation: the whole new text and what changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    /// The new text. Equal to the input when the edit is a no-op.
    pub text: String,
    /// What changed.
    pub mutation: Mutation,
}

/// Converts any line ending to `\n`.
fn normalize(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn without_blank_edges(text: &str) -> Vec<&str> {
    let lines: Vec<&str> = text.split('\n').collect();
    let start = lines.iter().position(|l| !l.trim().is_empty());
    let end = lines.iter().rposition(|l| !l.trim().is_empty());
    match (start, end) {
        (Some(s), Some(e)) => lines[s..=e].to_vec(),
        _ => vec![],
    }
}

/// Lines of inserted text. One trailing line ending terminates the last line
/// instead of starting an empty one (spec decision 14): `echo x | md append`
/// and `md append "x"` insert the same thing.
fn content_lines(content: &str) -> Vec<String> {
    let content = normalize(content);
    content
        .strip_suffix('\n')
        .unwrap_or(&content)
        .split('\n')
        .map(str::to_owned)
        .collect()
}

impl Document {
    /// A paragraph line just before a setext underline would swallow it as a
    /// continuation line: end inserted text with a blank line in that case.
    fn guard_setext(&self, at: usize, lines: &mut Vec<String>) {
        let next_is_setext = self
            .sections()
            .iter()
            .any(|s| s.line - 1 == at && s.heading_last_line > s.line);
        if next_is_setext && lines.last().is_some_and(|l| !l.trim().is_empty()) {
            lines.push(String::new());
        }
    }

    /// Replaces the body of a section (the lines after its heading; with
    /// `deep` also its subsections). A blank line is kept between the heading
    /// and the new text. Writing the current body back changes nothing
    /// (spec decision 9).
    pub fn write(&self, selector: &str, content: &str, deep: bool) -> Result<Edit, Error> {
        let idx = self.resolve_index(selector)?;
        let s = &self.sections()[idx];
        let start = s.heading_last_line;
        let end = self.end0(idx, deep);
        // Blank lines around the body are ignored: a shell round trip of `read`
        // loses the trailing ones.
        if without_blank_edges(&normalize(content)) == without_blank_edges(&self.body(idx, deep)) {
            return Ok(Edit {
                text: self.text().to_owned(),
                mutation: Mutation {
                    action: Action::Updated,
                    id: s.id.clone(),
                    line_start: s.line,
                    line_end: None,
                    lines_added: 0,
                    lines_removed: 0,
                },
            });
        }
        let mut new = if content.is_empty() {
            vec![]
        } else {
            content_lines(content)
        };
        if new.first().is_some_and(|l| !l.trim().is_empty()) {
            new.insert(0, String::new());
        }
        self.guard_setext(end, &mut new);
        Ok(Edit {
            text: self.splice_lines(start, end, &new),
            mutation: Mutation {
                action: Action::Updated,
                id: s.id.clone(),
                line_start: s.line,
                line_end: Some(start + new.len()),
                lines_added: new.len(),
                lines_removed: end - start,
            },
        })
    }

    /// Inserts `content` after a section (after its subsections with `deep`),
    /// before it (`before`), or, with no selector, at the end of the document
    /// or right after the frontmatter (`before`). A blank line separates
    /// appended text from a non-blank previous line.
    pub fn append(
        &self,
        selector: Option<&str>,
        content: &str,
        deep: bool,
        before: bool,
    ) -> Result<Edit, Error> {
        let idx = selector.map(|s| self.resolve_index(s)).transpose()?;
        let at = match (idx, before) {
            (None, true) => self.frontmatter_lines(),
            (None, false) => self.content_line_count(),
            (Some(i), true) => self.sections()[i].line - 1,
            (Some(i), false) => self.end0(i, deep),
        };
        let mut new = content_lines(content);
        let pad =
            !before && at > 0 && !self.line(at - 1).trim().is_empty() && !new[0].trim().is_empty();
        if pad {
            new.insert(0, String::new());
        }
        self.guard_setext(at, &mut new);
        // Nothing to separate from or to terminate in an empty text (spec
        // decision 12): the whole file is the new text.
        let mut text = if self.text().is_empty() {
            new.join(self.line_ending().as_str())
        } else {
            self.splice_lines(at, at, &new)
        };
        // Appended content at the end of the file always ends with a line
        // ending (spec decision 12), whatever the file ended with before.
        if at >= self.content_line_count() && !text.ends_with(['\n', '\r']) {
            text.push_str(self.line_ending().as_str());
        }

        // The new text is a section when the reparsed document has a heading
        // on its first non-padding line; its id is only known from the reparse
        // (occurrence indices may have shifted).
        let first = at + usize::from(pad);
        let created = if new[usize::from(pad)].trim().is_empty() {
            None
        } else {
            Document::parse(&text)
                .sections()
                .iter()
                .find(|s| s.line - 1 == first)
                .map(|s| s.id.clone())
        };
        let mutation = Mutation {
            action: if created.is_some() {
                Action::Created
            } else {
                Action::Appended
            },
            line_end: created.as_ref().map(|_| at + new.len()),
            id: created
                .or_else(|| idx.map(|i| self.sections()[i].id.clone()))
                .unwrap_or_else(|| "-".to_owned()),
            line_start: at + 1,
            lines_added: new.len(),
            lines_removed: 0,
        };
        Ok(Edit { text, mutation })
    }

    /// Removes the body of a section, keeping its heading. With `deep` the
    /// subsections go too.
    pub fn empty(&self, selector: &str, deep: bool) -> Result<Edit, Error> {
        let idx = self.resolve_index(selector)?;
        let s = &self.sections()[idx];
        let (start, end) = (s.heading_last_line, self.end0(idx, deep));
        Ok(Edit {
            text: self.splice_lines(start, end, &[]),
            mutation: Mutation {
                action: Action::Emptied,
                id: s.id.clone(),
                line_start: s.line,
                line_end: None,
                lines_added: 0,
                lines_removed: end - start,
            },
        })
    }

    /// Removes a section: heading, body and subsections.
    pub fn remove(&self, selector: &str) -> Result<Edit, Error> {
        let idx = self.resolve_index(selector)?;
        let s = &self.sections()[idx];
        let (start, end) = (s.line - 1, self.end0(idx, true));
        Ok(Edit {
            text: self.splice_lines(start, end, &[]),
            mutation: Mutation {
                action: Action::Removed,
                id: s.id.clone(),
                line_start: s.line,
                line_end: None,
                lines_added: 0,
                lines_removed: end - start,
            },
        })
    }
}

/// Edits addressed by a resolved MRFI range rather than by a section. Only
/// whole lines are touched; the report ids are `-`.
impl Document {
    /// Replaces the 1-based lines `first..=last` by `content`.
    pub fn write_lines(&self, first: usize, last: usize, content: &str) -> Edit {
        let (a, b) = self.line_span(first, last);
        let new = if content.is_empty() {
            vec![]
        } else {
            content_lines(content)
        };
        Edit {
            text: self.splice_lines(a, b, &new),
            mutation: Mutation {
                action: Action::Updated,
                id: "-".to_owned(),
                line_start: first,
                line_end: Some(first + new.len()),
                lines_added: new.len(),
                lines_removed: b - a,
            },
        }
    }

    /// Removes the 1-based lines `first..=last`.
    pub fn remove_lines(&self, first: usize, last: usize) -> Edit {
        let (a, b) = self.line_span(first, last);
        Edit {
            text: self.splice_lines(a, b, &[]),
            mutation: Mutation {
                action: Action::Removed,
                id: "-".to_owned(),
                line_start: first,
                line_end: None,
                lines_added: 0,
                lines_removed: b - a,
            },
        }
    }

    /// Inserts `content` before line `first` (`before`) or after line `last`.
    pub fn append_lines(&self, first: usize, last: usize, content: &str, before: bool) -> Edit {
        let (a, b) = self.line_span(first, last);
        let at = if before { a } else { b };
        let new = if content.is_empty() {
            vec![]
        } else {
            content_lines(content)
        };
        Edit {
            text: self.splice_lines(at, at, &new),
            mutation: Mutation {
                action: Action::Appended,
                id: "-".to_owned(),
                line_start: at + 1,
                line_end: None,
                lines_added: new.len(),
                lines_removed: 0,
            },
        }
    }

    /// 0-based `[a, b)` of the 1-based inclusive lines, clamped to the text.
    fn line_span(&self, first: usize, last: usize) -> (usize, usize) {
        let n = self.lines().count();
        let a = first.saturating_sub(1).min(n);
        (a, last.max(first).min(n).max(a))
    }
}
