//! Scanner for the review syntax: `<!-- ... -->` and `{?? ... ??}`
//! conversations, CriticMarkup annotations, `@me` / `@agent` messages.

/// Who wrote a message line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Marker {
    /// `@`
    Quick,
    /// `@me`
    Me,
    /// `@agent`
    Agent,
}

impl Marker {
    /// Source spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Quick => "@",
            Self::Me => "@me",
            Self::Agent => "@agent",
        }
    }
}

/// Kind of a review annotation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `{++ ++}`
    Addition,
    /// `{-- --}`
    Deletion,
    /// `{~~ ~> ~~}`
    Substitution,
    /// `{== ==}`
    Highlight,
    /// `{>> <<}`
    Comment,
    /// `{?? ??}` without any marker
    Discussion,
    /// A block with at least one `@` marker
    Conversation,
}

impl Kind {
    /// Name used in ids and JSON.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Addition => "addition",
            Self::Deletion => "deletion",
            Self::Substitution => "substitution",
            Self::Highlight => "highlight",
            Self::Comment => "comment",
            Self::Discussion => "discussion",
            Self::Conversation => "conversation",
        }
    }
}

/// A located review item (byte offsets, 1-based lines).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Annotation {
    /// 1-based position among the collected items.
    pub index: usize,
    /// Byte offset of the first character.
    pub start: usize,
    /// Byte offset after the last character.
    pub end: usize,
    /// Source slice.
    pub raw: String,
    /// Kind.
    pub kind: Kind,
    /// First line (1-based).
    pub line_start: usize,
    /// Last line (1-based).
    pub line_end: usize,
    /// Timestamp value written in `{++%ts|`.
    pub timestamp: Option<String>,
}

/// `[ \t\r\n]`
pub(crate) fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n')
}

/// 1-based line of a byte offset. `\n`, `\r\n` and a lone `\r` each end one
/// line (as in `md`; the TS counted only `\n`, so a CR-only file was one line).
pub(crate) fn line_of(text: &str, offset: usize) -> usize {
    let bytes = text.as_bytes();
    let before = &bytes[..offset.min(bytes.len())];
    // A `\r` is a line end unless its `\n` follows; looking past `offset`
    // keeps an offset between the two bytes of a CRLF on the same line.
    1 + before
        .iter()
        .enumerate()
        .filter(|&(i, &b)| b == b'\n' || (b == b'\r' && bytes.get(i + 1) != Some(&b'\n')))
        .count()
}

/// Source lines without their terminator (`\n`, `\r\n` or `\r`); a final
/// terminator leaves an empty last line, like `split('\n')` did.
pub fn lines(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\n' => {
                out.push(&text[start..i]);
                start = i + 1;
            }
            b'\r' => {
                out.push(&text[start..i]);
                if bytes.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    out.push(&text[start..]);
    out
}

/// End of `[A-Za-z0-9]{8}` at `at`.
fn alnum8(s: &str, at: usize) -> Option<usize> {
    let b = s.as_bytes().get(at..at + 8)?;
    b.iter().all(u8::is_ascii_alphanumeric).then_some(at + 8)
}

/// End of `[\uac00-\ucbff]{4}` at `at`.
fn hangul4(s: &str, at: usize) -> Option<usize> {
    let mut end = at;
    let mut chars = s.get(at..)?.chars();
    for _ in 0..4 {
        let c = chars.next()?;
        if !('\u{ac00}'..='\u{cbff}').contains(&c) {
            return None;
        }
        end += c.len_utf8();
    }
    Some(end)
}

