//! A JSON value whose objects keep their key order (`serde_json::Value` sorts
//! keys). The worklog JSON files are rewritten in place by every command, so
//! reading then writing must not move a key.

use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// JSON value with ordered objects.
#[derive(Debug, Clone, PartialEq)]
pub enum J {
    /// `null`
    Null,
    /// `true` / `false`
    Bool(bool),
    /// A number.
    Num(serde_json::Number),
    /// A string.
    Str(String),
    /// An array.
    Arr(Vec<J>),
    /// An object, in insertion order.
    Obj(Vec<(String, J)>),
}

impl J {
    /// Shorthand for a string.
    pub fn str(s: impl Into<String>) -> J {
        J::Str(s.into())
    }

    /// An array of strings.
    pub fn strings<I, S>(items: I) -> J
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        J::Arr(items.into_iter().map(|s| J::Str(s.into())).collect())
    }

    /// An empty object.
    pub fn obj() -> J {
        J::Obj(Vec::new())
    }

    /// An integer.
    pub fn int(n: i64) -> J {
        J::Num(n.into())
    }

    /// Entry of an object.
    pub fn get(&self, key: &str) -> Option<&J> {
        match self {
            J::Obj(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Mutable entry of an object.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut J> {
        match self {
            J::Obj(m) => m.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// The string, if it is one.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            J::Str(s) => Some(s),
            _ => None,
        }
    }

    /// Sets a key: replaced in place, or appended. `None` removes it (the
    /// equivalent of assigning `undefined` before `JSON.stringify`).
    pub fn set(&mut self, key: &str, value: Option<J>) {
        let J::Obj(m) = self else { return };
        match (m.iter().position(|(k, _)| k == key), value) {
            (Some(i), Some(v)) => m[i].1 = v,
            (Some(i), None) => {
                m.remove(i);
            }
            (None, Some(v)) => m.push((key.to_string(), v)),
            (None, None) => {}
        }
    }

    /// Removes a key.
    pub fn remove(&mut self, key: &str) -> Option<J> {
        let J::Obj(m) = self else { return None };
        let i = m.iter().position(|(k, _)| k == key)?;
        Some(m.remove(i).1)
    }

    /// Parses JSON text.
    pub fn parse(text: &str) -> Result<J, serde_json::Error> {
        serde_json::from_str(text)
    }

    /// `JSON.stringify(value)`
    pub fn to_compact(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// `JSON.stringify(value, null, 2)`
    pub fn to_pretty(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_default()
    }
}

impl Serialize for J {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            J::Null => s.serialize_unit(),
            J::Bool(b) => s.serialize_bool(*b),
            J::Num(n) => n.serialize(s),
            J::Str(v) => s.serialize_str(v),
            J::Arr(a) => {
                let mut seq = s.serialize_seq(Some(a.len()))?;
                for v in a {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
            J::Obj(m) => {
                let mut map = s.serialize_map(Some(m.len()))?;
                for (k, v) in m {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for J {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<J, D::Error> {
        struct Vis;
        impl<'de> Visitor<'de> for Vis {
            type Value = J;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("any JSON value")
            }
            fn visit_unit<E>(self) -> Result<J, E> {
                Ok(J::Null)
            }
            fn visit_none<E>(self) -> Result<J, E> {
                Ok(J::Null)
            }
            fn visit_bool<E>(self, v: bool) -> Result<J, E> {
                Ok(J::Bool(v))
            }
            fn visit_i64<E>(self, v: i64) -> Result<J, E> {
                Ok(J::Num(v.into()))
            }
            fn visit_u64<E>(self, v: u64) -> Result<J, E> {
                Ok(J::Num(v.into()))
            }
            fn visit_f64<E>(self, v: f64) -> Result<J, E> {
                Ok(serde_json::Number::from_f64(v).map_or(J::Null, J::Num))
            }
            fn visit_str<E>(self, v: &str) -> Result<J, E> {
                Ok(J::Str(v.to_string()))
            }
            fn visit_string<E>(self, v: String) -> Result<J, E> {
                Ok(J::Str(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<J, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = a.next_element()? {
                    out.push(v);
                }
                Ok(J::Arr(out))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<J, A::Error> {
                let mut out: Vec<(String, J)> = Vec::new();
                while let Some((k, v)) = a.next_entry::<String, J>()? {
                    // JS objects keep the first position of a duplicate key.
                    match out.iter_mut().find(|(ek, _)| *ek == k) {
                        Some(slot) => slot.1 = v,
                        None => out.push((k, v)),
                    }
                }
                Ok(J::Obj(out))
            }
        }
        d.deserialize_any(Vis)
    }
}
