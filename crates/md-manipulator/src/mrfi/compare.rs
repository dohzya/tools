//! `compare(A, B)` and `rank(target, candidates)`: field-by-field comparison
//! of two references without resolving them (spec: `docs/specs/mrfi.md`,
//! "Comparing References Without Resolving"). Pure: no document involved.
//!
//! The thresholds below are implementation-defined by the spec; they are
//! the ones of the TS implementation so that verdicts stay comparable.

use super::{
    DEFAULT_SMH64_MAX_DISTANCE, Extent, FuzzyHash, Mrfi, SourceRange, hamming,
    must_understand_violations, normalize_for_compare, parse_reference,
};
use std::collections::HashSet;

/// Result of comparing one field present (or not) on both sides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Both sides agree (graded fields: similarity above the match threshold).
    Match,
    /// Both sides carry the field and disagree.
    Conflict,
    /// Not comparable: missing on a side, different hash tags, or positional
    /// evidence without a compatible `doc`. Contributes neither way.
    Absent,
}

impl Outcome {
    /// `match`, `conflict` or `absent`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Match => "match",
            Self::Conflict => "conflict",
            Self::Absent => "absent",
        }
    }
}

/// Overall verdict of a comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Exact-strong agreement (`fh` or `a`) with no conflicting content evidence.
    Same,
    /// High similarity, good comparability, no strong conflict.
    Likely,
    /// Some agreement, but thin or mixed evidence.
    Possible,
    /// No shared field of sufficient strength: "cannot tell", not "different".
    Incomparable,
    /// Strong conflicts.
    Unrelated,
    /// A side is not a valid locator; nothing was compared.
    Invalid,
}

impl Verdict {
    /// Lowercase name, as printed by `md compare`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Same => "same",
            Self::Likely => "likely",
            Self::Possible => "possible",
            Self::Incomparable => "incomparable",
            Self::Unrelated => "unrelated",
            Self::Invalid => "invalid",
        }
    }

    /// Position in the normative `rank` order (smaller = tried first).
    /// `incomparable` precedes `unrelated`: ranking orders resolution
    /// attempts and an incomparable candidate has no evidence against it.
    /// `invalid` goes last: the input itself was rejected.
    fn class(self) -> u8 {
        match self {
            Self::Same => 0,
            Self::Likely => 1,
            Self::Possible => 2,
            Self::Incomparable => 3,
            Self::Unrelated => 4,
            Self::Invalid => 5,
        }
    }
}

/// Comparison of one field.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldComparison {
    /// Spec field name (`fh`, `a`, `hh`, `ph`, `ctx`, `p`, `doc`, `r`, `o`, `q`, `x`).
    pub field: &'static str,
    /// Agreement.
    pub outcome: Outcome,
    /// Graded similarity in `[0, 1]`; `None` when absent (and for `x`).
    pub similarity: Option<f64>,
}

/// Result of `compare(A, B)`.
#[derive(Debug, Clone, PartialEq)]
pub struct Comparison {
    /// `0..=1`, weighted over the shared fields (`x` excluded).
    pub similarity: f64,
    /// `0..=1`, share of the strong-evidence weight both sides carry.
    pub comparability: f64,
    /// The verdict.
    pub verdict: Verdict,
    /// Every field, in a fixed order, absent ones included.
    pub fields: Vec<FieldComparison>,
    /// Human-readable reasons.
    pub diagnostics: Vec<String>,
}

/// One candidate of [`rank`].
#[derive(Debug, Clone, PartialEq)]
pub struct Ranked {
    /// Position of the candidate in the input, for callers whose candidates
    /// carry more than the reference string (duplicated strings included).
    pub index: usize,
    /// The candidate exactly as given.
    pub reference: String,
    /// 1-based competition rank: ties share a rank, the next one skips.
    pub rank: usize,
    /// Comparison against the target.
    pub comparison: Comparison,
}

/// Weights roughly follow the "Strength" column of the spec. `x` has none:
/// it is not evidence about location, it only caps the verdict.
fn weight(field: &str) -> f64 {
    match field {
        "fh" | "a" => 5.0,
        "ph" => 4.0,
        "hh" | "ctx" | "q" => 3.0,
        "p" | "doc" => 2.0,
        "r" | "o" => 1.0,
        _ => 0.0,
    }
}

