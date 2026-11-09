//! `compare` / `rank` (spec: `docs/specs/mrfi.md`, "Comparing References
//! Without Resolving"). The first block ports the vectors of the TS tests
//! (`compare-references.test.ts`, `rank-reference-candidates.test.ts`).

use md_manipulator::mrfi::{Comparison, Outcome, Verdict, compare, rank};

fn field(c: &Comparison, name: &str) -> (Outcome, Option<f64>) {
    let f = c
        .fields
        .iter()
        .find(|f| f.field == name)
        .unwrap_or_else(|| panic!("field {name} missing"));
    (f.outcome, f.similarity)
}

#[test]
fn equal_fh_is_same() {
    let c = compare("~{v0;fh=xxh64:aabbccdd}", "~{v0;fh=xxh64:aabbccdd}");
    assert_eq!(c.verdict, Verdict::Same);
}

#[test]
fn differing_fh_with_shared_path_is_unrelated() {
    let c = compare(
        "~{v0;fh=xxh64:aabbccdd;p=h1[1]%2Fp[1]}",
        "~{v0;fh=xxh64:11223344;p=h1[1]%2Fp[1]}",
    );
    assert_eq!(c.verdict, Verdict::Unrelated);
}

#[test]
fn equal_anchor_without_conflict_is_same() {
    assert_eq!(
        compare("~{v0;a=intro}", "~{v0;a=intro}").verdict,
        Verdict::Same
    );
}

#[test]
fn range_without_compatible_doc_is_incomparable() {
    let c = compare("~{v0;r=1:1-2:1}", "~{v0;r=100:1-101:1}");
    assert_eq!(c.verdict, Verdict::Incomparable);
    assert_eq!(c.comparability, 0.0);
    assert_eq!(field(&c, "r").0, Outcome::Absent);
}

#[test]
fn range_overlap_gated_by_close_doc_matches() {
    let c = compare(
        "~{v0;r=1:1-2:1;doc=smh64:0000000000000000}",
        "~{v0;r=1:1-2:1;doc=smh64:0000000000000001}",
    );
    assert_eq!(field(&c, "r").0, Outcome::Match);
}

#[test]
fn huge_line_numbers_do_not_overflow() {
    // The range parser saturates at u64::MAX; stored references come from disk.
    let doc = "doc=smh64:0000000000000000";
    let c = compare(
        &format!("~{{v0;r=1:1-99999999999999999999:2;{doc}}}"),
        &format!("~{{v0;r=1:1-99999999999999999999:2;{doc}}}"),
    );
    assert_eq!(field(&c, "r").0, Outcome::Match);
    let c = compare(
        &format!("~{{v0;o=0-18446744073709551615;{doc}}}"),
        &format!("~{{v0;o=1-18446744073709551615;{doc}}}"),
    );
    assert_ne!(field(&c, "o").0, Outcome::Absent);
}

#[test]
fn x_mismatch_caps_same_at_possible() {
    let c = compare(
        "~{v0;fh=xxh64:aabbccdd;x=sec}",
        "~{v0;fh=xxh64:aabbccdd;x=body}",
    );
    assert_eq!(c.verdict, Verdict::Possible);
    assert_eq!(field(&c, "x").0, Outcome::Conflict);
    assert!(c.diagnostics.iter().any(|d| d.starts_with("x mismatch")));
}

#[test]
fn x_absent_on_both_sides_matches() {
    let c = compare("~{v0;fh=xxh64:aabbccdd}", "~{v0;fh=xxh64:aabbccdd}");
    assert_eq!(field(&c, "x").0, Outcome::Match);
    assert_eq!(c.verdict, Verdict::Same);
}

#[test]
fn x_absent_vs_set_is_a_conflict() {
    // Absence is the plain-extent value, not missing evidence.
    let c = compare("~{v0;fh=xxh64:aabbccdd}", "~{v0;fh=xxh64:aabbccdd;x=sec}");
    assert_eq!(field(&c, "x").0, Outcome::Conflict);
    assert_eq!(c.verdict, Verdict::Possible);
}

#[test]
fn x_does_not_inflate_similarity() {
    let c = compare("~{v0;x=sec}", "~{v0;x=sec}");
    assert_eq!(c.similarity, 0.0);
    assert_eq!(c.comparability, 0.0);
    assert_eq!(c.verdict, Verdict::Incomparable);
}

