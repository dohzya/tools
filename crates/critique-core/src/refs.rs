//! Passage references written in documents: `<!-- ref: path:12-14~mrfi^id -->`
//! with optional `{&&label ... label&&}` snapshots.

use crate::scan::{is_escaped_at, is_ws, line_of, timestamp_value};
use md_manipulator::mrfi::{is_js_whitespace, js_trim};

/// Inclusive 1-based lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineRange {
    /// First line.
    pub start: u64,
    /// Last line.
    pub end: u64,
}

/// `{&&label ... label&&}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// Trimmed inner text.
    pub content: String,
    /// Label.
    pub label: String,
    /// Whole block.
    pub raw: String,
}

/// One `;`-separated target of a reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    /// Parsed lines (absent when the target is invalid).
    pub line_range: Option<LineRange>,
    /// `~...` locator.
    pub mrfi: Option<String>,
    /// File.
    pub path: String,
    /// Source text of the target.
    pub raw: String,
    /// `~id` of a review item.
    pub review_id: Option<String>,
    /// Inline snapshot.
    pub snapshot: Option<Snapshot>,
    /// `^id` anchor.
    pub stable_id: Option<String>,
}

/// A `ref` statement and where it sits (byte offsets).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    /// Offset after the last character.
    pub end: usize,
    /// 1-based position among the references.
    pub index: usize,
    /// Last line.
    pub line_end: usize,
    /// First line.
    pub line_start: usize,
    /// Statement text.
    pub raw: String,
    /// First byte.
    pub start: usize,
    /// Targets (never empty).
    pub targets: Vec<Target>,
    /// Timestamp of `ref%ts:`.
    pub timestamp: Option<String>,
}

/// Problem with snapshot labels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotIssue {
    /// `duplicate-nested-label` or `unclosed-snapshot`.
    pub kind: &'static str,
    /// Label.
    pub label: String,
}

fn is_label_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

/// Length of `{&&label` at `at`, with the label.
fn snapshot_open(s: &str, at: usize) -> Option<(usize, &str)> {
    let rest = s.get(at..)?.strip_prefix("{&&")?;
    let n = rest.bytes().take_while(|&b| is_label_char(b)).count();
    (n > 0).then(|| (3 + n, &rest[..n]))
}

/// Length of `label&&}` at `at`.
fn any_snapshot_close(s: &str, at: usize) -> Option<usize> {
    let rest = s.get(at..)?;
    let n = rest.bytes().take_while(|&b| is_label_char(b)).count();
    (n > 0 && rest[n..].starts_with("&&}")).then_some(n + 3)
}

struct Parsed {
    duplicates: Vec<String>,
    snapshot: Option<Snapshot>,
    unclosed: Vec<String>,
}

fn unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

fn parse_labelled_snapshot(raw: &str) -> Parsed {
    struct Entry<'a> {
        content_start: usize,
        label: &'a str,
        start: usize,
    }
    let mut duplicates = Vec::new();
    let mut stack: Vec<Entry<'_>> = Vec::new();
    let mut first: Option<Snapshot> = None;
    let mut i = 0;
    while i < raw.len() {
        if !raw.is_char_boundary(i) {
            i += 1;
            continue;
        }
        if is_escaped_at(raw, i) {
            i += 1;
            continue;
        }
        if let Some((len, label)) = snapshot_open(raw, i) {
            if stack.iter().any(|e| e.label == label) {
                duplicates.push(label.to_string());
            }
            stack.push(Entry {
                content_start: i + len,
                label,
                start: i,
            });
            i += len;
            continue;
        }
        if let Some(current) = stack.last() {
            let close = format!("{}&&}}", current.label);
            if raw[i..].starts_with(&close) {
                let entry = stack.pop();
                if let Some(entry) = entry
                    && stack.is_empty()
                    && first.is_none()
                {
                    let end = i + close.len();
                    first = Some(Snapshot {
                        content: js_trim(&raw[entry.content_start..i]).to_string(),
                        label: entry.label.to_string(),
                        raw: raw[entry.start..end].to_string(),
                    });
                }
                i += close.len();
                continue;
            }
        }
        i += 1;
    }
    Parsed {
        duplicates: unique(duplicates),
        snapshot: first,
        unclosed: unique(stack.iter().map(|e| e.label.to_string())),
    }
}

