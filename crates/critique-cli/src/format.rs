//! Text rendering: colors, item blocks, statistics.

use crate::args::{ColorMode, Context};
use crate::host::Host;
use critique_core::review::{self, ReviewItem};
use critique_core::scan::{self, Annotation, Kind, Marker, Status};
use critique_core::timestamp::{ReviewTimestamp, format_for_display, parse_review_timestamp};
use std::collections::BTreeMap;

/// Named ANSI styles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Paint {
    Bold,
    Blue,
    Cyan,
    Dim,
    Green,
    Magenta,
    Red,
    Reset,
    Yellow,
}

impl Paint {
    fn code(self) -> &'static str {
        match self {
            Self::Bold => "\x1b[1m",
            Self::Blue => "\x1b[34m",
            Self::Cyan => "\x1b[36m",
            Self::Dim => "\x1b[2m",
            Self::Green => "\x1b[32m",
            Self::Magenta => "\x1b[35m",
            Self::Red => "\x1b[31m",
            Self::Reset => "",
            Self::Yellow => "\x1b[33m",
        }
    }
}

/// Whether to emit colors.
#[derive(Debug, Clone, Copy)]
pub struct Style {
    /// Colors enabled.
    pub color: bool,
    /// Stdout is a terminal (wider rules).
    pub terminal: bool,
}

impl Style {
    /// Resolves `--color`, `NO_COLOR`, `FORCE_COLOR` and the terminal.
    pub fn resolve(host: &dyn Host, mode: Option<ColorMode>) -> Self {
        let terminal = host.stdout_is_terminal();
        let color = match mode {
            Some(ColorMode::Always) => true,
            Some(ColorMode::Auto) => terminal,
            Some(ColorMode::Never) => false,
            None => {
                if host.env("NO_COLOR").is_some_and(|v| !v.is_empty()) {
                    false
                } else if host
                    .env("FORCE_COLOR")
                    .is_some_and(|v| !v.is_empty() && v != "0")
                {
                    true
                } else {
                    terminal
                }
            }
        };
        Self { color, terminal }
    }

    /// Wraps `text`.
    pub fn paint(&self, text: &str, paint: Paint) -> String {
        if !self.color || paint == Paint::Reset {
            return text.to_string();
        }
        format!("{}{text}\x1b[0m", paint.code())
    }
}

fn status_paint(status: Status) -> Paint {
    match status {
        Status::Open => Paint::Blue,
        Status::Wip => Paint::Yellow,
        Status::Handled | Status::Resolved => Paint::Dim,
    }
}

fn kind_paint(kind: Kind) -> Paint {
    match kind {
        Kind::Addition => Paint::Green,
        Kind::Deletion => Paint::Red,
        Kind::Substitution => Paint::Yellow,
        Kind::Highlight | Kind::Comment | Kind::Discussion => Paint::Cyan,
        Kind::Conversation => Paint::Reset,
    }
}

/// `-----` rule, header line of an item.
pub fn item_header(
    style: &Style,
    file: &str,
    index: usize,
    total: Option<usize>,
    ann: &Annotation,
    id: Option<&str>,
) -> String {
    let progress = total.map_or_else(|| format!("#{index}"), |t| format!("{index}/{t}"));
    let width = if style.terminal { 72 } else { 48 };
    let rule = "─".repeat(width);
    let location = format!("{file}:{}-{}", ann.line_start, ann.line_end);
    let (kind, kind_paint) = if ann.kind == Kind::Conversation {
        let status = scan::conversation_status(&ann.raw);
        (
            format!("{} conversation", critique_core::agent::status_name(status)),
            status_paint(status),
        )
    } else {
        (ann.kind.as_str().to_string(), Paint::Magenta)
    };
    let id_part = id.map_or(String::new(), |i| {
        format!(" {}", style.paint(i, Paint::Cyan))
    });
    format!(
        "\n{}\n{} {}{id_part} {}\n",
        style.paint(&rule, Paint::Dim),
        style.paint(&progress, Paint::Bold),
        style.paint(&kind, kind_paint),
        style.paint(&location, Paint::Dim)
    )
}

/// Numbered source lines around an item.
pub fn source_context(style: &Style, text: &str, ann: &Annotation, context: Context) -> String {
    let lines = critique_core::scan::lines(text);
    let start = ann.line_start.saturating_sub(context.before).max(1);
    let end = lines.len().min(ann.line_end + context.after);
    let width = end.to_string().len();
    let mut rows = Vec::new();
    for n in start..=end {
        let target = ann.line_start <= n && n <= ann.line_end;
        let line = format!(
            "{}{n:>width$} │ {}",
            if target { ">" } else { " " },
            lines[n - 1]
        );
        rows.push(style.paint(&line, if target { Paint::Bold } else { Paint::Dim }));
    }
    rows.join("\n")
}

