//! Properties P1-P6 of `docs/specs/markdown-sections.md`, over the 80-file
//! corpus of the black-box suite with seeded random operations.

use md_manipulator::{Document, section_id};
use std::collections::HashMap;
use std::path::Path;

const ROUNDS: usize = 40;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn corpus() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/blackbox/fixtures/md-corpus");
    let mut v: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            let bytes = std::fs::read(e.path()).unwrap();
            (
                e.file_name().to_string_lossy().into_owned(),
                String::from_utf8_lossy(&bytes).into_owned(),
            )
        })
        .collect();
    v.sort();
    assert_eq!(v.len(), 80);
    v
}

/// Heading-free bodies that cannot change the structure around them.
const CONTENTS: [&str; 6] = [
    "text",
    "line one\nline two",
    "\npara\n\n- item\n- item2",
    "text\r\nmore",
    "> quote",
    "para\n",
];

type Outline = Vec<(usize, String)>;

fn outline(d: &Document) -> Outline {
    d.sections()
        .iter()
        .map(|s| (s.level, s.title.clone()))
        .collect()
}

/// Outline with ids recomputed from scratch: a reparse must agree with them.
fn same_outline(d: &Document, expected: &Outline) -> bool {
    let mut occ: HashMap<(usize, String), usize> = HashMap::new();
    let ids: Vec<String> = expected
        .iter()
        .map(|(l, t)| {
            let k = occ
                .entry((*l, t.to_lowercase().trim().to_owned()))
                .or_insert(0);
            let id = section_id(*l, t, *k);
            *k += 1;
            id
        })
        .collect();
    outline(d) == *expected && d.sections().iter().map(|s| s.id.clone()).eq(ids)
}

fn check_outside(orig: &str, out: &str, range: std::ops::Range<usize>, what: &str) {
    let (a, b) = (range.start, range.end);
    assert!(
        out.len() + b >= orig.len() && out.starts_with(&orig[..a]),
        "P1 prefix differs: {what}"
    );
    assert!(out.ends_with(&orig[b..]), "P1 suffix differs: {what}");
}

#[test]
fn p1_p6_edits_touch_only_their_range_and_reparse_as_expected() {
    let (mut ops, mut captured) = (0, 0);
    for (name, text) in corpus() {
        let d = Document::parse(&text);
        if d.sections().is_empty() {
            continue;
        }
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ (name.len() as u64 * 7919));
        for round in 0..ROUNDS {
            let i = rng.below(d.sections().len());
            let deep = rng.below(2) == 0;
            let what = format!("{name} round {round} sec {i}");
            let s = &d.sections()[i];
            let o = outline(&d);
            let sel = s.id.clone();
            match rng.below(3) {
                0 => {
                    let c = CONTENTS[rng.below(CONTENTS.len())];
                    let edit = d.write(&sel, c, deep).unwrap();
                    check_outside(&text, &edit.text, d.body_byte_range(i, deep), &what);
                    // a deep write also drops the sub-sections
                    let end = d.end_line(i, deep);
                    let exp: Outline = (0..o.len())
                        .filter(|&k| d.sections()[k].line <= s.line || d.sections()[k].line > end)
                        .map(|k| o[k].clone())
                        .collect();
                    let r = Document::parse(&edit.text);
                    if !same_outline(&r, &exp) {
                        // New text ending in a list item or quote absorbs a following
                        // heading indented 1-3 spaces (lazy continuation / list content).
                        let after = d.sections().iter().find(|n| n.line > end);
                        let indented = after.is_some_and(|n| {
                            d.text()
                                .lines()
                                .nth(n.line - 1)
                                .is_some_and(|l| l.starts_with(' '))
                        });
                        assert!(
                            indented && r.sections().len() < exp.len(),
                            "P6 write: {what}"
                        );
                        captured += 1;
                    }
                }
                1 => {
                    let edit = d.remove(&sel).unwrap();
                    check_outside(&text, &edit.text, d.section_byte_range(i, true), &what);
                    let end = d.end_line(i, true);
                    let exp: Outline = (0..o.len())
                        .filter(|&k| d.sections()[k].line < s.line || d.sections()[k].line > end)
                        .map(|k| o[k].clone())
                        .collect();
                    assert!(
                        same_outline(&Document::parse(&edit.text), &exp),
                        "P6 remove: {what}"
                    );
                }
                _ => {
                    let c = CONTENTS[rng.below(CONTENTS.len())];
                    let before = rng.below(2) == 0;
                    let at = if before {
                        s.line - 1
                    } else {
                        d.end_line(i, deep)
                    };
                    let edit = d.append(Some(&sel), c, deep, before).unwrap();
                    check_outside(&text, &edit.text, d.insertion_byte_range(at), &what);
                    let r = Document::parse(&edit.text);
                    if !same_outline(&r, &o) {
                        // Text added inside a construct still open at the end of the
                        // section (unterminated fence, HTML block) can only hide headings.
                        captured += 1;
                        assert!(r.sections().len() <= o.len(), "P6 append grew: {what}");
                    }
                }
            }
            ops += 1;
        }
    }
    eprintln!("P1/P6: {ops} ops, {captured} appends captured by an open construct");
    assert!(ops > 1500);
}

