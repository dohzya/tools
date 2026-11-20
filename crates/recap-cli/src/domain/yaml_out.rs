//! YAML emitter for `config show` / `config files -v`.
//!
//! The TS tool prints with `@std/yaml` (a port of js-yaml 3), and its quoting
//! decisions are visible in the output (`'true'`, `'Hello ${NAME}'`, a `>-`
//! folded block for long commands...). This is a port of the part of its
//! dumper that block-style maps, sequences and strings go through, so that
//! the output stays byte-identical. Scalar logic works on UTF-16 code units
//! like the original: an astral character is two units, neither of them
//! "printable", so such strings end up double-quoted with `\U` escapes.

/// A value to print.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// String.
    Str(String),
    /// Integer.
    Int(i64),
    /// Boolean.
    Bool(bool),
    /// Sequence.
    Seq(Vec<Node>),
    /// Mapping, in insertion order.
    Map(Vec<(String, Node)>),
}

const INDENT: usize = 2;
const LINE_WIDTH: usize = 80;

/// Serializes `node` as a document (ends with a newline).
pub fn stringify(node: &Node) -> String {
    format!("{}\n", node_text(node, 0, true, false))
}

fn node_text(node: &Node, level: usize, compact: bool, is_key: bool) -> String {
    match node {
        Node::Str(s) => scalar(s, level, is_key),
        Node::Int(i) => i.to_string(),
        Node::Bool(b) => b.to_string(),
        Node::Seq(items) if items.is_empty() => "[]".to_owned(),
        Node::Seq(items) => {
            let ws = next_line(level);
            let prefix = if compact { String::new() } else { ws.clone() };
            let rendered: Vec<String> = items
                .iter()
                .map(|item| {
                    let s = node_text(item, level + 1, true, false);
                    let dash = if s.starts_with('\n') { "-" } else { "- " };
                    format!("{dash}{s}")
                })
                .collect();
            prefix + &rendered.join(&ws)
        }
        Node::Map(pairs) if pairs.is_empty() => "{}".to_owned(),
        Node::Map(pairs) => {
            let sep = next_line(level);
            let prefix = if compact { String::new() } else { sep.clone() };
            let rendered: Vec<String> = pairs
                .iter()
                .map(|(k, v)| {
                    let key = scalar(k, level + 1, true);
                    let explicit = utf16(&key).len() > 1024;
                    let value = node_text(v, level + 1, explicit, false);
                    let mut pair = String::new();
                    if explicit {
                        pair.push_str(if key.starts_with('\n') { "?" } else { "? " });
                    }
                    pair.push_str(&key);
                    if explicit {
                        pair.push_str(&sep);
                    }
                    pair.push_str(if value.starts_with('\n') { ":" } else { ": " });
                    pair.push_str(&value);
                    pair
                })
                .collect();
            prefix + &rendered.join(&sep)
        }
    }
}

fn next_line(level: usize) -> String {
    format!("\n{}", " ".repeat(INDENT * level))
}

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

#[derive(PartialEq, Eq)]
enum Style {
    Plain,
    Single,
    Literal,
    Folded,
    Double,
}

fn is_printable(c: u32) -> bool {
    (0x20..=0x7e).contains(&c)
        || ((0xa1..=0xd7ff).contains(&c) && c != 0x2028 && c != 0x2029)
        || ((0xe000..=0xfffd).contains(&c) && c != 0xfeff)
        || (0x10000..=0x10ffff).contains(&c)
}

fn is_plain_safe(c: u32) -> bool {
    is_printable(c)
        && !matches!(
            char::from_u32(c),
            Some(',' | '[' | ']' | '{' | '}' | ':' | '#')
        )
}

fn is_white(c: u32) -> bool {
    c == 0x20 || c == 0x09
}

fn is_plain_safe_first(c: u32) -> bool {
    is_plain_safe(c)
        && !is_white(c)
        && !matches!(
            char::from_u32(c),
            Some('-' | '?' | '&' | '*' | '!' | '|' | '>' | '\'' | '"' | '%' | '@' | '`')
        )
}

