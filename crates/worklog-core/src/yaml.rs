//! YAML values of a task frontmatter, and an emitter that reproduces the
//! output of `@std/yaml` 1.1.0 `stringify(value, { lineWidth: -1 })` byte for
//! byte (a port of js-yaml 3.13's dumper). Existing `.worklog` directories were
//! written by that emitter, so every deviation shows up as a diff in users'
//! repositories.

/// A YAML value of the core schema. Mappings keep their insertion order.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// `null`
    Null,
    /// `true` / `false`
    Bool(bool),
    /// An integer.
    Int(i64),
    /// A float.
    Float(f64),
    /// A string.
    Str(String),
    /// A sequence.
    Seq(Vec<Value>),
    /// A mapping.
    Map(Vec<(String, Value)>),
}

impl Value {
    /// Shorthand for a string value.
    pub fn str(s: impl Into<String>) -> Value {
        Value::Str(s.into())
    }

    /// The string, if this is one.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    /// The mapping entries, if this is a mapping.
    pub fn as_map(&self) -> Option<&[(String, Value)]> {
        match self {
            Value::Map(m) => Some(m),
            _ => None,
        }
    }

    /// Entry of a mapping.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.as_map()?
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }
}

/// Parses a YAML document into ordered values. Anything that is not a mapping
/// gives an empty mapping and so does invalid YAML: the TS parser returned `{}`
/// for corrupted frontmatter.
pub fn parse_mapping(yaml: &str) -> Vec<(String, Value)> {
    if yaml.trim().is_empty() {
        return Vec::new();
    }
    match serde_yaml_ng::from_str::<serde_yaml_ng::Value>(yaml) {
        Ok(serde_yaml_ng::Value::Mapping(m)) => m
            .into_iter()
            .map(|(k, v)| (key_text(&k), convert(v)))
            .collect(),
        _ => Vec::new(),
    }
}

fn key_text(k: &serde_yaml_ng::Value) -> String {
    match convert(k.clone()) {
        Value::Str(s) => s,
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => f.to_string(),
        _ => String::new(),
    }
}

fn convert(v: serde_yaml_ng::Value) -> Value {
    use serde_yaml_ng::Value as Y;
    match v {
        Y::Null => Value::Null,
        Y::Bool(b) => Value::Bool(b),
        Y::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Int(i)
            } else if let Some(f) = n.as_f64() {
                Value::Float(f)
            } else {
                Value::Str(n.to_string())
            }
        }
        Y::String(s) => Value::Str(s),
        Y::Sequence(s) => Value::Seq(s.into_iter().map(convert).collect()),
        Y::Mapping(m) => Value::Map(
            m.into_iter()
                .map(|(k, v)| (key_text(&k), convert(v)))
                .collect(),
        ),
        Y::Tagged(t) => convert(t.value),
    }
}

/// `stringify(value, { lineWidth: -1 })`: block style, 2-space indent, with a
/// final newline.
pub fn dump(value: &Value) -> String {
    match stringify_node(value, 0, true, true, false) {
        Some(s) => format!("{s}\n"),
        None => String::new(),
    }
}

/// Dumps a mapping given as entries.
pub fn dump_map(entries: &[(String, Value)]) -> String {
    dump(&Value::Map(entries.to_vec()))
}

const INDENT: usize = 2;

// Style of a scalar, as chosen by `chooseScalarStyle` (the folded style needs
// a line width, which is disabled).
enum Style {
    Plain,
    Single,
    Literal,
    Double,
}

fn is_printable(c: u32) -> bool {
    (0x20..=0x7e).contains(&c)
        || ((0xa1..=0xd7ff).contains(&c) && c != 0x2028 && c != 0x2029)
        || ((0xe000..=0xfffd).contains(&c) && c != 0xfeff)
        || (0x10000..=0x10ffff).contains(&c)
}

fn is_white_space(c: u32) -> bool {
    c == 0x09 || c == 0x20
}

