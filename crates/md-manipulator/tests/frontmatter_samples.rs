//! Lossless-edit round trip over the 42 frontmatter samples of the YAML-EDIT
//! spike (real frontmatters of this repository plus hand-made hard cases):
//! after an edit of key K, a textual diff may only touch K's own lines.

use md_manipulator::{Document, EditMethod, Error, Value};
use std::fs;
use std::path::Path;

/// (sample, edit) pairs where the library refuses to edit rather than risk the
/// data: a path inside an anchored mapping that other nodes alias.
const REFUSED: &[(&str, &str)] = &[("hard05_anchors", "nested")];

/// Deleting an anchored node moves the anchor to its first alias (that is what
/// keeps the document valid), so a second entry legitimately changes.
const ANCHOR_MOVES: &[(&str, &str)] = &[("hard05_anchors", "del")];

/// Samples that are not valid YAML for our rules; an edit must refuse them.
const INVALID: &[&str] = &["hard12_duplicate_keys", "hard13_invalid", "real15"];

fn samples() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/frontmatter-samples");
    let mut out: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .map(|p| {
            (
                p.file_stem().unwrap().to_string_lossy().into_owned(),
                fs::read_to_string(&p).unwrap(),
            )
        })
        .collect();
    out.sort();
    out
}

/// A sample as a document: a frontmatter body always ends with a line ending.
fn document(sample: &str) -> String {
    let eol = if sample.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut body = sample.to_owned();
    if !body.is_empty() && !body.ends_with('\n') {
        body.push_str(eol);
    }
    format!("---{eol}{body}---{eol}{eol}# Body{eol}")
}

/// The intended data, computed independently of the library (paths here have
/// one or two segments).
fn apply(data: &mut Value, path: &str, value: Option<Value>) {
    let Value::Map(entries) = data else { panic!() };
    let (head, tail) = path
        .split_once('.')
        .map_or((path, None), |(h, t)| (h, Some(t)));
    if let Some(tail) = tail {
        let child = &mut entries.iter_mut().find(|(k, _)| k == head).unwrap().1;
        apply(child, tail, value);
        return;
    }
    match (entries.iter().position(|(k, _)| k == head), value) {
        (Some(i), Some(v)) => entries[i].1 = v,
        (None, Some(v)) => entries.push((head.to_owned(), v)),
        (Some(i), None) => {
            entries.remove(i);
        }
        (None, None) => panic!(),
    }
}

fn fm_lines(text: &str) -> Vec<String> {
    let doc = Document::parse(text);
    let raw = doc.frontmatter_raw().unwrap_or_default();
    if raw.is_empty() {
        return vec![];
    }
    raw.split('\n')
        .map(|l| l.trim_end_matches('\r').to_owned())
        .collect()
}

/// Lines `[start, end)` of the top-level entry of `key` in `lines`.
fn entry(lines: &[String], key: &str) -> (usize, usize) {
    let is_key_line = |l: &str| !l.is_empty() && !l.starts_with([' ', '\t', '#', '-']);
    let start = lines
        .iter()
        .position(|l| {
            l.starts_with(&format!("{key}:"))
                || l.starts_with(&format!("\"{key}\":"))
                || l.starts_with(&format!("'{key}':"))
        })
        .unwrap_or_else(|| panic!("key {key} not found on a line of its own"));
    let end = (start + 1..lines.len())
        .find(|&i| is_key_line(&lines[i]))
        .unwrap_or(lines.len());
    (start, end)
}

/// Asserts that old -> new only changed lines inside `allowed` (a range of
/// old lines; `None` = nothing may be removed).
fn assert_only_touches(
    sample: &str,
    edit: &str,
    old: &[String],
    new: &[String],
    allowed: Option<(usize, usize)>,
) {
    let prefix = old.iter().zip(new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let removed = prefix..old.len() - suffix;
    match allowed {
        None => assert!(
            removed.is_empty(),
            "{sample} {edit}: lines {removed:?} of the old frontmatter changed"
        ),
        Some((s, e)) => assert!(
            removed.is_empty() || (removed.start >= s && removed.end <= e),
            "{sample} {edit}: changed old lines {removed:?} outside the entry {s}..{e}"
        ),
    }
}

#[test]
fn edits_touch_only_the_lines_of_their_key() {
    let (mut lossless, mut textual, mut removed, mut refused, mut edits) = (0, 0, 0, 0, 0);
    let mut failures = vec![];
    for (name, sample) in samples() {
        let text = document(&sample);
        let doc = Document::parse(&text);
        if INVALID.contains(&name.as_str()) {
            let e = doc
                .meta_set("zz_added", Value::Str("x".into()))
                .unwrap_err();
            assert!(matches!(e, Error::FrontmatterParse(_)), "{name}: {e:?}");
            refused += 1;
            continue;
        }
        let Value::Map(entries) = doc.meta().unwrap() else {
            panic!("{name}: not a mapping");
        };
        let old = fm_lines(&text);
        let mut attempts: Vec<(&str, String, Option<Value>)> = vec![];
        if let Some((k, _)) = entries.iter().find(|(_, v)| matches!(v, Value::Str(_))) {
            attempts.push(("set", k.clone(), Some(Value::Str("changed value".into()))));
        }
        attempts.push(("add", "zz_added".into(), Some(Value::Str("added".into()))));
        if let Some((k, _)) = entries.first() {
            attempts.push(("del", k.clone(), None));
        }
        if let Some((k, Value::Map(child))) = entries
            .iter()
            .find(|(_, v)| matches!(v, Value::Map(m) if !m.is_empty()))
        {
            attempts.push((
                "nested",
                format!("{k}.{}", child[0].0),
                Some(Value::Str("changed".into())),
            ));
        }
        for (kind, path, value) in attempts {
            edits += 1;
            let result = match &value {
                Some(v) => doc.meta_set(&path, v.clone()),
                None => doc.meta_delete(&path),
            };
            let edit = match result {
                Ok(e) => e,
                Err(_) if REFUSED.contains(&(name.as_str(), kind)) => continue,
                Err(e) => {
                    failures.push(format!("{name} {kind} {path}: {e}"));
                    continue;
                }
            };
            match edit.method {
                EditMethod::Lossless => lossless += 1,
                EditMethod::Textual => textual += 1,
                EditMethod::Removed => removed += 1,
                EditMethod::Created => {}
            }
            // 1. reads back as intended
            let after = Document::parse(&edit.text);
            let mut want = doc.meta().unwrap();
            apply(&mut want, &path, value.clone());
            if after.meta().ok() != Some(want) && edit.method != EditMethod::Removed {
                failures.push(format!("{name} {kind} {path}: data differs"));
            }
            // 2. the body is untouched
            if !edit.text.ends_with("# Body\n") && !edit.text.ends_with("# Body\r\n") {
                failures.push(format!("{name} {kind}: body changed"));
            }
            // 3. only the key's lines changed
            if edit.method == EditMethod::Removed || ANCHOR_MOVES.contains(&(name.as_str(), kind)) {
                continue;
            }
            let new = fm_lines(&edit.text);
            let top = path.split('.').next().unwrap();
            let allowed = if kind == "add" {
                None
            } else {
                Some(entry(&old, top))
            };
            let r =
                std::panic::catch_unwind(|| assert_only_touches(&name, kind, &old, &new, allowed));
            if let Err(e) = r {
                failures.push(e.downcast_ref::<String>().cloned().unwrap_or_default());
            }
        }
    }
    eprintln!(
        "samples: {edits} edits, {lossless} lossless, {textual} textual fallback, {removed} block removed, {refused} invalid samples refused"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