fn message_line(style: &Style, m: &review::Message) -> String {
    let marker_paint = if m.marker == Marker::Agent {
        Paint::Blue
    } else {
        Paint::Green
    };
    let timestamp = m
        .timestamp
        .as_deref()
        .and_then(parse_review_timestamp)
        .map(format_for_display);
    let mut parts = vec![style.paint(m.marker.as_str(), marker_paint)];
    if let Some(t) = timestamp {
        parts.push(style.paint(&t, Paint::Dim));
    }
    parts.push(m.body.clone());
    parts.retain(|p| !p.is_empty());
    parts.join(" ")
}

fn conversation_body(style: &Style, raw: &str) -> String {
    let (open, close) = if raw.starts_with("<!--") {
        ("<!--", "-->")
    } else {
        ("{??", "??}")
    };
    let mut lines = vec![style.paint(open, Paint::Dim)];
    lines.extend(review::messages(raw).iter().map(|m| message_line(style, m)));
    lines.push(style.paint(close, Paint::Dim));
    lines.join("\n")
}

/// `open`, optional `%ts|`, content, `close`.
fn split_simple<'a>(
    text: &'a str,
    open: &str,
    close: &str,
    with_ts: bool,
) -> Option<(&'a str, &'a str, &'a str)> {
    let rest = text.strip_prefix(open)?;
    let ts_len = if with_ts {
        scan::metadata_prefix_end(rest, 0).unwrap_or(0)
    } else {
        0
    };
    let tail = &rest[ts_len..];
    let try_split = |ts_len: usize| -> Option<(&'a str, &'a str, &'a str)> {
        let body = &rest[ts_len..];
        let content = body.strip_suffix(close)?;
        Some((&rest[..ts_len], content, &body[content.len()..]))
    };
    let _ = tail;
    try_split(ts_len).or_else(|| if ts_len > 0 { try_split(0) } else { None })
}

fn simple_annotation(
    style: &Style,
    text: &str,
    open: &str,
    close: &str,
    with_ts: bool,
    content: Paint,
) -> String {
    let Some((ts, body, close_text)) = split_simple(text, open, close, with_ts) else {
        return text.to_string();
    };
    [
        style.paint(open, Paint::Dim),
        if ts.is_empty() {
            String::new()
        } else {
            style.paint(ts, Paint::Dim)
        },
        style.paint(body, content),
        style.paint(close_text, Paint::Dim),
    ]
    .concat()
}

fn annotation_body(style: &Style, ann: &Annotation) -> String {
    let text = review::render_for_display(ann);
    match ann.kind {
        Kind::Addition => simple_annotation(style, &text, "{++", "++}", true, Paint::Green),
        Kind::Deletion => simple_annotation(style, &text, "{--", "--}", true, Paint::Red),
        Kind::Highlight => simple_annotation(style, &text, "{==", "==}", true, Paint::Cyan),
        Kind::Comment => simple_annotation(style, &text, "{>>", "<<}", true, Paint::Cyan),
        Kind::Discussion => simple_annotation(style, &text, "{??", "??}", false, Paint::Cyan),
        Kind::Substitution => {
            let paint_all = || style.paint(&text, kind_paint(Kind::Substitution));
            let Some(rest) = text.strip_prefix("{~~") else {
                return paint_all();
            };
            let ts_len = scan::metadata_prefix_end(rest, 0).unwrap_or(0);
            let try_at = |ts_len: usize| {
                let body = &rest[ts_len..];
                let (old, tail) = body.split_once("~>")?;
                let new = tail.strip_suffix("~~}")?;
                Some((ts_len, old.to_string(), new.to_string()))
            };
            let Some((ts_len, old, new)) =
                try_at(ts_len).or_else(|| if ts_len > 0 { try_at(0) } else { None })
            else {
                return paint_all();
            };
            [
                style.paint("{~~", Paint::Dim),
                if ts_len > 0 {
                    style.paint(&rest[..ts_len], Paint::Dim)
                } else {
                    String::new()
                },
                style.paint(&old, Paint::Red),
                style.paint("~>", Paint::Dim),
                style.paint(&new, Paint::Green),
                style.paint("~~}", Paint::Dim),
            ]
            .concat()
        }
        Kind::Conversation => conversation_body(style, &ann.raw),
    }
}

