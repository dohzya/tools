//! The data model of a frontmatter, with the conversions the `md meta`
//! commands need.
//!
//! An own enum rather than `serde_json::Value`: it keeps mapping order without
//! `preserve_order` (and its `indexmap` dependency), adds no dependency to the
//! wasm build, and stays a plain YAML core-schema value (no JSON-only
//! constraints such as string-only keys leaking into the API). Mapping keys
//! are always strings: scalar keys are read through their text.

/// A YAML value of the core schema. Mappings keep their source order.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// `null`, `~` or an empty value.
    Null,
    /// `true` / `false`.
    Bool(bool),
    /// An integer that fits in an `i64`.
    Int(i64),
    /// A float.
    Float(f64),
    /// Any other scalar.
    Str(String),
    /// A sequence.
    Seq(Vec<Value>),
    /// A mapping, in source order.
    Map(Vec<(String, Value)>),
}

/// Splits a dotted path (`a.b.0`). Like the TS code, there is no way to
/// address a key that contains a dot.
pub(crate) fn split_path(path: &str) -> Vec<&str> {
    path.split('.').collect()
}

impl Value {
    /// Value at a dotted path; numeric segments index sequences.
    pub fn get_path(&self, path: &str) -> Option<&Value> {
        split_path(path)
            .into_iter()
            .try_fold(self, |cur, seg| match cur {
                Value::Map(m) => m.iter().find(|(k, _)| k == seg).map(|(_, v)| v),
                Value::Seq(s) => seg.parse::<usize>().ok().and_then(|i| s.get(i)),
                _ => None,
            })
    }

    /// Sets a value at a dotted path (see [`Value::set_path`] for the rules);
    /// used to build a frontmatter from scratch.
    pub fn set(&mut self, path: &str, value: Value) -> Result<(), String> {
        self.set_path(&split_path(path), value)
    }

    /// Sets a value, creating missing mappings on the way and replacing
    /// scalars that are in the way, as the TS `setNestedValue` did. Fails when
    /// a sequence index is out of range or not a number.
    pub(crate) fn set_path(&mut self, segs: &[&str], value: Value) -> Result<(), String> {
        let Some((seg, rest)) = segs.split_first() else {
            *self = value;
            return Ok(());
        };
        match self {
            Value::Map(m) => {
                let slot = match m.iter().position(|(k, _)| k == seg) {
                    Some(i) => &mut m[i].1,
                    None => {
                        m.push(((*seg).to_owned(), Value::Null));
                        &mut m.last_mut().expect("just pushed").1
                    }
                };
                if !rest.is_empty() && !matches!(slot, Value::Map(_) | Value::Seq(_)) {
                    *slot = Value::Map(vec![]);
                }
                slot.set_path(rest, value)
            }
            Value::Seq(s) => {
                let i = seg
                    .parse::<usize>()
                    .ok()
                    .filter(|&i| i <= s.len())
                    .ok_or_else(|| format!("'{seg}' is not an index of the sequence"))?;
                if i == s.len() {
                    s.push(Value::Null);
                }
                if !rest.is_empty() && !matches!(s[i], Value::Map(_) | Value::Seq(_)) {
                    s[i] = Value::Map(vec![]);
                }
                s[i].set_path(rest, value)
            }
            _ => Err(format!("'{seg}' is not inside a mapping or a sequence")),
        }
    }

    /// Removes the value at a path; false if there is none.
    pub(crate) fn delete_path(&mut self, segs: &[&str]) -> bool {
        let Some((seg, rest)) = segs.split_first() else {
            return false;
        };
        match self {
            Value::Map(m) => match m.iter().position(|(k, _)| k == seg) {
                Some(i) if rest.is_empty() => {
                    m.remove(i);
                    true
                }
                Some(i) => m[i].1.delete_path(rest),
                None => false,
            },
            Value::Seq(s) => match seg.parse::<usize>().ok().filter(|&i| i < s.len()) {
                Some(i) if rest.is_empty() => {
                    s.remove(i);
                    true
                }
                Some(i) => s[i].delete_path(rest),
                None => false,
            },
            _ => false,
        }
    }

