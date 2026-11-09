//! Reference generation for a range or a section.

use super::MrfiError;
use super::blocks::{BlockKind, BlockStep, BlockTree};
use super::codec::{
    Context, Extent, Format, FuzzyHash, Mrfi, OffsetRange, SourceRange, format_mrfi,
};
use super::doc::MrfiDoc;
use super::text::{HashSignal, js_trim, sha256_prefix, smh64, xxh64_prefix};

/// Field selection of a generated reference; never changes field semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile {
    /// `r`, `fh`, `hh`, plus `a` when an anchor is present.
    Min,
    /// `min` plus `p`, `ctx` and `doc`.
    Default,
    /// `default` plus `o` and `ph`.
    Full,
}

/// What to reference.
#[derive(Debug, Clone, Copy)]
pub enum Target {
    /// An explicit range (columns in scalar values).
    Range(SourceRange),
    /// A whole section, by index in [`MrfiDoc::sections`].
    Section(usize),
}

/// Generation options.
#[derive(Debug, Clone, Copy)]
pub struct GenerateOptions {
    /// Output encoding.
    pub format: Format,
    /// Field profile.
    pub profile: Profile,
    /// Add the `q` quote field.
    pub quote: bool,
    /// Quote cap in scalar values (default 80).
    pub quote_max: usize,
    /// Makes a scope reference; section targets only.
    pub extent: Option<Extent>,
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            format: Format::Hangul,
            profile: Profile::Default,
            quote: false,
            quote_max: 80,
            extent: None,
        }
    }
}

/// Generates a reference string.
pub fn generate(
    doc: &MrfiDoc,
    target: Target,
    options: &GenerateOptions,
) -> Result<String, MrfiError> {
    format_mrfi(&generate_mrfi(doc, target, options)?, options.format)
}

/// Generates the locator, profile applied, before encoding.
pub fn generate_mrfi(
    doc: &MrfiDoc,
    target: Target,
    options: &GenerateOptions,
) -> Result<Mrfi, MrfiError> {
    match target {
        Target::Range(_) if options.extent.is_some() => Err(MrfiError::new(
            "scope references require a section target, not a range",
        )),
        Target::Range(range) => {
            validate_range(doc, &range)?;
            let selected = doc.range_text(&range);
            let quote = options
                .quote
                .then(|| truncate_quote(js_trim(&selected), options.quote_max));
            Ok(apply_profile(build(doc, &range, quote), options.profile))
        }
        Target::Section(index) => {
            let section = &doc.sections()[index];
            let range = if options.extent.is_some() {
                SourceRange {
                    start_line: section.line as u64,
                    start_column: 1,
                    end_line: section.heading_last_line as u64,
                    end_column: doc.line_end_column(section.heading_last_line) as u64,
                }
            } else {
                let end = doc.trimmed_end_line(index);
                SourceRange {
                    start_line: section.line as u64,
                    start_column: 1,
                    end_line: end as u64,
                    end_column: doc.line_end_column(end) as u64,
                }
            };
            let quote = options
                .quote
                .then(|| truncate_quote(&section.title, options.quote_max));
            let mut parsed = build(doc, &range, quote);
            if let Some(extent) = options.extent {
                parsed.extent = Some(extent);
                // `hh` of a scope reference is the enclosing heading's scope.
                parsed.heading_hash = doc.parent_section(index).map(|p| FuzzyHash {
                    hash: smh64(&doc.section_scope_text(p)),
                    max_distance: None,
                });
            }
            Ok(apply_profile(parsed, options.profile))
        }
    }
}