/// End of the ISO 8601 form accepted by the TS regex (shape only).
fn iso(s: &str, at: usize) -> Option<usize> {
    let b = s.as_bytes();
    let digits = |from: usize, n: usize| {
        b.get(from..from + n)
            .is_some_and(|d| d.iter().all(u8::is_ascii_digit))
    };
    let sep = |i: usize, c: u8| b.get(at + i) == Some(&c);
    if !(digits(at, 4)
        && sep(4, b'-')
        && digits(at + 5, 2)
        && sep(7, b'-')
        && digits(at + 8, 2)
        && sep(10, b'T')
        && digits(at + 11, 2)
        && sep(13, b':')
        && digits(at + 14, 2)
        && sep(16, b':')
        && digits(at + 17, 2))
    {
        return None;
    }
    let tz = at + 19;
    match b.get(tz)? {
        b'Z' => Some(tz + 1),
        b'+' | b'-' => {
            if digits(tz + 1, 2) {
                if b.get(tz + 3) == Some(&b':') && digits(tz + 4, 2) {
                    return Some(tz + 6);
                }
                if digits(tz + 3, 2) {
                    return Some(tz + 5);
                }
            }
            None
        }
        _ => None,
    }
}

/// The three timestamp alternatives, tried in the TS regex order, followed by
/// `accept`.
pub(crate) fn timestamp_value(s: &str, at: usize, accept: impl Fn(usize) -> bool) -> Option<usize> {
    [alnum8, hangul4, iso]
        .iter()
        .find_map(|alt| alt(s, at).filter(|&e| accept(e)))
}

/// One `@`, `@me` or `@agent` message marker (TS `REVIEW_MARKER_RE`).
#[derive(Debug, Clone)]
pub(crate) struct MarkerMatch {
    /// Start of the delimiter before the marker (equals `marker_start` at the string start).
    pub index: usize,
    pub prefix_len: usize,
    pub marker: Marker,
    /// Byte range of the `%timestamp` value (without the `%`).
    pub ts: Option<(usize, usize)>,
    pub end: usize,
}

impl MarkerMatch {
    pub fn marker_start(&self) -> usize {
        self.index + self.prefix_len
    }
}

/// Marker, byte range of its `%timestamp` value, end of the match.
type MarkerParts = (Marker, Option<(usize, usize)>, usize);

fn marker_at(s: &str, p: usize) -> Option<MarkerParts> {
    let b = s.as_bytes();
    for (name, marker) in [
        ("@agent", Marker::Agent),
        ("@me", Marker::Me),
        ("@", Marker::Quick),
    ] {
        if !s[p..].starts_with(name) {
            continue;
        }
        let after = p + name.len();
        if b.get(after) == Some(&b'%') {
            let at_boundary = |e: usize| e == b.len() || is_ws(b[e]);
            if let Some(e) = timestamp_value(s, after + 1, at_boundary) {
                return Some((marker, Some((after + 1, e)), e));
            }
            continue;
        }
        let mut k = after;
        while matches!(b.get(k), Some(b' ' | b'\t')) {
            k += 1;
        }
        if b.get(k) == Some(&b':') || b.get(after).is_none_or(|&c| is_ws(c)) {
            return Some((marker, None, after));
        }
    }
    None
}

pub(crate) fn find_markers(s: &str) -> Vec<MarkerMatch> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let (prefix_len, p) = if i == 0 && b[0] == b'@' {
            (0, 0)
        } else if is_ws(b[i]) && b.get(i + 1) == Some(&b'@') {
            (1, i + 1)
        } else {
            i += 1;
            continue;
        };
        match marker_at(s, p) {
            Some((marker, ts, end)) => {
                out.push(MarkerMatch {
                    index: i,
                    prefix_len,
                    marker,
                    ts,
                    end,
                });
                i = end.max(i + 1);
            }
            None => i += 1,
        }
    }
    out
}

/// A `{++%ts|` style metadata prefix (TS `REVIEW_ANNOTATION_TIMESTAMP_RE`).
#[derive(Debug, Clone)]
pub(crate) struct AnnotationTs {
    /// Start of the 3-byte opener.
    pub index: usize,
    /// Byte range of the timestamp value.
    pub ts: (usize, usize),
    /// Byte offset after the closing `|`.
    pub end: usize,
}