/// Strings the default schema would read back as something else, which then
/// need quotes. `int` is ported as written, including its refusal of plain
/// decimals (the `float` rule catches those anyway).
fn resolves_to_other_type(s: &str) -> bool {
    matches!(s, "~" | "null" | "Null" | "NULL" | "<<")
        || matches!(s, "true" | "True" | "TRUE" | "false" | "False" | "FALSE")
        || resolves_int(s)
        || resolves_float(s)
        || resolves_timestamp(s)
}

fn resolves_int(s: &str) -> bool {
    let b = s.as_bytes();
    let max = b.len();
    if max == 0 {
        return false;
    }
    let mut i = 0;
    if b[0] == b'-' || b[0] == b'+' {
        i = 1;
    }
    let ch = b.get(i).copied();
    if ch == Some(b'0') {
        if i + 1 == max {
            return true;
        }
        i += 1;
        let kind = b[i];
        let valid: fn(u8) -> bool = match kind {
            b'b' => |c| c == b'0' || c == b'1',
            b'x' => |c| c.is_ascii_hexdigit(),
            _ => |c| (b'0'..=b'7').contains(&c),
        };
        if kind == b'b' || kind == b'x' {
            i += 1;
        }
        let mut has_digits = false;
        for &c in &b[i..] {
            if c == b'_' {
                continue;
            }
            if !valid(c) {
                return false;
            }
            has_digits = true;
        }
        return has_digits && b[max - 1] != b'_';
    }
    if ch == Some(b'_') {
        return false;
    }
    // Decimal and base 60: the original then requires a `:dd` group after
    // the loop has consumed everything, so nothing ever matches.
    false
}

fn resolves_float(s: &str) -> bool {
    if s.ends_with('_') {
        return false;
    }
    let b = s.as_bytes();
    // .inf / .nan forms
    let unsigned = s.strip_prefix(['-', '+']).unwrap_or(s);
    if matches!(unsigned, ".inf" | ".Inf" | ".INF") {
        return true;
    }
    if matches!(s, ".nan" | ".NaN" | ".NAN") {
        return true;
    }
    let digits_us = |c: u8| c.is_ascii_digit() || c == b'_';
    let exponent = |mut i: usize| -> Option<usize> {
        if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
            i += 1;
            if i < b.len() && (b[i] == b'-' || b[i] == b'+') {
                i += 1;
            }
            let start = i;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            if i == start {
                return None;
            }
        }
        Some(i)
    };
    // `.2e4`, `.2`
    if b.first() == Some(&b'.') {
        let mut i = 1;
        while i < b.len() && digits_us(b[i]) {
            i += 1;
        }
        return i > 1 && exponent(i) == Some(b.len());
    }
    // `[-+]?(0|[1-9][0-9_]*)(\.[0-9_]*)?([eE][-+]?[0-9]+)?`
    let mut i = 0;
    if i < b.len() && (b[i] == b'-' || b[i] == b'+') {
        i += 1;
    }
    match b.get(i) {
        Some(b'0') => i += 1,
        Some(c) if (b'1'..=b'9').contains(c) => {
            i += 1;
            while i < b.len() && digits_us(b[i]) {
                i += 1;
            }
        }
        _ => return false,
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        while i < b.len() && digits_us(b[i]) {
            i += 1;
        }
    }
    exponent(i) == Some(b.len())
}

