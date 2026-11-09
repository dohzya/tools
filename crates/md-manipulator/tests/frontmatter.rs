//! Frontmatter reading and lossless editing (spec decisions 8 and 10).

use md_manipulator::{Document, EditMethod, Error, Value};

fn s(v: &str) -> Value {
    Value::Str(v.to_owned())
}

fn map(pairs: &[(&str, Value)]) -> Value {
    Value::Map(
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect(),
    )
}

const RICH: &str = "---\n# a comment\ntitle: \"Quoted title\"\ncount: 3\nlist:\n  - a\n  - b\nnested:\n  k: v\n---\n\n# Body\n";

// --- detection and reading ------------------------------------------------

#[test]
fn raw_is_the_text_between_the_delimiters() {
    assert_eq!(
        Document::parse("---\na: 1\nb: 2\n---\n# T\n").frontmatter_raw(),
        Some("a: 1\nb: 2")
    );
    assert_eq!(
        Document::parse("---\na: 1\n...\n# T\n").frontmatter_raw(),
        Some("a: 1")
    );
    assert_eq!(
        Document::parse("---\n---\n# T\n").frontmatter_raw(),
        Some("")
    );
    // Not frontmatter: not on line 1, or never closed.
    assert_eq!(
        Document::parse("# T\n---\na: 1\n---\n").frontmatter_raw(),
        None
    );
    assert_eq!(Document::parse("---\na: 1\n# T\n").frontmatter_raw(), None);
}

#[test]
fn values_have_core_schema_types_and_keep_key_order() {
    let doc = Document::parse(
        "---\nz: 1\na: 2.5\nb: true\nc: ~\nd: 'x'\ne: yes\nf: |\n  l1\n  l2\ng:\nh: [1, two]\ni: {k: v}\n---\n",
    );
    let want = map(&[
        ("z", Value::Int(1)),
        ("a", Value::Float(2.5)),
        ("b", Value::Bool(true)),
        ("c", Value::Null),
        ("d", s("x")),
        ("e", s("yes")),
        ("f", s("l1\nl2\n")),
        ("g", Value::Null),
        ("h", Value::Seq(vec![Value::Int(1), s("two")])),
        ("i", map(&[("k", s("v"))])),
    ]);
    assert_eq!(doc.meta().unwrap(), want);
}

#[test]
fn dotted_paths_reach_into_mappings_and_sequences() {
    let doc = Document::parse(RICH);
    assert_eq!(doc.meta_get("title").unwrap(), Some(s("Quoted title")));
    assert_eq!(doc.meta_get("nested.k").unwrap(), Some(s("v")));
    assert_eq!(doc.meta_get("list.1").unwrap(), Some(s("b")));
    assert_eq!(doc.meta_get("list.9").unwrap(), None);
    assert_eq!(doc.meta_get("nothing").unwrap(), None);
    assert_eq!(Document::parse("# T\n").meta_get("a").unwrap(), None);
}

#[test]
fn crlf_frontmatter_reads_like_lf() {
    let doc = Document::parse("---\r\ntitle: crlf\r\n---\r\n\r\n# Body\r\n");
    assert_eq!(doc.meta_get("title").unwrap(), Some(s("crlf")));
}

#[test]
fn unparseable_frontmatter_is_a_typed_error_everywhere() {
    let text = "---\ntitle: [unclosed\n  bad: : yaml\n---\n\n# Body\n";
    let doc = Document::parse(text);
    for r in [
        doc.meta().map(|_| ()),
        doc.meta_get("title").map(|_| ()),
        doc.meta_set("a", s("b")).map(|_| ()),
        doc.meta_delete("title").map(|_| ()),
    ] {
        let e = r.unwrap_err();
        assert!(matches!(e, Error::FrontmatterParse(_)), "{e:?}");
        assert_eq!(e.code(), "parse_error");
    }
}

#[test]
fn duplicate_keys_are_refused_instead_of_guessed() {
    let doc = Document::parse("---\na: 1\na: 2\n---\n");
    assert!(matches!(
        doc.meta_set("b", s("x")),
        Err(Error::FrontmatterParse(_))
    ));
}

