//! `search` and `concat` of documents (the TS `SearchUseCase` and `cmdConcat`).

use md_manipulator::{Document, concat, search};

const DOC: &str =
    "---\ntitle: alpha\n---\n\n# One\n\nalpha here\n\n## Two\n\nnothing\nalpha again alpha\n";

#[test]
fn search_reports_each_matching_line_with_its_section() {
    let doc = Document::parse(DOC);
    let r = search(&doc, "alpha");
    let lines: Vec<(usize, &str, Option<&str>)> = r
        .matches
        .iter()
        .map(|m| (m.line, m.content.as_str(), m.section_id.as_deref()))
        .collect();
    let one = doc.sections()[0].id.clone();
    let two = doc.sections()[1].id.clone();
    assert_eq!(
        lines,
        vec![
            (2, "title: alpha", None),
            (7, "alpha here", Some(one.as_str())),
            (12, "alpha again alpha", Some(two.as_str())),
        ]
    );
}

#[test]
fn search_is_a_plain_substring_match() {
    let doc = Document::parse("a [b\nc\n");
    assert_eq!(search(&doc, "[").matches.len(), 1);
    assert_eq!(search(&doc, "A").matches.len(), 0);
}

#[test]
fn search_summaries_group_lines_by_section_in_first_match_order() {
    let doc = Document::parse(DOC);
    let r = search(&doc, "alpha");
    assert_eq!(r.summaries.len(), 2, "the frontmatter match has no section");
    assert_eq!(r.summaries[0].title, "One");
    assert_eq!(r.summaries[0].lines, vec![7]);
    assert_eq!(r.summaries[1].lines, vec![12]);
    assert_eq!(r.summaries[1].match_count, 1);
}

#[test]
fn concat_keeps_first_frontmatter_and_shifts_headings() {
    let a = Document::parse("---\nk: v\n---\n# A\n\n## B\n");
    let b = Document::parse("---\nz: 1\n---\n# C\n");
    assert_eq!(
        concat(&[a, b], 1),
        "---\nk: v\n---\n\n## A\n\n### B\n\n\n## C\n"
    );
}

#[test]
fn concat_clamps_to_level_6_and_ignores_non_positive_shift() {
    let a = Document::parse("##### X\n###### Y");
    assert_eq!(concat(std::slice::from_ref(&a), 3), "###### X\n###### Y");
    assert_eq!(concat(&[a], -2), "##### X\n###### Y");
}

#[test]
fn concat_joins_files_with_two_newlines_after_their_own_ending() {
    let a = Document::parse("# A\n");
    let b = Document::parse("# B\n");
    assert_eq!(concat(&[a, b], 0), "# A\n\n\n# B\n");
}