fn resolves_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    let digits = |from: usize, n: usize| {
        b.len() >= from + n && b[from..from + n].iter().all(u8::is_ascii_digit)
    };
    // YYYY-MM-DD
    if b.len() == 10 && digits(0, 4) && b[4] == b'-' && digits(5, 2) && b[7] == b'-' && digits(8, 2)
    {
        return true;
    }
    // YYYY-M(M)-D(D)(T| +)H(H):MM:SS(.f*)?( *(Z|[-+]H(H)(:MM)?))?
    if !(digits(0, 4) && b.get(4) == Some(&b'-')) {
        return false;
    }
    let mut i = 5;
    let take = |i: &mut usize, min: usize, max: usize| -> bool {
        let start = *i;
        while *i < b.len() && *i - start < max && b[*i].is_ascii_digit() {
            *i += 1;
        }
        *i - start >= min
    };
    if !take(&mut i, 1, 2) || b.get(i) != Some(&b'-') {
        return false;
    }
    i += 1;
    if !take(&mut i, 1, 2) {
        return false;
    }
    match b.get(i) {
        Some(b'T' | b't') => i += 1,
        Some(b' ' | b'\t') => {
            while matches!(b.get(i), Some(b' ' | b'\t')) {
                i += 1;
            }
        }
        _ => return false,
    }
    if !take(&mut i, 1, 2) || b.get(i) != Some(&b':') {
        return false;
    }
    i += 1;
    if !(digits(i, 2) && b.get(i + 2) == Some(&b':') && digits(i + 3, 2)) {
        return false;
    }
    i += 5;
    if b.get(i) == Some(&b'.') {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i == b.len() {
        return true;
    }
    while matches!(b.get(i), Some(b' ' | b'\t')) {
        i += 1;
    }
    match b.get(i) {
        Some(b'Z') => i + 1 == b.len(),
        Some(b'-' | b'+') => {
            i += 1;
            if !take(&mut i, 1, 2) {
                return false;
            }
            if b.get(i) == Some(&b':') {
                i += 1;
                if !digits(i, 2) {
                    return false;
                }
                i += 2;
            }
            i == b.len()
        }
        _ => false,
    }
}

fn choose_style(units: &[u16], single_line_only: bool, line_width: usize) -> Style {
    let mut has_line_break = false;
    let mut has_foldable = false;
    let mut previous_break: isize = -1;
    let first = u32::from(units[0]);
    let last = u32::from(units[units.len() - 1]);
    let mut plain = is_plain_safe_first(first) && !is_white(last);

    let too_long = |end: usize, prev: isize| {
        let line_len = end as isize - prev - 1;
        let start = (prev + 1) as usize;
        line_len > line_width as isize && units.get(start) != Some(&0x20)
    };
    for (i, &u) in units.iter().enumerate() {
        let c = u32::from(u);
        if single_line_only {
            if !is_printable(c) {
                return Style::Double;
            }
        } else if c == 0x0a {
            has_line_break = true;
            has_foldable = has_foldable || too_long(i, previous_break);
            previous_break = i as isize;
        } else if !is_printable(c) {
            return Style::Double;
        }
        plain = plain && is_plain_safe(c);
    }
    if !single_line_only {
        has_foldable = has_foldable || too_long(units.len(), previous_break);
    }
    if !has_line_break && !has_foldable {
        return if plain && !resolves_to_other_type(&from_utf16(units)) {
            Style::Plain
        } else {
            Style::Single
        };
    }
    if has_foldable {
        Style::Folded
    } else {
        Style::Literal
    }
}

fn scalar(s: &str, level: usize, is_key: bool) -> String {
    if s.is_empty() {
        return "''".to_owned();
    }
    // YAML 1.1 booleans are quoted for older readers.
    if matches!(
        s,
        "y" | "Y"
            | "yes"
            | "Yes"
            | "YES"
            | "on"
            | "On"
            | "ON"
            | "n"
            | "N"
            | "no"
            | "No"
            | "NO"
            | "off"
            | "Off"
            | "OFF"
    ) {
        return format!("'{s}'");
    }
    let units = utf16(s);
    let indent = INDENT * level.max(1);
    // Deeper values get narrower, down to 40 columns.
    let width = LINE_WIDTH.saturating_sub(indent).max(LINE_WIDTH.min(40));
    match choose_style(&units, is_key, width) {
        Style::Plain => s.to_owned(),
        Style::Single => format!("'{}'", s.replace('\'', "''")),
        Style::Literal => format!(
            "|{}{}",
            block_header(&units),
            trim_trailing_newline(&indent_string(s, indent))
        ),
        Style::Folded => format!(
            ">{}{}",
            block_header(&units),
            trim_trailing_newline(&indent_string(&fold_string(&units, width), indent))
        ),
        Style::Double => format!("\"{}\"", escape_string(&units)),
    }
}

