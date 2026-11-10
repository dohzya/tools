//! A string-keyed map that keeps insertion order, like a JS object. The JSON
//! files of a worklog (index, scopes) are read and written with it so that a
//! rewrite never reorders keys.

use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Insertion-ordered map.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OrderedMap<V>(pub Vec<(String, V)>);

impl<V> OrderedMap<V> {
    /// Empty map.
    pub fn new() -> Self {
        OrderedMap(Vec::new())
    }

    /// Value of a key.
    pub fn get(&self, key: &str) -> Option<&V> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// Mutable value of a key.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut V> {
        self.0.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// Whether the key exists.
    pub fn contains_key(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Sets a value: replaces in place, or appends.
    pub fn insert(&mut self, key: impl Into<String>, value: V) {
        let key = key.into();
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }

    /// Removes a key.
    pub fn remove(&mut self, key: &str) -> Option<V> {
        let pos = self.0.iter().position(|(k, _)| k == key)?;
        Some(self.0.remove(pos).1)
    }

    /// Keys in order.
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.0.iter().map(|(k, _)| k)
    }

    /// Entries in order.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &V)> {
        self.0.iter().map(|(k, v)| (k, v))
    }

    /// Number of entries.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether there is no entry.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl<V: Serialize> Serialize for OrderedMap<V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

impl<'de, V: Deserialize<'de>> Deserialize<'de> for OrderedMap<V> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Vis<V>(std::marker::PhantomData<V>);
        impl<'de, V: Deserialize<'de>> Visitor<'de> for Vis<V> {
            type Value = OrderedMap<V>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a map")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut out = OrderedMap::new();
                while let Some((k, v)) = a.next_entry::<String, V>()? {
                    out.insert(k, v);
                }
                Ok(out)
            }
        }
        d.deserialize_map(Vis(std::marker::PhantomData))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_keeps_position_and_remove_works() {
        let mut m = OrderedMap::new();
        m.insert("b", 1);
        m.insert("a", 2);
        m.insert("b", 3);
        assert_eq!(m.keys().cloned().collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(m.get("b"), Some(&3));
        assert_eq!(m.remove("b"), Some(3));
        assert_eq!(m.len(), 1);
        assert!(!m.contains_key("b"));
    }

    #[test]
    fn serializes_as_a_map_in_order() {
        let mut m = OrderedMap::new();
        m.insert("z", "1".to_string());
        m.insert("a", "2".to_string());
        assert_eq!(serde_json::to_string(&m).unwrap(), r#"{"z":"1","a":"2"}"#);
        let back: OrderedMap<String> = serde_json::from_str(r#"{"z":"1","a":"2"}"#).unwrap();
        assert_eq!(back, m);
    }
}
