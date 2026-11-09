//! Unit behaviours of `mrfi` not covered by the TS golden vectors: the
//! explicit column units and the line edits used by MRFI selectors.

use md_manipulator::Document;
use md_manipulator::mrfi::{
    Extent, Format, GenerateOptions, MrfiDoc, Profile, ResolveOptions, SourceRange, Status, Target,
    generate, resolve,
};

#[test]
fn utf16_and_scalar_columns_convert_both_ways() {
    // Columns: scalar a=1 🎉=2 b=3 end=4; UTF-16 a=1 🎉=2 b=4 end=5.
    let doc = MrfiDoc::new("a🎉b\n");
    for (scalar, utf16) in [(1, 1), (2, 2), (3, 4), (4, 5)] {
        assert_eq!(doc.column_to_utf16(1, scalar), utf16);
        assert_eq!(doc.column_from_utf16(1, utf16), scalar);
    }
    // Inside a surrogate pair: rounds up to the next character.
    assert_eq!(doc.column_from_utf16(1, 3), 3);
    // Past the end of the line the excess is kept (so validation can reject it).
    assert_eq!(doc.column_from_utf16(1, 9), 8);
    assert_eq!(doc.column_to_utf16(1, 8), 9);
}

#[test]
fn a_utf16_column_is_rejected_as_a_scalar_column() {
    // The dz-review defect: "Emoji 🎉 line é." is 15 scalars, 16 UTF-16 units.
    let doc = MrfiDoc::new("# T\n\nEmoji 🎉 line é.\n");
    let range = |end| SourceRange {
        start_line: 3,
        start_column: 1,
        end_line: 3,
        end_column: end,
    };
    let options = GenerateOptions {
        format: Format::Debug,
        ..GenerateOptions::default()
    };
    assert!(generate(&doc, Target::Range(range(16)), &options).is_ok());
    let utf16_end = doc.column_to_utf16(3, 16);
    assert_eq!(utf16_end, 17);
    let err = generate(&doc, Target::Range(range(utf16_end as u64)), &options).unwrap_err();
    assert!(
        err.message()
            .starts_with("Range column is outside the document line")
    );
}

#[test]
fn crlf_documents_are_addressed_like_their_lf_conversion() {
    let lf = "# T\n\nsome text here\n";
    let crlf = lf.replace('\n', "\r\n");
    let options = GenerateOptions {
        format: Format::Debug,
        profile: Profile::Full,
        ..GenerateOptions::default()
    };
    let range = Target::Range(SourceRange {
        start_line: 3,
        start_column: 1,
        end_line: 3,
        end_column: 10,
    });
    assert_eq!(
        generate(&MrfiDoc::new(lf), range, &options),
        generate(&MrfiDoc::new(&crlf), range, &options)
    );
}

#[test]
fn line_edits_touch_whole_lines_only() {
    let doc = Document::parse("one\ntwo\nthree\nfour\n");
    assert_eq!(doc.write_lines(2, 3, "x\ny").text, "one\nx\ny\nfour\n");
    assert_eq!(doc.write_lines(2, 2, "").text, "one\nthree\nfour\n");
    assert_eq!(doc.remove_lines(1, 2).text, "three\nfour\n");
    assert_eq!(
        doc.append_lines(2, 3, "after", false).text,
        "one\ntwo\nthree\nafter\nfour\n"
    );
    assert_eq!(
        doc.append_lines(2, 3, "before", true).text,
        "one\nbefore\ntwo\nthree\nfour\n"
    );
    let edit = doc.remove_lines(2, 3);
    assert_eq!(
        (edit.mutation.line_start, edit.mutation.lines_removed),
        (2, 2)
    );
    // CRLF files keep their line endings, inserted lines use them too.
    let crlf = Document::parse("one\r\ntwo\r\nthree\r\n");
    assert_eq!(
        crlf.write_lines(2, 2, "x\ny").text,
        "one\r\nx\r\ny\r\nthree\r\n"
    );
}

#[test]
fn an_extent_result_names_its_identity_heading() {
    // The `body` extent starts on `## Sub`, yet the identity is `# A`.
    let doc = MrfiDoc::new("# A\n## Sub\n\nx\n\n# B\n");
    let options = GenerateOptions {
        format: Format::Debug,
        extent: Some(Extent::Body),
        ..GenerateOptions::default()
    };
    let reference = generate(&doc, Target::Section(0), &options).unwrap();
    let result = resolve(&doc, &reference, &ResolveOptions::default());
    assert!(matches!(result.status, Status::Exact | Status::Confident));
    assert_eq!(result.scope_section, Some(0));
    assert_eq!(result.range.unwrap().start_line, 2);
}
