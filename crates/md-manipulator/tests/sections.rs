//! Behaviour of the section tree and the text->text operations, from the
//! intent of the TS domain tests plus the decisions of
//! `docs/specs/markdown-sections.md`.

use md_manipulator::{Action, Document, Error, LineEnding, is_valid_id, section_id};

fn titles(doc: &Document) -> Vec<(usize, String)> {
    doc.sections()
        .iter()
        .map(|s| (s.level, s.title.clone()))
        .collect()
}

fn t(level: usize, title: &str) -> (usize, String) {
    (level, title.to_owned())
}

// --- ids ------------------------------------------------------------------

#[test]
fn ids_match_the_recorded_deno_vectors() {
    // From tests/blackbox/cases/md/outline/json (fixture md-basic/doc.md).
    for (level, title, occ, id) in [
        (1, "Sample", 0, "9df28b38"),
        (2, "Setup", 0, "aa142dbd"),
        (3, "Details", 0, "db1b134b"),
        (2, "Usage", 0, "c0c42456"),
        (2, "Setup", 1, "1a3a282a"),
        (1, "Appendix", 0, "f1b1d3d7"),
    ] {
        assert_eq!(section_id(level, title, occ), id);
    }
}

#[test]
fn id_input_is_lowercased_and_trimmed_but_not_otherwise_cleaned() {
    assert_eq!(section_id(2, "  SETUP ", 0), section_id(2, "setup", 0));
    assert_ne!(section_id(2, "Setup #", 0), section_id(2, "Setup", 0));
    assert_ne!(section_id(2, "Setup", 0), section_id(3, "Setup", 0));
}

#[test]
fn occurrence_counts_identical_level_and_lowercased_title() {
    let doc = Document::parse("# Title\n## Title\n# TITLE\n# title\n");
    let ids: Vec<&str> = doc.sections().iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids[0], section_id(1, "Title", 0));
    assert_eq!(ids[1], section_id(2, "Title", 0));
    assert_eq!(ids[2], section_id(1, "TITLE", 1));
    assert_eq!(ids[3], section_id(1, "title", 2));
}

#[test]
fn closing_hashes_stay_in_the_title_and_the_id() {
    let doc = Document::parse("## Closing ##\n");
    assert_eq!(doc.sections()[0].title, "Closing ##");
    assert_eq!(doc.sections()[0].id, section_id(2, "Closing ##", 0));
}

#[test]
fn id_validity() {
    assert!(is_valid_id("deadBEEF"));
    assert!(!is_valid_id("deadbee"));
    assert!(!is_valid_id("zzzzzzzz"));
}

// --- parsing --------------------------------------------------------------

#[test]
fn parses_levels_titles_and_lines() {
    let doc = Document::parse("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6");
    assert_eq!(doc.sections().len(), 6);
    for (i, s) in doc.sections().iter().enumerate() {
        assert_eq!(s.level, i + 1);
        assert_eq!(s.line, i + 1);
    }
    assert_eq!(Document::parse("").sections().len(), 0);
}

#[test]
fn lines_count_the_frontmatter() {
    let doc = Document::parse("---\ntitle: T\n---\n\n# Title\nbody");
    assert_eq!(doc.frontmatter_lines(), 3);
    assert_eq!(doc.sections()[0].line, 5);
}

#[test]
fn frontmatter_is_not_markdown() {
    let doc = Document::parse("---\n# not a heading\n---\n# Real\n");
    assert_eq!(titles(&doc), vec![t(1, "Real")]);
    // closed by `...` too (spec decision 8); unterminated => no frontmatter
    assert_eq!(
        Document::parse("---\na: 1\n...\n# R\n").frontmatter_lines(),
        3
    );
    assert_eq!(Document::parse("---\na: 1\n# R\n").frontmatter_lines(), 0);
}