#[test]
fn p2_write_current_body_is_noop() {
    for (name, text) in corpus() {
        let d = Document::parse(&text);
        for i in 0..d.sections().len() {
            let id = d.sections()[i].id.clone();
            for deep in [false, true] {
                let body = d.read(&id, deep).unwrap().content;
                assert_eq!(
                    d.write(&id, &body, deep).unwrap().text,
                    text,
                    "P2 {name} sec {i} deep {deep}"
                );
            }
        }
    }
}

#[test]
fn p3_append_then_remove_restores_up_to_the_padding_blank_line() {
    let (mut exact, mut padded) = (0, 0);
    for (name, text) in corpus() {
        let d = Document::parse(&text);
        for i in 0..d.sections().len() {
            let s = &d.sections()[i];
            let content = format!("{} Zz-appended\nnew body", "#".repeat(s.level));
            let edit = d
                .append(Some(&s.id.clone()), &content, true, false)
                .unwrap();
            if edit.mutation.action != md_manipulator::Action::Created {
                continue; // swallowed by an open fence or HTML block
            }
            let d2 = Document::parse(&edit.text);
            let back = d2.remove(&edit.mutation.id).unwrap().text;
            if back == text {
                exact += 1;
            } else {
                // `append` pads one blank line after a non-blank line; an
                // unterminated file also gains its final EOL.
                let trimmed = |t: &str| t.trim_end_matches(['\n', '\r']).replace("\r\n", "\n");
                let mut lines: Vec<&str> = back.split_inclusive(['\n']).collect();
                let ok = trimmed(&back) == trimmed(&text)
                    || (0..lines.len()).any(|k| {
                        let l = lines.remove(k);
                        let same = lines.concat() == text && l.trim().is_empty();
                        lines.insert(k, l);
                        same
                    });
                assert!(
                    ok,
                    "P3 {name} sec {i}\n--- orig\n{text:?}\n--- back\n{back:?}"
                );
                padded += 1;
            }
        }
    }
    eprintln!("P3: exact {exact}, padded {padded}");
    assert!(exact + padded > 150);
}

fn to_crlf(t: &str) -> String {
    t.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n")
}

#[test]
fn p4_crlf_outline_equals_lf_outline() {
    for (name, text) in corpus() {
        let lf = text.replace("\r\n", "\n").replace('\r', "\n");
        let (a, b) = (Document::parse(&lf), Document::parse(&to_crlf(&text)));
        let key = |d: &Document| -> Vec<_> {
            d.sections()
                .iter()
                .map(|s| (s.id.clone(), s.level, s.title.clone(), s.line))
                .collect()
        };
        assert_eq!(key(&a), key(&b), "P4 {name}");
    }
}

