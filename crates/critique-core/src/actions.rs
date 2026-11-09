//! Text edits on review items: apply/cancel annotations, human and agent
//! replies, deletion. They return new text; the host writes it.

use crate::scan::{self, Kind};

/// What to do with an item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Remove the block.
    Delete,
    /// Add or remove a trailing human `ok`.
    ToggleOk,
    /// Append a human reply.
    Reply(String),
    /// Accept a CriticMarkup change.
    Apply,
    /// Reject a CriticMarkup change.
    Cancel,
}

fn payload_start(raw: &str, content_start: usize) -> usize {
    match scan::metadata_prefix_end(raw, content_start) {
        Some(end) => end,
        None => content_start,
    }
}

/// `(cancel, apply)` replacements of a CriticMarkup block.
fn critic_replacement(raw: &str) -> Option<(String, String)> {
    let payload = |from: usize| raw[payload_start(raw, from)..raw.len() - 3].to_string();
    let starts =
        |open: &str, close: &str| raw.starts_with(open) && raw.ends_with(close) && raw.len() >= 6;
    if starts("{++", "++}") {
        return Some((String::new(), payload(3)));
    }
    if starts("{--", "--}") {
        return Some((payload(3), String::new()));
    }
    if starts("{==", "==}") {
        let p = payload(3);
        return Some((p.clone(), p));
    }
    if starts("{>>", "<<}") || starts("{??", "??}") {
        return Some((String::new(), String::new()));
    }
    if starts("{~~", "~~}") {
        let content_start = payload_start(raw, 3);
        let sep = content_start + raw[content_start..].find("~>")?;
        return Some((
            raw[content_start..sep].to_string(),
            raw[sep + 2..raw.len() - 3].to_string(),
        ));
    }
    None
}

/// Replacement of `raw` for `action`.
pub fn replacement(raw: &str, action: &Action) -> String {
    if *action == Action::Delete {
        return String::new();
    }
    let kind = scan::annotation_kind(raw);
    if kind == Some(Kind::Conversation) {
        return match action {
            Action::ToggleOk => toggle_human_ok(raw),
            Action::Reply(body) => append_human_reply(raw, body),
            _ => String::new(),
        };
    }
    if matches!(action, Action::ToggleOk | Action::Reply(_)) {
        return raw.to_string();
    }
    match critic_replacement(raw) {
        Some((cancel, apply)) => {
            if *action == Action::Apply {
                apply
            } else {
                cancel
            }
        }
        None => raw.to_string(),
    }
}

/// `text` with `[start, end)` replaced.
pub fn splice(text: &str, start: usize, end: usize, replacement: &str) -> String {
    format!("{}{replacement}{}", &text[..start], &text[end..])
}

fn is_inline(raw: &str) -> bool {
    !raw.contains(['\n', '\r'])
}

fn ends_with_ws(s: &str) -> bool {
    s.ends_with([' ', '\t', '\r', '\n'])
}

/// Dominant line ending of `text` (`\n` when it has none). In a mixed text
/// the most frequent of `\r\n`, `\n`, `\r` wins; ties go to the one found
/// first, so inserted lines look like their neighbours.
pub fn dominant_eol(text: &str) -> &'static str {
    let b = text.as_bytes();
    // (count, first position) for CRLF, LF, CR.
    let mut seen = [(0usize, usize::MAX); 3];
    let mut i = 0;
    while i < b.len() {
        let kind = match b[i] {
            b'\n' => Some(1),
            b'\r' if b.get(i + 1) == Some(&b'\n') => {
                i += 1;
                Some(0)
            }
            b'\r' => Some(2),
            _ => None,
        };
        if let Some(k) = kind {
            seen[k].0 += 1;
            seen[k].1 = seen[k].1.min(i);
        }
        i += 1;
    }
    let best = (0..3)
        .filter(|&k| seen[k].0 > 0)
        .max_by_key(|&k| (seen[k].0, std::cmp::Reverse(seen[k].1)));
    match best {
        Some(0) => "\r\n",
        Some(2) => "\r",
        _ => "\n",
    }
}