#[test]
fn cli_arguments_are_yaml_when_non_empty_else_literal_strings() {
    let cases = [
        ("42", Value::Int(42)),
        ("-3", Value::Int(-3)),
        ("true", Value::Bool(true)),
        ("1.5", Value::Float(1.5)),
        ("hello world", s("hello world")),
        ("[a, b]", Value::Seq(vec![s("a"), s("b")])),
        ("a: b", map(&[("a", s("b"))])),
        ("'quoted'", s("quoted")),
        // Kept as typed, because the TS code did: an empty or null result
        // means "not YAML".
        ("", s("")),
        ("null", s("null")),
        ("~", s("~")),
        ("[]", s("[]")),
        ("{}", s("{}")),
        ("# note", s("# note")),
        ("a: [b", s("a: [b")),
        ("2024-01-01", s("2024-01-01")),
    ];
    for (arg, want) in cases {
        assert_eq!(Value::from_cli_arg(arg), want, "{arg:?}");
    }
}

#[test]
fn display_and_json() {
    let v = map(&[("k", Value::Seq(vec![Value::Int(1), s("x y")]))]);
    assert_eq!(v.to_json(), r#"{"k":[1,"x y"]}"#);
    assert_eq!(v.to_display(), "k:\n  - 1\n  - x y");
    assert_eq!(Value::Null.to_display(), "");
    assert_eq!(s("a\"b\n").to_json(), r#""a\"b\n""#);
    assert_eq!(
        Value::Seq(vec![s("alpha"), s("beta")]).to_display(),
        "- alpha\n- beta"
    );
}

// --- lossless edits -------------------------------------------------------

#[test]
fn set_changes_only_the_touched_entry() {
    let doc = Document::parse(RICH);
    let edit = doc.meta_set("count", Value::Int(4)).unwrap();
    assert_eq!(edit.text, RICH.replace("count: 3", "count: 4"));
    assert_eq!(edit.method, EditMethod::Lossless);
}

#[test]
fn set_a_new_key_appends_it_after_the_others() {
    let doc = Document::parse(RICH);
    let edit = doc.meta_set("added", s("ok")).unwrap();
    assert_eq!(
        edit.text,
        RICH.replace("  k: v\n---", "  k: v\nadded: ok\n---")
    );
}

#[test]
fn set_keeps_the_trailing_comment_and_the_quoting_style_of_other_keys() {
    let text = "---\nname: x   # who\nq: 'single'\nn: 1\n---\n";
    let edit = Document::parse(text).meta_set("n", Value::Int(2)).unwrap();
    assert_eq!(edit.text, "---\nname: x   # who\nq: 'single'\nn: 2\n---\n");
    let edit = Document::parse(text).meta_set("name", s("y")).unwrap();
    assert_eq!(edit.text, "---\nname: y   # who\nq: 'single'\nn: 1\n---\n");
}

#[test]
fn strings_that_look_like_other_types_are_quoted() {
    let doc = Document::parse("---\na: 1\n---\n");
    let text = doc.meta_set("b", s("42")).unwrap().text;
    assert_eq!(Document::parse(&text).meta_get("b").unwrap(), Some(s("42")));
    let text = doc.meta_set("c", s("yes")).unwrap().text;
    assert_eq!(
        Document::parse(&text).meta_get("c").unwrap(),
        Some(s("yes"))
    );
}

#[test]
fn nested_paths_are_created_and_edited() {
    let doc = Document::parse(RICH);
    let text = doc.meta_set("nested.k", s("w")).unwrap().text;
    assert_eq!(text, RICH.replace("  k: v", "  k: w"));
    let text = doc.meta_set("nested.deep.er", Value::Int(1)).unwrap().text;
    let got = Document::parse(&text).meta_get("nested").unwrap().unwrap();
    assert_eq!(
        got,
        map(&[("k", s("v")), ("deep", map(&[("er", Value::Int(1))]))])
    );
    let text = doc.meta_set("list.0", s("A")).unwrap().text;
    assert_eq!(text, RICH.replace("  - a\n", "  - A\n"));
    // A scalar in the way is replaced, as before.
    let text = doc.meta_set("count.sub", Value::Int(1)).unwrap().text;
    assert_eq!(
        Document::parse(&text).meta_get("count").unwrap(),
        Some(map(&[("sub", Value::Int(1))]))
    );
}

#[test]
fn collections_can_be_set() {
    let doc = Document::parse("---\na: 1\n---\n");
    let v = Value::Seq(vec![s("x"), map(&[("y", Value::Int(1))])]);
    let text = doc.meta_set("c", v.clone()).unwrap().text;
    assert_eq!(Document::parse(&text).meta_get("c").unwrap(), Some(v));
    assert!(text.starts_with("---\na: 1\n"));
}

#[test]
fn set_that_cannot_work_is_an_error_and_never_a_rewrite() {
    let doc = Document::parse(RICH);
    let e = doc.meta_set("list.7", s("x")).unwrap_err();
    assert_eq!(e.code(), "parse_error");
    let doc = Document::parse("---\n- a\n- b\n---\n");
    assert!(doc.meta_set("k", s("v")).is_err());
}

#[test]
fn delete_removes_only_the_entry() {
    let doc = Document::parse(RICH);
    let edit = doc.meta_delete("count").unwrap();
    assert_eq!(edit.text, RICH.replace("count: 3\n", ""));
    let edit = doc.meta_delete("nested.k").unwrap();
    assert_eq!(
        Document::parse(&edit.text).meta_get("nested").unwrap(),
        Some(map(&[]))
    );
    let edit = doc.meta_delete("list.0").unwrap();
    assert_eq!(edit.text, RICH.replace("  - a\n", ""));
    assert!(matches!(
        doc.meta_delete("nothing"),
        Err(Error::KeyNotFound(_))
    ));
    assert_eq!(
        doc.meta_delete("nothing").unwrap_err().code(),
        "parse_error"
    );
    assert!(matches!(
        Document::parse("# T\n").meta_delete("a"),
        Err(Error::KeyNotFound(_))
    ));
}

#[test]
fn deleting_the_last_key_removes_the_block_and_its_blank_line() {
    let doc = Document::parse("---\na: 1\n---\n\n# Body\n");
    assert_eq!(doc.meta_delete("a").unwrap().text, "# Body\n");
}

#[test]
fn a_frontmatter_is_created_when_there_is_none() {
    let doc = Document::parse("# Title\n\nbody\n");
    let edit = doc.meta_set("status", s("open")).unwrap();
    assert_eq!(edit.text, "---\nstatus: open\n---\n\n# Title\n\nbody\n");
    assert_eq!(edit.method, EditMethod::Created);
    let doc = Document::parse("# Title\r\n");
    assert_eq!(
        doc.meta_set("a", Value::Int(1)).unwrap().text,
        "---\r\na: 1\r\n---\r\n\r\n# Title\r\n"
    );
}

#[test]
fn crlf_frontmatter_stays_crlf() {
    let doc = Document::parse("---\r\ntitle: crlf\r\n---\r\n\r\n# Body\r\n");
    let text = doc.meta_set("k", s("v")).unwrap().text;
    assert_eq!(text, "---\r\ntitle: crlf\r\nk: v\r\n---\r\n\r\n# Body\r\n");
}

#[test]
fn an_empty_or_comment_only_frontmatter_takes_new_keys_textually() {
    let doc = Document::parse("---\n---\n\n# T\n");
    let edit = doc.meta_set("a", s("b")).unwrap();
    assert_eq!(edit.text, "---\na: b\n---\n\n# T\n");
    let doc = Document::parse("---\n# keep me\n---\n# T\n");
    let edit = doc.meta_set("a", Value::Seq(vec![Value::Int(1)])).unwrap();
    assert_eq!(edit.text, "---\n# keep me\na:\n  - 1\n---\n# T\n");
    assert_eq!(edit.method, EditMethod::Textual);
}

#[test]
fn the_body_after_the_frontmatter_is_never_touched() {
    let body = "\n# Body\n\n---\nnot: frontmatter\n---\n";
    let doc = Document::parse(&format!("---\na: 1\n---\n{body}"));
    let text = doc.meta_set("a", Value::Int(2)).unwrap().text;
    assert!(text.ends_with(body));
}
