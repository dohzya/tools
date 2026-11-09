//! wasm-bindgen facade over critique-core for the VS Code extension; positions are converted to UTF-16 only here.
//!
//! The facade exchanges JSON strings so the JS side needs no generated
//! classes. Ids come from `critique-core`, the same code the CLI runs, so
//! the extension and `critique` always agree.

use serde::Serialize;
use wasm_bindgen::prelude::*;

/// An item as the extension needs it. Offsets are UTF-16 code units, the unit
/// of JS strings and VS Code positions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedItem {
    /// Stable id (content derived).
    pub id: String,
    /// Kind name.
    pub kind: String,
    /// Conversation state, or `annotation` / `discussion`.
    pub state: String,
    /// UTF-16 offset of the first unit.
    pub start: usize,
    /// UTF-16 offset after the last unit.
    pub end: usize,
    /// First line (1-based).
    pub line_start: usize,
    /// Last line (1-based).
    pub line_end: usize,
    /// `%timestamp` value of the annotation metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// Scans `text` (as the file `file`) and returns the items as JSON.
pub fn scan_json(file: &str, text: &str) -> String {
    let items = critique_core::review::collect_review_items(
        text,
        false,
        critique_core::review::Filter::All,
    );
    let anns: Vec<_> = items.iter().map(|i| i.ann.clone()).collect();
    let ids = critique_core::ids::assign_stable_ids(file, &anns);
    let scanned: Vec<ScannedItem> = items
        .iter()
        .zip(ids)
        .map(|(item, id)| {
            let agent = critique_core::agent::to_agent_item(file, &id, item);
            ScannedItem {
                id,
                kind: agent.kind,
                state: agent.state,
                start: utf16(text, item.ann.start),
                end: utf16(text, item.ann.end),
                line_start: item.ann.line_start,
                line_end: item.ann.line_end,
                timestamp: item.ann.timestamp.clone(),
            }
        })
        .collect();
    serde_json::to_string(&scanned).unwrap_or_else(|_| "[]".into())
}

fn utf16(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

/// JS entry point of [`scan_json`].
#[wasm_bindgen(js_name = scanReviewItems)]
pub fn scan_review_items(file: &str, text: &str) -> String {
    scan_json(file, text)
}

/// Persistent ids of the items of `text` given the current `reference-map.json`
/// content (`""` for none). Returns `{ ids, map }` where `map` is the new file
/// content to write, or `null` when nothing changed.
pub fn persistent_ids_json(file: &str, text: &str, map_json: &str) -> Result<String, String> {
    let map = if map_json.trim().is_empty() {
        critique_core::refmap::ReferenceMap::default()
    } else {
        critique_core::refmap::ReferenceMap::parse(map_json)?
    };
    let items = critique_core::review::collect_review_items(
        text,
        false,
        critique_core::review::Filter::All,
    );
    let anns: Vec<_> = items.iter().map(|i| i.ann.clone()).collect();
    let assigned = critique_core::refmap::assign_persistent_ids(file, text, &anns, &map);
    let out = serde_json::json!({"ids": assigned.ids, "map": assigned.write.map(|m| m.to_json())});
    Ok(out.to_string())
}

/// JS entry point of [`persistent_ids_json`].
#[wasm_bindgen(js_name = assignPersistentIds)]
pub fn assign_persistent_ids(file: &str, text: &str, map_json: &str) -> Result<String, JsError> {
    persistent_ids_json(file, text, map_json).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "intro @me hi\n<!-- @agent%1VB66I0Y question\n@me answer -->\n{++%1VB66I0Y|add++} {>> note <<} {?? plain ??} {~~a~>b~~}\n";

    fn parse(json: &str) -> Vec<serde_json::Value> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn ids_match_the_historical_ts_values() {
        let items = parse(&scan_json("doc.md", TEXT));
        let ids: Vec<&str> = items.iter().map(|i| i["id"].as_str().unwrap()).collect();
        assert_eq!(
            ids,
            [
                "rvw_BvdxQ04WLz7",
                "rvw_3EuaiDCHDmU",
                "rvw_CGccweYElFj",
                "rvw_LG6BK88trzG",
                "rvw_EjacHmOUF4g"
            ]
        );
    }

    #[test]
    fn ids_equal_the_core_ids_used_by_the_cli() {
        let text = "😀 {>> é <<} and {?? @me 🎉 ??}";
        let items = parse(&scan_json("a/b.md", text));
        let core = critique_core::ids::assign_stable_ids(
            "a/b.md",
            &critique_core::scan::collect_annotations(text),
        );
        let ids: Vec<String> = items
            .iter()
            .map(|i| i["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids, core);
    }

    #[test]
    fn offsets_are_utf16_units() {
        let text = "😀 {>> é <<}";
        let items = parse(&scan_json("a.md", text));
        let (start, end) = (
            items[0]["start"].as_u64().unwrap() as usize,
            items[0]["end"].as_u64().unwrap() as usize,
        );
        let units: Vec<u16> = text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[start..end]).unwrap(), "{>> é <<}");
        assert_eq!(start, 3, "the emoji is two UTF-16 units");
    }

    #[test]
    fn persistent_ids_round_trip_through_the_map_text() {
        let first = parse_one(&persistent_ids_json("doc.md", TEXT, "").unwrap());
        let map = first["map"].as_str().unwrap().to_string();
        let again = parse_one(&persistent_ids_json("doc.md", TEXT, &map).unwrap());
        assert_eq!(again["ids"], first["ids"]);
        assert!(again["map"].is_null());
    }

    #[test]
    fn persistent_ids_follow_the_ranked_pass_two_like_the_cli() {
        // Same scenario as the black-box case `drift/pass-two-closest-stored-reference`.
        let map = r#"{"version":1,"entries":{
"rvw_coarse":{"file":"doc.md","range":{"startLine":100,"endLine":100},"mrfi":"~{v0;r=1:1-3:15;p=h1[1];fh=xxh64:AjAXQ728;hh=smh64:523f49688a480c0b;ctx=suf:rzWtdMwJ;doc=smh64:523f49688a480c0b}"},
"rvw_own":{"file":"doc.md","range":{"startLine":100,"endLine":100},"mrfi":"~{v0;r=3:1-3:15;p=h1[1]/p[1];fh=xxh64:FhAKPVpE;hh=smh64:523f49688a480c0b;ctx=pre:XwovWhJk,suf:rzWtdMwJ;doc=smh64:523f49688a480c0b}"}}}"#;
        let got =
            parse_one(&persistent_ids_json("doc.md", "# T\n\nonly {>> b <<}\n", map).unwrap());
        assert_eq!(got["ids"], serde_json::json!(["rvw_own"]));
    }

    #[test]
    fn lone_cr_is_a_line_end_with_the_same_ids_as_lf() {
        let lf = parse(&scan_json("d.md", "a\nb\n{?? @me x ??}\n"));
        let cr = parse(&scan_json("d.md", "a\rb\r{?? @me x ??}\r"));
        assert_eq!(cr[0]["lineStart"], 3);
        assert_eq!(cr[0]["id"], lf[0]["id"]);
    }

    fn parse_one(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }
}
