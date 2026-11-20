use crate::{Error, Section, is_valid_id, section_id};
use pulldown_cmark::{Event, Options, Parser, Tag};
use std::borrow::Cow;
use std::collections::HashMap;
use std::ops::Range;

/// Line ending written by edits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    /// `\n`
    Lf,
    /// `\r\n`
    CrLf,
    /// A lone `\r` (classic Mac OS, still a line ending for CommonMark).
    Cr,
}

impl LineEnding {
    /// The bytes of the line ending.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "\n",
            Self::CrLf => "\r\n",
            Self::Cr => "\r",
        }
    }
}

/// A parsed Markdown text. The text is kept exactly as given: nothing is
/// normalized, and every edit returns a new text spliced from the original.
#[derive(Debug, Clone)]
pub struct Document {
    text: String,
    /// Content of every line, line ending excluded. As with `split("\n")`,
    /// a text ending with a line ending has a last empty line, and an empty
    /// text is one empty line: the black-box suite pins the resulting edits.
    lines: Vec<Range<usize>>,
    frontmatter_lines: usize,
    sections: Vec<Section>,
    line_ending: LineEnding,
}

/// Result of [`Document::read`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionRead<'a> {
    /// The section that was read.
    pub section: &'a Section,
    /// Lines after the heading, joined with `\n` whatever the file uses.
    pub content: String,
    /// 1-based last line of the content (see [`Document::end_line`]).
    pub end_line: usize,
}

