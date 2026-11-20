//! Line-based fallback for when the syntax tree cannot make an edit. It is
//! deliberately narrow: top-level keys only, and it declines (returns `None`)
//! rather than guess. Comments and the other entries stay byte-identical.

use super::{Op, Value};

fn is_blank_or_comment(l: &str) -> bool {
    let t = l.trim();
    t.is_empty() || t.starts_with('#')
}

/// Byte index of a trailing ` # comment` in the text after a `key:`, ignoring
/// `#` inside quotes.
fn comment_at(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut quote: Option<char> = None;
    for (i, c) in s.char_indices() {
        match quote {
            Some(q) => {
                if c == q && !(q == '"' && i > 0 && b[i - 1] == b'\\') {
                    quote = None;
                }
            }
            None if (c == '"' || c == '\'')
                && (s[..i].trim().is_empty() || s[..i].ends_with(' ')) =>
            {
                quote = Some(c);
            }
            None if c == '#' && (i == 0 || b[i - 1] == b' ') => return Some(i),
            None => {}
        }
    }
    None
}

fn key_matches(line: &str, key: &str) -> bool {
    [key.to_owned(), format!("\"{key}\""), format!("'{key}'")]
        .iter()
        .any(|k| {
            line.strip_prefix(k.as_str()).is_some_and(|r| {
                let r = r.trim_start();
                r.starts_with(':') && (r.len() == 1 || r[1..].starts_with([' ', '\t']))
            })
        })
}

/// `[start, end)` of the top-level entry of `key`: its line and the more
/// indented lines (or `- ` items at the same indent) that follow, minus
/// trailing blank and comment lines, which belong to what comes next.
fn entry(lines: &[&str], key: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| key_matches(l, key))?;
    let mut end = start + 1;
    while end < lines.len() {
        let l = lines[end];
        let indented = l.starts_with([' ', '\t']);
        if !l.trim().is_empty() && !indented && !l.starts_with("- ") && l != "-" {
            break;
        }
        end += 1;
    }
    while end > start + 1
        && is_blank_or_comment(lines[end - 1])
        && !lines[end - 1].starts_with([' ', '\t'])
    {
        end -= 1;
    }
    Some((start, end))
}

pub(crate) fn edit(raw: &str, segs: &[&str], op: &Op, eol: &str) -> Option<String> {
    let owned: Vec<String> = raw
        .split_inclusive('\n')
        .map(|l| l.trim_end_matches(['\n', '\r']).to_owned())
        .collect();
    let mut lines: Vec<&str> = owned.iter().map(String::as_str).collect();
    let key = segs[0];
    let found = entry(&lines, key);
    let replacement: Vec<String>;
    match (op, found) {
        (Op::Set(value), None) => {
            let nested = segs[1..].iter().rev().fold(value.clone(), |acc, s| {
                Value::Map(vec![((*s).to_owned(), acc)])
            });
            replacement = Value::Map(vec![(key.to_owned(), nested)])
                .to_yaml()
                .split('\n')
                .map(str::to_owned)
                .collect();
            lines.extend(replacement.iter().map(String::as_str));
        }
        (Op::Set(value), Some((s, e))) if segs.len() == 1 => {
            let mut new: Vec<String> = Value::Map(vec![(key.to_owned(), value.clone())])
                .to_yaml()
                .split('\n')
                .map(str::to_owned)
                .collect();
            // `key: old # why` -> `key: new # why` when both are one-liners.
            if e == s + 1 && new.len() == 1 {
                let after = &lines[s][lines[s].find(':').map_or(0, |c| c + 1)..];
                if let Some(c) = comment_at(after) {
                    new[0].push(' ');
                    new[0].push_str(&after[c..]);
                    if after[..c]
                        .trim()
                        .starts_with(['|', '>', '&', '*', '[', '{', '!'])
                    {
                        return None;
                    }
                }
            }
            replacement = new;
            lines.splice(s..e, replacement.iter().map(String::as_str));
        }
        (Op::Delete, Some((s, e))) if segs.len() == 1 => {
            lines.drain(s..e);
        }
        _ => return None,
    }
    let mut out = lines.join(eol);
    if !lines.is_empty() {
        out.push_str(eol);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str =
        "# top\na: 1  # why\nb:\n  - x\n  - y\n# between\nc: |\n  text\n\n  more\nd: 'q'\n";

    fn run(segs: &[&str], op: Op) -> Option<String> {
        edit(SRC, segs, &op, "\n")
    }

    #[test]
    fn sets_replace_one_entry_and_keep_a_trailing_comment() {
        let out = run(&["a"], Op::Set(Value::Int(2))).unwrap();
        // The gap before the comment is normalized to one space.
        assert_eq!(out, SRC.replace("a: 1  # why", "a: 2 # why"));
        let out = run(&["b"], Op::Set(Value::Str("s".into()))).unwrap();
        assert_eq!(out, SRC.replace("b:\n  - x\n  - y\n", "b: s\n"));
    }

    #[test]
    fn delete_removes_the_entry_with_its_block_scalar_but_not_the_next_comment() {
        let out = run(&["c"], Op::Delete).unwrap();
        assert_eq!(out, SRC.replace("c: |\n  text\n\n  more\n", ""));
        let out = run(&["b"], Op::Delete).unwrap();
        assert_eq!(out, SRC.replace("b:\n  - x\n  - y\n", ""));
    }

    #[test]
    fn add_appends_and_nested_paths_are_declined_when_the_key_exists() {
        let out = run(&["e", "f"], Op::Set(Value::Int(1))).unwrap();
        assert_eq!(out, format!("{SRC}e:\n  f: 1\n"));
        assert_eq!(run(&["b", "0"], Op::Set(Value::Int(1))), None);
        assert_eq!(run(&["zz"], Op::Delete), None);
    }
}
