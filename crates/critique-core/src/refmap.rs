//! Persistent review item ids: an id is minted once, then kept in
//! `reference-map.json` as `id -> { file, range, mrfi }` so that it survives
//! edits of the item's own text (the stable ids of [`crate::ids`] are
//! recomputed from content and change with every edit of the anchor).
//!
//! Pure: the host reads and writes the file; this module only transforms the
//! parsed map. Three passes, cheapest first (same as the TS tool):
//! 1. same `{lineStart, lineEnd}` as a stored entry of the file: adopt it;
//! 2. resolve the stored MRFI against the current document and adopt the
//!    first `exact`/`confident` resolution overlapping the item's lines;
//! 3. mint a new id from [`crate::ids::assign_stable_ids`].
//!
//! Pass 2 tries the stored candidates in `rank` order against a fresh
//! reference of the item. The TS meant to do that but passed `item.raw` (the
//! item's text, never a reference) as target, so every candidate was
//! "invalid" and the stored order stayed: a wiring bug, fixed here
//! (`docs/specs/critique.md`).

use crate::ids::{self, assign_stable_ids_avoiding};
use crate::scan::Annotation;
use md_manipulator::mrfi::{
    Format, GenerateOptions, MrfiDoc, Profile, ResolveOptions, SourceRange, Status, Target,
    generate, rank, resolve,
};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
use std::fmt;

/// Current file format version.
pub const VERSION: i64 = 1;

/// Inclusive 1-based line range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    /// First line.
    pub start_line: i64,
    /// Last line.
    pub end_line: i64,
}

/// Locator of one assigned id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// File the item belongs to (`/` separators).
    pub file: String,
    /// Last known lines.
    pub range: LineRange,
    /// MRFI (debug format) of those lines.
    pub mrfi: String,
}

/// Insertion-ordered `id -> entry` object (JS key order).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Entries(pub Vec<(String, Entry)>);

impl Entries {
    fn position(&self, id: &str) -> Option<usize> {
        self.0.iter().position(|(k, _)| k == id)
    }
}

impl<'de> Deserialize<'de> for Entries {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Entries;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an object of reference map entries")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Entries, A::Error> {
                let mut out: Vec<(String, Entry)> = Vec::new();
                while let Some((k, v)) = map.next_entry::<String, Entry>()? {
                    // JS objects keep the first position of a duplicated key, last value.
                    match out.iter_mut().find(|(ek, _)| *ek == k) {
                        Some(slot) => slot.1 = v,
                        None => out.push((k, v)),
                    }
                }
                Ok(Entries(out))
            }
        }
        d.deserialize_map(V)
    }
}

impl Serialize for Entries {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

/// The persisted map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceMap {
    /// Format version (kept as read).
    pub version: serde_json::Number,
    /// Entries by id.
    pub entries: Entries,
}

impl Default for ReferenceMap {
    fn default() -> Self {
        Self {
            version: VERSION.into(),
            entries: Entries::default(),
        }
    }
}

impl ReferenceMap {
    /// Strict parse (a malformed or foreign file is an error, like the TS zod schema).
    pub fn parse(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }

    /// `JSON.stringify(map, null, 2)` plus a final newline.
    pub fn to_json(&self) -> String {
        let mut out = serde_json::to_string_pretty(self).unwrap_or_default();
        out.push('\n');
        out
    }
}

fn normalize_file(file: &str) -> String {
    file.replace('\\', "/")
}

fn full_line_range(doc: &MrfiDoc, start: i64, end: i64) -> SourceRange {
    let (start, end) = (start.max(1) as u64, end.max(1) as u64);
    SourceRange {
        start_line: start,
        start_column: 1,
        end_line: end,
        end_column: doc.line_end_column(end as usize) as u64,
    }
}

fn debug_reference(doc: &MrfiDoc, start: i64, end: i64) -> String {
    let options = GenerateOptions {
        format: Format::Debug,
        profile: Profile::Default,
        ..GenerateOptions::default()
    };
    // Lines come from the scanner on the same text: the range is in the document.
    generate(
        doc,
        Target::Range(full_line_range(doc, start, end)),
        &options,
    )
    .unwrap_or_default()
}

/// Result of an assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assigned {
    /// One id per item, in order.
    pub ids: Vec<String>,
    /// The map to persist, when it must be (re)written.
    pub write: Option<ReferenceMap>,
}

