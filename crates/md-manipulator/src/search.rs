use crate::Document;

/// A line containing the pattern.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    /// Id of the last section starting at or before the line; `None` before
    /// the first heading (frontmatter included).
    pub section_id: Option<String>,
    /// 1-based line.
    pub line: usize,
    /// The line, without its line ending.
    pub content: String,
}

/// Matches of one section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionMatches {
    /// Section id.
    pub id: String,
    /// Heading level.
    pub level: usize,
    /// Heading text.
    pub title: String,
    /// 1-based matching lines.
    pub lines: Vec<usize>,
    /// `lines.len()`.
    pub match_count: usize,
}

/// Result of [`search`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchResult {
    /// Every matching line, in file order.
    pub matches: Vec<Match>,
    /// Matches grouped by section, in order of first match.
    pub summaries: Vec<SectionMatches>,
}

/// Finds the lines that contain `pattern` as plain text (no regex, case
/// sensitive), frontmatter included.
pub fn search(doc: &Document, pattern: &str) -> SearchResult {
    let mut matches = vec![];
    let mut summaries: Vec<SectionMatches> = vec![];
    for (i, content) in doc.lines().enumerate() {
        if !content.contains(pattern) {
            continue;
        }
        let line = i + 1;
        let section = doc.sections().iter().rev().find(|s| s.line <= line);
        if let Some(s) = section {
            match summaries.iter_mut().find(|m| m.id == s.id) {
                Some(m) => {
                    m.lines.push(line);
                    m.match_count += 1;
                }
                None => summaries.push(SectionMatches {
                    id: s.id.clone(),
                    level: s.level,
                    title: s.title.clone(),
                    lines: vec![line],
                    match_count: 1,
                }),
            }
        }
        matches.push(Match {
            section_id: section.map(|s| s.id.clone()),
            line,
            content: content.to_owned(),
        });
    }
    SearchResult { matches, summaries }
}
