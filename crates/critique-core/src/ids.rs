//! Stable review item ids: `rvw_` + base62(FNV-1a 64 over the UTF-16 code
//! units of `file\0kind\0anchor`). Kept bit-identical to the TS tool because
//! ids are persisted in user documents and shared with the VS Code extension,
//! except that the value of a `ref%ts:` prefix is left out of the anchor and
//! of fingerprints (the TS hashed it), so they ignore the timestamp format.

use crate::scan::{self, Annotation, Kind};
use crate::timestamp::parse_review_timestamp;
use dz_encodings::base62::{self, Alphabet};
use std::collections::HashMap;

/// Prefix of every id.
pub const PREFIX: &str = "rvw_";

/// Collapses JS-whitespace runs to one space and trims (`\s+` -> " ", trim).
pub fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending = false;
    for c in text.chars() {
        if md_manipulator::mrfi::is_js_whitespace(c) {
            pending = true;
        } else {
            if pending && !out.is_empty() {
                out.push(' ');
            }
            pending = false;
            out.push(c);
        }
    }
    out
}

/// FNV-1a 64 over UTF-16 code units, as hex padded to 16 (TS `hashStableReviewText`).
fn fnv1a(units: &[u16]) -> u64 {
    units.iter().fold(0xcbf2_9ce4_8422_2325u64, |hash, &u| {
        (hash ^ u64::from(u)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Hash used for fingerprints: `fnv1a` as 16 hex digits.
pub fn fingerprint(raw: &str) -> String {
    // EOL-normalized so the same block hashes alike in a CRLF, CR or LF file
    // (LF text, hence every value persisted so far, is unchanged).
    let normalized = md_manipulator::mrfi::normalize_line_endings(raw);
    let units: Vec<u16> = scan::strip_timestamps(&normalized).encode_utf16().collect();
    format!("{:016x}", fnv1a(&units))
}

fn first_timestamp_anchor(raw: &str) -> Option<String> {
    let mut found: Vec<(usize, &str)> = scan::find_markers(raw)
        .iter()
        .filter_map(|m| m.ts.map(|(a, e)| (a, &raw[a..e])))
        .collect();
    found.extend(
        scan::find_annotation_timestamps(raw)
            .iter()
            .map(|m| (m.ts.0, &raw[m.ts.0..m.ts.1])),
    );
    found.sort_by_key(|&(index, _)| index);
    let (_, value) = *found.first()?;
    Some(match parse_review_timestamp(value) {
        Some(t) => format!("timestamp\0{}\0{}", t.unix_seconds, t.offset_minutes),
        None => format!("timestamp\0{value}"),
    })
}

fn first_message(raw: &str) -> Option<String> {
    let markers = scan::find_markers(raw);
    let first = markers.first()?;
    let start = scan::body_start(raw, first.end);
    let next = markers.get(1).map_or_else(
        || scan::conversation_close_start(raw),
        scan::MarkerMatch::marker_start,
    );
    let body = if next > start {
        collapse_whitespace(&raw[start..next])
    } else {
        String::new()
    };
    Some(format!("{}\0{}", first.marker.as_str(), body))
}

fn anchor(kind: Kind, raw: &str) -> Vec<u16> {
    if let Some(ts) = first_timestamp_anchor(raw) {
        return ts.encode_utf16().collect();
    }
    if kind == Kind::Conversation
        && let Some(message) = first_message(raw)
    {
        return message.encode_utf16().collect();
    }
    // The TS slices 160 UTF-16 units, possibly splitting a surrogate pair:
    // hashing units (not chars) keeps the ids identical in that case too.
    let mut units: Vec<u16> = collapse_whitespace(&scan::strip_timestamps(raw))
        .encode_utf16()
        .collect();
    units.truncate(160);
    units
}

fn key(file: &str, kind: Kind, raw: &str) -> Vec<u16> {
    let mut key: Vec<u16> = file.replace('\\', "/").encode_utf16().collect();
    key.push(0);
    key.extend(kind.as_str().encode_utf16());
    key.push(0);
    key.extend(anchor(kind, raw));
    key
}

fn id_from_key(key: &[u16]) -> String {
    format!(
        "{PREFIX}{}",
        base62::encode_unsigned(u128::from(fnv1a(key)), 0, Alphabet::Mrfi)
    )
}

/// Ids for all `items` of `file`, disambiguating identical anchors by
/// occurrence number.
pub fn assign_stable_ids(file: &str, items: &[Annotation]) -> Vec<String> {
    let keys: Vec<Vec<u16>> = items.iter().map(|i| key(file, i.kind, &i.raw)).collect();
    let mut totals: HashMap<&[u16], usize> = HashMap::new();
    for k in &keys {
        *totals.entry(k).or_default() += 1;
    }
    let mut seen: HashMap<&[u16], usize> = HashMap::new();
    keys.iter()
        .map(|k| {
            let occurrence = seen.entry(k).or_default();
            let id = if totals[k.as_slice()] == 1 {
                id_from_key(k)
            } else {
                let mut suffixed = k.clone();
                suffixed.push(0);
                suffixed.extend(occurrence.to_string().encode_utf16());
                id_from_key(&suffixed)
            };
            *occurrence += 1;
            id
        })
        .collect()
}

/// Like [`assign_stable_ids`], but an id already in `taken` (held by another
/// item of the document) gets a numeric suffix instead of being shared, so
/// that a duplicated block never inherits the id of its original. `taken` is
/// extended with the returned ids.
pub fn assign_stable_ids_avoiding(
    file: &str,
    items: &[Annotation],
    taken: &mut std::collections::HashSet<String>,
) -> Vec<String> {
    let keys: Vec<Vec<u16>> = items.iter().map(|i| key(file, i.kind, &i.raw)).collect();
    assign_stable_ids(file, items)
        .into_iter()
        .zip(keys)
        .map(|(id, key)| {
            let mut id = id;
            let mut n = 1;
            while taken.contains(&id) {
                let mut suffixed = key.clone();
                suffixed.push(0);
                suffixed.extend(format!("dup{n}").encode_utf16());
                id = id_from_key(&suffixed);
                n += 1;
            }
            taken.insert(id.clone());
            id
        })
        .collect()
}

/// Display id: shortest prefix (min 5, plus one) that no other id shares.
pub fn short_id(id: &str, all_ids: &[String]) -> String {
    let strip = |s: &str| s.strip_prefix(PREFIX).unwrap_or(s).to_string();
    let display: Vec<char> = strip(id).chars().collect();
    let others: Vec<String> = all_ids.iter().map(|i| strip(i)).collect();
    let me: String = display.iter().collect();
    let mut len = 5;
    while len < display.len() {
        let prefix: String = display[..len].iter().collect::<String>().to_lowercase();
        let conflict = others
            .iter()
            .any(|o| *o != me && o.to_lowercase().starts_with(&prefix));
        if !conflict {
            return display[..(len + 1).min(display.len())].iter().collect();
        }
        len += 1;
    }
    me
}

/// Id as displayed: [`short_id`] for minted ids, ids from elsewhere in full.
pub fn display_id(id: &str, all_ids: &[String]) -> String {
    if id.starts_with(PREFIX) {
        short_id(id, all_ids)
    } else {
        id.to_string()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn fingerprint_ignores_the_eol_style_but_not_lf_vectors() {
        let lf = "<!--\n@agent q\n@me a\n-->";
        assert_eq!(fingerprint(&lf.replace('\n', "\r\n")), fingerprint(lf));
        assert_eq!(fingerprint(&lf.replace('\n', "\r")), fingerprint(lf));
        // Historical TS value of an LF block (rawHash in the session fixtures).
        assert_eq!(fingerprint("{>> b <<}"), "e93dfc190eba893f");
    }

    use super::*;
    use crate::scan::collect_annotations;

    #[test]
    fn short_ids_extend_until_unique() {
        let all = vec![
            "rvw_abcdeXY".to_string(),
            "rvw_abcdeZW".to_string(),
            "rvw_zzzzzzz".to_string(),
        ];
        assert_eq!(short_id(&all[0], &all), "abcdeXY");
        assert_eq!(short_id(&all[2], &all), "zzzzzz");
    }

    #[test]
    fn display_ids_shorten_only_minted_ids() {
        let all = vec!["rvw_abcdeXY".to_string(), "custom".to_string()];
        assert_eq!(display_id(&all[0], &all), short_id(&all[0], &all));
        assert_eq!(display_id("custom", &all), "custom");
    }

    #[test]
    fn ref_prefixes_do_not_change_text_anchored_ids_nor_fingerprints() {
        let doc = |ts: &str| format!("x {{>> see <!-- ref%{ts}: a.md:1 --> <<}}\n");
        let (compact, iso) = (doc("1VB66I0Y"), doc("2026-01-01T01:00:00+01:00"));
        assert_eq!(
            assign_stable_ids("doc.md", &collect_annotations(&compact)),
            assign_stable_ids("doc.md", &collect_annotations(&iso))
        );
        assert_eq!(
            fingerprint(&collect_annotations(&compact)[0].raw),
            fingerprint(&collect_annotations(&iso)[0].raw)
        );
    }

    #[test]
    fn duplicates_get_occurrence_suffix() {
        let items = collect_annotations("{>> a <<} {>> a <<}");
        let ids = assign_stable_ids("d.md", &items);
        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn ids_match_ts() {
        let text = "intro @me hi\n<!-- @agent%1VB66I0Y question\n@me answer -->\n{++%1VB66I0Y|add++} {>> note <<} {?? plain ??} {~~a~>b~~}\n";
        let items = collect_annotations(text);
        assert_eq!(
            assign_stable_ids("doc.md", &items),
            [
                "rvw_BvdxQ04WLz7",
                "rvw_3EuaiDCHDmU",
                "rvw_CGccweYElFj",
                "rvw_LG6BK88trzG",
                "rvw_EjacHmOUF4g"
            ]
        );
    }
}