pub(crate) fn find_annotation_timestamps(s: &str) -> Vec<AnnotationTs> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 4 < b.len() {
        let opener =
            b[i] == b'{' && matches!(&b[i + 1..i + 3], b"++" | b"--" | b"==" | b">>" | b"~~");
        if opener
            && b[i + 3] == b'%'
            && let Some(e) = timestamp_value(s, i + 4, |e| b.get(e) == Some(&b'|'))
        {
            out.push(AnnotationTs {
                index: i,
                ts: (i + 4, e),
                end: e + 1,
            });
            i = e + 1;
            continue;
        }
        i += 1;
    }
    out
}

/// End of a `%timestamp|` metadata prefix starting at `at` (the `%`).
pub fn metadata_prefix_end(s: &str, at: usize) -> Option<usize> {
    if s.as_bytes().get(at) != Some(&b'%') {
        return None;
    }
    timestamp_value(s, at + 1, |e| s.as_bytes().get(e) == Some(&b'|')).map(|e| e + 1)
}

/// Removes `%timestamp` parts (TS `stripReviewTimestamps`).
pub(crate) fn strip_timestamps(text: &str) -> String {
    let mut first = String::with_capacity(text.len());
    let mut cursor = 0;
    for m in find_markers(text) {
        first.push_str(&text[cursor..m.end.min(m.marker_start() + m.marker.as_str().len())]);
        cursor = m.end;
    }
    first.push_str(&text[cursor..]);
    let mut out = String::with_capacity(first.len());
    let mut cursor = 0;
    for m in find_annotation_timestamps(&first) {
        out.push_str(&first[cursor..m.index + 3]);
        cursor = m.end;
    }
    out.push_str(&first[cursor..]);
    out
}

pub(crate) fn is_escaped_at(text: &str, offset: usize) -> bool {
    text.as_bytes()[..offset]
        .iter()
        .rev()
        .take_while(|&&b| b == b'\\')
        .count()
        % 2
        == 1
}

/// `lastIndexOf(close)`; the TS yields -1 when absent, which `slice` reads as
/// "before the last character" (only reachable for `{?? ... ?}`).
pub(crate) fn conversation_close_start(raw: &str) -> usize {
    let close = if raw.starts_with("<!--") {
        "-->"
    } else {
        "??}"
    };
    raw.rfind(close).unwrap_or(raw.len().saturating_sub(1))
}

/// One message line of a conversation.
#[derive(Debug, Clone)]
pub struct ReviewLine {
    /// Author marker.
    pub marker: Marker,
    /// Byte offset of the marker in the raw block.
    pub marker_start: usize,
    /// Trimmed message text.
    pub body: String,
    /// Timestamp value after `%`.
    pub timestamp: Option<String>,
}

/// Offset of the message text after a marker (skips blanks and one `:`).
pub(crate) fn body_start(raw: &str, offset: usize) -> usize {
    let b = raw.as_bytes();
    let mut k = offset;
    while matches!(b.get(k), Some(b' ' | b'\t')) {
        k += 1;
    }
    if b.get(k) == Some(&b':') {
        k += 1;
        while matches!(b.get(k), Some(b' ' | b'\t')) {
            k += 1;
        }
    }
    k
}

/// Message lines of a raw block (escaped markers skipped).
pub fn review_lines(raw: &str) -> Vec<ReviewLine> {
    let matches: Vec<_> = find_markers(raw)
        .into_iter()
        .filter(|m| !is_escaped_at(raw, m.marker_start()))
        .collect();
    let close = conversation_close_start(raw);
    matches
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let start = body_start(raw, m.end);
            let next = matches.get(i + 1).map_or(close, MarkerMatch::marker_start);
            let body = if next > start {
                md_manipulator::mrfi::js_trim(&raw[start..next])
            } else {
                ""
            };
            ReviewLine {
                marker: m.marker,
                marker_start: m.marker_start(),
                body: body.to_string(),
                timestamp: m.ts.map(|(a, e)| raw[a..e].to_string()),
            }
        })
        .collect()
}

fn has_roles(raw: &str) -> bool {
    !review_lines(raw).is_empty()
}