#[test]
fn must_understand_violation_is_invalid() {
    let c = compare(
        "~{v0;fh=xxh64:aabbccdd;zz=unknown}",
        "~{v0;fh=xxh64:aabbccdd}",
    );
    assert_eq!(c.verdict, Verdict::Invalid);
    assert!(c.fields.is_empty());
    assert!(c.diagnostics[0].starts_with("must-understand field violation: zz"));
}

#[test]
fn unparsable_reference_is_invalid_on_either_side() {
    assert_eq!(
        compare("not a reference", "~{v0;fh=xxh64:aabbccdd}").verdict,
        Verdict::Invalid
    );
    assert_eq!(
        compare("~{v0;fh=xxh64:aabbccdd}", "not a reference").verdict,
        Verdict::Invalid
    );
}

#[test]
fn extension_fields_never_invalidate() {
    let c = compare(
        "~{v0;fh=xxh64:aabbccdd;_kind=note}",
        "~{v0;fh=xxh64:aabbccdd}",
    );
    assert_eq!(c.verdict, Verdict::Same);
}

#[test]
fn matching_ctx_is_a_shared_strong_field() {
    let r = "~{v0;ctx=pre:before%20text,suf:after%20text}";
    let c = compare(r, r);
    assert_eq!(field(&c, "ctx"), (Outcome::Match, Some(1.0)));
    assert!(c.comparability > 0.0);
}

#[test]
fn fh_with_different_tags_is_absent_not_conflicting() {
    let c = compare(
        "~{v0;fh=xxh64:aabbccdd;p=h1[1]%2Fp[1]}",
        "~{v0;fh=sha256:aabbccdd;p=h1[1]%2Fp[1]}",
    );
    assert_eq!(field(&c, "fh").0, Outcome::Absent);
}

#[test]
fn field_present_on_one_side_contributes_nothing() {
    let c = compare(
        "~{v0;fh=xxh64:aabbccdd;q=hello%20world}",
        "~{v0;fh=xxh64:aabbccdd}",
    );
    assert_eq!(field(&c, "q").0, Outcome::Absent);
    assert_eq!(c.verdict, Verdict::Same);
}

#[test]
fn identical_paths_match_exactly() {
    let c = compare(
        "~{v0;r=3:1-3:4;p=h1[1]%2Fp[1]}",
        "~{v0;r=3:5-3:8;p=h1[1]%2Fp[1]}",
    );
    assert_eq!(field(&c, "p"), (Outcome::Match, Some(1.0)));
}

#[test]
fn path_partial_prefix_is_graded() {
    let c = compare(
        "~{v0;p=h1[1]%2Fh2[1]%2Fp[1]}",
        "~{v0;p=h1[1]%2Fh2[1]%2Fp[2]}",
    );
    let (o, s) = field(&c, "p");
    assert_eq!(o, Outcome::Match);
    assert!((s.unwrap() - 2.0 / 3.0).abs() < 1e-12);
}

#[test]
fn smh64_distance_is_graded_and_thresholded() {
    // distance 1 -> match; distance 16 > default max 8 -> conflict
    let near = compare(
        "~{v0;hh=smh64:0000000000000000}",
        "~{v0;hh=smh64:0000000000000001}",
    );
    assert_eq!(field(&near, "hh").0, Outcome::Match);
    assert!((field(&near, "hh").1.unwrap() - 63.0 / 64.0).abs() < 1e-12);
    let far = compare(
        "~{v0;hh=smh64:0000000000000000}",
        "~{v0;hh=smh64:000000000000ffff}",
    );
    assert_eq!(field(&far, "hh").0, Outcome::Conflict);
}

#[test]
fn distant_doc_plus_conflicting_hh_is_unrelated() {
    let c = compare(
        "~{v0;doc=smh64:0000000000000000;hh=smh64:0000000000000000}",
        "~{v0;doc=smh64:ffffffffffffffff;hh=smh64:ffffffffffffffff}",
    );
    assert_eq!(c.verdict, Verdict::Unrelated);
}

#[test]
fn quote_similarity_levels() {
    let eq = compare("~{v0;q=Hello%20World}", "~{v0;q=hello%20%20world}");
    assert_eq!(field(&eq, "q"), (Outcome::Match, Some(1.0)));
    let inc = compare("~{v0;q=hello}", "~{v0;q=hello%20world}");
    assert_eq!(field(&inc, "q"), (Outcome::Match, Some(0.6)));
    let tok = compare("~{v0;q=a%20b%20c%20d}", "~{v0;q=a%20b%20x%20d}");
    // shared {a,b,d} over union {a,b,c,d,x}
    assert_eq!(field(&tok, "q"), (Outcome::Match, Some(0.6)));
    let none = compare("~{v0;q=aaa}", "~{v0;q=bbb}");
    assert_eq!(field(&none, "q"), (Outcome::Conflict, Some(0.0)));
}

