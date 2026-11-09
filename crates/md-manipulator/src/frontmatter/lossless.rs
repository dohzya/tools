//! Edits through the `yaml-edit` syntax tree: everything outside the touched
//! entry (comments, quoting, flow/block style, key order) is kept as is.

use super::{Op, Value};
use std::str::FromStr;
use yaml_edit::{Document, Mapping, ScalarValue, Sequence, YamlNode};

/// A value ready to be handed to the tree: collections are parsed from their
/// own YAML text, which the library copies into the tree.
enum Prepared {
    Scalar(ScalarValue),
    Str(String),
    Seq(Sequence),
    Map(Mapping),
}

fn prepare(v: &Value) -> Option<Prepared> {
    Some(match v {
        Value::Null => Prepared::Scalar(ScalarValue::null()),
        Value::Bool(b) => Prepared::Scalar(ScalarValue::from(*b)),
        Value::Int(i) => Prepared::Scalar(ScalarValue::from(*i)),
        Value::Float(f) => Prepared::Scalar(ScalarValue::from(*f)),
        Value::Str(s) => Prepared::Str(s.clone()),
        Value::Seq(_) => {
            let doc = Document::from_str(&v.to_yaml()).ok()?;
            Prepared::Seq(doc.as_sequence()?)
        }
        Value::Map(_) => {
            let doc = Document::from_str(&v.to_yaml()).ok()?;
            Prepared::Map(doc.as_mapping()?)
        }
    })
}

macro_rules! each {
    ($p:expr, |$v:ident| $body:expr) => {
        match $p {
            Prepared::Scalar($v) => $body,
            Prepared::Str($v) => $body,
            Prepared::Seq($v) => $body,
            Prepared::Map($v) => $body,
        }
    };
}

/// `a.b` + 1 -> `{a: {b: 1}}`
fn nest(segs: &[&str], value: &Value) -> Value {
    segs.iter().rev().fold(value.clone(), |acc, seg| {
        Value::Map(vec![((*seg).to_owned(), acc)])
    })
}

enum Cursor {
    Map(Mapping),
    Seq(Sequence),
}

fn descend(node: Option<YamlNode>) -> Option<Cursor> {
    match node? {
        YamlNode::Mapping(m) => Some(Cursor::Map(m)),
        YamlNode::Sequence(s) => Some(Cursor::Seq(s)),
        _ => None,
    }
}

/// The edited text, or `None` when the tree cannot do it (the caller then
/// verifies nothing and tries the textual fallback).
pub(crate) fn edit(raw: &str, segs: &[&str], op: &Op) -> Option<String> {
    let doc = Document::from_str(raw).ok()?;
    let mut cur = Cursor::Map(doc.as_mapping()?);
    for (i, seg) in segs.iter().enumerate() {
        let last = i + 1 == segs.len();
        let rest = &segs[i + 1..];
        match (&cur, op) {
            (Cursor::Map(m), Op::Set(value)) => {
                if last {
                    each!(prepare(value)?, |v| m.set(*seg, &v));
                    break;
                }
                match descend(m.get(*seg)) {
                    Some(next) => cur = next,
                    None => {
                        each!(prepare(&nest(rest, value))?, |v| m.set(*seg, &v));
                        break;
                    }
                }
            }
            (Cursor::Map(m), Op::Delete) => {
                if last {
                    m.remove(*seg)?;
                    break;
                }
                cur = descend(m.get(*seg))?;
            }
            (Cursor::Seq(s), Op::Set(value)) => {
                let idx: usize = seg.parse().ok()?;
                if last {
                    each!(prepare(value)?, |v| if idx == s.len() {
                        s.push(&v)
                    } else if !s.set(idx, &v) {
                        return None;
                    });
                    break;
                }
                match descend(s.get(idx)) {
                    Some(next) => cur = next,
                    None => {
                        let nested = prepare(&nest(rest, value))?;
                        each!(nested, |v| if idx == s.len() {
                            s.push(&v)
                        } else if !s.set(idx, &v) {
                            return None;
                        });
                        break;
                    }
                }
            }
            (Cursor::Seq(s), Op::Delete) => {
                let idx: usize = seg.parse().ok()?;
                if last {
                    s.remove(idx)?;
                    break;
                }
                cur = descend(s.get(idx))?;
            }
        }
    }
    Some(doc.to_string())
}