#[test]
fn fenced_code_follows_commonmark() {
    // backtick and tilde fences
    let doc = Document::parse("# A\n```\n# no\n```\n~~~\n# no\n~~~\n## B\n");
    assert_eq!(titles(&doc), vec![t(1, "A"), t(2, "B")]);
    // closing fence needs the same char, at least the opening length, no info
    let doc = Document::parse("# A\n````\n```\n# still code\n````\n# B\n");
    assert_eq!(titles(&doc), vec![t(1, "A"), t(1, "B")]);
    let doc = Document::parse("# A\n```\n``` js\n# still code\n```\n# B\n");
    assert_eq!(titles(&doc), vec![t(1, "A"), t(1, "B")]);
    // nested block opened by a longer fence
    let doc = Document::parse("~~~~md\n~~~\n# in\n~~~\n~~~~\n# Out\n");
    assert_eq!(titles(&doc), vec![t(1, "Out")]);
    // unterminated fence runs to the end of the file
    let doc = Document::parse("# A\n```\n# no\n## no\n");
    assert_eq!(titles(&doc), vec![t(1, "A")]);
    // inline triple backticks do not open a fence
    let doc = Document::parse("# A\nsome ```code``` here\n# B\n");
    assert_eq!(titles(&doc), vec![t(1, "A"), t(1, "B")]);
    // a fence indented 4+ is indented code
    let doc = Document::parse("# A\n    ```\n# B\n");
    assert_eq!(titles(&doc), vec![t(1, "A"), t(1, "B")]);
}

#[test]
fn setext_headings() {
    let doc = Document::parse("Title\n=====\n\ntext\n\nSub\n---\n");
    assert_eq!(titles(&doc), vec![t(1, "Title"), t(2, "Sub")]);
    assert_eq!(doc.sections()[0].line, 1);
    assert_eq!(doc.sections()[0].heading_last_line, 2);
    // multi-line setext title: lines joined with a space
    let doc = Document::parse("one\ntwo\n===\n");
    assert_eq!(doc.sections()[0].title, "one two");
    // a lone rule is not a heading
    assert!(
        Document::parse("text\n\n---\n\nmore\n")
            .sections()
            .is_empty()
    );
}

#[test]
fn atx_variants() {
    // 1-3 leading spaces still make a heading, 4 is code
    let doc = Document::parse(" # a\n  ## b\n   ### c\n    #### d\n");
    assert_eq!(titles(&doc), vec![t(1, "a"), t(2, "b"), t(3, "c")]);
    // empty heading: title "" and still addressable by id
    let doc = Document::parse("#\n\ntext\n");
    assert_eq!(titles(&doc), vec![t(1, "")]);
    assert_eq!(doc.sections()[0].id, section_id(1, "", 0));
    // NBSP after `#` is a paragraph; 7 hashes too
    assert!(
        Document::parse("#\u{a0}x\n####### x\n#x\n")
            .sections()
            .is_empty()
    );
    // tab after `#` is fine
    assert_eq!(titles(&Document::parse("#\tTab\n")), vec![t(1, "Tab")]);
}

#[test]
fn only_document_level_headings_count() {
    let doc = Document::parse(
        "# A\n\n> # quoted\n\n- # item\n\n<div>\n# html\n</div>\n\n<!-- \n# comment\n-->\n\n## B\n",
    );
    assert_eq!(titles(&doc), vec![t(1, "A"), t(2, "B")]);
}

// --- line endings ---------------------------------------------------------

#[test]
fn crlf_and_cr_files_have_the_same_outline_as_lf() {
    let lf = "# A\n\nbody\n\n```\n# no\n```\n\n## B\ntext\n";
    let crlf = lf.replace('\n', "\r\n");
    let cr = lf.replace('\n', "\r");
    let (a, b, c) = (
        Document::parse(lf),
        Document::parse(&crlf),
        Document::parse(&cr),
    );
    // byte ranges differ with the line ending, everything else must not
    let key = |d: &Document| -> Vec<_> {
        d.sections()
            .iter()
            .map(|s| (s.id.clone(), s.level, s.title.clone(), s.line))
            .collect()
    };
    assert_eq!(key(&a), key(&b));
    assert_eq!(key(&a), key(&c));
    assert_eq!(&crlf[b.sections()[1].heading_range.clone()], "## B");
    assert_eq!(a.line_ending(), LineEnding::Lf);
    assert_eq!(b.line_ending(), LineEnding::CrLf);
    assert_eq!(c.line_ending(), LineEnding::Cr);
}

