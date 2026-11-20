//! Review items: collection, status filters, summaries and git diff lines.

use crate::actions;
use crate::ids::collapse_whitespace;
use crate::scan::{self, Annotation, Kind, Marker, Status};
use crate::timestamp::{ReviewTimestamp, format_for_display, parse_review_timestamp};
use std::collections::BTreeSet;

/// Which conversations a command keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    /// Everything.
    All,
    /// `open`
    Open,
    /// `wip`
    Wip,
    /// `handled`
    Handled,
    /// `resolved`
    Resolved,
    /// `open` or `wip`
    Pending,
}

/// A collected item. `from_conversations` mirrors the TS distinction between
/// items built by the conversation collector (they have `roles`, so their
/// status is real) and items built by the annotation collector (no `roles`:
/// every one of them, even a conversation, is "handled" for filtering).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewItem {
    /// The located block.
    pub ann: Annotation,
    /// Built by the conversation collector.
    pub from_conversations: bool,
}

/// Items for the `conversation_only` flag (conversations first, then the
/// annotation-collected discussions, as the TS does) or every annotation.
pub fn collect_review_items(
    text: &str,
    conversation_only: bool,
    filter: Filter,
) -> Vec<ReviewItem> {
    let keep = |item: &ReviewItem| matches_filter(item, filter);
    if !conversation_only {
        return scan::collect_annotations(text)
            .into_iter()
            .map(|ann| ReviewItem {
                ann,
                from_conversations: false,
            })
            .filter(keep)
            .collect();
    }
    let conversations = scan::collect_conversations(text)
        .into_iter()
        .map(|ann| ReviewItem {
            ann,
            from_conversations: true,
        });
    let discussions = scan::collect_annotations(text)
        .into_iter()
        .filter(|a| a.kind == Kind::Discussion)
        .map(|ann| ReviewItem {
            ann,
            from_conversations: false,
        });
    conversations.chain(discussions).filter(keep).collect()
}

/// Status used by filters.
pub fn item_status(item: &ReviewItem) -> Status {
    if item.from_conversations && item.ann.kind == Kind::Conversation {
        scan::conversation_status(&item.ann.raw)
    } else {
        Status::Handled
    }
}

/// Whether `item` passes `filter`.
pub fn matches_filter(item: &ReviewItem, filter: Filter) -> bool {
    let status = item_status(item);
    match filter {
        Filter::All => true,
        Filter::Pending => matches!(status, Status::Open | Status::Wip),
        Filter::Open => status == Status::Open,
        Filter::Wip => status == Status::Wip,
        Filter::Handled => status == Status::Handled,
        Filter::Resolved => status == Status::Resolved,
    }
}

/// Whether the item spans a line of `lines`.
pub fn overlaps_lines(item: &Annotation, lines: &BTreeSet<usize>) -> bool {
    lines
        .range(item.line_start..=item.line_end)
        .next()
        .is_some()
}

/// One message of a conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    /// Author marker.
    pub marker: Marker,
    /// Text.
    pub body: String,
    /// Timestamp value.
    pub timestamp: Option<String>,
}

/// Messages of a raw block.
pub fn messages(raw: &str) -> Vec<Message> {
    scan::review_lines(raw)
        .into_iter()
        .map(|l| Message {
            marker: l.marker,
            body: l.body,
            timestamp: l.timestamp,
        })
        .collect()
}

/// First `n` UTF-16 units as text (a split surrogate pair becomes U+FFFD,
/// which is what writing it to stdout gives in JS).
pub fn utf16_prefix(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn conversation_content(raw: &str) -> &str {
    if raw.starts_with("<!--") && raw.ends_with("-->") && raw.len() >= 7 {
        &raw[4..raw.len() - 3]
    } else if raw.starts_with("{??") && raw.ends_with("??}") && raw.len() >= 6 {
        &raw[3..raw.len() - 3]
    } else {
        raw
    }
}

/// What a summary shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SummarySource {
    /// Conversations as their whitespace-collapsed content, other items as
    /// the block itself (see [`render_for_display`]), line breaks included.
    Display,
    /// What the item is about, whitespace-collapsed: the inserted, deleted or
    /// highlighted text, the comment, `old -> new`, or a conversation's content.
    Payload,
}

/// How [`summarize`] renders an item: each front end picks the values that
/// suit its display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SummaryOptions {
    /// What the summary shows.
    pub source: SummarySource,
    /// Maximum length in UTF-16 units; longer text is cut and ends with `...`.
    pub width: usize,
}

fn truncate_summary(text: String, width: usize) -> String {
    if utf16_len(&text) <= width {
        text
    } else {
        format!("{}...", utf16_prefix(&text, width.saturating_sub(3)))
    }
}