/// Splits on `\n`, `\r\n` and a lone `\r`, the line endings CommonMark knows
/// (the parser would otherwise disagree with us on lone-CR files).
fn split_lines(text: &str) -> Vec<Range<usize>> {
    let bytes = text.as_bytes();
    let mut lines = vec![];
    let (mut start, mut i) = (0, 0);
    while i < bytes.len() {
        match bytes[i] {
            b'\n' => {
                lines.push(start..i);
                start = i + 1;
            }
            b'\r' => {
                lines.push(start..i);
                if bytes.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    lines.push(start..bytes.len());
    lines
}

/// pulldown-cmark treats a lone `\r` as a line ending in most places but not
/// all (an info string runs past it, so a backtick fence is not recognised).
/// Replacing it with `\n` keeps every byte offset and makes the two agree.
fn lone_cr_as_lf(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let has_lone_cr = bytes
        .iter()
        .enumerate()
        .any(|(i, &b)| b == b'\r' && bytes.get(i + 1) != Some(&b'\n'));
    if !has_lone_cr {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        out.push(if c == '\r' && chars.peek() != Some(&'\n') {
            '\n'
        } else {
            c
        });
    }
    Cow::Owned(out)
}

/// Dominant line ending; LF when there is none or on ties with LF.
fn dominant_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    let cr = text.matches('\r').count() - crlf;
    if crlf > 0 && crlf >= lf && crlf >= cr {
        LineEnding::CrLf
    } else if cr > lf {
        LineEnding::Cr
    } else {
        LineEnding::Lf
    }
}

impl Document {
    /// Parses `text`. Never fails: any text is a document.
    pub fn parse(text: &str) -> Self {
        let mut doc = Document {
            text: text.to_owned(),
            lines: split_lines(text),
            frontmatter_lines: 0,
            sections: vec![],
            line_ending: dominant_line_ending(text),
        };
        doc.frontmatter_lines = doc.detect_frontmatter();
        doc.sections = doc.find_sections();
        doc
    }

    /// The text, exactly as given to [`Document::parse`].
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Headings in document order.
    pub fn sections(&self) -> &[Section] {
        &self.sections
    }

    /// Line ending used for inserted text.
    pub fn line_ending(&self) -> LineEnding {
        self.line_ending
    }

    /// Number of lines of the frontmatter prefix, delimiters included (0 if none).
    pub fn frontmatter_lines(&self) -> usize {
        self.frontmatter_lines
    }

    /// Number of lines without the empty last one that a final line ending
    /// creates. Appending there keeps the final line ending (spec decision 13).
    pub(crate) fn content_line_count(&self) -> usize {
        self.lines.len() - usize::from(self.lines[self.lines.len() - 1].is_empty())
    }

    /// Bytes between the delimiter lines of the frontmatter, final line
    /// ending included; empty for `---` directly followed by `---`.
    pub(crate) fn frontmatter_body_bytes(&self) -> Option<Range<usize>> {
        let fl = self.frontmatter_lines;
        (fl >= 2).then(|| self.lines[1].start..self.lines[fl - 1].start)
    }

    /// The text without the frontmatter block and one blank line after it.
    pub(crate) fn without_frontmatter(&self) -> String {
        let fl = self.frontmatter_lines;
        let n = self.lines.len();
        let cut = if fl < n && self.line(fl).trim().is_empty() {
            self.lines.get(fl + 1).map_or(self.text.len(), |l| l.start)
        } else {
            self.lines[fl.min(n - 1)].start
        };
        self.text[cut..].to_owned()
    }

    /// Every line without its line ending, as `split("\n")` would give them
    /// (a final line ending leaves an empty last line).
    pub fn lines(&self) -> impl Iterator<Item = &str> {
        self.lines.iter().map(|r| &self.text[r.clone()])
    }

    /// Content of the 0-based line `i`, without its line ending.
    pub(crate) fn line(&self, i: usize) -> &str {
        &self.text[self.lines[i].clone()]
    }

    fn line_of(&self, offset: usize) -> usize {
        self.lines.partition_point(|l| l.start <= offset) - 1
    }

    /// Frontmatter is a text prefix outside Markdown (spec decision 8): the
    /// first line is `---` and a later line is `---` or `...`.
    fn detect_frontmatter(&self) -> usize {
        if self.line(0).trim() != "---" {
            return 0;
        }
        (1..self.lines.len())
            .find(|&i| matches!(self.line(i).trim(), "---" | "..."))
            .map_or(0, |i| i + 1)
    }

    fn find_sections(&self) -> Vec<Section> {
        let body_start = self.lines[self.frontmatter_lines.min(self.lines.len() - 1)].start;
        // Only the parser's block structure is used. Without the YAML option the
        // frontmatter would be seen as Markdown, hence the offset.
        let body = lone_cr_as_lf(&self.text[body_start..]);
        let body = body.as_ref();
        let mut seen: HashMap<(usize, String), usize> = HashMap::new();
        let mut sections = vec![];
        let mut depth = 0usize;
        for (event, range) in Parser::new_ext(body, Options::empty()).into_offset_iter() {
            match event {
                Event::Start(tag) => {
                    // Depth 0 = document level: headings in block quotes, list
                    // items and footnotes have an ancestor.
                    if let (Tag::Heading { level, .. }, 0) = (&tag, depth) {
                        let first = self.line_of(body_start + range.start);
                        // The range ends after the line ending, so `end - 1` is
                        // inside the last heading line.
                        let last = self.line_of(body_start + range.end - 1).max(first);
                        let level = *level as usize;
                        let title = self.heading_title(first, last);
                        let key = (level, title.to_lowercase().trim().to_owned());
                        let occurrence = seen.entry(key).or_insert(0);
                        sections.push(Section {
                            id: section_id(level, &title, *occurrence),
                            level,
                            title,
                            occurrence: *occurrence,
                            line: first + 1,
                            heading_last_line: last + 1,
                            heading_range: self.lines[first].start..self.lines[last].end,
                        });
                        *occurrence += 1;
                    }
                    depth += 1;
                }
                Event::End(_) => depth -= 1,
                _ => {}
            }
        }
        sections
    }

    /// The parser gives inline events, not the raw text: ids depend on the
    /// raw ATX title (closing `#`s kept), so it is re-read from the source.
    fn heading_title(&self, first: usize, last: usize) -> String {
        if first == last {
            return self
                .line(first)
                .trim_start_matches(' ')
                .trim_start_matches('#')
                .trim()
                .to_owned();
        }
        // Setext: text lines, underline excluded.
        (first..last)
            .map(|i| self.line(i).trim())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Finds a section by id (8 hex characters) or by heading text
    /// (`## Title`: exact level and title, an error if ambiguous).
    pub fn resolve(&self, selector: &str) -> Result<&Section, Error> {
        self.resolve_index(selector).map(|i| &self.sections[i])
    }

    pub(crate) fn resolve_index(&self, selector: &str) -> Result<usize, Error> {
        if selector.starts_with('#') {
            let title = selector.trim_start_matches('#');
            let level = selector.len() - title.len();
            let title = title.trim();
            if level > 6 || title.is_empty() {
                return Err(Error::InvalidHeadingSelector(selector.to_owned()));
            }
            let mut matches = (0..self.sections.len())
                .filter(|&i| self.sections[i].level == level && self.sections[i].title == title);
            return match (matches.next(), matches.next()) {
                (None, _) => Err(Error::SectionNotFound(selector.to_owned())),
                (Some(i), None) => Ok(i),
                (Some(_), Some(_)) => Err(Error::AmbiguousSection(selector.to_owned())),
            };
        }
        if !is_valid_id(selector) {
            return Err(Error::InvalidId(selector.to_owned()));
        }
        self.sections
            .iter()
            .position(|s| s.id == selector)
            .ok_or_else(|| Error::SectionNotFound(selector.to_owned()))
    }

    /// Exclusive 0-based end of the section's lines, which is also the
    /// 1-based inclusive last line. Without `deep` the section stops at the
    /// next heading of any level, with `deep` at the next one of the same or a
    /// higher level. Blank lines before the next heading belong to the
    /// section; at the end of the file they do not.
    pub(crate) fn end0(&self, idx: usize, deep: bool) -> usize {
        let s = &self.sections[idx];
        let next = if deep {
            self.sections[idx + 1..].iter().find(|n| n.level <= s.level)
        } else {
            self.sections.get(idx + 1)
        };
        match next {
            Some(n) => n.line - 1,
            None => {
                let mut end = self.lines.len();
                while end > s.heading_last_line && self.line(end - 1).trim().is_empty() {
                    end -= 1;
                }
                end
            }
        }
    }

    /// 1-based last line of a section.
    pub fn end_line(&self, idx: usize, deep: bool) -> usize {
        self.end0(idx, deep)
    }

    /// Lines of the section body (after the heading), joined with `\n`.
    pub(crate) fn body(&self, idx: usize, deep: bool) -> String {
        let s = &self.sections[idx];
        (s.heading_last_line..self.end0(idx, deep))
            .map(|i| self.line(i))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Body of a section. Content is printed with LF line endings whatever
    /// the file uses (spec decision 11).
    pub fn read(&self, selector: &str, deep: bool) -> Result<SectionRead<'_>, Error> {
        let idx = self.resolve_index(selector)?;
        Ok(SectionRead {
            section: &self.sections[idx],
            content: self.body(idx, deep),
            end_line: self.end0(idx, deep),
        })
    }

    /// Sections strictly inside the extent of `selector` (always deep), for
    /// `outline --after`.
    pub fn outline_after(&self, selector: &str) -> Result<Vec<&Section>, Error> {
        let idx = self.resolve_index(selector)?;
        let parent = &self.sections[idx];
        let end = self.end0(idx, true);
        Ok(self
            .sections
            .iter()
            .filter(|s| s.line > parent.line && s.line <= end && s.level > parent.level)
            .collect())
    }

    /// Replaces the 0-based lines `[a, b)` by `new` and returns the new text.
    ///
    /// This is a splice of the line array, joined back like `join("\n")`:
    /// bytes outside the replaced lines are copied untouched (mixed line
    /// endings survive), inserted lines use the dominant line ending, and the
    /// final line, which has no line ending, is never given one.
    pub(crate) fn splice_lines(&self, a: usize, b: usize, new: &[String]) -> String {
        let n = self.lines.len();
        let eol = self.line_ending.as_str();
        let mut out = String::with_capacity(self.text.len());
        if a > 0 {
            out.push_str(&self.text[..self.lines[a - 1].end]);
            let left_sep = if a < n {
                &self.text[self.lines[a - 1].end..self.lines[a].start]
            } else {
                eol
            };
            if !new.is_empty() || b < n {
                out.push_str(left_sep);
            }
        }
        if !new.is_empty() {
            out.push_str(&new.join(eol));
            if b < n {
                out.push_str(eol);
            }
        }
        if b < n {
            out.push_str(&self.text[self.lines[b].start..]);
        }
        out
    }

    /// Bytes of the original text that `splice_lines(a, b, ..)` may change.
    fn edit_range(&self, a: usize, b: usize) -> Range<usize> {
        let start = if a > 0 { self.lines[a - 1].end } else { 0 };
        let end = self.lines.get(b).map_or(self.text.len(), |l| l.start);
        start..end
    }

    /// Bytes a `write` of the section body may change.
    pub fn body_byte_range(&self, idx: usize, deep: bool) -> Range<usize> {
        self.edit_range(self.sections[idx].heading_last_line, self.end0(idx, deep))
    }

    /// Bytes a `remove` of the section (with subsections, if `deep`) may change.
    pub fn section_byte_range(&self, idx: usize, deep: bool) -> Range<usize> {
        self.edit_range(self.sections[idx].line - 1, self.end0(idx, deep))
    }

    /// Bytes an insertion before the 0-based line `at` may change.
    pub fn insertion_byte_range(&self, at: usize) -> Range<usize> {
        self.edit_range(at, at)
    }
}