/// Raw blocks with their kind. `critic` adds the CriticMarkup annotations to
/// the two block syntaxes of conversations (JS regex alternation, lazy).
fn find_blocks(text: &str, critic: bool) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if !text.is_char_boundary(i) {
            i += 1;
            continue;
        }
        let rest = &text[i..];
        let end = if let Some(after) = rest.strip_prefix("<!--") {
            after.find("-->").map(|k| i + 4 + k + 3)
        } else if b[i] == b'{' && rest.len() >= 3 && rest.is_char_boundary(3) {
            let closer = match &rest[..3] {
                "{??" => Some("?}"),
                "{++" if critic => Some("++}"),
                "{--" if critic => Some("--}"),
                "{==" if critic => Some("==}"),
                "{>>" if critic => Some("<<}"),
                _ => None,
            };
            if let Some(c) = closer {
                rest[3..].find(c).map(|k| i + 3 + k + c.len())
            } else if critic && &rest[..3] == "{~~" {
                rest[3..].find("~>").and_then(|k| {
                    let from = 3 + k + 2;
                    rest[from..].find("~~}").map(|j| i + from + j + 3)
                })
            } else {
                None
            }
        } else {
            None
        };
        match end {
            Some(e) => {
                out.push((i, e));
                i = e;
            }
            None => i += 1,
        }
    }
    out
}

pub(crate) fn annotation_kind(raw: &str) -> Option<Kind> {
    if raw.starts_with("<!--") && raw.ends_with("-->") {
        return has_roles(raw).then_some(Kind::Conversation);
    }
    let pairs = [
        ("{++", "++}", Kind::Addition),
        ("{--", "--}", Kind::Deletion),
        ("{==", "==}", Kind::Highlight),
        ("{>>", "<<}", Kind::Comment),
        ("{~~", "~~}", Kind::Substitution),
    ];
    for (open, close, kind) in pairs {
        if raw.starts_with(open) && raw.ends_with(close) {
            return Some(kind);
        }
    }
    if raw.starts_with("{??") && raw.ends_with("??}") {
        return Some(if has_roles(raw) {
            Kind::Conversation
        } else {
            Kind::Discussion
        });
    }
    None
}

/// Metadata timestamp of `{++%ts|...`, looked up right after the opener.
fn metadata_timestamp(raw: &str) -> Option<String> {
    let ts = find_annotation_timestamps(raw)
        .into_iter()
        .next()
        .filter(|m| m.index == 0)?;
    Some(raw[ts.ts.0..ts.ts.1].to_string())
}

fn make(
    text: &str,
    index: usize,
    start: usize,
    end: usize,
    kind: Kind,
    timestamp: Option<String>,
) -> Annotation {
    Annotation {
        index,
        start,
        end,
        raw: text[start..end].to_string(),
        kind,
        line_start: line_of(text, start),
        line_end: line_of(text, start.max(end - 1)),
        timestamp,
    }
}

/// Collects every annotation, in document order.
pub fn collect_annotations(text: &str) -> Vec<Annotation> {
    let mut out = Vec::new();
    for (start, end) in find_blocks(text, true) {
        let raw = &text[start..end];
        let Some(kind) = annotation_kind(raw) else {
            continue;
        };
        out.push(make(
            text,
            out.len() + 1,
            start,
            end,
            kind,
            metadata_timestamp(raw),
        ));
    }
    out
}

/// Conversation blocks only (`<!-- -->` or `{?? ??}` holding at least one marker).
pub fn collect_conversations(text: &str) -> Vec<Annotation> {
    let mut out = Vec::new();
    for (start, end) in find_blocks(text, false) {
        if has_roles(&text[start..end]) {
            out.push(make(
                text,
                out.len() + 1,
                start,
                end,
                Kind::Conversation,
                None,
            ));
        }
    }
    out
}

/// Conversation state, from the last message line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// No message, or last message by the agent.
    Open,
    /// Last message by a human, empty.
    Wip,
    /// Last message by a human.
    Handled,
    /// Last message by a human is `ok`.
    Resolved,
}

