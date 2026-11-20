//! The emitter must equal `@std/yaml` 1.1.0 `stringify(.., { lineWidth: -1 })`.
//! `yaml_golden.json` was produced by the Deno implementation over awkward
//! strings (reserved words, numbers, dates, unicode, multi-line).

use serde_json::Value as Json;
use worklog_core::yaml::{Value, dump};

fn one(k: &str, v: Value) -> String {
    dump(&Value::Map(vec![(k.to_string(), v)]))
}

#[test]
fn scalars_lists_and_keys_match_std_yaml() {
    let golden: Vec<Json> = serde_json::from_str(include_str!("yaml_golden.json")).unwrap();
    let mut checked = 0;
    for g in &golden {
        let input = g["input"].as_str().unwrap();
        if input == "__fm__" {
            continue;
        }
        let s = Value::str(input);
        assert_eq!(
            one("k", s.clone()),
            g["map"].as_str().unwrap(),
            "value {input:?}"
        );
        assert_eq!(
            one("k", Value::Seq(vec![s.clone(), Value::str("z")])),
            g["list"].as_str().unwrap(),
            "list item {input:?}"
        );
        assert_eq!(
            one(input, Value::Int(1)),
            g["key"].as_str().unwrap(),
            "key {input:?}"
        );
        checked += 1;
    }
    assert!(checked > 100);
}

#[test]
fn a_whole_frontmatter_matches_std_yaml() {
    let golden: Vec<Json> = serde_json::from_str(include_str!("yaml_golden.json")).unwrap();
    let fm = golden.iter().find(|g| g["input"] == "__fm__").unwrap();
    let s = |x: &str| Value::str(x);
    let v = Value::Map(vec![
        ("id".into(), s("abc")),
        ("uid".into(), s("u")),
        ("name".into(), s("N: x")),
        ("desc".into(), Value::Seq(vec![s("a"), s("b\nc")])),
        ("status".into(), s("done")),
        ("created_at".into(), s("2020-01-01T00:00:00+01:00")),
        ("ready_at".into(), Value::Null),
        ("flag".into(), Value::Bool(true)),
        ("count".into(), Value::Int(3)),
        ("ratio".into(), Value::Float(1.5)),
        (
            "metadata".into(),
            Value::Map(vec![("a".into(), s("b")), ("c d".into(), s("e: f"))]),
        ),
        ("tags".into(), Value::Seq(vec![s("x"), s("y/z")])),
        (
            "links".into(),
            Value::Seq(vec![Value::Map(vec![
                ("type".into(), s("related")),
                ("task".into(), s("t1")),
            ])]),
        ),
        ("empty".into(), Value::Seq(vec![])),
        ("emptyMap".into(), Value::Map(vec![])),
    ]);
    assert_eq!(dump(&v), fm["map"].as_str().unwrap());
}