    /// Interprets the argument of `md meta --set` the way the TS CLI did: it
    /// is YAML if it parses to something non-empty, otherwise (also for
    /// `null`, `~`, `[]`, `{}`, comments and invalid YAML) the literal string.
    pub fn from_cli_arg(arg: &str) -> Value {
        match super::read::parse(arg) {
            Ok(Value::Null) | Err(_) => Value::Str(arg.to_owned()),
            Ok(Value::Seq(s)) if s.is_empty() => Value::Str(arg.to_owned()),
            Ok(Value::Map(m)) if m.is_empty() => Value::Str(arg.to_owned()),
            Ok(v) => v,
        }
    }

    /// Text shown by `md meta <file> <key>`: scalars as they are, `null` as
    /// nothing, collections as block YAML.
    pub fn to_display(&self) -> String {
        match self {
            Value::Null => String::new(),
            Value::Bool(b) => b.to_string(),
            Value::Int(i) => i.to_string(),
            Value::Float(f) => float_text(*f),
            Value::Str(s) => s.clone(),
            _ => self.to_yaml(),
        }
    }

    /// Compact JSON.
    pub fn to_json(&self) -> String {
        match self {
            Value::Null => "null".into(),
            Value::Bool(b) => b.to_string(),
            Value::Int(i) => i.to_string(),
            Value::Float(f) if f.is_finite() => float_text(*f),
            Value::Float(_) => "null".into(),
            Value::Str(s) => json_string(s),
            Value::Seq(s) => format!(
                "[{}]",
                s.iter().map(Value::to_json).collect::<Vec<_>>().join(",")
            ),
            Value::Map(m) => format!(
                "{{{}}}",
                m.iter()
                    .map(|(k, v)| format!("{}:{}", json_string(k), v.to_json()))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        }
    }

    /// Block-style YAML without a final line ending (2-space indent, sequences
    /// indented under their key). Strings are quoted whenever reading them
    /// back could give another type.
    pub fn to_yaml(&self) -> String {
        let mut lines = vec![];
        emit(self, 0, &mut lines);
        lines.join("\n")
    }
}

fn float_text(f: f64) -> String {
    if f.is_nan() {
        "NaN".into()
    } else if f.is_infinite() {
        if f > 0.0 { "Infinity" } else { "-Infinity" }.into()
    } else {
        f.to_string()
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A plain scalar is only used when it cannot be read as another type nor
/// confuse a block parser; everything else is double-quoted (JSON escapes are
/// valid YAML ones).
fn scalar_text(s: &str) -> String {
    let plain_chars = !s.is_empty()
        && s.chars()
            .all(|c| c.is_alphanumeric() || " _./@+()-".contains(c))
        && !s.starts_with([' ', '-'])
        && !s.ends_with(' ');
    let lower = s.to_lowercase();
    let typed = [
        "true", "false", "null", "yes", "no", "on", "off", "y", "n", "~",
    ]
    .contains(&lower.as_str())
        || s.parse::<f64>().is_ok()
        || s.starts_with(|c: char| c.is_ascii_digit());
    if plain_chars && !typed {
        s.to_owned()
    } else {
        json_string(s)
    }
}

fn inline(v: &Value) -> Option<String> {
    Some(match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => float_text(*f),
        Value::Str(s) => scalar_text(s),
        Value::Seq(s) if s.is_empty() => "[]".into(),
        Value::Map(m) if m.is_empty() => "{}".into(),
        _ => return None,
    })
}

fn emit(v: &Value, indent: usize, out: &mut Vec<String>) {
    let pad = " ".repeat(indent);
    match v {
        Value::Map(m) if !m.is_empty() => {
            for (k, child) in m {
                match inline(child) {
                    Some(t) => out.push(format!("{pad}{}: {t}", scalar_text(k))),
                    None => {
                        out.push(format!("{pad}{}:", scalar_text(k)));
                        emit(child, indent + 2, out);
                    }
                }
            }
        }
        Value::Seq(s) if !s.is_empty() => {
            for child in s {
                match inline(child) {
                    Some(t) => out.push(format!("{pad}- {t}")),
                    None => {
                        let start = out.len();
                        emit(child, indent + 2, out);
                        // `- ` takes the place of the first line's indent.
                        out[start].replace_range(indent..indent + 2, "- ");
                    }
                }
            }
        }
        scalar => out.push(format!("{pad}{}", inline(scalar).unwrap_or_default())),
    }
}