#[test]
fn p4b_edits_on_crlf_files_stay_crlf() {
    for (name, text) in corpus() {
        let crlf = to_crlf(&text);
        let d = Document::parse(&crlf);
        if !crlf.contains('\n') {
            continue;
        }
        for i in 0..d.sections().len().min(5) {
            let id = d.sections()[i].id.clone();
            let w = d.write(&id, "a\nb", false).unwrap().text;
            let a = d.append(Some(&id), "## N\nx", true, false).unwrap().text;
            for out in [&w, &a] {
                assert_eq!(
                    out.matches('\n').count(),
                    out.matches("\r\n").count(),
                    "bare LF in {name}"
                );
            }
            // `write` keeps the final-newline state; `append` ending at the
            // end of the file always terminates it (spec decision 12).
            assert_eq!(w.ends_with('\n'), crlf.ends_with('\n'), "final EOL {name}");
            assert!(
                !crlf.ends_with('\n') || a.ends_with('\n'),
                "final EOL append {name}"
            );
        }
    }
}

#[test]
fn p5_no_heading_inside_code_or_html() {
    let bad = [
        "in code",
        "still code",
        "in html",
        "in comment",
        "also",
        "in pre",
        "indented code",
    ];
    for (name, text) in corpus() {
        for s in Document::parse(&text).sections() {
            // html-block-blank.md: a blank line ends an HTML block, that heading is real
            assert!(
                name == "html-block-blank.md" || !bad.iter().any(|b| s.title.contains(b)),
                "P5 {name}: {:?}",
                s.title
            );
        }
    }
}

mod generated {
    use super::*;
    use proptest::prelude::*;

    /// Line soup built from structure-relevant fragments, mixed line endings.
    fn text() -> impl Strategy<Value = String> {
        let line = prop_oneof![
            Just("# A"),
            Just("## B"),
            Just("### a"),
            Just("  ## B"),
            Just("#"),
            Just("text"),
            Just(""),
            Just("```"),
            Just("~~~"),
            Just("    # code"),
            Just("> # q"),
            Just("- # li"),
            Just("Setext"),
            Just("==="),
            Just("---"),
            Just("<div>"),
            Just("</div>"),
            Just("---\u{a0}"),
            Just("é ☃"),
        ];
        let eol = prop_oneof![Just("\n"), Just("\r\n"), Just("\r")];
        proptest::collection::vec((line, eol), 0..14)
            .prop_flat_map(|v| (Just(v), any::<bool>()))
            .prop_map(|(v, final_eol)| {
                let mut s: String = v.iter().map(|(l, e)| format!("{l}{e}")).collect();
                if !final_eol {
                    s = s.trim_end_matches(['\n', '\r']).to_owned();
                }
                s
            })
    }

    proptest! {
        #[test]
        fn any_text_parses_and_current_body_writes_are_noops(t in text()) {
            let d = Document::parse(&t);
            for s in d.sections() {
                for deep in [false, true] {
                    let body = d.read(&s.id, deep).unwrap().content;
                    prop_assert_eq!(d.write(&s.id, &body, deep).unwrap().text, t.clone());
                }
            }
        }

        #[test]
        fn edits_never_panic_and_leave_outside_bytes_alone(t in text(), pick in 0usize..8) {
            let d = Document::parse(&t);
            if d.sections().is_empty() { return Ok(()); }
            let i = pick % d.sections().len();
            let id = d.sections()[i].id.clone();
            let removed = d.remove(&id).unwrap();
            check_outside(&t, &removed.text, d.section_byte_range(i, true), "remove");
            let emptied = d.empty(&id, true).unwrap();
            check_outside(&t, &emptied.text, d.body_byte_range(i, true), "empty");
            let appended = d.append(Some(&id), "x\ny", false, false).unwrap();
            let at = d.end_line(i, false);
            check_outside(&t, &appended.text, d.insertion_byte_range(at), "append");
        }

        #[test]
        fn line_ending_never_changes_the_outline(t in text()) {
            let lf = t.replace("\r\n", "\n").replace('\r', "\n");
            let key = |d: &Document| -> Vec<_> {
                d.sections().iter().map(|s| (s.id.clone(), s.level, s.title.clone(), s.line)).collect()
            };
            prop_assert_eq!(key(&Document::parse(&lf)), key(&Document::parse(&to_crlf(&lf))));
            prop_assert_eq!(key(&Document::parse(&lf)), key(&Document::parse(&lf.replace('\n', "\r"))));
        }
    }
}