/// Strong fields count toward comparability; `r` and `o` are weak alone.
const STRONG_FIELDS: [&str; 8] = ["fh", "a", "hh", "ph", "ctx", "p", "doc", "q"];
const FIELD_MATCH_THRESHOLD: f64 = 0.6;
const LIKELY_SIMILARITY_THRESHOLD: f64 = 0.7;
const LIKELY_COMPARABILITY_THRESHOLD: f64 = 0.5;

fn invalid(diagnostic: impl Into<String>) -> Comparison {
    Comparison {
        similarity: 0.0,
        comparability: 0.0,
        verdict: Verdict::Invalid,
        fields: vec![],
        diagnostics: vec![diagnostic.into()],
    }
}

fn parse(reference: &str) -> Result<Mrfi, String> {
    match parse_reference(reference) {
        Ok(Some(m)) => Ok(m),
        Ok(None) => Err("unsupported MRFI payload".to_owned()),
        Err(e) => Err(e.message().to_owned()),
    }
}

/// `compare(A, B)` on reference strings (any encoding). Never fails: a
/// reference that cannot be accepted makes the verdict `invalid`.
pub fn compare(a: &str, b: &str) -> Comparison {
    match (parse(a), parse(b)) {
        (Ok(a), Ok(b)) => compare_locators(&a, &b),
        (Err(e), _) | (_, Err(e)) => invalid(e),
    }
}

/// `compare` on decoded locators.
pub fn compare_locators(a: &Mrfi, b: &Mrfi) -> Comparison {
    let violations: Vec<String> = must_understand_violations(a)
        .into_iter()
        .chain(must_understand_violations(b))
        .collect();
    if !violations.is_empty() {
        return invalid(format!(
            "must-understand field violation: {}",
            violations.join(", ")
        ));
    }

    let doc = smh64("doc", a.document_hash, b.document_hash);
    let doc_compatible = doc.outcome == Outcome::Match;
    let fields = vec![
        compare_fh(a, b),
        equality("a", a.anchor.as_deref(), b.anchor.as_deref()),
        smh64("hh", a.heading_hash, b.heading_hash),
        smh64("ph", a.passage_hash, b.passage_hash),
        compare_ctx(a, b),
        compare_path(a.structural_path.as_deref(), b.structural_path.as_deref()),
        doc,
        compare_range(a.range, b.range, doc_compatible),
        compare_offsets(a, b, doc_compatible),
        compare_quote(a.quote.as_deref(), b.quote.as_deref()),
        compare_extent(a.extent, b.extent),
    ];
    let get = |name: &str| fields.iter().find(|f| f.field == name);
    let conflict = |name: &str| get(name).is_some_and(|f| f.outcome == Outcome::Conflict);

    let (mut weight_sum, mut score_sum) = (0.0, 0.0);
    for f in fields
        .iter()
        .filter(|f| f.field != "x" && f.outcome != Outcome::Absent)
    {
        let w = weight(f.field);
        weight_sum += w;
        score_sum += w * f.similarity.unwrap_or(0.0);
    }
    let similarity = if weight_sum == 0.0 {
        0.0
    } else {
        score_sum / weight_sum
    };
    let comparability = STRONG_FIELDS
        .iter()
        .filter(|n| get(n).is_some_and(|f| f.outcome != Outcome::Absent))
        .map(|n| weight(n))
        .sum::<f64>()
        / STRONG_FIELDS.iter().map(|n| weight(n)).sum::<f64>();

    // A distant `doc` only counts as a strong conflict together with
    // mismatching content evidence; `doc` alone says "other file", not
    // "other passage".
    let strong_conflict = conflict("fh")
        || conflict("a")
        || (conflict("doc") && ["hh", "ph", "q"].iter().any(|n| conflict(n)));

    let mut diagnostics = vec![];
    let mut verdict = if comparability == 0.0 {
        diagnostics.push("no shared field of sufficient strength".to_owned());
        Verdict::Incomparable
    } else if strong_conflict {
        Verdict::Unrelated
    } else if is_same(&fields) {
        Verdict::Same
    } else if similarity >= LIKELY_SIMILARITY_THRESHOLD
        && comparability >= LIKELY_COMPARABILITY_THRESHOLD
    {
        Verdict::Likely
    } else {
        Verdict::Possible
    };
    if conflict("x") && matches!(verdict, Verdict::Same | Verdict::Likely) {
        diagnostics.push("x mismatch: same identity node, different extent".to_owned());
        verdict = Verdict::Possible;
    }
    Comparison {
        similarity,
        comparability,
        verdict,
        fields,
        diagnostics,
    }
}