fn validate_range(doc: &MrfiDoc, r: &SourceRange) -> Result<(), MrfiError> {
    let shown = r.format();
    if !r.is_valid_shape() {
        return Err(MrfiError::new(format!(
            "Range must select at least one character: {shown}"
        )));
    }
    let lines = doc.line_count() as u64;
    if r.start_line > lines || r.end_line > lines {
        return Err(MrfiError::new(format!(
            "Range is outside the document: {shown}"
        )));
    }
    if r.start_column > doc.line_end_column(r.start_line as usize) as u64
        || r.end_column > doc.line_end_column(r.end_line as usize) as u64
    {
        return Err(MrfiError::new(format!(
            "Range column is outside the document line: {shown}"
        )));
    }
    Ok(())
}

fn apply_profile(parsed: Mrfi, profile: Profile) -> Mrfi {
    if profile == Profile::Full {
        return parsed;
    }
    let mut base = Mrfi {
        range: parsed.range,
        exact_hash: parsed.exact_hash,
        heading_hash: parsed.heading_hash,
        anchor: parsed.anchor.filter(|s| !s.is_empty()),
        quote: parsed.quote.filter(|s| !s.is_empty()),
        extent: parsed.extent,
        ..Mrfi::default()
    };
    if profile == Profile::Default {
        base.structural_path = parsed.structural_path;
        base.context = parsed.context;
        base.document_hash = parsed.document_hash;
    }
    base
}

/// Keeps the beginning, middle and end of `value`, separated by `...`.
pub fn truncate_quote(value: &str, max: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= max {
        return value.to_owned();
    }
    if max == 0 {
        return String::new();
    }
    if max <= 9 {
        return chars[..max].iter().collect();
    }
    let segment = (max - 6) / 3;
    let remainder = (max - 6) - segment * 3;
    let start_len = segment + usize::from(remainder > 0);
    let middle_len = segment + usize::from(remainder > 1);
    let end_len = segment;
    let middle_start = start_len.max((chars.len() - middle_len) / 2);
    let take = |a: usize, b: usize| chars[a..b].iter().collect::<String>();
    format!(
        "{}...{}...{}",
        take(0, start_len),
        take(middle_start, middle_start + middle_len),
        take(chars.len() - end_len, chars.len())
    )
}

fn build(doc: &MrfiDoc, range: &SourceRange, quote: Option<String>) -> Mrfi {
    let selected = doc.range_text(range);
    let section = doc.section_containing_line(range.start_line as usize);
    let (start, end) = doc.offsets_of(range);
    let heading_text = section.map_or_else(|| selected.clone(), |s| doc.section_scope_text(s));
    Mrfi {
        range: Some(*range),
        offset_range: Some(OffsetRange {
            start: start as u64,
            end: end as u64,
        }),
        structural_path: structural_path(doc, section, start, end),
        exact_hash: Some(HashSignal {
            algorithm: "xxh64".to_owned(),
            prefix: xxh64_prefix(&selected, 8),
        }),
        heading_hash: Some(FuzzyHash {
            hash: smh64(&heading_text),
            max_distance: None,
        }),
        passage_hash: Some(FuzzyHash {
            hash: smh64(&selected),
            max_distance: None,
        }),
        context: Some(context_hashes(doc, start, end)),
        document_hash: Some(FuzzyHash {
            hash: smh64(doc.text()),
            max_distance: None,
        }),
        anchor: section.and_then(|s| doc.first_section_anchor(s)),
        quote: quote.filter(|q| !q.is_empty()),
        ..Mrfi::default()
    }
}

/// Source of the node a `p` path is computed in: the section (heading to
/// `line_end`) or the whole document, with its scalar start offset.
pub(crate) fn node_source(doc: &MrfiDoc, section: Option<usize>) -> (usize, String) {
    match section {
        None => (0, doc.text().to_owned()),
        Some(i) => {
            let s = &doc.sections()[i];
            let start = doc.line_column_to_offset(s.line, 1);
            let end = doc.line_column_to_offset(s.line_end, doc.line_end_column(s.line_end));
            (start, doc.slice(start, end))
        }
    }
}