/// Status of a raw conversation block.
pub fn conversation_status(raw: &str) -> Status {
    let lines = review_lines(raw);
    let Some(last) = lines.last() else {
        return Status::Open;
    };
    if last.marker == Marker::Agent {
        return Status::Open;
    }
    let body = md_manipulator::mrfi::js_trim(&last.body);
    if body.is_empty() {
        Status::Wip
    } else if body.eq_ignore_ascii_case("ok") {
        Status::Resolved
    } else {
        Status::Handled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "intro @me hi\n<!-- @agent%1VB66I0Y question\n@me answer -->\n{++%1VB66I0Y|add++} {>> note <<} {?? plain ??} {~~a~>b~~}\n";

    #[test]
    fn annotations_match_ts() {
        let got: Vec<_> = collect_annotations(TEXT)
            .iter()
            .map(|a| {
                (
                    a.kind,
                    a.start,
                    a.end,
                    a.line_start,
                    a.line_end,
                    a.timestamp.clone(),
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                (Kind::Conversation, 13, 57, 2, 3, None),
                (Kind::Addition, 58, 77, 4, 4, Some("1VB66I0Y".into())),
                (Kind::Comment, 78, 90, 4, 4, None),
                (Kind::Discussion, 91, 104, 4, 4, None),
                (Kind::Substitution, 105, 115, 4, 4, None),
            ]
        );
    }

    #[test]
    fn statuses() {
        assert_eq!(
            conversation_status("<!-- @agent q\n@me answer -->"),
            Status::Handled
        );
        assert_eq!(conversation_status("<!-- @agent q -->"), Status::Open);
        assert_eq!(conversation_status("<!-- @agent q @me -->"), Status::Wip);
        assert_eq!(
            conversation_status("<!-- @agent q @me OK -->"),
            Status::Resolved
        );
        assert_eq!(conversation_status("{++x++}"), Status::Open);
    }

    #[test]
    fn unclosed_and_escaped() {
        assert!(collect_annotations("<!-- @me never closed").is_empty());
        assert!(collect_annotations("<!-- \\@me nothing -->").is_empty());
        assert_eq!(collect_annotations("a\r\nb {++x++}\r\n")[0].line_start, 2);
    }

    #[test]
    fn crlf_lf_and_lone_cr_number_lines_alike() {
        for eol in ["\n", "\r\n", "\r"] {
            let text = format!("a{eol}b{eol}{{?? @me x{eol}y ??}}{eol}c {{++z++}}{eol}");
            let lines: Vec<_> = collect_annotations(&text)
                .iter()
                .map(|a| (a.line_start, a.line_end))
                .collect();
            assert_eq!(lines, [(3, 4), (5, 5)], "eol {eol:?}");
        }
    }

    #[test]
    fn mixed_endings_and_a_cr_before_the_offset_pair() {
        // \r\n counts once, a lone \r counts, and an offset between the two
        // bytes of a CRLF is still on the line the pair terminates.
        let text = "a\r\nb\rc {++x++}";
        assert_eq!(collect_annotations(text)[0].line_start, 3);
        assert_eq!(line_of(text, 2), 1);
        assert_eq!(line_of(text, 3), 2);
    }

    #[test]
    fn lines_splits_at_every_ending() {
        assert_eq!(lines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
        assert_eq!(lines("a\r\n"), ["a", ""]);
        assert_eq!(lines(""), [""]);
    }

    use crate::timestamp::Format;

    const MIXED: &str = "<!-- @agent%1VB66I0Y q\n@me%갚뚭씀갼 a\n@me: bare -->\n{++%2026-01-01T01:00:00+01:00|add++} {--del--}\n";

    #[test]
    fn convert_rewrites_every_existing_timestamp() {
        let iso = "2026-01-01T01:00:00+01:00";
        assert_eq!(
            convert_timestamps(MIXED, Format::Iso).unwrap(),
            (
                2,
                format!(
                    "<!-- @agent%{iso} q\n@me%{iso} a\n@me: bare -->\n{{++%{iso}|add++}} {{--del--}}\n"
                )
            )
        );
        assert_eq!(
            convert_timestamps(MIXED, Format::Compact).unwrap(),
            (
                2,
                "<!-- @agent%1VB66I0Y q\n@me%1VB66I0Y a\n@me: bare -->\n{++%1VB66I0Y|add++} {--del--}\n"
                    .to_string()
            )
        );
    }

    #[test]
    fn convert_leaves_what_the_parser_does_not_read_as_a_timestamp() {
        let text = "100%discount a%20bcdefgh x @me%1VB66I0Yx {++%1VB66I0Y add++}\n";
        assert_eq!(
            convert_timestamps(text, Format::Iso).unwrap(),
            (0, text.to_string())
        );
    }

    #[test]
    fn convert_is_transform_without_stamping() {
        let text =
            "<!-- @agent%1VB66I0Y q\n@me%갚뚭씀갼 a -->\n{++%2026-01-01T01:00:00+01:00|add++}\n";
        for format in [Format::Compact, Format::Hangul, Format::Iso] {
            assert_eq!(
                convert_timestamps(text, format).unwrap(),
                transform_timestamps(text, "unused", format).unwrap()
            );
        }
    }

    #[test]
    fn convert_reports_values_out_of_the_target_range() {
        // Year 9999 is past the 6 base62 digits of the compact epoch.
        let text = "@me%9999-01-01T00:00:00Z x";
        assert!(convert_timestamps(text, Format::Compact).is_err());
    }
}

/// `(@agent|@me|@)%TS` followed by whitespace or the end, anywhere in the
/// text (TS `DISPLAY_CONVERSATION_TIMESTAMP_RE`, no delimiter required);
/// returns the byte ranges of the values.
fn conversation_ts_matches(text: &str) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'@' {
            i += 1;
            continue;
        }
        let found = ["@agent", "@me", "@"].iter().find_map(|name| {
            if !text[i..].starts_with(name) {
                return None;
            }
            let after = i + name.len();
            if b.get(after) != Some(&b'%') {
                return None;
            }
            let e = timestamp_value(text, after + 1, |e| e == b.len() || is_ws(b[e]))?;
            Some((after + 1, e))
        });
        match found {
            Some(ts) => {
                i = ts.1;
                out.push(ts);
            }
            None => i += 1,
        }
    }
    out
}

/// Number of timestamps per encoding found in `text`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FormatStats {
    /// 8-character base62.
    pub compact: usize,
    /// 4 Hangul syllables.
    pub hangul: usize,
    /// ISO 8601.
    pub iso: usize,
}