/// Offset of the start of the line containing `pos` (any line ending).
fn line_start_before(text: &str, pos: usize) -> usize {
    text[..pos].rfind(['\n', '\r']).map_or(0, |i| i + 1)
}

/// Appends `line` (a message without trailing newline) before the closing marker.
fn append_line(raw: &str, close: usize, line: &str) -> String {
    if is_inline(raw) {
        let before = &raw[..close];
        let prefix = if ends_with_ws(before) { "" } else { " " };
        return format!("{before}{prefix}{line} {}", &raw[close..]);
    }
    let eol = dominant_eol(raw);
    let close_line_start = line_start_before(raw, close);
    let close_line = &raw[close_line_start..close];
    let indent: String = close_line
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect();
    let full = format!("{indent}{line}{eol}");
    if close_line.chars().all(|c| c == ' ' || c == '\t') {
        return format!(
            "{}{full}{}",
            &raw[..close_line_start],
            &raw[close_line_start..]
        );
    }
    let prefix = if raw[..close].ends_with(['\n', '\r']) {
        ""
    } else {
        eol
    };
    format!("{}{prefix}{full}{}", &raw[..close], &raw[close..])
}

/// Appends a human `@me body` reply.
pub fn append_human_reply(raw: &str, body: &str) -> String {
    append_line(
        raw,
        scan::conversation_close_start(raw),
        &format!("@me {body}"),
    )
}

/// Appends an `@agent%<timestamp> body` reply. `timestamp` is the ISO value.
pub fn append_agent_reply(raw: &str, body: &str, timestamp: &str) -> String {
    let close = if raw.ends_with("-->") {
        raw.rfind("-->").unwrap_or(0)
    } else {
        raw.rfind("??}").unwrap_or(raw.len().saturating_sub(1))
    };
    append_line(raw, close, &format!("@agent%{timestamp} {body}"))
}

fn toggle_human_ok(raw: &str) -> String {
    let lines = scan::review_lines(raw);
    if scan::conversation_status(raw) == scan::Status::Resolved
        && let Some(last) = lines.last()
    {
        return remove_trailing_human_ok(raw, last.marker_start);
    }
    append_human_reply(raw, "ok")
}

fn remove_trailing_human_ok(raw: &str, marker_start: usize) -> String {
    let close = scan::conversation_close_start(raw);
    if is_inline(raw) {
        let remove_start =
            if marker_start > 0 && matches!(raw.as_bytes()[marker_start - 1], b' ' | b'\t') {
                marker_start - 1
            } else {
                marker_start
            };
        return format!("{} {}", &raw[..remove_start], &raw[close..]);
    }
    format!("{}{}", &raw[..marker_start], &raw[close..])
}