fn structural_path(
    doc: &MrfiDoc,
    section: Option<usize>,
    start: usize,
    end: usize,
) -> Option<String> {
    let (node_start, text) = node_source(doc, section);
    let steps = BlockTree::parse(&text).steps_for_range(
        start.saturating_sub(node_start),
        end.saturating_sub(node_start),
    );
    let mut segments: Vec<String> = vec![];
    if let Some(i) = section {
        segments.push(heading_ancestry(doc, i));
    }
    segments.extend(steps.iter().map(format_step));
    (!segments.is_empty()).then(|| segments.join("/"))
}

fn format_step(step: &BlockStep) -> String {
    format!("{}[{}]", step.kind.as_str(), step.occurrence)
}

fn heading_ancestry(doc: &MrfiDoc, index: usize) -> String {
    let mut chain = vec![index];
    while let Some(p) = doc.parent_section(*chain.last().expect("non-empty")) {
        chain.push(p);
    }
    chain.reverse();
    chain
        .iter()
        .enumerate()
        .map(|(i, &c)| {
            let parent = (i > 0).then(|| chain[i - 1]);
            let level = doc.sections()[c].level;
            let occurrence = (0..=c)
                .filter(|&k| doc.sections()[k].level == level && doc.parent_section(k) == parent)
                .count();
            format!("h{level}[{occurrence}]")
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn context_hashes(doc: &MrfiDoc, start: usize, end: usize) -> Context {
    let chars = doc.chars();
    let before: String = chars[start.saturating_sub(64).min(chars.len())..start.min(chars.len())]
        .iter()
        .collect();
    let after: String = chars[end.min(chars.len())..(end + 64).min(chars.len())]
        .iter()
        .collect();
    Context {
        prefix: (!before.is_empty()).then(|| sha256_prefix(&before, 8)),
        suffix: (!after.is_empty()).then(|| sha256_prefix(&after, 8)),
    }
}

/// Parsed `p` path: heading chain then block steps.
pub(crate) struct ParsedPath {
    pub levels: Vec<usize>,
    pub occurrences: Vec<usize>,
    pub blocks: Vec<BlockStep>,
}

/// Parses `h1[1]/h2[3]/ul[1]/li[2]/p[1]`, tolerating a legacy `chars:a-b` tail.
pub(crate) fn parse_path(path: &str) -> Option<ParsedPath> {
    let mut segments: Vec<&str> = path.split('/').collect();
    if segments.last().is_some_and(|s| {
        s.strip_prefix("chars:").is_some_and(|r| {
            r.split_once('-').is_some_and(|(a, b)| {
                !a.is_empty()
                    && !b.is_empty()
                    && a.bytes().all(|c| c.is_ascii_digit())
                    && b.bytes().all(|c| c.is_ascii_digit())
            })
        })
    }) {
        segments.pop();
    }
    let step = |s: &str| -> Option<(String, usize)> {
        let inner = s.strip_suffix(']')?;
        let (name, n) = inner.split_once('[')?;
        if n.is_empty() || !n.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        Some((name.to_owned(), n.parse().unwrap_or(usize::MAX)))
    };
    let (mut levels, mut occurrences, mut blocks) = (vec![], vec![], vec![]);
    let mut i = 0;
    while i < segments.len() {
        match step(segments[i]) {
            Some((name, n))
                if name.len() == 2
                    && name.starts_with('h')
                    && matches!(name.as_bytes()[1], b'1'..=b'6') =>
            {
                levels.push((name.as_bytes()[1] - b'0') as usize);
                occurrences.push(n);
                i += 1;
            }
            _ => break,
        }
    }
    for s in &segments[i..] {
        let (name, n) = step(s)?;
        blocks.push(BlockStep {
            kind: BlockKind::parse(&name)?,
            occurrence: n,
        });
    }
    if levels.is_empty() && blocks.is_empty() {
        return None;
    }
    Some(ParsedPath {
        levels,
        occurrences,
        blocks,
    })
}