fn is_same(fields: &[FieldComparison]) -> bool {
    let outcome = |name: &str| fields.iter().find(|f| f.field == name).map(|f| f.outcome);
    if outcome("fh") == Some(Outcome::Match) {
        return true;
    }
    outcome("a") == Some(Outcome::Match)
        && !["fh", "hh", "ph", "q"]
            .iter()
            .any(|n| outcome(n) == Some(Outcome::Conflict))
}

fn absent(field: &'static str) -> FieldComparison {
    FieldComparison {
        field,
        outcome: Outcome::Absent,
        similarity: None,
    }
}

fn graded(field: &'static str, similarity: f64) -> FieldComparison {
    let outcome = if similarity >= FIELD_MATCH_THRESHOLD {
        Outcome::Match
    } else {
        Outcome::Conflict
    };
    FieldComparison {
        field,
        outcome,
        similarity: Some(similarity),
    }
}

fn exact(field: &'static str, equal: bool) -> FieldComparison {
    FieldComparison {
        field,
        outcome: if equal {
            Outcome::Match
        } else {
            Outcome::Conflict
        },
        similarity: Some(if equal { 1.0 } else { 0.0 }),
    }
}

/// Different hash tags are not comparable (spec, Locator Fields): reported
/// as absent rather than as proof of different content.
fn compare_fh(a: &Mrfi, b: &Mrfi) -> FieldComparison {
    match (&a.exact_hash, &b.exact_hash) {
        (Some(x), Some(y)) if x.algorithm == y.algorithm => exact("fh", x.prefix == y.prefix),
        _ => absent("fh"),
    }
}

fn equality(field: &'static str, a: Option<&str>, b: Option<&str>) -> FieldComparison {
    match (a, b) {
        (Some(x), Some(y)) => exact(field, x == y),
        _ => absent(field),
    }
}

fn smh64(field: &'static str, a: Option<FuzzyHash>, b: Option<FuzzyHash>) -> FieldComparison {
    let (Some(a), Some(b)) = (a, b) else {
        return absent(field);
    };
    let default = u64::from(DEFAULT_SMH64_MAX_DISTANCE);
    let max = a
        .max_distance
        .unwrap_or(default)
        .min(b.max_distance.unwrap_or(default));
    let distance = hamming(a.hash, b.hash);
    FieldComparison {
        field,
        outcome: if u64::from(distance) <= max {
            Outcome::Match
        } else {
            Outcome::Conflict
        },
        similarity: Some((1.0 - f64::from(distance) / 64.0).max(0.0)),
    }
}

/// Scored as the fraction of sides present on both references that agree,
/// so a two-sided match is stronger than a one-sided one.
fn compare_ctx(a: &Mrfi, b: &Mrfi) -> FieldComparison {
    let (Some(a), Some(b)) = (&a.context, &b.context) else {
        return absent("ctx");
    };
    let sides: Vec<bool> = [(&a.prefix, &b.prefix), (&a.suffix, &b.suffix)]
        .into_iter()
        .filter_map(|(l, r)| Some(l.as_ref()? == r.as_ref()?))
        .collect();
    if sides.is_empty() {
        return absent("ctx");
    }
    let agreeing = sides.iter().filter(|&&s| s).count();
    graded("ctx", agreeing as f64 / sides.len() as f64)
}

fn compare_path(a: Option<&str>, b: Option<&str>) -> FieldComparison {
    let (Some(a), Some(b)) = (a, b) else {
        return absent("p");
    };
    if a == b {
        return exact("p", true);
    }
    let (sa, sb): (Vec<_>, Vec<_>) = (a.split('/').collect(), b.split('/').collect());
    let common = sa.iter().zip(&sb).take_while(|(x, y)| x == y).count();
    graded("p", common as f64 / sa.len().max(sb.len()) as f64)
}