#[test]
fn read_prints_lf_but_edits_keep_the_file_line_ending() {
    let doc = Document::parse("# A\r\n\r\none\r\ntwo\r\n## B\r\nx\r\n");
    assert_eq!(doc.read("# A", false).unwrap().content, "\none\ntwo");
    let edit = doc.write("# A", "new\nlines", false).unwrap();
    assert_eq!(edit.text, "# A\r\n\r\nnew\r\nlines\r\n## B\r\nx\r\n");
    let edit = doc
        .append(Some("# A"), "added\r\nmore", false, false)
        .unwrap();
    assert_eq!(
        edit.text,
        "# A\r\n\r\none\r\ntwo\r\n\r\nadded\r\nmore\r\n## B\r\nx\r\n"
    );
}

#[test]
fn untouched_lines_keep_their_own_endings_in_mixed_files() {
    let doc = Document::parse("# A\r\nx\ny\r\n# B\nz\n");
    let edit = doc.remove("# B").unwrap();
    assert_eq!(edit.text, "# A\r\nx\ny\r\n");
}

// --- extents and read -----------------------------------------------------

const DOC: &str = "# Top\nintro\n\n## One\na\n\n### Deep\nd\n\n## Two\nb\n\n";

#[test]
fn shallow_stops_at_next_heading_deep_at_next_heading_of_same_or_higher_level() {
    let doc = Document::parse(DOC);
    let top = doc.read("# Top", false).unwrap();
    assert_eq!((top.content.as_str(), top.end_line), ("intro\n", 3));
    let top = doc.read("# Top", true).unwrap();
    assert_eq!(top.end_line, 11); // trailing blank lines of the file are trimmed
    let one = doc.read("## One", true).unwrap();
    assert_eq!(one.end_line, 9);
    assert!(one.content.contains("### Deep"));
    assert!(!doc.read("## One", false).unwrap().content.contains("Deep"));
}

#[test]
fn trailing_blank_lines_of_the_file_are_not_part_of_the_last_section() {
    let doc = Document::parse("# Title\nContent\n\n\n");
    assert_eq!(doc.read("# Title", false).unwrap().end_line, 2);
}

#[test]
fn outline_after_lists_deeper_sections_inside_the_extent() {
    let doc = Document::parse(DOC);
    let sub: Vec<&str> = doc
        .outline_after("# Top")
        .unwrap()
        .iter()
        .map(|s| s.title.as_str())
        .collect();
    assert_eq!(sub, vec!["One", "Deep", "Two"]);
    assert!(doc.outline_after("### Deep").unwrap().is_empty());
}

// --- selectors ------------------------------------------------------------

#[test]
fn selectors_by_id_and_heading_with_typed_errors() {
    let doc = Document::parse("# A\n## S\n## S\n");
    let id = section_id(2, "S", 1);
    assert_eq!(doc.resolve(&id).unwrap().line, 3);
    assert_eq!(doc.resolve("# A").unwrap().line, 1);
    let code = |r: Result<_, Error>| r.map(|_: &md_manipulator::Section| ()).unwrap_err().code();
    assert_eq!(code(doc.resolve("## S")), "ambiguous_section");
    assert_eq!(code(doc.resolve("### S")), "section_not_found");
    assert_eq!(code(doc.resolve("deadbeef")), "section_not_found");
    assert_eq!(code(doc.resolve("S")), "invalid_id");
    assert_eq!(code(doc.resolve("zzzzzzzz")), "invalid_id");
    assert_eq!(code(doc.resolve("####### x")), "invalid_id");
    assert_eq!(code(doc.resolve("##")), "invalid_id");
}

// --- write ----------------------------------------------------------------