fn is_plain_safe(c: u32) -> bool {
    is_printable(c)
        && !matches!(
            char::from_u32(c),
            Some(',' | '[' | ']' | '{' | '}' | ':' | '#' | '\u{feff}')
        )
}

fn is_plain_safe_first(c: u32) -> bool {
    is_plain_safe(c)
        && !is_white_space(c)
        && !matches!(
            char::from_u32(c),
            Some('-' | '?' | '&' | '*' | '!' | '|' | '>' | '\'' | '"' | '%' | '@' | '`')
        )
}

/// Whether one of the implicit types (timestamp, merge, null, bool, int,
/// float) would read the plain string as something else.
fn resolves_implicitly(s: &str) -> bool {
    is_timestamp(s)
        || s == "<<"
        || matches!(s, "~" | "null" | "Null" | "NULL")
        || matches!(s, "true" | "True" | "TRUE" | "false" | "False" | "FALSE")
        || is_yaml_int(s)
        || is_yaml_float(s)
}

fn digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_timestamp(s: &str) -> bool {
    if !s.is_ascii() {
        return false;
    }
    let b = s.as_bytes();
    // YYYY-MM-DD
    if s.len() == 10
        && digits(&s[0..4], 4)
        && b[4] == b'-'
        && digits(&s[5..7], 2)
        && b[7] == b'-'
        && digits(&s[8..10], 2)
    {
        return true;
    }
    if s.len() < 4 || !digits(&s[0..4], 4) || b.get(4) != Some(&b'-') {
        return false;
    }
    let rest = &s[5..];
    let (month, rest) = take_digits(rest, 1, 2);
    if month.is_none() || !rest.starts_with('-') {
        return false;
    }
    let (day, rest) = take_digits(&rest[1..], 1, 2);
    if day.is_none() {
        return false;
    }
    // [Tt] or one or more blanks
    let rest = if let Some(r) = rest.strip_prefix(['T', 't']) {
        r
    } else {
        let t = rest.trim_start_matches([' ', '\t']);
        if t.len() == rest.len() {
            return false;
        }
        t
    };
    let (hour, rest) = take_digits(rest, 1, 2);
    if hour.is_none() || !rest.starts_with(':') {
        return false;
    }
    let (min, rest) = take_digits(&rest[1..], 2, 2);
    if min.is_none() || !rest.starts_with(':') {
        return false;
    }
    let (sec, mut rest) = take_digits(&rest[1..], 2, 2);
    if sec.is_none() {
        return false;
    }
    if let Some(r) = rest.strip_prefix('.') {
        rest = r.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let rest = rest.trim_start_matches([' ', '\t']);
    if rest.is_empty() || rest == "Z" {
        return true;
    }
    let Some(r) = rest.strip_prefix(['+', '-']) else {
        return false;
    };
    let (tzh, r) = take_digits(r, 1, 2);
    if tzh.is_none() {
        return false;
    }
    if r.is_empty() {
        return true;
    }
    match r.strip_prefix(':') {
        Some(m) => digits(m, 2),
        None => false,
    }
}

fn take_digits(s: &str, min: usize, max: usize) -> (Option<&str>, &str) {
    let n = s.bytes().take_while(u8::is_ascii_digit).count().min(max);
    if n < min {
        (None, s)
    } else {
        (Some(&s[..n]), &s[n..])
    }
}

fn is_yaml_int(data: &str) -> bool {
    let b = data.as_bytes();
    let max = b.len();
    if max == 0 {
        return false;
    }
    let mut i = 0;
    let mut ch = b[i];
    if ch == b'-' || ch == b'+' {
        i += 1;
        if i >= max {
            // js: `ch = undefined`, falls through to the decimal loop: no digit.
            return false;
        }
        ch = b[i];
    }
    if ch == b'0' {
        if i + 1 == max {
            return true;
        }
        i += 1;
        ch = b[i];
        let mut has_digits = false;
        if ch == b'b' {
            i += 1;
            while i < max {
                ch = b[i];
                i += 1;
                if ch == b'_' {
                    continue;
                }
                if ch != b'0' && ch != b'1' {
                    return false;
                }
                has_digits = true;
            }
            return has_digits && ch != b'_';
        }
        if ch == b'x' {
            i += 1;
            while i < max {
                ch = b[i];
                i += 1;
                if ch == b'_' {
                    continue;
                }
                if !ch.is_ascii_hexdigit() {
                    return false;
                }
                has_digits = true;
            }
            return has_digits && ch != b'_';
        }
        while i < max {
            ch = b[i];
            i += 1;
            if ch == b'_' {
                continue;
            }
            if !(b'0'..=b'7').contains(&ch) {
                return false;
            }
            has_digits = true;
        }
        return has_digits && ch != b'_';
    }
    if ch == b'_' {
        return false;
    }
    let mut has_digits = false;
    while i < max {
        ch = b[i];
        i += 1;
        if ch == b'_' {
            continue;
        }
        if !ch.is_ascii_digit() {
            // sexagesimal: `:[0-5]?[0-9]` groups after the digits
            return is_sexagesimal(&data[i - 1..]) && has_digits;
        }
        has_digits = true;
    }
    has_digits && ch != b'_'
}

// `^(:[0-5]?[0-9])+$`
fn is_sexagesimal(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.split(':').skip(1).all(|g| {
        let b = g.as_bytes();
        match b.len() {
            1 => b[0].is_ascii_digit(),
            2 => (b'0'..=b'5').contains(&b[0]) && b[1].is_ascii_digit(),
            _ => false,
        }
    }) && s.starts_with(':')
}

// ^(?:[-+]?(?:0|[1-9][0-9_]*)(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?
//    |\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$
fn is_yaml_float(s: &str) -> bool {
    if s.ends_with('_') {
        return false;
    }
    if matches!(s, ".nan" | ".NaN" | ".NAN") {
        return true;
    }
    let unsigned = s.strip_prefix(['-', '+']).unwrap_or(s);
    if matches!(unsigned, ".inf" | ".Inf" | ".INF") {
        return true;
    }
    let exp_ok = |e: &str| -> bool {
        let e = e.strip_prefix(['-', '+']).unwrap_or(e);
        !e.is_empty() && e.bytes().all(|b| b.is_ascii_digit())
    };
    let split_exp = |t: &str| -> Option<(String, Option<String>)> {
        match t.find(['e', 'E']) {
            Some(p) => Some((t[..p].to_string(), Some(t[p + 1..].to_string()))),
            None => Some((t.to_string(), None)),
        }
    };
    if let Some(rest) = s.strip_prefix('.') {
        // \.[0-9_]+(exp)?
        let Some((mant, exp)) = split_exp(rest) else {
            return false;
        };
        return !mant.is_empty()
            && mant.bytes().all(|b| b.is_ascii_digit() || b == b'_')
            && exp.is_none_or(|e| exp_ok(&e));
    }
    let Some((mant, exp)) = split_exp(unsigned) else {
        return false;
    };
    if !exp.is_none_or(|e| exp_ok(&e)) {
        return false;
    }
    let (int_part, frac) = match mant.split_once('.') {
        Some((i, f)) => (i.to_string(), Some(f.to_string())),
        None => (mant.clone(), None),
    };
    let int_ok = int_part == "0"
        || (int_part.starts_with(|c: char| ('1'..='9').contains(&c))
            && int_part.bytes().all(|b| b.is_ascii_digit() || b == b'_'));
    int_ok && frac.is_none_or(|f| f.bytes().all(|b| b.is_ascii_digit() || b == b'_'))
}

fn deprecated_boolean(s: &str) -> bool {
    matches!(
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
    )
}

fn choose_style(s: &str, single_line_only: bool) -> Style {
    let units: Vec<u32> = s.encode_utf16().map(u32::from).collect();
    let first = units.first().copied().unwrap_or(0);
    let last = units.last().copied().unwrap_or(0);
    let mut plain = is_plain_safe_first(first) && !is_white_space(last);
    let mut has_line_break = false;
    for &c in &units {
        if !single_line_only && c == 0x0a {
            has_line_break = true;
        } else if !is_printable(c) {
            return Style::Double;
        }
        plain = plain && is_plain_safe(c);
    }
    if !has_line_break {
        return if plain && !resolves_implicitly(s) {
            Style::Plain
        } else {
            Style::Single
        };
    }
    Style::Literal
}

fn escape_string(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        let c = ch as u32;
        if c > 0xffff {
            out.push_str(&format!("\\U{c:08X}"));
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
            Some(q) => out.push_str(q),
            None if is_printable(c) => out.push(ch),
            None if c <= 0xff => out.push_str(&format!("\\x{c:02X}")),
            None => out.push_str(&format!("\\u{c:04X}")),
        }
    }
    out
}

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

