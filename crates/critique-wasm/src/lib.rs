//! wasm-bindgen facade over critique-core for the VS Code extension; positions are converted to UTF-16 only here.
//!
//! The facade exchanges JSON strings so the JS side needs no generated
//! classes. Ids come from `critique-core`, the same code the CLI runs, so
//! the extension and `critique` always agree.

use critique_core::agent::{self, AgentMessage};
use critique_core::refmap::{self, ReferenceMap};
use critique_core::review::{self, Filter, SummaryOptions, SummarySource};
use critique_core::scan::{self, Kind};
use critique_core::state;
use critique_core::timestamp::{self, Format, ReviewTimestamp};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// An item as the extension needs it. Offsets are UTF-16 code units, the unit
/// of JS strings and VS Code positions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// Persistent id.
    pub id: String,
    /// Id as the CLI displays it, unique among the ids of the project (the
    /// reference map, every file, and the ids of this file).
    pub short_id: String,
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
    /// One-line summary, rendered with the caller's options.
    pub summary: String,
    /// `%timestamp` value of the annotation metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Messages, for conversations only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages: Option<Vec<AgentMessage>>,
}

#[derive(Serialize)]
struct Items {
    items: Vec<Item>,
    map: Option<String>,
}

/// Items of `text` (as the file `file`) with persistent ids, given the current
/// `reference-map.json` content (`None` or blank for none). Returns
/// `{ items, map }` where `map` is the new file content to write, or `null`
/// when nothing changed. Summaries show `summary_source` (`display` or
/// `payload`, see [`SummarySource`]) cut at `summary_width` UTF-16 units.
///
/// Ids are assigned over every item, before any filtering, like `critique
/// list`, `session start` and the `agent` commands: an id must not depend on
/// what the caller shows.
pub fn review_items_json(
    file: &str,
    text: &str,
    map_json: Option<&str>,
    summary_source: &str,
    summary_width: usize,
) -> Result<String, String> {
    let summary = SummaryOptions {
        source: match summary_source {
            "display" => SummarySource::Display,
            "payload" => SummarySource::Payload,
            other => return Err(format!("unknown summary source: {other}")),
        },
        width: summary_width,
    };
    let map = match map_json.filter(|m| !m.trim().is_empty()) {
        Some(json) => ReferenceMap::parse(json)?,
        None => ReferenceMap::default(),
    };
    let collected = review::collect_review_items(text, false, Filter::All);
    let anns: Vec<_> = collected.iter().map(|i| i.ann.clone()).collect();
    let assigned = refmap::assign_persistent_ids(file, text, &anns, &map);
    let short_ids = refmap::display_ids(assigned.write.as_ref().unwrap_or(&map), &assigned.ids);
    let items = collected
        .iter()
        .zip(&assigned.ids)
        .zip(short_ids)
        .map(|((item, id), short_id)| {
            let view = agent::to_agent_item(file, id, item, &summary);
            let messages = (item.ann.kind == Kind::Conversation).then(|| {
                review::messages(&item.ann.raw)
                    .into_iter()
                    .map(agent::message)
                    .collect()
            });
            Item {
                id: id.clone(),
                short_id,
                kind: view.kind,
                state: view.state,
                start: utf16(text, item.ann.start),
                end: utf16(text, item.ann.end),
                line_start: item.ann.line_start,
                line_end: item.ann.line_end,
                summary: view.context,
                timestamp: item.ann.timestamp.clone(),
                messages,
            }
        })
        .collect();
    let out = Items {
        items,
        map: assigned.write.map(|m| m.to_json()),
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

fn utf16(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

/// JS entry point of [`review_items_json`].
#[wasm_bindgen(js_name = reviewItems)]
pub fn review_items(
    file: &str,
    text: &str,
    map_json: Option<String>,
    summary_source: &str,
    summary_width: usize,
) -> Result<String, JsError> {
    review_items_json(
        file,
        text,
        map_json.as_deref(),
        summary_source,
        summary_width,
    )
    .map_err(|e| JsError::new(&e))
}

/// State directory: the first non-blank `configured` value by priority, else
/// `.critique` under `base` (the Git root, else the cwd), as the CLI does.
/// Blank stands for unset (no optional strings in a JS array).
#[wasm_bindgen(js_name = stateDir)]
pub fn state_dir(base: Option<String>, configured: Vec<String>) -> String {
    let configured: Vec<_> = configured.iter().map(|v| Some(v.as_str())).collect();
    state::locate(state::STATE_DIR, &configured, base.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Timestamp {
    unix_seconds: u64,
    offset_minutes: i32,
}

/// `{ unixSeconds, offsetMinutes }` of a review timestamp in any of the three
/// formats (optional leading `%`), as JSON; `undefined` when unreadable.
#[wasm_bindgen(js_name = parseTimestamp)]
pub fn parse_timestamp(value: &str) -> Option<String> {
    let t = timestamp::parse_review_timestamp(value)?;
    serde_json::to_string(&Timestamp {
        unix_seconds: t.unix_seconds,
        offset_minutes: t.offset_minutes,
    })
    .ok()
}

fn format(name: &str) -> Result<Format, String> {
    match name {
        "compact" => Ok(Format::Compact),
        "hangul" => Ok(Format::Hangul),
        "iso" => Ok(Format::Iso),
        other => Err(format!("unknown timestamp format: {other}")),
    }
}

/// The instant `unix_seconds` (offset `offset_minutes`) rendered in `format`
/// (`compact`, `hangul` or `iso`).
///
/// Seconds come as a JS number rather than a `u64`, which wasm-bindgen maps
/// to a `BigInt`; anything but a safe non-negative integer is an error.
pub fn encode_timestamp_value(
    unix_seconds: f64,
    offset_minutes: i32,
    format_name: &str,
) -> Result<String, String> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if !(0.0..=MAX_SAFE_INTEGER).contains(&unix_seconds) || unix_seconds.fract() != 0.0 {
        return Err(format!(
            "unixSeconds is not a valid instant: {unix_seconds}"
        ));
    }
    // Exact: checked above to be an integer in 0..=2^53-1.
    let unix_seconds = unix_seconds as u64;
    timestamp::encode(
        ReviewTimestamp {
            unix_seconds,
            offset_minutes,
        },
        format(format_name)?,
    )
    .map_err(|e| e.0)
}

/// JS entry point of [`encode_timestamp_value`].
#[wasm_bindgen(js_name = encodeTimestamp)]
pub fn encode_timestamp(
    unix_seconds: f64,
    offset_minutes: i32,
    format_name: &str,
) -> Result<String, JsError> {
    encode_timestamp_value(unix_seconds, offset_minutes, format_name).map_err(|e| JsError::new(&e))
}

/// `text` with its existing review timestamps rewritten in `format`, nothing
/// stamped (see [`scan::convert_timestamps`]).
pub fn convert_timestamps_text(text: &str, format_name: &str) -> Result<String, String> {
    scan::convert_timestamps(text, format(format_name)?).map(|(_, out)| out)
}

/// JS entry point of [`convert_timestamps_text`].
#[wasm_bindgen(js_name = convertTimestamps)]
pub fn convert_timestamps(text: &str, format_name: &str) -> Result<String, JsError> {
    convert_timestamps_text(text, format_name).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use critique_core::refmap::{Entry, LineRange, ReferenceMap, assign_persistent_ids};
    use critique_core::scan::collect_annotations;

    const TEXT: &str = "intro @me hi\n<!-- @agent%1VB66I0Y question\n@me answer -->\n{++%1VB66I0Y|add++} {>> note <<} {?? plain ??} {~~a~>b~~}\n";

    fn parse(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    fn ids(out: &serde_json::Value) -> Vec<String> {
        out["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn ids_without_a_map_are_the_historical_ts_values() {
        let out = parse(&review_items_json("doc.md", TEXT, None, "payload", 80).unwrap());
        assert_eq!(
            ids(&out),
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
    fn ids_and_map_equal_the_core_assignment_used_by_the_cli() {
        let text = "😀 {>> é <<} and {?? @me 🎉 ??}\n{>> é <<}";
        let core = assign_persistent_ids(
            "a/b.md",
            text,
            &collect_annotations(text),
            &ReferenceMap::default(),
        );
        let out = parse(&review_items_json("a/b.md", text, None, "payload", 80).unwrap());
        assert_eq!(ids(&out), core.ids);
        assert_eq!(
            out["map"].as_str(),
            core.write.map(|m| m.to_json()).as_deref()
        );
    }

    /// `map` plus an id of `other.md` sharing the 6 first characters of `id`.
    fn with_lookalike(map: ReferenceMap, id: &str) -> String {
        let mut map = map;
        let lookalike = format!("{}zzzzzz", &id[..critique_core::ids::PREFIX.len() + 6]);
        let entry = Entry {
            file: "other.md".into(),
            range: LineRange {
                start_line: 1,
                end_line: 1,
            },
            mrfi: String::new(),
        };
        map.entries.0.push((lookalike, entry));
        map.to_json()
    }

    #[test]
    fn short_ids_are_unique_across_the_files_of_the_map() {
        let alone = parse(&review_items_json("doc.md", TEXT, None, "payload", 80).unwrap());
        let id = alone["items"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(alone["items"][0]["shortId"].as_str().unwrap().len(), 6);
        let written = ReferenceMap::parse(alone["map"].as_str().unwrap()).unwrap();
        // First call (the map gets this file's entries) and later calls (map
        // unchanged): the lookalike of another file lengthens the short id.
        for map in [ReferenceMap::default(), written] {
            let out = review_items_json(
                "doc.md",
                TEXT,
                Some(&with_lookalike(map, &id)),
                "payload",
                80,
            )
            .unwrap();
            let out = parse(&out);
            assert_eq!(out["items"][0]["id"], id.as_str());
            let short = out["items"][0]["shortId"].as_str().unwrap();
            assert!(short.len() > 6, "{short}");
            assert!(id[critique_core::ids::PREFIX.len()..].starts_with(short));
            assert_eq!(out["items"][1]["shortId"], alone["items"][1]["shortId"]);
        }
    }

    #[test]
    fn offsets_are_utf16_units() {
        let text = "😀 {>> é <<}";
        let out = parse(&review_items_json("a.md", text, None, "payload", 80).unwrap());
        let item = &out["items"][0];
        let (start, end) = (
            item["start"].as_u64().unwrap() as usize,
            item["end"].as_u64().unwrap() as usize,
        );
        let units: Vec<u16> = text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[start..end]).unwrap(), "{>> é <<}");
        assert_eq!(start, 3, "the emoji is two UTF-16 units");
    }

    #[test]
    fn items_carry_kind_state_lines_timestamp_and_messages() {
        let out = parse(&review_items_json("doc.md", TEXT, None, "payload", 80).unwrap());
        let conversation = &out["items"][0];
        assert_eq!(conversation["kind"], "conversation");
        assert_eq!(conversation["state"], "handled");
        assert_eq!(conversation["lineStart"], 2);
        assert_eq!(conversation["lineEnd"], 3);
        assert_eq!(conversation["messages"][0]["author"], "@agent");
        assert_eq!(conversation["messages"][0]["timestamp"], "1VB66I0Y");
        assert_eq!(conversation["messages"][1]["body"], "answer");
        let addition = &out["items"][1];
        assert_eq!(addition["kind"], "addition");
        assert_eq!(addition["state"], "annotation");
        assert_eq!(addition["timestamp"], "1VB66I0Y");
        assert!(addition.get("messages").is_none());
    }

    #[test]
    fn map_is_null_once_written_back() {
        let first = parse(&review_items_json("doc.md", TEXT, None, "payload", 80).unwrap());
        let map = first["map"].as_str().unwrap().to_string();
        let again = parse(&review_items_json("doc.md", TEXT, Some(&map), "payload", 80).unwrap());
        assert_eq!(ids(&again), ids(&first));
        assert!(again["map"].is_null());
    }

    #[test]
    fn a_blank_map_is_no_map() {
        assert_eq!(
            review_items_json("doc.md", TEXT, Some("  "), "payload", 80),
            review_items_json("doc.md", TEXT, None, "payload", 80)
        );
    }

    #[test]
    fn persistent_ids_follow_the_ranked_pass_two_like_the_cli() {
        // Same scenario as the black-box case `drift/pass-two-closest-stored-reference`.
        let map = r#"{"version":1,"entries":{
"rvw_coarse":{"file":"doc.md","range":{"startLine":100,"endLine":100},"mrfi":"~{v0;r=1:1-3:15;p=h1[1];fh=xxh64:AjAXQ728;hh=smh64:523f49688a480c0b;ctx=suf:rzWtdMwJ;doc=smh64:523f49688a480c0b}"},
"rvw_own":{"file":"doc.md","range":{"startLine":100,"endLine":100},"mrfi":"~{v0;r=3:1-3:15;p=h1[1]/p[1];fh=xxh64:FhAKPVpE;hh=smh64:523f49688a480c0b;ctx=pre:XwovWhJk,suf:rzWtdMwJ;doc=smh64:523f49688a480c0b}"}}}"#;
        let out = parse(
            &review_items_json(
                "doc.md",
                "# T\n\nonly {>> b <<}\n",
                Some(map),
                "payload",
                80,
            )
            .unwrap(),
        );
        assert_eq!(ids(&out), ["rvw_own"]);
        assert_eq!(out["items"][0]["shortId"], "own");
    }

    #[test]
    fn crlf_and_lone_cr_give_the_lf_lines_and_ids() {
        let lf = parse(
            &review_items_json("d.md", "a\nb\n{?? @me x ??}\n", None, "payload", 80).unwrap(),
        );
        for eol in ["\r\n", "\r"] {
            let text = format!("a{eol}b{eol}{{?? @me x ??}}{eol}");
            let out = parse(&review_items_json("d.md", &text, None, "payload", 80).unwrap());
            assert_eq!(out["items"][0]["lineStart"], 3);
            assert_eq!(out["items"][0]["id"], lf["items"][0]["id"]);
            let start = out["items"][0]["start"].as_u64().unwrap() as usize;
            assert_eq!(start, 2 + 2 * eol.len());
        }
    }

    #[test]
    fn summaries_follow_the_given_options() {
        let summaries = |source, width| {
            let out = parse(&review_items_json("doc.md", TEXT, None, source, width).unwrap());
            out["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|i| i["summary"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            summaries("payload", 80),
            [
                "@agent%1VB66I0Y question @me answer",
                "add",
                "note",
                "plain",
                "a -> b"
            ]
        );
        assert_eq!(summaries("display", 10)[1], "{++%202...");
    }

    #[test]
    fn an_unknown_summary_source_is_an_error() {
        assert!(review_items_json("doc.md", TEXT, None, "raw", 80).is_err());
    }

    #[test]
    fn ids_already_in_the_map_are_kept() {
        // Earlier extension builds minted plain `{?? ??}` ids as conversations,
        // so they differ from what the core mints today.
        let first = parse(&review_items_json("doc.md", TEXT, None, "payload", 80).unwrap());
        let minted = first["items"][3]["id"].as_str().unwrap();
        let map = first["map"]
            .as_str()
            .unwrap()
            .replace(minted, "rvw_fromOldPanel");
        let out = parse(&review_items_json("doc.md", TEXT, Some(&map), "payload", 80).unwrap());
        assert_eq!(out["items"][3]["kind"], "discussion");
        assert_eq!(out["items"][3]["id"], "rvw_fromOldPanel");
        assert!(out["map"].is_null());
    }

    #[test]
    fn an_invalid_map_is_an_error() {
        assert!(review_items_json("doc.md", TEXT, Some("{not json"), "payload", 80).is_err());
    }

    #[test]
    fn state_dir_is_the_first_non_blank_configured_value_else_the_default() {
        let dir = |configured: &[&str]| {
            let configured = configured.iter().map(ToString::to_string).collect();
            state_dir(Some("/repo".to_string()), configured)
        };
        assert_eq!(dir(&[]), "/repo/.critique");
        assert_eq!(dir(&["", " "]), "/repo/.critique");
        assert_eq!(dir(&["", "env/", "x"]), "env/");
        assert_eq!(state_dir(None, Vec::new()), ".critique");
    }

    const T: f64 = 1_767_225_600.0; // 2026-01-01T00:00:00Z

    #[test]
    fn timestamps_parse_from_any_format_with_an_optional_percent() {
        let expected = Some(r#"{"unixSeconds":1767225600,"offsetMinutes":60}"#.to_string());
        for value in [
            "1VB66I0Y",
            "%갚뚭씀갼",
            "2026-01-01T01:00:00+01:00",
            "%2026-01-01T01:00:00+0100",
        ] {
            assert_eq!(parse_timestamp(value), expected, "{value}");
        }
        assert_eq!(parse_timestamp("nope"), None);
        assert_eq!(parse_timestamp("2026-02-30T00:00:00Z"), None);
    }

    #[test]
    fn timestamps_encode_in_each_format() {
        let encode = |format| encode_timestamp_value(T, 60, format);
        assert_eq!(encode("compact").unwrap(), "1VB66I0Y");
        assert_eq!(encode("hangul").unwrap(), "갚뚭씀갼");
        assert_eq!(encode("iso").unwrap(), "2026-01-01T01:00:00+01:00");
        assert!(encode("none").is_err());
    }

    #[test]
    fn timestamps_reject_seconds_that_are_not_a_valid_instant() {
        for seconds in [-1.0, 0.5, f64::NAN, f64::INFINITY, 1e300] {
            assert!(
                encode_timestamp_value(seconds, 0, "iso").is_err(),
                "{seconds}"
            );
        }
        // Past the 6 base62 digits of the compact epoch.
        assert!(encode_timestamp_value(253_370_764_800.0, 0, "compact").is_err());
    }

    #[test]
    fn timestamp_conversion_is_the_core_one() {
        let text = "<!-- @agent%1VB66I0Y q\n@me a -->\n{++%갚뚭씀갼|x++} 50%discount\n";
        for format in ["compact", "hangul", "iso"] {
            let core_format = match format {
                "compact" => critique_core::timestamp::Format::Compact,
                "hangul" => critique_core::timestamp::Format::Hangul,
                _ => critique_core::timestamp::Format::Iso,
            };
            assert_eq!(
                convert_timestamps_text(text, format).unwrap(),
                critique_core::scan::convert_timestamps(text, core_format)
                    .unwrap()
                    .1
            );
        }
        assert_eq!(
            convert_timestamps_text(text, "iso").unwrap(),
            "<!-- @agent%2026-01-01T01:00:00+01:00 q\n@me a -->\n{++%2026-01-01T01:00:00+01:00|x++} 50%discount\n"
        );
        assert!(convert_timestamps_text(text, "none").is_err());
    }
}