#[test]
fn write_replaces_the_body_and_separates_it_from_the_heading() {
    let doc = Document::parse("# Title\nOld content\nMore old\n");
    let edit = doc.write("# Title", "New content", false).unwrap();
    assert_eq!(edit.text, "# Title\n\nNew content\n");
    assert_eq!(edit.mutation.action, Action::Updated);
    assert_eq!(edit.mutation.lines_removed, 2);
    assert_eq!(edit.mutation.lines_added, 2);
}

#[test]
fn write_empty_content_empties_the_body() {
    let doc = Document::parse("# Title\nOld\n## Next\n");
    assert_eq!(
        doc.write("# Title", "", false).unwrap().text,
        "# Title\n## Next\n"
    );
}

#[test]
fn write_deep_replaces_subsections_too() {
    let doc = Document::parse(DOC);
    let edit = doc.write("# Top", "all new", true).unwrap();
    // the text ends with a blank line and the final line ending
    assert_eq!(edit.text, "# Top\n\nall new\n\n");
}

#[test]
fn writing_the_current_body_is_a_byte_noop() {
    // Spec decision 9, including bodies glued to the heading and blank-only ones.
    for text in [
        "# T\nbody\n",
        "# T\n\nbody\n",
        "# T\n\n## U\nx\n",
        "# T\n",
        "# T",
    ] {
        let doc = Document::parse(text);
        for deep in [false, true] {
            let body = doc.read("# T", deep).unwrap().content;
            let edit = doc.write("# T", &body, deep).unwrap();
            assert_eq!(edit.text, text, "{text:?} deep={deep}");
        }
    }
}

#[test]
fn writing_the_body_without_its_surrounding_blank_lines_is_also_a_noop() {
    // A shell round trip (`write "$(read)"`) loses the trailing newlines.
    let text = "# T\nbody line\n\n## S\nx\n";
    let doc = Document::parse(text);
    assert_eq!(doc.write("# T", "body line", false).unwrap().text, text);
    assert_eq!(
        doc.write("# T", "\nbody line\n\n", false).unwrap().text,
        text
    );
    assert_ne!(doc.write("# T", "other", false).unwrap().text, text);
}

// --- append ---------------------------------------------------------------

#[test]
fn append_without_selector_goes_to_the_end_or_after_the_frontmatter() {
    let doc = Document::parse("---\na: 1\n---\n# T\nbody\n");
    assert_eq!(
        doc.append(None, "tail", false, false).unwrap().text,
        "---\na: 1\n---\n# T\nbody\n\ntail\n"
    );
    assert_eq!(
        doc.append(None, "head", false, true).unwrap().text,
        "---\na: 1\n---\nhead\n# T\nbody\n"
    );
}

#[test]
fn append_after_a_section_goes_before_its_next_heading() {
    let doc = Document::parse("# A\nx\n## B\ny\n# C\n");
    let edit = doc.append(Some("# A"), "more", false, false).unwrap();
    assert_eq!(edit.text, "# A\nx\n\nmore\n## B\ny\n# C\n");
    let edit = doc.append(Some("# A"), "more", true, false).unwrap();
    assert_eq!(edit.text, "# A\nx\n## B\ny\n\nmore\n# C\n");
    let edit = doc.append(Some("## B"), "pre", false, true).unwrap();
    assert_eq!(edit.text, "# A\nx\npre\n## B\ny\n# C\n");
}

#[test]
fn appending_a_heading_reports_the_created_section_id() {
    let doc = Document::parse("# Title\nContent");
    let edit = doc.append(None, "## New\ntext", false, false).unwrap();
    assert_eq!(edit.mutation.action, Action::Created);
    assert_eq!(edit.mutation.id, section_id(2, "New", 0));
    assert_eq!(edit.text, "# Title\nContent\n\n## New\ntext\n");
}

#[test]
fn append_at_the_end_adds_the_missing_final_newline() {
    let doc = Document::parse("# A\nlast");
    assert_eq!(
        doc.append(Some("# A"), "x", false, false).unwrap().text,
        "# A\nlast\n\nx\n"
    );
}

#[test]
fn append_to_an_empty_document() {
    // Spec decision 12: no leading blank line, and the content ends with a
    // line ending.
    let edit = Document::parse("")
        .append(None, "# First", false, false)
        .unwrap();
    assert_eq!(edit.text, "# First\n");
    assert_eq!(edit.mutation.line_start, 1);
    assert_eq!(edit.mutation.lines_added, 1);
}