fn block_header(s: &str) -> String {
    let indent_indicator = if needs_indent_indicator(s) {
        INDENT.to_string()
    } else {
        String::new()
    };
    let clip = s.ends_with('\n');
    let keep = clip && (s.ends_with("\n\n") || s == "\n");
    let chomp = if keep {
        "+"
    } else if clip {
        ""
    } else {
        "-"
    };
    format!("{indent_indicator}{chomp}\n")
}

// /^\n* /
fn needs_indent_indicator(s: &str) -> bool {
    s.trim_start_matches('\n').starts_with(' ')
}

fn stringify_scalar(s: &str, level: usize, is_key: bool) -> String {
    if s.is_empty() {
        return "''".into();
    }
    if deprecated_boolean(s) {
        return format!("'{s}'");
    }
    let indent = INDENT * level.max(1);
    match choose_style(s, is_key) {
        Style::Plain => s.to_string(),
        Style::Single => format!("'{}'", s.replace('\'', "''")),
        Style::Literal => {
            let body = indent_string(s, indent);
            let body = body.strip_suffix('\n').unwrap_or(&body);
            format!("|{}{}", block_header(s), body)
        }
        Style::Double => format!("\"{}\"", escape_string(s)),
    }
}

fn newline_indent(level: usize) -> String {
    format!("\n{}", " ".repeat(INDENT * level))
}