fn trim_trailing_newline(s: &str) -> String {
    s.strip_suffix('\n').unwrap_or(s).to_owned()
}

/// Indents every non-empty line.
fn indent_string(s: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    s.split('\n')
        .map(|l| {
            if l.is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn block_header(units: &[u16]) -> String {
    // `^\n* ` : the first non-newline character is a space.
    let lead = units.iter().take_while(|&&u| u == 0x0a).count();
    let indicator = if units.get(lead) == Some(&0x20) {
        INDENT.to_string()
    } else {
        String::new()
    };
    let n = units.len();
    let clip = units[n - 1] == 0x0a;
    let keep = clip && (n >= 2 && units[n - 2] == 0x0a || n == 1);
    let chomp = if keep {
        "+"
    } else if clip {
        ""
    } else {
        "-"
    };
    format!("{indicator}{chomp}\n")
}

fn escape_string(units: &[u16]) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < units.len() {
        let c = u32::from(units[i]);
        if (0xd800..=0xdbff).contains(&c)
            && let Some(&next) = units.get(i + 1)
            && (0xdc00..=0xdfff).contains(&u32::from(next))
        {
            let cp = (c - 0xd800) * 0x400 + u32::from(next) - 0xdc00 + 0x10000;
            out.push_str(&hex_escape(cp));
            i += 2;
            continue;
        }
        let seq = match c {
            0x00 => Some("\\0"),
            0x07 => Some("\\a"),
            0x08 => Some("\\b"),
            0x09 => Some("\\t"),
            0x0a => Some("\\n"),
            0x0b => Some("\\v"),
            0x0c => Some("\\f"),
            0x0d => Some("\\r"),
            0x1b => Some("\\e"),
            0x22 => Some("\\\""),
            0x5c => Some("\\\\"),
            0x85 => Some("\\N"),
            0xa0 => Some("\\_"),
            0x2028 => Some("\\L"),
            0x2029 => Some("\\P"),
            _ => None,
        };
        match seq {
            Some(s) => out.push_str(s),
            None if is_printable(c) => out.push_str(&from_utf16(&units[i..=i])),
            None => out.push_str(&hex_escape(c)),
        }
        i += 1;
    }
    out
}

fn hex_escape(c: u32) -> String {
    if c <= 0xff {
        format!("\\x{c:02X}")
    } else if c <= 0xffff {
        format!("\\u{c:04X}")
    } else {
        format!("\\U{c:08X}")
    }
}

/// Greedy line breaking at single spaces; more-indented lines cannot be
/// folded because that would add a newline.
fn fold_line(line: &[u16], width: usize) -> Vec<u16> {
    if line.is_empty() || line[0] == 0x20 {
        return line.to_vec();
    }
    let (mut start, mut curr) = (0usize, 0usize);
    let mut lines: Vec<&[u16]> = Vec::new();
    let mut i = 0;
    while i + 1 < line.len() {
        // Matches ` [^ ]`.
        if line[i] == 0x20 && line[i + 1] != 0x20 {
            let next = i;
            if next - start > width {
                let end = if curr > start { curr } else { next };
                lines.push(&line[start..end]);
                start = end + 1;
            }
            curr = next;
            i += 2;
        } else {
            i += 1;
        }
    }
    if line.len() - start > width && curr > start {
        lines.push(&line[start..curr]);
        lines.push(&line[curr + 1..]);
    } else {
        lines.push(&line[start..]);
    }
    lines.join(&0x0au16)
}

fn fold_string(units: &[u16], width: usize) -> String {
    // Chunks are newline runs followed by a content line.
    let first_end = units.iter().position(|&u| u == 0x0a).unwrap_or(units.len());
    let mut result = fold_line(&units[..first_end], width);
    let mut prev_more_indented = units[0] == 0x0a || units[0] == 0x20;
    let mut i = first_end;
    while i < units.len() {
        let nl_start = i;
        while i < units.len() && units[i] == 0x0a {
            i += 1;
        }
        let prefix = &units[nl_start..i];
        let line_start = i;
        while i < units.len() && units[i] != 0x0a {
            i += 1;
        }
        let line = &units[line_start..i];
        let more_indented = line.first() == Some(&0x20);
        result.extend_from_slice(prefix);
        if !prev_more_indented && !more_indented && !line.is_empty() {
            result.push(0x0a);
        }
        result.extend(fold_line(line, width));
        prev_more_indented = more_indented;
    }
    from_utf16(&result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &str) -> Node {
        Node::Str(v.into())
    }

    fn map(pairs: Vec<(&str, Node)>) -> Node {
        Node::Map(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }

    #[test]
    fn nested_layout_matches_std_yaml() {
        let doc = map(vec![
            (
                "sections",
                Node::Seq(vec![
                    map(vec![("id", s("a")), ("max_lines", Node::Int(2))]),
                    map(vec![
                        ("id", s("b")),
                        ("env", map(vec![("FOO", s("foo"))])),
                        ("deprecated", Node::Bool(true)),
                    ]),
                ]),
            ),
            ("empty", Node::Seq(vec![])),
            ("none", map(vec![])),
        ]);
        assert_eq!(
            stringify(&doc),
            "sections:\n  - id: a\n    max_lines: 2\n  - id: b\n    env:\n      FOO: foo\n    deprecated: true\nempty: []\nnone: {}\n"
        );
    }

    fn one(v: &str) -> String {
        stringify(&map(vec![("k", s(v))]))
    }

    #[test]
    fn quoting_follows_js_yaml_3() {
        assert_eq!(one("plain text"), "k: plain text\n");
        assert_eq!(one("true"), "k: 'true'\n");
        assert_eq!(one("yes"), "k: 'yes'\n");
        assert_eq!(one("12"), "k: '12'\n");
        assert_eq!(one("1.5e3"), "k: '1.5e3'\n");
        assert_eq!(one("0x1F"), "k: '0x1F'\n");
        assert_eq!(one("2020-01-01"), "k: '2020-01-01'\n");
        assert_eq!(one("~"), "k: '~'\n");
        assert_eq!(one(""), "k: ''\n");
        assert_eq!(one("Hello ${NAME}"), "k: 'Hello ${NAME}'\n");
        assert_eq!(one("a # b"), "k: 'a # b'\n");
        assert_eq!(one("s#x"), "k: 's#x'\n");
        assert_eq!(one("it's"), "k: it's\n");
        assert_eq!(one("'q' #"), "k: '''q'' #'\n");
        assert_eq!(one("- x"), "k: '- x'\n");
        assert_eq!(one("a: b"), "k: 'a: b'\n");
        assert_eq!(one(" lead"), "k: ' lead'\n");
        assert_eq!(one("trail "), "k: 'trail '\n");
        assert_eq!(one("tab\there"), "k: \"tab\\there\"\n");
        assert_eq!(one("é"), "k: é\n");
    }

    #[test]
    fn multiline_uses_block_scalars() {
        assert_eq!(one("a\nb"), "k: |-\n  a\n  b\n");
        assert_eq!(one("a\nb\n"), "k: |\n  a\n  b\n");
        assert_eq!(one("a\n\n"), "k: |+\n  a\n\n");
    }

    #[test]
    fn long_single_lines_are_folded() {
        let words = "word ".repeat(30);
        let text = words.trim_end();
        let out = one(text);
        assert!(out.starts_with("k: >-\n  word word"), "{out}");
        assert!(out.lines().skip(1).all(|l| l.len() <= 2 + 78 + 5));
        let unfolded: String = out
            .lines()
            .skip(1)
            .map(str::trim)
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(unfolded, text);
    }
}