/// Body of an item (annotation text or conversation messages).
pub fn item_body(style: &Style, ann: &Annotation) -> String {
    if ann.kind == Kind::Conversation {
        conversation_body(style, &ann.raw)
    } else {
        annotation_body(style, ann)
    }
}

/// What `full_item` shows: an item and its place in the listing.
pub struct Shown<'a> {
    /// File as given.
    pub file: &'a str,
    /// 1-based position.
    pub index: usize,
    /// Number of items listed.
    pub total: usize,
    /// The item.
    pub item: &'a ReviewItem,
    /// File content.
    pub text: &'a str,
    /// Display id.
    pub id: &'a str,
}

/// Complete block of `list`.
pub fn full_item(style: &Style, shown: &Shown<'_>, context: Context) -> String {
    let ann = &shown.item.ann;
    format!(
        "{}{}\n{}\n",
        item_header(
            style,
            shown.file,
            shown.index,
            Some(shown.total),
            ann,
            Some(shown.id)
        ),
        source_context(style, shown.text, ann, context),
        item_body(style, ann)
    )
}

/// Last review timestamp of a set of items and its author.
#[derive(Debug, Clone, Copy)]
pub struct LastReview {
    /// `@agent`, `@me`, `@` or `other`.
    pub source: &'static str,
    /// Value.
    pub timestamp: ReviewTimestamp,
}

/// Counters behind `status`.
#[derive(Debug, Default, Clone)]
pub struct Stats {
    /// open, wip, handled, resolved.
    pub conversations: [usize; 4],
    /// Annotations by kind.
    pub counts: BTreeMap<&'static str, usize>,
    /// Latest timestamp.
    pub last: Option<LastReview>,
}

impl Stats {
    fn total_conversations(&self) -> usize {
        self.conversations.iter().sum()
    }

    /// No conversation and no annotation.
    pub fn is_empty(&self) -> bool {
        self.total_conversations() == 0 && self.counts.values().all(|&c| c == 0)
    }

    /// Records one item.
    pub fn add(&mut self, item: &ReviewItem) {
        let ann = &item.ann;
        match ann.kind {
            Kind::Conversation => {
                let slot = match scan::conversation_status(&ann.raw) {
                    Status::Open => 0,
                    Status::Wip => 1,
                    Status::Handled => 2,
                    Status::Resolved => 3,
                };
                self.conversations[slot] += 1;
            }
            Kind::Discussion => self.conversations[2] += 1,
            kind => *self.counts.entry(kind.as_str()).or_default() += 1,
        }
        if ann.kind == Kind::Conversation {
            for m in review::messages(&ann.raw) {
                self.candidate(m.marker.as_str(), m.timestamp.as_deref());
            }
        } else {
            self.candidate("other", ann.timestamp.as_deref());
        }
    }

    fn candidate(&mut self, source: &'static str, value: Option<&str>) {
        let Some(timestamp) = value.and_then(parse_review_timestamp) else {
            return;
        };
        if self
            .last
            .is_none_or(|l| timestamp.unix_seconds > l.timestamp.unix_seconds)
        {
            let source = match source {
                "@agent" => "@agent",
                "@me" => "@me",
                "@" => "@",
                _ => "other",
            };
            self.last = Some(LastReview { source, timestamp });
        }
    }
}

fn plural(count: usize, word: &str) -> String {
    if count == 1 {
        word.to_string()
    } else if word == "highlight" {
        "highlights".to_string()
    } else {
        format!("{word}s")
    }
}

const COUNTED: [(&str, Kind); 5] = [
    ("addition", Kind::Addition),
    ("deletion", Kind::Deletion),
    ("substitution", Kind::Substitution),
    ("highlight", Kind::Highlight),
    ("comment", Kind::Comment),
];