fn js_float(f: f64) -> String {
    if f.is_nan() {
        ".nan".into()
    } else if f.is_infinite() {
        if f > 0.0 { ".inf" } else { "-.inf" }.into()
    } else if f == 0.0 && f.is_sign_negative() {
        "-0.0".into()
    } else {
        let r = format!("{f}");
        // `1e21` has no dot: js-yaml turns it into `1.e21`.
        if let Some(p) = r.find('e')
            && !r[..p].contains('.')
        {
            return format!("{}.e{}", &r[..p], &r[p + 1..]);
        }
        r
    }
}

fn stringify_node(
    value: &Value,
    level: usize,
    block: bool,
    compact: bool,
    is_key: bool,
) -> Option<String> {
    match value {
        Value::Null => Some("null".into()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Int(i) => Some(i.to_string()),
        Value::Float(f) => Some(js_float(*f)),
        Value::Str(s) => Some(stringify_scalar(s, level, is_key)),
        Value::Seq(items) => {
            if block && !items.is_empty() {
                let whitespace = newline_indent(level);
                let prefix = if compact {
                    String::new()
                } else {
                    whitespace.clone()
                };
                let mut results = Vec::new();
                for item in items {
                    let s = stringify_node(item, level + 1, true, true, false)?;
                    let line_prefix = if s.starts_with('\n') { "-" } else { "- " };
                    results.push(format!("{line_prefix}{s}"));
                }
                Some(format!("{prefix}{}", results.join(&whitespace)))
            } else {
                let results: Vec<String> = items
                    .iter()
                    .filter_map(|i| stringify_node(i, level, false, false, false))
                    .collect();
                Some(format!("[{}]", results.join(", ")))
            }
        }
        Value::Map(entries) => {
            if block && !entries.is_empty() {
                let separator = newline_indent(level);
                let mut results = Vec::new();
                for (k, v) in entries {
                    let key = stringify_scalar(k, level + 1, true);
                    let explicit = key.chars().count() > 1024;
                    let val = stringify_node(v, level + 1, true, explicit, false)?;
                    let mut pair = String::new();
                    if explicit {
                        pair.push_str(if key.starts_with('\n') { "?" } else { "? " });
                    }
                    pair.push_str(&key);
                    if explicit {
                        pair.push_str(&separator);
                    }
                    pair.push_str(if val.starts_with('\n') { ":" } else { ": " });
                    pair.push_str(&val);
                    results.push(pair);
                }
                let prefix = if compact {
                    String::new()
                } else {
                    separator.clone()
                };
                Some(format!("{prefix}{}", results.join(&separator)))
            } else {
                let results: Vec<String> = entries
                    .iter()
                    .map(|(k, v)| {
                        let key = stringify_scalar(k, level, false);
                        let val = stringify_node(v, level, false, false, false).unwrap_or_default();
                        format!("{key}: {val}")
                    })
                    .collect();
                Some(format!("{{{}}}", results.join(", ")))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(entries: &[(&str, Value)]) -> Value {
        Value::Map(
            entries
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }

    #[test]
    fn scalars_follow_std_yaml_quoting() {
        let v = m(&[
            ("id", Value::str("6jevipvi6toy2zccnok82aeue")),
            ("name", Value::str("Write regression test")),
            ("desc", Value::Seq(vec![])),
            ("created_at", Value::str("2020-01-21T09:00:00+01:00")),
            ("ready_at", Value::Null),
            ("flag", Value::Bool(false)),
            ("colon", Value::str("a: b")),
            ("num", Value::str("123")),
            ("flagish", Value::str("yes")),
            ("empty", Value::str("")),
            ("quote", Value::str("it's")),
        ]);
        assert_eq!(
            dump(&v),
            "id: 6jevipvi6toy2zccnok82aeue\nname: Write regression test\ndesc: []\n\
             created_at: '2020-01-21T09:00:00+01:00'\nready_at: null\nflag: false\n\
             colon: 'a: b'\nnum: '123'\nflagish: 'yes'\nempty: ''\nquote: it's\n"
        );
    }

    #[test]
    fn emoji_force_double_quotes_like_utf16_js() {
        let v = m(&[("name", Value::str("ship 🚀"))]);
        assert_eq!(dump(&v), "name: \"ship \\U0001F680\"\n");
        let v = m(&[("name", Value::str("café ☕"))]);
        assert_eq!(dump(&v), "name: café ☕\n");
    }

    #[test]
    fn multiline_strings_use_literal_blocks_in_sequences() {
        let v = m(&[(
            "desc",
            Value::Seq(vec![Value::str("one"), Value::str("a\nb")]),
        )]);
        assert_eq!(dump(&v), "desc:\n  - one\n  - |-\n    a\n    b\n");
    }

    #[test]
    fn nested_mappings_and_sequences_of_mappings() {
        let v = m(&[
            ("metadata", m(&[("k", Value::str("v"))])),
            (
                "links",
                Value::Seq(vec![m(&[
                    ("type", Value::str("related")),
                    ("task", Value::str("abc")),
                ])]),
            ),
        ]);
        assert_eq!(
            dump(&v),
            "metadata:\n  k: v\nlinks:\n  - type: related\n    task: abc\n"
        );
    }

    #[test]
    fn parse_keeps_order_and_types() {
        let p = parse_mapping("b: 1\na: 'x'\nc: null\nd: [1, 2]\n");
        assert_eq!(p[0], ("b".into(), Value::Int(1)));
        assert_eq!(p[1], ("a".into(), Value::str("x")));
        assert_eq!(p[2], ("c".into(), Value::Null));
        assert!(parse_mapping(": : :").is_empty());
    }
}