/// Assigns a persistent id to every item of `file` (all items must belong to it).
pub fn assign_persistent_ids(
    file: &str,
    content: &str,
    items: &[Annotation],
    map: &ReferenceMap,
) -> Assigned {
    if items.is_empty() {
        return Assigned {
            ids: Vec::new(),
            write: None,
        };
    }
    let normalized = normalize_file(file);
    let mut entries = map.entries.clone();
    let ids_for_file: Vec<String> = entries
        .0
        .iter()
        .filter(|(_, e)| normalize_file(&e.file) == normalized)
        .map(|(k, _)| k.clone())
        .collect();
    let mut results: Vec<Option<String>> = vec![None; items.len()];
    let mut consumed: HashSet<String> = HashSet::new();

    // Pass 1: exact range match. The TS adopts any entry with the same range,
    // so inserting lines above made items swap ids (an item took the id of
    // the one that used to sit on its lines). Here an entry whose locator
    // still resolves with confidence to a place *not overlapping* the item is skipped; the
    // document is only parsed (lazily) when a range matches.
    let mut doc_cache: Option<MrfiDoc> = None;
    let mut elsewhere: std::collections::HashMap<String, Option<(i64, i64)>> =
        std::collections::HashMap::new();
    for (i, item) in items.iter().enumerate() {
        let (s, e) = (item.line_start as i64, item.line_end as i64);
        let candidates: Vec<String> = ids_for_file
            .iter()
            .filter(|id| {
                let range = entries.0[entries.position(id).unwrap_or(0)].1.range;
                range.start_line == s && range.end_line == e && !consumed.contains(*id)
            })
            .cloned()
            .collect();
        let hit = candidates.into_iter().find(|id| {
            let doc = doc_cache.get_or_insert_with(|| MrfiDoc::new(content));
            let resolved = elsewhere.entry(id.clone()).or_insert_with(|| {
                let pos = entries.position(id)?;
                let r = resolve(doc, &entries.0[pos].1.mrfi, &ResolveOptions::default());
                match (r.status, r.range) {
                    (Status::Exact | Status::Confident, Some(range)) => {
                        Some((range.start_line as i64, range.end_line as i64))
                    }
                    _ => None,
                }
            });
            // A coarser resolution (the whole section) still covers the item.
            resolved.is_none_or(|(rs, re)| rs <= e && re >= s)
        });
        if let Some(id) = hit {
            consumed.insert(id.clone());
            results[i] = Some(id);
        }
    }
    let unresolved: Vec<usize> = (0..items.len()).filter(|&i| results[i].is_none()).collect();
    if unresolved.is_empty() {
        return Assigned {
            ids: results.into_iter().flatten().collect(),
            write: None,
        };
    }

    let doc = doc_cache.unwrap_or_else(|| MrfiDoc::new(content));

    // Pass 2: resolve stored locators against the current document, closest
    // first. The target is a real reference of the item's current lines, so
    // `rank` can tell which stored locator describes this item best; the
    // order only matters when several of them resolve over the item (the TS
    // passed the item's raw text as target, which never parsed: stored order).
    for &i in &unresolved {
        let item = &items[i];
        let pool: Vec<&String> = ids_for_file
            .iter()
            .filter(|id| !consumed.contains(*id))
            .collect();
        let stored: Vec<&str> = pool
            .iter()
            .filter_map(|id| entries.position(id).map(|p| entries.0[p].1.mrfi.as_str()))
            .collect();
        let target = debug_reference(&doc, item.line_start as i64, item.line_end as i64);
        for ranked in rank(&target, &stored) {
            let id = pool[ranked.index];
            let Some(pos) = entries.position(id) else {
                continue;
            };
            let result = resolve(&doc, &entries.0[pos].1.mrfi, &ResolveOptions::default());
            let (Status::Exact | Status::Confident, Some(range)) = (result.status, result.range)
            else {
                continue;
            };
            let (rs, re) = (range.start_line as i64, range.end_line as i64);
            if !(rs <= item.line_end as i64 && re >= item.line_start as i64) {
                continue;
            }
            consumed.insert(id.clone());
            results[i] = Some(id.clone());
            entries.0[pos].1 = Entry {
                file: normalized.clone(),
                range: LineRange {
                    start_line: rs,
                    end_line: re,
                },
                mrfi: debug_reference(&doc, rs, re),
            };
            break;
        }
    }

    // Pass 3: mint ids for the rest, in one batch (occurrence suffixes).
    let still: Vec<usize> = unresolved
        .into_iter()
        .filter(|&i| results[i].is_none())
        .collect();
    if !still.is_empty() {
        let batch: Vec<Annotation> = still.iter().map(|&i| items[i].clone()).collect();
        let mut taken: HashSet<String> = results.iter().flatten().cloned().collect();
        for (&i, id) in still
            .iter()
            .zip(assign_stable_ids_avoiding(file, &batch, &mut taken))
        {
            let item = &items[i];
            let (s, e) = (item.line_start as i64, item.line_end as i64);
            let entry = Entry {
                file: normalized.clone(),
                range: LineRange {
                    start_line: s,
                    end_line: e,
                },
                mrfi: debug_reference(&doc, s, e),
            };
            match entries.position(&id) {
                Some(pos) => entries.0[pos].1 = entry,
                None => entries.0.push((id.clone(), entry)),
            }
            results[i] = Some(id);
        }
    }
    Assigned {
        ids: results.into_iter().flatten().collect(),
        write: Some(ReferenceMap {
            version: map.version.clone(),
            entries,
        }),
    }
}