#[test]
fn append_at_the_end_ends_with_a_newline_and_one_blank_separator() {
    // Spec decision 13.
    let edit = Document::parse("# A\nx\n")
        .append(None, "# B", false, false)
        .unwrap();
    assert_eq!(edit.text, "# A\nx\n\n# B\n");
    let m = &edit.mutation;
    assert_eq!((m.line_start, m.line_end, m.lines_added), (3, Some(4), 2));

    // A blank line is already there: not doubled.
    let edit = Document::parse("# A\nx\n\n")
        .append(None, "# B", false, false)
        .unwrap();
    assert_eq!(edit.text, "# A\nx\n\n# B\n");
    assert_eq!(edit.mutation.lines_added, 1);

    // No final newline in the file: one is added.
    let edit = Document::parse("# A\nx")
        .append(None, "# B", false, false)
        .unwrap();
    assert_eq!(edit.text, "# A\nx\n\n# B\n");
}

#[test]
fn one_trailing_newline_of_the_content_is_not_a_line() {
    // Spec decision 14: `echo text | md append` and `md append "text"` agree.
    let doc = Document::parse("# A\nx\n");
    let edit = doc.append(Some("# A"), "tail\n", false, false).unwrap();
    assert_eq!(edit.text, "# A\nx\n\ntail\n");
    assert_eq!(edit.mutation.lines_added, 2);

    let edit = doc.write("# A", "new\n", false).unwrap();
    assert_eq!(edit.text, "# A\n\nnew\n");
    assert_eq!(edit.mutation.lines_added, 2);

    // Only one is dropped: a deliberate blank line survives.
    let edit = doc.append(Some("# A"), "tail\n\n", false, false).unwrap();
    assert_eq!(edit.text, "# A\nx\n\ntail\n\n");
    assert_eq!(edit.mutation.lines_added, 3);
}

#[test]
fn appended_text_cannot_turn_the_next_setext_heading_into_a_paragraph() {
    let doc = Document::parse("# A\nx\n\nNext\n====\n");
    let edit = doc.append(Some("# A"), "tail", false, false).unwrap();
    let after = Document::parse(&edit.text);
    assert_eq!(titles(&after), vec![t(1, "A"), t(1, "Next")]);
}

// --- empty and remove -----------------------------------------------------

#[test]
fn empty_keeps_the_heading_and_removes_the_body() {
    let doc = Document::parse("# A\nx\n## B\ny\n# C\n");
    assert_eq!(doc.empty("# A", false).unwrap().text, "# A\n## B\ny\n# C\n");
    assert_eq!(doc.empty("# A", true).unwrap().text, "# A\n# C\n");
    assert_eq!(
        doc.empty("# A", true).unwrap().mutation.action,
        Action::Emptied
    );
}

#[test]
fn remove_takes_the_heading_the_body_and_the_subsections() {
    let doc = Document::parse("# A\nx\n## B\ny\n# C\nz\n");
    let edit = doc.remove("# A").unwrap();
    assert_eq!(edit.text, "# C\nz\n");
    assert_eq!(edit.mutation.action, Action::Removed);
    assert_eq!(edit.mutation.lines_removed, 4);
    assert_eq!(doc.remove("# C").unwrap().text, "# A\nx\n## B\ny\n");
}

#[test]
fn every_operation_reports_missing_sections() {
    let doc = Document::parse("# A\n");
    assert_eq!(
        doc.write("deadbeef", "x", false).unwrap_err().code(),
        "section_not_found"
    );
    assert_eq!(
        doc.append(Some("deadbeef"), "x", false, false)
            .unwrap_err()
            .code(),
        "section_not_found"
    );
    assert_eq!(
        doc.empty("deadbeef", false).unwrap_err().code(),
        "section_not_found"
    );
    assert_eq!(
        doc.remove("deadbeef").unwrap_err().code(),
        "section_not_found"
    );
}