/// `r` and `o` are meaningless across unrelated documents: they take part
/// only when `doc` is compatible. Range overlap is measured in lines.
fn compare_range(
    a: Option<SourceRange>,
    b: Option<SourceRange>,
    doc_compatible: bool,
) -> FieldComparison {
    let (Some(a), Some(b), true) = (a, b, doc_compatible) else {
        return absent("r");
    };
    // f64: line numbers read from a stored reference may be up to u64::MAX
    // (the parser saturates), where `+ 1` in integers would overflow.
    let (a_start, a_end) = (a.start_line as f64, a.end_line as f64);
    let (b_start, b_end) = (b.start_line as f64, b.end_line as f64);
    let overlap = (a_end.min(b_end) - a_start.max(b_start) + 1.0).max(0.0);
    let span = a_end.max(b_end) - a_start.min(b_start) + 1.0;
    overlap_field("r", overlap / span)
}

fn compare_offsets(a: &Mrfi, b: &Mrfi, doc_compatible: bool) -> FieldComparison {
    let (Some(a), Some(b), true) = (a.offset_range, b.offset_range, doc_compatible) else {
        return absent("o");
    };
    // end > start is guaranteed by the codec, so neither difference can underflow.
    let overlap = a.end.min(b.end).saturating_sub(a.start.max(b.start)) as f64;
    let span = (a.end.max(b.end) - a.start.min(b.start)) as f64;
    overlap_field("o", if span == 0.0 { 0.0 } else { overlap / span })
}

fn overlap_field(field: &'static str, overlap: f64) -> FieldComparison {
    FieldComparison {
        field,
        outcome: if overlap > 0.0 {
            Outcome::Match
        } else {
            Outcome::Conflict
        },
        similarity: Some(overlap),
    }
}

fn compare_quote(a: Option<&str>, b: Option<&str>) -> FieldComparison {
    let (Some(a), Some(b)) = (a, b) else {
        return absent("q");
    };
    let (na, nb) = (normalize_for_compare(a), normalize_for_compare(b));
    let similarity = if na == nb {
        1.0
    } else if na.contains(&nb) || nb.contains(&na) {
        0.6
    } else {
        token_overlap(&na, &nb)
    };
    graded("q", similarity)
}

fn token_overlap(a: &str, b: &str) -> f64 {
    let tokens = |s: &str| {
        s.split(' ')
            .filter(|t| !t.is_empty())
            .map(str::to_owned)
            .collect::<HashSet<_>>()
    };
    let (ta, tb) = (tokens(a), tokens(b));
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    ta.intersection(&tb).count() as f64 / ta.union(&tb).count() as f64
}

/// `x` always takes part: its absence is a value (the plain extent), not
/// missing evidence. It carries no similarity (see [`weight`]).
fn compare_extent(a: Option<Extent>, b: Option<Extent>) -> FieldComparison {
    FieldComparison {
        field: "x",
        outcome: if a == b {
            Outcome::Match
        } else {
            Outcome::Conflict
        },
        similarity: None,
    }
}

/// `rank(target, candidates)`: candidates ordered by (verdict class,
/// similarity), best first; ties keep input order and share a rank. An
/// invalid target or candidate is reported as `invalid` (last), never
/// dropped, so one bad candidate cannot break the ranking of the others.
pub fn rank<S: AsRef<str>>(target: &str, candidates: &[S]) -> Vec<Ranked> {
    let target = parse(target);
    let mut entries: Vec<(usize, String, Comparison)> = candidates
        .iter()
        .enumerate()
        .map(|(index, c)| {
            let c = c.as_ref();
            let comparison = match (&target, parse(c)) {
                (Ok(t), Ok(c)) => compare_locators(t, &c),
                (Err(e), _) => invalid(e.clone()),
                (_, Err(e)) => invalid(e),
            };
            (index, c.to_owned(), comparison)
        })
        .collect();
    // `sort_by` is stable: equal entries keep the caller's order.
    entries.sort_by(|(_, _, l), (_, _, r)| {
        l.verdict
            .class()
            .cmp(&r.verdict.class())
            .then(r.similarity.total_cmp(&l.similarity))
    });
    let mut out: Vec<Ranked> = Vec::with_capacity(entries.len());
    for (position, (index, reference, comparison)) in entries.into_iter().enumerate() {
        let rank = match out.last() {
            Some(p)
                if p.comparison.verdict == comparison.verdict
                    && p.comparison.similarity == comparison.similarity =>
            {
                p.rank
            }
            _ => position + 1,
        };
        out.push(Ranked {
            index,
            reference,
            rank,
            comparison,
        });
    }
    out
}