/// Removes `[start, end)` and the whitespace that would be left behind.
pub fn delete_with_whitespace(text: &str, start: usize, end: usize) -> String {
    let (mut start, mut end) = (start, end);
    let b = text.as_bytes();
    let line_start = line_start_before(text, start);
    let own_line = text[line_start..start]
        .chars()
        .all(|c| c == ' ' || c == '\t');
    if own_line {
        // Alone on its line: eat one adjacent newline so no blank line remains.
        if start > 0 && matches!(b[start - 1], b'\n' | b'\r') {
            // Eat the whole previous terminator (`\r\n` is one).
            start -= if b[start - 1] == b'\n' && start > 1 && b[start - 2] == b'\r' {
                2
            } else {
                1
            };
        } else if end < text.len() && matches!(b[end], b'\n' | b'\r') {
            end += if b[end] == b'\r' && b.get(end + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
        }
    } else {
        // Trailing other content (a list item's inline comment): drop only
        // the separating blanks, never the line's own newline.
        while start > 0 && matches!(b[start - 1], b' ' | b'\t') {
            start -= 1;
        }
    }
    format!("{}{}", &text[..start], &text[end..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn critic_apply_and_cancel() {
        assert_eq!(replacement("{++new++}", &Action::Apply), "new");
        assert_eq!(replacement("{++new++}", &Action::Cancel), "");
        assert_eq!(replacement("{--old--}", &Action::Apply), "");
        assert_eq!(replacement("{--old--}", &Action::Cancel), "old");
        assert_eq!(replacement("{~~a~>b~~}", &Action::Apply), "b");
        assert_eq!(replacement("{~~a~>b~~}", &Action::Cancel), "a");
        assert_eq!(replacement("{++%1VB66I0Y|new++}", &Action::Apply), "new");
        assert_eq!(replacement("{==hl==}", &Action::Apply), "hl");
        assert_eq!(replacement("{>>note<<}", &Action::Apply), "");
    }

    #[test]
    fn replies() {
        assert_eq!(
            append_human_reply("<!-- @agent q -->", "yes"),
            "<!-- @agent q @me yes -->"
        );
        assert_eq!(
            append_human_reply("<!--\n@agent q\n-->", "yes"),
            "<!--\n@agent q\n@me yes\n-->"
        );
        assert_eq!(
            replacement("<!-- @agent q @me ok -->", &Action::ToggleOk),
            "<!-- @agent q -->"
        );
        assert_eq!(
            append_agent_reply("{?? @me q ??}", "a", "2026-01-01T00:00:00+00:00"),
            "{?? @me q @agent%2026-01-01T00:00:00+00:00 a ??}"
        );
    }

    const EOLS: [&str; 3] = ["\n", "\r\n", "\r"];

    #[test]
    fn replies_follow_the_eol_of_the_block() {
        for e in EOLS {
            assert_eq!(
                append_human_reply(&format!("<!--{e}@agent q{e}-->"), "yes"),
                format!("<!--{e}@agent q{e}@me yes{e}-->"),
                "eol {e:?}"
            );
            assert_eq!(
                append_agent_reply(&format!("{{??{e}@me q{e}??}}"), "a", "T"),
                format!("{{??{e}@me q{e}@agent%T a{e}??}}"),
                "eol {e:?}"
            );
            assert_eq!(
                replacement(
                    &format!("<!--{e}@agent q{e}@me ok{e}-->"),
                    &Action::ToggleOk
                ),
                format!("<!--{e}@agent q{e}-->"),
                "eol {e:?}"
            );
        }
    }

    #[test]
    fn a_mixed_block_uses_its_dominant_eol_first_found_on_ties() {
        // 2 CRLF vs 1 LF: CRLF. 1 vs 1: the first one found.
        assert_eq!(
            append_human_reply("<!--\r\n@agent q\r\n@agent r\n-->", "y"),
            "<!--\r\n@agent q\r\n@agent r\n@me y\r\n-->"
        );
        assert_eq!(
            append_human_reply("<!--\r@agent q\n-->", "y"),
            "<!--\r@agent q\n@me y\r-->"
        );
    }

    #[test]
    fn deletion_is_tidy_for_every_eol() {
        for e in EOLS {
            let text = format!("a{e}<!-- x -->{e}b{e}");
            assert_eq!(
                delete_with_whitespace(&text, 1 + e.len(), 11 + e.len()),
                format!("a{e}b{e}"),
                "eol {e:?}"
            );
            let text = format!("<!-- x -->{e}b{e}");
            assert_eq!(
                delete_with_whitespace(&text, 0, 10),
                format!("b{e}"),
                "eol {e:?}"
            );
            let text = format!("- item <!-- x -->{e}next{e}");
            assert_eq!(
                delete_with_whitespace(&text, 7, 17),
                format!("- item{e}next{e}"),
                "eol {e:?}"
            );
        }
    }

    #[test]
    fn deletion_keeps_lines_tidy() {
        assert_eq!(
            delete_with_whitespace("a\n<!-- x -->\nb\n", 2, 12),
            "a\nb\n"
        );
        assert_eq!(
            delete_with_whitespace("- item <!-- x -->\nnext\n", 7, 17),
            "- item\nnext\n"
        );
    }
}