/// Counts the timestamps of each encoding.
pub fn timestamp_format_stats(text: &str) -> FormatStats {
    let mut stats = FormatStats::default();
    let values = conversation_ts_matches(text)
        .into_iter()
        .chain(find_annotation_timestamps(text).into_iter().map(|m| m.ts));
    for (a, e) in values {
        let v = &text[a..e];
        if v.len() == 8 && v.bytes().all(|b| b.is_ascii_alphanumeric()) {
            stats.compact += 1;
        } else if crate::timestamp::is_hangul_timestamp(v) {
            stats.hangul += 1;
        } else {
            stats.iso += 1;
        }
    }
    stats
}

fn render_value(value: &str, format: crate::timestamp::Format) -> Result<Option<String>, String> {
    let Some(t) = crate::timestamp::parse_review_timestamp(value) else {
        return Ok(None);
    };
    crate::timestamp::encode(t, format)
        .map(Some)
        .map_err(|e| e.0)
}

/// Rewrites the value ranges `spans` of `text` in `format`, skipping the
/// unparsable and unchanged ones; adds the rewrites to `count`.
fn convert_spans(
    text: &str,
    spans: impl IntoIterator<Item = (usize, usize)>,
    format: crate::timestamp::Format,
    count: &mut usize,
) -> Result<String, String> {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for (a, e) in spans {
        let value = &text[a..e];
        match render_value(value, format)? {
            Some(rendered) if rendered != value => {
                out.push_str(&text[cursor..a]);
                out.push_str(&rendered);
                cursor = e;
                *count += 1;
            }
            _ => {}
        }
    }
    out.push_str(&text[cursor..]);
    Ok(out)
}