fn payload(ann: &Annotation) -> String {
    let raw = &ann.raw;
    let inner_end = raw.len() - 3;
    match ann.kind {
        Kind::Conversation | Kind::Discussion => conversation_content(raw).to_string(),
        Kind::Substitution => {
            let start = actions::payload_start(raw, 3);
            match raw[start..].find("~>") {
                Some(k) => format!(
                    "{} -> {}",
                    &raw[start..start + k],
                    &raw[start + k + 2..inner_end]
                ),
                None => raw.clone(),
            }
        }
        _ => raw[actions::payload_start(raw, 3).min(inner_end)..inner_end].to_string(),
    }
}

/// Summary of any item.
pub fn summarize(ann: &Annotation, options: &SummaryOptions) -> String {
    let text = match options.source {
        SummarySource::Payload => collapse_whitespace(&payload(ann)),
        SummarySource::Display if ann.kind == Kind::Conversation => {
            collapse_whitespace(conversation_content(&ann.raw))
        }
        SummarySource::Display => render_for_display(ann),
    };
    truncate_summary(text, options.width)
}

/// The block with its metadata timestamp shown as ISO.
pub fn render_for_display(ann: &Annotation) -> String {
    let Some(ts) = &ann.timestamp else {
        return ann.raw.clone();
    };
    let Some(parsed) = parse_review_timestamp(ts) else {
        return ann.raw.clone();
    };
    match scan::find_annotation_timestamps(&ann.raw).first() {
        Some(m) if m.index == 0 => {
            format!(
                "{}%{}|{}",
                &ann.raw[..3],
                format_for_display(parsed),
                &ann.raw[m.end..]
            )
        }
        _ => ann.raw.clone(),
    }
}

/// Timestamp used by `--since`: annotation metadata, or the last message.
pub fn item_timestamp(item: &ReviewItem) -> Option<ReviewTimestamp> {
    if item.ann.kind != Kind::Conversation {
        return item
            .ann
            .timestamp
            .as_deref()
            .and_then(parse_review_timestamp);
    }
    let last = messages(&item.ann.raw).pop()?;
    last.timestamp.as_deref().and_then(parse_review_timestamp)
}

/// Order used by `--since`; `tie_break_offset` is the located-items variant.
pub fn compare_timestamps(
    left: ReviewTimestamp,
    right: ReviewTimestamp,
    tie_break_offset: bool,
) -> i64 {
    match left.unix_seconds.cmp(&right.unix_seconds) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Equal if tie_break_offset => {
            i64::from(left.offset_minutes - right.offset_minutes)
        }
        std::cmp::Ordering::Equal => 0,
    }
}

/// `--since` test.
pub fn matches_since(
    item: &ReviewItem,
    since: Option<ReviewTimestamp>,
    tie_break_offset: bool,
) -> bool {
    let Some(since) = since else { return true };
    item_timestamp(item).is_some_and(|t| compare_timestamps(t, since, tie_break_offset) >= 0)
}

/// Added lines per file of a `git diff --unified=0` output, in file order.
pub fn added_lines_by_file(diff: &str) -> Vec<(String, BTreeSet<usize>)> {
    let mut out: Vec<(String, BTreeSet<usize>)> = Vec::new();
    let mut current: Option<usize> = None;
    let mut line_no = 0usize;
    for line in diff.split('\n') {
        if let Some(rest) = line.strip_prefix("+++ ") {
            let file = rest.trim();
            current = (file != "/dev/null").then(|| {
                let name = normalize_diff_path(file);
                match out.iter().position(|(f, _)| *f == name) {
                    Some(i) => i,
                    None => {
                        out.push((name, BTreeSet::new()));
                        out.len() - 1
                    }
                }
            });
            continue;
        }
        if let Some(start) = parse_hunk_start(line) {
            line_no = start;
            continue;
        }
        let Some(idx) = current else { continue };
        if line.is_empty() || line.starts_with("diff --git ") {
            continue;
        }
        if line.starts_with('+') {
            out[idx].1.insert(line_no);
            line_no += 1;
        } else if !line.starts_with('-') {
            line_no += 1;
        }
    }
    out
}

/// `@@ -a[,b] +c[,d] @@` -> c.
fn parse_hunk_start(line: &str) -> Option<usize> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(' ')?;
    if !old
        .split(',')
        .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        || old.split(',').count() > 2
    {
        return None;
    }
    let rest = rest.strip_prefix('+')?;
    let (new, rest) = rest.split_once(' ')?;
    if !rest.starts_with("@@") || new.split(',').count() > 2 {
        return None;
    }
    let mut parts = new.split(',');
    let first = parts.next()?;
    if parts
        .next()
        .is_some_and(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    if first.is_empty() || !first.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    first.parse().ok()
}