/// Display ids of `ids`, unique among every id of the project: those of
/// `map` (all files) and `ids` themselves (not persisted yet, or no map).
pub fn display_ids(map: &ReferenceMap, ids: &[String]) -> Vec<String> {
    let mut all: Vec<String> = map.entries.0.iter().map(|(id, _)| id.clone()).collect();
    all.extend_from_slice(ids);
    ids.iter().map(|id| ids::display_id(id, &all)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::collect_annotations;

    const DOC: &str = "# T\n\nfirst {>> a <<}\n\nsecond {>> b <<}\n";

    fn assign(content: &str, map: &ReferenceMap) -> Assigned {
        assign_persistent_ids("doc.md", content, &collect_annotations(content), map)
    }

    #[test]
    fn mints_then_reuses_by_range_without_writing() {
        let first = assign(DOC, &ReferenceMap::default());
        assert_eq!(first.ids.len(), 2);
        let map = first.write.expect("new ids must be persisted");
        assert_eq!(map.entries.0.len(), 2);
        let again = assign(DOC, &map);
        assert_eq!(again.ids, first.ids);
        assert_eq!(again.write, None);
    }

    #[test]
    fn id_survives_a_typo_in_the_item() {
        let first = assign(DOC, &ReferenceMap::default());
        let map = first.write.unwrap();
        let edited = DOC.replace("{>> a <<}", "{>> a typo fixed <<}");
        let moved = assign(&edited, &map);
        assert_eq!(moved.ids, first.ids);
    }

    #[test]
    fn id_follows_an_insertion_above() {
        let first = assign(DOC, &ReferenceMap::default());
        let map = first.write.unwrap();
        let edited = format!("intro line\n\n{DOC}");
        let moved = assign(&edited, &map);
        assert_eq!(moved.ids, first.ids);
        let written = moved.write.unwrap();
        assert_eq!(written.entries.0[0].1.range.start_line, 5);
    }

    #[test]
    fn duplicated_block_gets_its_own_id() {
        let first = assign(DOC, &ReferenceMap::default());
        let map = first.write.unwrap();
        let duplicated = format!("{DOC}\nfirst {{>> a <<}}\n");
        let got = assign(&duplicated, &map);
        assert_eq!(&got.ids[..2], &first.ids[..]);
        assert_eq!(got.ids.len(), 3);
        assert!(got.ids[2] != got.ids[0] && got.ids[2] != got.ids[1]);
    }

    fn stale_entry(file: &str, mrfi: String) -> Entry {
        // Stale range: pass 1 must not adopt it, only the locator can.
        Entry {
            file: file.to_owned(),
            range: LineRange {
                start_line: 100,
                end_line: 100,
            },
            mrfi,
        }
    }

    #[test]
    fn pass_two_tries_the_closest_stored_reference_first() {
        // Two stored locators both resolve over the item: the coarse one is
        // stored first. The item must take the one that matches its own
        // fresh reference, whatever the storage order.
        let content = "# T\n\nonly {>> b <<}\n";
        let doc = MrfiDoc::new(content);
        let coarse = stale_entry("doc.md", debug_reference(&doc, 1, 3));
        let own = stale_entry("doc.md", debug_reference(&doc, 3, 3));
        let map = ReferenceMap {
            version: VERSION.into(),
            entries: Entries(vec![("rvw_coarse".into(), coarse), ("rvw_own".into(), own)]),
        };
        assert_eq!(assign(content, &map).ids, ["rvw_own"]);
    }

    #[test]
    fn display_ids_are_unique_across_every_file_of_the_map() {
        let minted = assign(DOC, &ReferenceMap::default()).ids;
        let alone = display_ids(&ReferenceMap::default(), &minted);
        assert_eq!(alone[0].len(), 6);
        // Another file holds an id sharing the 6 first characters of minted[0].
        let other = format!("{}{}", &minted[0][..ids::PREFIX.len() + 6], "zzzzzz");
        let map = ReferenceMap {
            version: VERSION.into(),
            entries: Entries(vec![(other, stale_entry("other.md", String::new()))]),
        };
        let shown = display_ids(&map, &minted);
        assert!(shown[0].len() > 6);
        assert!(minted[0][ids::PREFIX.len()..].starts_with(&shown[0]));
        assert_eq!(shown[1], alone[1]);
    }

    #[test]
    fn json_roundtrip_is_byte_stable() {
        let map = assign(DOC, &ReferenceMap::default()).write.unwrap();
        let json = map.to_json();
        assert!(json.starts_with("{\n  \"version\": 1,\n  \"entries\": {\n    \"rvw_"));
        assert_eq!(ReferenceMap::parse(&json).unwrap().to_json(), json);
        assert!(ReferenceMap::parse("{\"nope\":1}").is_err());
    }
}
