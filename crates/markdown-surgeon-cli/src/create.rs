//! Text of a new file for `md create`.

use crate::magic;
use jiff::Zoned;
use md_manipulator::Value;

/// A `--meta key=value` entry that has no `=` or an empty key.
#[derive(Debug, PartialEq, Eq)]
pub struct BadMeta(pub String);

/// Splits `key=value` at the first `=` (the key must not be empty).
pub fn parse_meta_entry(entry: &str) -> Result<(&str, &str), BadMeta> {
    match entry.split_once('=') {
        Some((k, v)) if !k.is_empty() => Ok((k, v)),
        _ => Err(BadMeta(entry.to_owned())),
    }
}

/// Frontmatter (when there are entries), `# title` and content, each part
/// expanded with the magic expressions; `{meta:key}` sees the entries
/// declared before it.
pub fn build(
    title: Option<&str>,
    entries: &[(&str, &str)],
    content: Option<&str>,
    now: &Zoned,
) -> Result<String, String> {
    let mut meta = Value::Map(vec![]);
    let mut lines: Vec<String> = vec![];
    if !entries.is_empty() {
        for (k, v) in entries {
            let value = magic::expand(v, &meta, now);
            meta.set(k, Value::Str(value))?;
        }
        lines.extend(["---".into(), yaml(&meta), "---".into(), String::new()]);
    }
    if let Some(title) = title.filter(|t| !t.is_empty()) {
        lines.push(format!("# {}", magic::expand(title, &meta, now)));
        lines.push(String::new());
    }
    if let Some(content) = content.filter(|c| !c.is_empty()) {
        lines.push(magic::expand(content, &meta, now));
    }
    Ok(lines.join("\n"))
}

/// Block YAML of nested mappings of strings, without final line ending.
/// Strings that would read back as another type are single-quoted, as
/// `@std/yaml` did.
fn yaml(v: &Value) -> String {
    let mut out = vec![];
    emit(v, 0, &mut out);
    out.join("\n")
}

fn emit(v: &Value, indent: usize, out: &mut Vec<String>) {
    let Value::Map(m) = v else { return };
    for (k, child) in m {
        let pad = " ".repeat(indent);
        match child {
            Value::Map(inner) if !inner.is_empty() => {
                out.push(format!("{pad}{}:", scalar(k)));
                emit(child, indent + 2, out);
            }
            Value::Str(s) => out.push(format!("{pad}{}: {}", scalar(k), scalar(s))),
            _ => out.push(format!("{pad}{}: {{}}", scalar(k))),
        }
    }
}

fn scalar(s: &str) -> String {
    let plain = !s.is_empty()
        && s.chars()
            .all(|c| c.is_alphanumeric() || " _./@+()-".contains(c))
        && !s.starts_with([' ', '-'])
        && !s.ends_with(' ');
    let lower = s.to_lowercase();
    let ambiguous = [
        "true", "false", "null", "yes", "no", "on", "off", "y", "n", "~",
    ]
    .contains(&lower.as_str())
        || s.parse::<f64>().is_ok()
        || s.starts_with(|c: char| c.is_ascii_digit());
    if plain && !ambiguous {
        s.to_owned()
    } else if s.chars().any(char::is_control) {
        format!("\"{}\"", s.escape_default())
    } else {
        format!("'{}'", s.replace('\'', "''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> Zoned {
        "2026-11-03T09:05:07+00:00[UTC]".parse().unwrap()
    }

    #[test]
    fn nothing_given_is_an_empty_file() {
        assert_eq!(build(None, &[], None, &now()).unwrap(), "");
        assert_eq!(build(Some(""), &[], Some(""), &now()).unwrap(), "");
    }

    #[test]
    fn title_and_content() {
        assert_eq!(
            build(Some("T"), &[], Some("body"), &now()).unwrap(),
            "# T\n\nbody"
        );
    }

    #[test]
    fn meta_block_quotes_ambiguous_strings() {
        let text = build(
            None,
            &[("a", "1"), ("b", "two"), ("c", "true")],
            None,
            &now(),
        )
        .unwrap();
        assert_eq!(text, "---\na: '1'\nb: two\nc: 'true'\n---\n");
    }

    #[test]
    fn dotted_keys_nest_and_later_entries_see_earlier_ones() {
        let text = build(
            Some("{meta:a.b}"),
            &[("a.b", "x y"), ("c", "{meta:a.b}!")],
            None,
            &now(),
        )
        .unwrap();
        assert_eq!(text, "---\na:\n  b: x y\nc: 'x y!'\n---\n\n# x y\n");
    }

    #[test]
    fn magic_expressions_are_expanded_everywhere() {
        let text = build(Some("{date}"), &[("at", "{dt}")], Some("{time}"), &now()).unwrap();
        assert_eq!(
            text,
            "---\nat: '2026-11-03T09:05:07+00:00'\n---\n\n# 2026-11-03\n\n09:05:07"
        );
    }

    #[test]
    fn meta_entries_need_a_key_and_an_equals_sign() {
        assert_eq!(parse_meta_entry("a=b=c"), Ok(("a", "b=c")));
        assert_eq!(parse_meta_entry("a="), Ok(("a", "")));
        assert_eq!(parse_meta_entry("oops"), Err(BadMeta("oops".into())));
        assert_eq!(parse_meta_entry("=v"), Err(BadMeta("=v".into())));
    }
}