/// `status` counts.
pub fn format_stats(
    style: &Style,
    stats: &Stats,
    conversation_only: bool,
    filter: review::Filter,
) -> String {
    use review::Filter;
    let [open, wip, handled, resolved] = stats.conversations;
    let total = stats.total_conversations();
    let mut parts: Vec<String> = Vec::new();
    match filter {
        Filter::Open | Filter::Wip | Filter::Handled | Filter::Resolved => {
            let (name, count, paint) = match filter {
                Filter::Open => ("open", open, Paint::Blue),
                Filter::Wip => ("wip", wip, Paint::Yellow),
                Filter::Handled => ("handled", handled, Paint::Dim),
                _ => ("resolved", resolved, Paint::Dim),
            };
            if conversation_only || count > 0 {
                parts.push(style.paint(
                    &format!("{count} {}", plural(count, &format!("{name} conversation"))),
                    paint,
                ));
            }
        }
        Filter::Pending => {
            let pending = open + wip;
            if conversation_only || pending > 0 {
                parts.push(style.paint(
                    &format!(
                        "{pending} {} ({open} open, {wip} wip)",
                        plural(pending, "pending conversation")
                    ),
                    if pending > 0 {
                        Paint::Yellow
                    } else {
                        Paint::Dim
                    },
                ));
            }
        }
        Filter::All => {
            if total > 0 || conversation_only {
                let pending = open + wip;
                parts.push(style.paint(
                    &format!(
                        "{total} {} ({open} open, {wip} wip, {handled} handled, {resolved} resolved)",
                        plural(total, "conversation")
                    ),
                    if pending > 0 { Paint::Yellow } else { Paint::Dim },
                ));
            }
        }
    }
    for (name, kind) in COUNTED {
        let count = stats.counts.get(name).copied().unwrap_or(0);
        if count > 0 {
            parts.push(style.paint(
                &format!("{count} {}", plural(count, name)),
                kind_paint(kind),
            ));
        }
    }
    if parts.is_empty() {
        "0 review annotations".to_string()
    } else {
        parts.join(", ")
    }
}

fn source_label(source: &str) -> &str {
    if source == "@" { "@me" } else { source }
}

fn source_paint(source: &str) -> Paint {
    match source {
        "@agent" => Paint::Blue,
        "@me" | "@" => Paint::Green,
        _ => Paint::Magenta,
    }
}

/// Long `status` line for one file.
pub fn format_status_stats(
    style: &Style,
    stats: &Stats,
    conversation_only: bool,
    filter: review::Filter,
) -> String {
    let rendered = format_stats(style, stats, conversation_only, filter);
    let Some(last) = stats.last else {
        return rendered;
    };
    format!(
        "{rendered}; {} {} {}",
        style.paint("last", Paint::Dim),
        style.paint(source_label(last.source), source_paint(last.source)),
        style.paint(&format_for_display(last.timestamp), Paint::Dim)
    )
}

fn short_timestamp(host: &dyn Host, t: ReviewTimestamp) -> String {
    let local = host.local_time(t.unix_seconds);
    let now = host.local_time(host.now().unix_seconds);
    let time = format!("{:02}:{:02}:{:02}", local.hour, local.minute, local.second);
    if (local.year, local.month, local.day) == (now.year, now.month, now.day) {
        time
    } else {
        format!("{}-{:02}-{:02} {time}", local.year, local.month, local.day)
    }
}

/// Compact `status` stats.
pub fn format_short_status_stats(style: &Style, host: &dyn Host, stats: &Stats) -> String {
    let mut parts: Vec<String> = Vec::new();
    let total = stats.total_conversations();
    let pending = stats.conversations[0] + stats.conversations[1];
    if total > 0 {
        parts.push(style.paint(
            &format!("{pending}/{total}"),
            if pending > 0 {
                Paint::Yellow
            } else {
                Paint::Dim
            },
        ));
    }
    let symbols = [
        ("addition", "+", Kind::Addition),
        ("deletion", "-", Kind::Deletion),
        ("substitution", "~", Kind::Substitution),
        ("highlight", "=", Kind::Highlight),
        ("comment", "x", Kind::Comment),
    ];
    let annotations: String = symbols
        .iter()
        .filter_map(|(name, symbol, kind)| {
            let count = stats.counts.get(name).copied().unwrap_or(0);
            (count > 0).then(|| style.paint(&format!("{symbol}{count}"), kind_paint(*kind)))
        })
        .collect();
    if !annotations.is_empty() {
        parts.push(annotations);
    }
    let rendered = if parts.is_empty() {
        "0".to_string()
    } else {
        parts.join(" ")
    };
    let Some(last) = stats.last else {
        return rendered;
    };
    let source = match last.source {
        "@agent" => "a",
        "@me" | "@" => "@",
        _ => "o",
    };
    format!(
        "{rendered} {} {} {}",
        style.paint("-", Paint::Dim),
        style.paint(source, source_paint(last.source)),
        style.paint(&short_timestamp(host, last.timestamp), Paint::Dim)
    )
}