#[test]
fn compare_accepts_every_encoding() {
    let debug = "~{v0;fh=xxh64:aabbccdd;a=intro}";
    let c1 = compare(debug, debug);
    assert_eq!(c1.verdict, Verdict::Same);
}

// ---- rank ----

#[test]
fn rank_puts_exact_fh_first() {
    let r = rank(
        "~{v0;fh=xxh64:aabbccdd}",
        &["~{v0;fh=xxh64:11223344;p=h1[1]}", "~{v0;fh=xxh64:aabbccdd}"],
    );
    assert_eq!(r[0].reference, "~{v0;fh=xxh64:aabbccdd}");
    assert_eq!(r[0].comparison.verdict, Verdict::Same);
    assert_eq!(r[0].rank, 1);
}

#[test]
fn rank_of_nothing_is_empty() {
    assert!(rank::<&str>("~{v0;fh=xxh64:aabbccdd}", &[]).is_empty());
}

#[test]
fn rank_reports_ties() {
    let r = rank("~{v0;a=intro}", &["~{v0;a=intro}", "~{v0;a=intro}"]);
    assert_eq!((r[0].rank, r[1].rank), (1, 1));
}

#[test]
fn rank_competition_numbering_skips_after_a_tie() {
    let r = rank(
        "~{v0;a=intro}",
        &["~{v0;a=other;fh=xxh64:1}", "~{v0;a=intro}", "~{v0;a=intro}"],
    );
    assert_eq!(r.iter().map(|x| x.rank).collect::<Vec<_>>(), [1, 1, 3]);
}

#[test]
fn rank_reports_the_input_position() {
    let r = rank(
        "~{v0;a=intro}",
        &["~{v0;a=other;fh=xxh64:1}", "bogus", "~{v0;a=intro}"],
    );
    assert_eq!(r.iter().map(|x| x.index).collect::<Vec<_>>(), [2, 0, 1]);
}

#[test]
fn rank_invalid_candidate_sorts_last() {
    let r = rank(
        "~{v0;fh=xxh64:aabbccdd}",
        &[
            "not a reference",
            "~{v0;fh=xxh64:aabbccdd}",
            "~{v0;fh=xxh64:11223344;p=h1[1]}",
        ],
    );
    assert_eq!(r[0].comparison.verdict, Verdict::Same);
    assert_eq!(r[2].comparison.verdict, Verdict::Invalid);
    assert_eq!(r[2].reference, "not a reference");
}

#[test]
fn rank_invalid_target_makes_everything_invalid() {
    let r = rank("not a reference", &["~{v0;fh=xxh64:aabbccdd}"]);
    assert_eq!(r[0].comparison.verdict, Verdict::Invalid);
}

#[test]
fn rank_incomparable_beats_unrelated() {
    let r = rank(
        "~{v0;fh=xxh64:aabbccdd;r=1:1-1:5}",
        &["~{v0;fh=xxh64:11223344;r=1:1-1:5}", "~{v0;r=10:1-10:5}"],
    );
    assert_eq!(r[0].comparison.verdict, Verdict::Incomparable);
    assert_eq!(r[1].comparison.verdict, Verdict::Unrelated);
}

#[test]
fn rank_is_stable_for_equal_entries() {
    // Same verdict and similarity: input order is kept.
    let r = rank(
        "~{v0;a=x}",
        &["~{v0;a=x;_n=1}", "~{v0;a=x;_n=2}", "~{v0;a=x;_n=3}"],
    );
    let order: Vec<_> = r.iter().map(|x| x.reference.as_str()).collect();
    assert_eq!(
        order,
        ["~{v0;a=x;_n=1}", "~{v0;a=x;_n=2}", "~{v0;a=x;_n=3}"]
    );
}

#[test]
fn rank_orders_by_similarity_within_a_class() {
    let r = rank(
        "~{v0;hh=smh64:0000000000000000}",
        &[
            "~{v0;hh=smh64:000000000000000f}",
            "~{v0;hh=smh64:0000000000000001}",
        ],
    );
    assert_eq!(r[0].reference, "~{v0;hh=smh64:0000000000000001}");
    assert!(r[0].comparison.similarity > r[1].comparison.similarity);
}

