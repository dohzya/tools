//! YAML text to [`Value`], through the `yaml-edit` syntax tree (the same
//! parser as the lossless edits, so reading and editing cannot disagree on
//! what is valid).

use super::Value;
use std::str::FromStr;
use yaml_edit::{Document, Scalar, ScalarType, ScalarValue, YamlNode, YamlValue};

/// Only blank lines and comments: no data, but not an error either (the
/// parser rejects a comment-only text).
pub(crate) fn is_blank(raw: &str) -> bool {
    raw.lines()
        .all(|l| l.trim().is_empty() || l.trim_start().starts_with('#'))
}

/// Parses one YAML document. Blank text is `null`.
pub(crate) fn parse(raw: &str) -> Result<Value, String> {
    if is_blank(raw) {
        return Ok(Value::Null);
    }
    let doc = Document::from_str(raw).map_err(|e| e.to_string())?;
    let root = doc
        .as_mapping()
        .map(YamlNode::Mapping)
        .or_else(|| doc.as_sequence().map(YamlNode::Sequence))
        .or_else(|| doc.as_scalar().map(YamlNode::Scalar));
    match root.map(|n| convert(&n)) {
        Some(Ok(v)) => Ok(v),
        Some(Err(Unsupported::Duplicate(k))) => Err(format!("duplicate key '{k}'")),
        // Aliases, merge keys and tags: let the library resolve them. The
        // result is correct but mapping order is lost (it sorts keys).
        _ => YamlValue::from_document(&doc)
            .map(|v| from_resolved(&v))
            .map_err(|e| e.to_string()),
    }
}

enum Unsupported {
    Node,
    Duplicate(String),
}

fn scalar(s: &Scalar) -> Value {
    let v = ScalarValue::from_scalar(s);
    typed(&v)
}

fn typed(v: &ScalarValue) -> Value {
    match v.scalar_type() {
        ScalarType::Null => Value::Null,
        ScalarType::Boolean => v
            .to_bool()
            .map_or_else(|| Value::Str(v.value().into()), Value::Bool),
        ScalarType::Integer => v.to_i64().map_or_else(
            || {
                v.to_f64()
                    .map_or_else(|| Value::Str(v.value().into()), Value::Float)
            },
            Value::Int,
        ),
        ScalarType::Float => v
            .to_f64()
            .map_or_else(|| Value::Str(v.value().into()), Value::Float),
        _ => Value::Str(v.value().to_owned()),
    }
}

fn convert(node: &YamlNode) -> Result<Value, Unsupported> {
    match node {
        YamlNode::Scalar(s) => Ok(scalar(s)),
        YamlNode::Sequence(s) => s
            .values()
            .map(|n| convert(&n))
            .collect::<Result<_, _>>()
            .map(Value::Seq),
        YamlNode::Mapping(m) => {
            let mut out: Vec<(String, Value)> = vec![];
            // `iter()` skips entries without a value (`key:`): use `entries()`.
            for entry in m.entries() {
                let Some(YamlNode::Scalar(k)) = entry.key_node() else {
                    return Err(Unsupported::Node);
                };
                let key = k.as_string();
                if out.iter().any(|(o, _)| *o == key) {
                    return Err(Unsupported::Duplicate(key));
                }
                let value = match entry.value_node() {
                    Some(v) => convert(&v)?,
                    None => Value::Null,
                };
                out.push((key, value));
            }
            Ok(Value::Map(out))
        }
        _ => Err(Unsupported::Node),
    }
}

fn from_resolved(v: &YamlValue) -> Value {
    match v {
        YamlValue::Scalar(s) => typed(s),
        YamlValue::Sequence(s) => Value::Seq(s.iter().map(from_resolved).collect()),
        YamlValue::Mapping(m) => Value::Map(
            m.iter()
                .map(|(k, v)| (k.clone(), from_resolved(v)))
                .collect(),
        ),
        YamlValue::OrderedMapping(m) | YamlValue::Pairs(m) => Value::Map(
            m.iter()
                .map(|(k, v)| (k.clone(), from_resolved(v)))
                .collect(),
        ),
        YamlValue::Set(s) => Value::Seq(s.iter().cloned().map(Value::Str).collect()),
        YamlValue::Tagged(_, inner) => from_resolved(inner),
    }
}