/// Snapshot label problems of a reference.
pub fn validate_snapshots(reference: &Reference) -> Vec<SnapshotIssue> {
    let mut issues = Vec::new();
    for target in &reference.targets {
        let parsed = parse_labelled_snapshot(&target.raw);
        issues.extend(parsed.duplicates.into_iter().map(|label| SnapshotIssue {
            kind: "duplicate-nested-label",
            label,
        }));
        issues.extend(parsed.unclosed.into_iter().map(|label| SnapshotIssue {
            kind: "unclosed-snapshot",
            label,
        }));
    }
    issues
}

/// `L?\d+(-L?\d+)?` to a range (`None` when malformed or reversed).
pub fn parse_line_range(value: &str) -> Option<LineRange> {
    let (first, second) = match value.split_once('-') {
        Some((a, b)) => (a, Some(b)),
        None => (value, None),
    };
    let number = |s: &str| -> Option<(bool, u64)> {
        let (l, digits) = match s.strip_prefix('L') {
            Some(d) => (true, d),
            None => (false, s),
        };
        (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
            .then(|| digits.parse().ok().map(|n| (l, n)))?
    };
    let (start_l, start) = number(first)?;
    let (end_l, end) = match second {
        Some(s) => number(s)?,
        None => (false, start),
    };
    if !start_l && end_l {
        return None;
    }
    (start >= 1 && end >= start).then_some(LineRange { start, end })
}

/// `12` or `12-14`.
pub fn format_line_range(range: LineRange) -> String {
    if range.start == range.end {
        range.start.to_string()
    } else {
        format!("{}-{}", range.start, range.end)
    }
}

/// `(canonical, location)` of a target.
pub fn format_target(target: &Target) -> (String, String) {
    let suffix = format!(
        "{}{}{}",
        target.mrfi.as_deref().unwrap_or(""),
        target
            .review_id
            .as_ref()
            .map_or(String::new(), |r| format!("~{r}")),
        target
            .stable_id
            .as_ref()
            .map_or(String::new(), |r| format!("^{r}"))
    );
    let location = match target.line_range {
        Some(r) => format!("{}:{}", target.path, format_line_range(r)),
        None => target.path.clone(),
    };
    (format!("{location}{suffix}"), location)
}

fn replace_label_runs(value: &str, open: bool) -> String {
    let b = value.as_bytes();
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < b.len() {
        if open {
            if let Some((len, _)) = snapshot_open(value, i) {
                out.push_str("{&&");
                i += len;
                continue;
            }
        } else if is_label_char(b[i])
            && (i == 0 || !is_label_char(b[i - 1]))
            && let Some(len) = any_snapshot_close(value, i)
        {
            out.push_str("&&}");
            i += len;
            continue;
        }
        let ch = value[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Comparable form of a snapshot: labels erased, whitespace collapsed.
pub fn normalize_snapshot_content(value: &str) -> String {
    normalize_labels_and_space(value)
}

/// Labels replaced by `{&&` / `&&}` only.
pub fn normalize_snapshot_labels(value: &str) -> String {
    replace_label_runs(&replace_label_runs(value, true), false)
}

fn normalize_labels_and_space(value: &str) -> String {
    crate::ids::collapse_whitespace(&normalize_snapshot_labels(value))
}

fn parse_mrfi_target(value: &str) -> Option<String> {
    let start = value.find('~')?;
    if value[start..].starts_with("~{") {
        let end = value[start + 2..].find('}')? + start + 2;
        return Some(value[start..=end].to_string());
    }
    let rest = &value[start + 1..];
    let n: usize = rest
        .chars()
        .take_while(|c| !is_js_whitespace(*c) && !matches!(c, '^' | '~' | '{' | ':'))
        .map(char::len_utf8)
        .sum();
    (n > 0).then(|| value[start..start + 1 + n].to_string())
}

struct Ids {
    mrfi: Option<String>,
    review_id: Option<String>,
    stable_id: Option<String>,
}

fn parse_target_ids(value: &str) -> Ids {
    let mrfi = parse_mrfi_target(value);
    let (mut review_id, mut stable_id) = (None, None);
    let b = value.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if (b[i] == b'~' || b[i] == b'^') && b.get(i + 1).is_some_and(|&c| is_label_char(c)) {
            let n = b[i + 1..].iter().take_while(|&&c| is_label_char(c)).count();
            let id = value[i + 1..i + 1 + n].to_string();
            if b[i] == b'~' && mrfi.is_none() {
                review_id = Some(id);
            } else if b[i] == b'^' {
                stable_id = Some(id);
            }
            i += 1 + n;
        } else {
            i += 1;
        }
    }
    Ids {
        mrfi,
        review_id,
        stable_id,
    }
}

fn has_line_terminator(s: &str) -> bool {
    s.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
}

/// `^(.+?):((?:L?\d+)(?:-L?\d+)?)(?=$|[~^\s{])(.*)?$` -> (path, spec, rest).
fn match_target_spec(spec: &str) -> Option<(&str, &str, &str)> {
    for (colon, _) in spec.match_indices(':') {
        let path = &spec[..colon];
        if path.is_empty() || has_line_terminator(path) {
            continue;
        }
        let b = spec.as_bytes();
        let mut k = colon + 1;
        let digits = |k: &mut usize| {
            if b.get(*k) == Some(&b'L') {
                *k += 1;
            }
            let s = *k;
            while b.get(*k).is_some_and(u8::is_ascii_digit) {
                *k += 1;
            }
            *k > s
        };
        if !digits(&mut k) {
            continue;
        }
        if b.get(k) == Some(&b'-') {
            let mut k2 = k + 1;
            if digits(&mut k2) {
                k = k2;
            }
        }
        let ok = k == spec.len()
            || spec[k..]
                .chars()
                .next()
                .is_some_and(|c| matches!(c, '~' | '^' | '{') || is_js_whitespace(c));
        let rest = &spec[k..];
        if ok && !has_line_terminator(rest) {
            return Some((path, &spec[colon + 1..k], rest));
        }
    }
    None
}

/// `^(.+?):([^~^]+)(.*)?$` -> (path, rest).
fn match_loose_spec(spec: &str) -> Option<(&str, &str)> {
    for (colon, _) in spec.match_indices(':') {
        let path = &spec[..colon];
        if path.is_empty() || has_line_terminator(path) {
            continue;
        }
        let after = &spec[colon + 1..];
        let n = after.find(['~', '^']).unwrap_or(after.len());
        if n == 0 {
            continue;
        }
        let rest = &after[n..];
        if !has_line_terminator(rest) {
            return Some((path, rest));
        }
    }
    None
}

fn parse_target(raw: &str) -> Target {
    let parsed = parse_labelled_snapshot(raw);
    let snapshot = parsed.snapshot;
    let spec = js_trim(match &snapshot {
        Some(s) => &raw[..raw.find(&s.raw).unwrap_or(raw.len())],
        None => raw,
    });
    if let Some((path, range, rest)) = match_target_spec(spec)
        && let Some(line_range) = parse_line_range(range)
    {
        let ids = parse_target_ids(rest);
        return Target {
            line_range: Some(line_range),
            mrfi: ids.mrfi,
            path: js_trim(path).to_string(),
            raw: raw.to_string(),
            review_id: ids.review_id,
            snapshot,
            stable_id: ids.stable_id,
        };
    }
    let loose = match_loose_spec(spec);
    let ids = parse_target_ids(loose.map_or("", |(_, rest)| rest));
    Target {
        line_range: None,
        mrfi: ids.mrfi,
        path: js_trim(loose.map_or(spec, |(p, _)| p)).to_string(),
        raw: raw.to_string(),
        review_id: ids.review_id,
        snapshot,
        stable_id: ids.stable_id,
    }
}

fn split_targets(statement: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let (mut start, mut depth, mut debug_depth) = (0, 0usize, 0usize);
    let mut i = 0;
    while i < statement.len() {
        if !statement.is_char_boundary(i) {
            i += 1;
            continue;
        }
        if is_escaped_at(statement, i) {
            i += 1;
            continue;
        }
        if statement[i..].starts_with("~{") {
            debug_depth += 1;
            i += 2;
            continue;
        }
        let byte = statement.as_bytes()[i];
        if byte == b'}' && debug_depth > 0 {
            debug_depth -= 1;
            i += 1;
            continue;
        }
        if let Some((len, _)) = snapshot_open(statement, i) {
            depth += 1;
            i += len;
            continue;
        }
        if let Some(len) = any_snapshot_close(statement, i) {
            depth = depth.saturating_sub(1);
            i += len;
            continue;
        }
        if byte == b';' && depth == 0 && debug_depth == 0 {
            targets.push(js_trim(&statement[start..i]).to_string());
            start = i + 1;
        }
        i += 1;
    }
    targets.push(js_trim(&statement[start..]).to_string());
    targets.into_iter().filter(|t| !t.is_empty()).collect()
}

fn parse_targets(statement: &str) -> Vec<Target> {
    split_targets(statement)
        .iter()
        .map(|t| parse_target(t))
        .collect()
}

fn html_comments(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(k) = text[i..].find("<!--") {
        let start = i + k;
        match text[start + 4..].find("-->") {
            Some(e) => {
                let end = start + 4 + e + 3;
                out.push((start, end));
                i = end;
            }
            None => i = start + 1,
        }
    }
    out
}

/// `ref(%ts)?(:|\s+)` at the start of `content`: (timestamp, prefix length).
fn block_prefix(content: &str) -> Option<(Option<String>, usize)> {
    let rest = content.strip_prefix("ref")?;
    let b = rest.as_bytes();
    let after = |pos: usize| -> Option<usize> {
        // `(?::|\s+)`
        if b.get(pos) == Some(&b':') {
            return Some(pos + 1);
        }
        let n: usize = rest[pos..]
            .chars()
            .take_while(|c| is_js_whitespace(*c))
            .map(char::len_utf8)
            .sum();
        (n > 0).then_some(pos + n)
    };
    if b.first() == Some(&b'%') {
        let e = timestamp_value(rest, 1, |e| after(e).is_some())?;
        return Some((Some(rest[1..e].to_string()), 3 + after(e)?));
    }
    after(0).map(|e| (None, 3 + e))
}

/// Start of the next `(^|[ \t\r\n])@(agent|me)?(%ts)?(?=[ \t:]|$)` at or after `from`.
fn next_review_marker(content: &str, from: usize) -> Option<usize> {
    let b = content.as_bytes();
    let tail_ok = |pos: usize| pos == b.len() || matches!(b[pos], b' ' | b'\t' | b':');
    let at_marker = |p: usize| -> bool {
        if b.get(p) != Some(&b'@') {
            return false;
        }
        let names = [("agent", 5), ("me", 2), ("", 0)];
        names.iter().any(|(name, len)| {
            if !content[p + 1..].starts_with(name) {
                return false;
            }
            let after = p + 1 + len;
            if b.get(after) == Some(&b'%')
                && let Some(e) = timestamp_value(content, after + 1, |_| true)
                && tail_ok(e)
            {
                return true;
            }
            tail_ok(after)
        })
    };
    (from..b.len()).find_map(|i| {
        if !content.is_char_boundary(i) {
            return None;
        }
        if i == 0 && at_marker(0) {
            return Some(0);
        }
        (is_ws(b[i]) && at_marker(i + 1)).then_some(i + 1)
    })
}

fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

fn make(
    index: usize,
    raw: &str,
    start: usize,
    end: usize,
    text: &str,
    timestamp: Option<String>,
    targets: Vec<Target>,
) -> Reference {
    Reference {
        end,
        index,
        line_end: line_of(text, start.max(end.saturating_sub(1))),
        line_start: line_of(text, start),
        raw: raw.to_string(),
        start,
        targets,
        timestamp,
    }
}

/// All references of a document, in order.
pub fn collect_references(text: &str) -> Vec<Reference> {
    let mut refs: Vec<Reference> = Vec::new();
    for (start, end) in html_comments(text) {
        let raw = &text[start..end];
        let content = &raw[4..raw.len() - 3];
        let trimmed = content.trim_start_matches(is_js_whitespace);
        if let Some((timestamp, len)) = block_prefix(trimmed) {
            let targets = parse_targets(&trimmed[len..]);
            refs.push(make(
                refs.len() + 1,
                raw,
                start,
                end,
                text,
                timestamp,
                targets,
            ));
            continue;
        }
        let cb = content.as_bytes();
        let mut from = 0;
        while let Some(k) = content[from..].find("ref:") {
            let at = from + k;
            from = at + 4;
            if at > 0 && is_word(cb[at - 1]) {
                continue;
            }
            let ws: usize = content[at + 4..]
                .chars()
                .take_while(|c| is_js_whitespace(*c))
                .map(char::len_utf8)
                .sum();
            let st = at + 4 + ws;
            let marker = next_review_marker(content, st).unwrap_or(content.len());
            let nl = content[st..].find('\n').map(|n| n + st);
            let en = match nl {
                Some(n) if n < marker => n,
                _ => marker,
            };
            let statement = js_trim(&content[st..en.max(st)]);
            if statement.is_empty() {
                continue;
            }
            let targets = parse_targets(statement);
            refs.push(make(
                refs.len() + 1,
                statement,
                start + 4 + st,
                start + 4 + en,
                text,
                None,
                targets,
            ));
        }
    }
    refs.into_iter().filter(|r| !r.targets.is_empty()).collect()
}

/// `^id` anchors defined by `<!-- ref-id: ^id -->` comments.
pub fn collect_reference_ids(text: &str) -> Vec<String> {
    html_comments(text)
        .into_iter()
        .filter_map(|(s, e)| {
            let inner = text[s + 4..e - 3].trim_matches(is_js_whitespace);
            let inner = match inner.strip_prefix("ref-id:") {
                Some(rest) => rest.trim_start_matches(is_js_whitespace),
                None => inner,
            };
            let id = inner.strip_prefix('^')?;
            (!id.is_empty() && id.bytes().all(is_label_char)).then(|| id.to_string())
        })
        .collect()
}

/// Number of UTF-16 units before byte offset `byte`.
pub fn utf16_offset(text: &str, byte: usize) -> usize {
    text[..byte.min(text.len())].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_and_inline_references() {
        let text = "a <!-- ref: source.md:3; other.md:8-10 -->\n<!--\n@me why\n@agent ref: source.md:6\n-->\n";
        let refs = collect_references(text);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].targets.len(), 2);
        assert_eq!(
            refs[0].targets[1].line_range,
            Some(LineRange { start: 8, end: 10 })
        );
        assert_eq!(refs[1].line_start, 4);
    }

    #[test]
    fn target_ids_and_snapshots() {
        let t = parse_target("a.md:6~{v0;r=6:1-6:30}^anchor");
        assert_eq!(t.mrfi.as_deref(), Some("~{v0;r=6:1-6:30}"));
        assert_eq!(t.stable_id.as_deref(), Some("anchor"));
        let t = parse_target("a.md:2 {&&r1\nbody\nr1&&}");
        assert_eq!(
            t.snapshot.as_ref().map(|s| s.content.as_str()),
            Some("body")
        );
        let bad = parse_target("a.md:0");
        assert_eq!(bad.line_range, None);
        assert_eq!(bad.path, "a.md");
        assert_eq!(
            parse_line_range("L8-L10"),
            Some(LineRange { start: 8, end: 10 })
        );
        assert_eq!(parse_line_range("8-L10"), None);
        assert_eq!(parse_line_range("9-3"), None);
    }

    #[test]
    fn snapshot_normalization() {
        assert_eq!(
            normalize_snapshot_content("{&&rA1\n x  y\nrA1&&}"),
            "{&& x y &&}"
        );
    }
}