// ---- properties ----

mod props {
    use super::*;
    use proptest::prelude::*;

    /// A random debug reference built from a small field vocabulary, so that
    /// pairs frequently share fields (and sometimes tags).
    fn reference() -> impl Strategy<Value = String> {
        let hex = "[0-9a-f]{16}";
        (
            proptest::option::of("[a-f0-9]{4}"),
            proptest::option::of("[a-c]{1,2}"),
            proptest::option::of(hex),
            proptest::option::of(hex),
            proptest::option::of(hex),
            proptest::option::of((1u32..9, 1u32..9)),
            proptest::option::of(0usize..3),
            proptest::option::of("[a-c ]{1,8}"),
        )
            .prop_map(|(fh, a, hh, ph, doc, r, x, q)| {
                let mut f = vec!["v0".to_owned()];
                if let Some(v) = fh {
                    f.push(format!("fh=xxh64:{v}"));
                }
                if let Some(v) = a {
                    f.push(format!("a={v}"));
                }
                if let Some(v) = hh {
                    f.push(format!("hh=smh64:{v}"));
                }
                if let Some(v) = ph {
                    f.push(format!("ph=smh64:{v}"));
                }
                if let Some(v) = doc {
                    f.push(format!("doc=smh64:{v}"));
                }
                if let Some((l, n)) = r {
                    f.push(format!("r={l}:1-{}:2", l + n));
                }
                if let Some(i) = x {
                    f.push(format!("x={}", ["sec", "body", "lead"][i]));
                }
                if let Some(v) = q {
                    f.push(format!("q={}", v.replace(' ', "%20")));
                }
                format!("~{{{}}}", f.join(";"))
            })
    }

    proptest! {
        #[test]
        fn compare_is_symmetric(a in reference(), b in reference()) {
            let (ab, ba) = (compare(&a, &b), compare(&b, &a));
            prop_assert_eq!(ab.verdict, ba.verdict);
            prop_assert_eq!(ab.similarity, ba.similarity);
            prop_assert_eq!(ab.comparability, ba.comparability);
        }

        #[test]
        fn scores_stay_in_unit_interval(a in reference(), b in reference()) {
            let c = compare(&a, &b);
            prop_assert!((0.0..=1.0).contains(&c.similarity));
            prop_assert!((0.0..=1.0).contains(&c.comparability));
        }

        #[test]
        fn a_reference_is_never_unrelated_to_itself(a in reference()) {
            let c = compare(&a, &a);
            prop_assert!(!matches!(c.verdict, Verdict::Unrelated | Verdict::Invalid));
        }

        #[test]
        fn no_comparability_means_incomparable(a in reference(), b in reference()) {
            let c = compare(&a, &b);
            prop_assert_eq!(c.comparability == 0.0, c.verdict == Verdict::Incomparable);
        }

        #[test]
        fn rank_is_a_sorted_permutation_with_competition_ranks(
            target in reference(),
            cands in proptest::collection::vec(reference(), 0..8),
        ) {
            let ranked = rank(&target, &cands);
            let mut got: Vec<_> = ranked.iter().map(|r| r.reference.clone()).collect();
            let mut want = cands.clone();
            got.sort();
            want.sort();
            prop_assert_eq!(got, want);
            for (i, r) in ranked.iter().enumerate() {
                let expected = ranked[..=i]
                    .iter()
                    .position(|p| p.comparison.verdict == r.comparison.verdict
                        && p.comparison.similarity == r.comparison.similarity)
                    .unwrap() + 1;
                prop_assert_eq!(r.rank, expected);
            }
        }

        #[test]
        fn rank_is_stable_and_deterministic(
            target in reference(),
            cands in proptest::collection::vec(reference(), 0..8),
        ) {
            prop_assert_eq!(rank(&target, &cands), rank(&target, &cands));
            // Reversing the input only permutes entries that tie.
            let mut rev = cands.clone();
            rev.reverse();
            let key = |v: &[md_manipulator::mrfi::Ranked]| -> Vec<(usize, &'static str)> {
                v.iter().map(|r| (r.rank, r.comparison.verdict.as_str())).collect()
            };
            prop_assert_eq!(key(&rank(&target, &cands)), key(&rank(&target, &rev)));
        }
    }
}