fn normalize_diff_path(file: &str) -> String {
    let unquoted = if file.len() >= 2 && file.starts_with('"') && file.ends_with('"') {
        // Remove one backslash level, like `.replace(/\\(.)/g, "$1")`.
        let inner = &file[1..file.len() - 1];
        let mut out = String::new();
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some(n) => out.push(n),
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }
        out
    } else {
        file.to_string()
    };
    unquoted
        .strip_prefix("b/")
        .map_or(unquoted.clone(), str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_filters_follow_the_collector_quirk() {
        let text = "<!-- @agent q -->\n{?? @me x ??}\n";
        let all = collect_review_items(text, false, Filter::All);
        assert_eq!(all.len(), 2);
        // Annotation-collected conversations are always "handled".
        assert!(collect_review_items(text, false, Filter::Open).is_empty());
        assert_eq!(collect_review_items(text, false, Filter::Handled).len(), 2);
        let conv = collect_review_items(text, true, Filter::Open);
        assert_eq!(conv.len(), 1);
        assert_eq!(conv[0].ann.line_start, 1);
    }

    #[test]
    fn summary_truncates_by_utf16_units() {
        let long = format!("{{>> {} <<}}", "é".repeat(200));
        let s = summarize(
            &collect_review_items(&long, false, Filter::All)[0].ann,
            &TUI,
        );
        assert_eq!(s.encode_utf16().count(), 120);
        assert!(s.ends_with("..."));
    }

    const TUI: SummaryOptions = SummaryOptions {
        source: SummarySource::Display,
        width: 120,
    };
    const GUI: SummaryOptions = SummaryOptions {
        source: SummarySource::Payload,
        width: 80,
    };

    fn first_ann(text: &str) -> Annotation {
        collect_review_items(text, false, Filter::All)[0]
            .ann
            .clone()
    }

    fn payload_summary(text: &str) -> String {
        summarize(&first_ann(text), &GUI)
    }

    #[test]
    fn payload_summary_strips_markers_and_metadata() {
        assert_eq!(payload_summary("{++%1VB66I0Y|new\n  text++}"), "new text");
        assert_eq!(
            payload_summary("{--%\u{ada8}\u{b22d}\u{b147}\u{ac78}|old--}"),
            "old"
        );
        assert_eq!(payload_summary("{== mark ==}"), "mark");
        assert_eq!(payload_summary("{>>%1VB66I0Y| note <<}"), "note");
        assert_eq!(payload_summary("{~~%1VB66I0Y|a~>b~~}"), "a -> b");
        assert_eq!(
            payload_summary("{?? plain\n discussion ??}"),
            "plain discussion"
        );
        assert_eq!(payload_summary("<!--\n@agent  q\n-->"), "@agent q");
    }

    #[test]
    fn payload_summary_cuts_at_the_given_width() {
        let fits = "x".repeat(80);
        assert_eq!(payload_summary(&format!("{{>>{fits}<<}}")), fits);
        let over = "é".repeat(81);
        assert_eq!(
            payload_summary(&format!("{{>>{over}<<}}")),
            format!("{}...", "é".repeat(77))
        );
    }

    #[test]
    fn cli_summary_keeps_an_annotation_block_as_displayed() {
        let s = summarize(&first_ann("{++%1VB66I0Y|two\n  lines++}"), &TUI);
        assert_eq!(s, "{++%2026-01-01T01:00:00+01:00|two\n  lines++}");
    }

    #[test]
    fn cli_summary_collapses_a_conversation_content() {
        let s = summarize(&first_ann("<!--\n@agent  q\n@me   a\n-->"), &TUI);
        assert_eq!(s, "@agent q @me a");
    }

    #[test]
    fn cli_summary_cuts_at_120_units() {
        let fits = format!("{{>>{}<<}}", "x".repeat(114));
        assert_eq!(summarize(&first_ann(&fits), &TUI), fits);
        let over = format!("{{>>{}<<}}", "x".repeat(115));
        assert_eq!(
            summarize(&first_ann(&over), &TUI),
            format!("{}...", &over[..117])
        );
    }

    #[test]
    fn display_shows_iso_for_metadata_timestamps() {
        let ann = &collect_review_items("{++%1VB66I0Y|x++}", false, Filter::All)[0].ann;
        assert_eq!(
            render_for_display(ann),
            "{++%2026-01-01T01:00:00+01:00|x++}"
        );
    }

    #[test]
    fn diff_lines() {
        let diff = "diff --git a/f.md b/f.md\n--- a/f.md\n+++ b/f.md\n@@ -1,0 +2,2 @@\n+a\n+b\n@@ -5 +7 @@\n-x\n+y\n";
        let got = added_lines_by_file(diff);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, "f.md");
        assert_eq!(got[0].1.iter().copied().collect::<Vec<_>>(), vec![2, 3, 7]);
    }
}