/// Converts `@marker%ts`.
fn convert_marker_timestamps(
    text: &str,
    format: crate::timestamp::Format,
    count: &mut usize,
) -> Result<String, String> {
    convert_spans(text, conversation_ts_matches(text), format, count)
}

/// Converts `{++%ts|`.
fn convert_annotation_timestamps(
    text: &str,
    format: crate::timestamp::Format,
    count: &mut usize,
) -> Result<String, String> {
    let spans = find_annotation_timestamps(text).into_iter().map(|m| m.ts);
    convert_spans(text, spans, format, count)
}

/// Rewrites the existing review timestamps in `format`, without stamping
/// anything: the ones [`transform_timestamps`] converts, nothing else (a `%`
/// followed by 8 alphanumerics elsewhere is prose or a URL escape).
/// Returns the number of changes and the new text.
pub fn convert_timestamps(
    text: &str,
    format: crate::timestamp::Format,
) -> Result<(usize, String), String> {
    let mut count = 0;
    let markers = convert_marker_timestamps(text, format, &mut count)?;
    let out = convert_annotation_timestamps(&markers, format, &mut count)?;
    Ok((count, out))
}

/// Rewrites every review timestamp in `format` and stamps the untimestamped
/// markers and annotations with `fallback` (an already encoded value).
/// Returns the number of changes and the new text.
pub fn transform_timestamps(
    text: &str,
    fallback: &str,
    format: crate::timestamp::Format,
) -> Result<(usize, String), String> {
    let mut count = 0;

    // 1. Convert `@marker%ts`.
    let step1 = convert_marker_timestamps(text, format, &mut count)?;

    // 2. Stamp bare markers.
    let b = step1.as_bytes();
    let mut step2 = String::with_capacity(step1.len());
    let mut cursor = 0;
    let mut i = 0;
    while i < b.len() {
        let (prefix_len, p) = if i == 0 && b[0] == b'@' {
            (0, 0)
        } else if is_ws(b[i]) && b.get(i + 1) == Some(&b'@') {
            (1, i + 1)
        } else {
            i += 1;
            continue;
        };
        let hit = ["@agent", "@me", "@"].iter().find_map(|name| {
            if !step1[p..].starts_with(name) {
                return None;
            }
            let after = p + name.len();
            if matches!(b.get(after), Some(b'%' | b'(')) {
                return None;
            }
            let mut k = after;
            while matches!(b.get(k), Some(b' ' | b'\t')) {
                k += 1;
            }
            (b.get(k) == Some(&b':') || b.get(after).is_none_or(|&c| is_ws(c)))
                .then_some((*name, after))
        });
        match hit {
            Some((name, after)) => {
                step2.push_str(&step1[cursor..p]);
                let _ = prefix_len;
                step2.push_str(if name == "@" { "@me" } else { name });
                step2.push('%');
                step2.push_str(fallback);
                cursor = after;
                count += 1;
                i = after.max(i + 1);
            }
            None => i += 1,
        }
    }
    step2.push_str(&step1[cursor..]);

    // 3. Convert `{++%ts|`.
    let step3 = convert_annotation_timestamps(&step2, format, &mut count)?;

    // 4. Stamp bare `{++`.
    let b = step3.as_bytes();
    let mut out = String::with_capacity(step3.len());
    let mut cursor = 0;
    let mut i = 0;
    while i + 2 < b.len() {
        let opener =
            b[i] == b'{' && matches!(&b[i + 1..i + 3], b"++" | b"--" | b"==" | b">>" | b"~~");
        if opener && b.get(i + 3) != Some(&b'%') {
            out.push_str(&step3[cursor..i + 3]);
            out.push('%');
            out.push_str(fallback);
            out.push('|');
            cursor = i + 3;
            count += 1;
            i += 3;
        } else {
            i += 1;
        }
    }
    out.push_str(&step3[cursor..]);
    Ok((count, out))
}
