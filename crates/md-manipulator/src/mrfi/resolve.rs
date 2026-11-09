//! Resolution of `^anchor` and `~mrfi` references against a document.
//!
//! A faithful port of the TS resolver: evidence is combined in the same order
//! and with the same thresholds, so statuses, confidences, diagnostics and
//! candidate lists match.

use super::blocks::BlockTree;
use super::codec::{
    Context, Extent, FuzzyHash, Mrfi, SourceRange, must_understand_violations, parse_reference,
};
use super::doc::MrfiDoc;
use super::generate::{ParsedPath, node_source, parse_path};
use super::text::{
    DEFAULT_SMH64_MAX_DISTANCE, hamming, hash_signal_for, js_trim, normalize_for_compare,
    sha256_prefix, smh64,
};
use super::{Format, GenerateOptions, Profile, Target, generate};

/// Outcome class of a resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// A single candidate agrees with exact evidence.
    Exact,
    /// A single best candidate with a clear margin.
    Confident,
    /// Several candidates cannot be separated.
    Ambiguous,
    /// Location known, content changed.
    Stale,
    /// No candidate anywhere.
    NotFound,
    /// The locator cannot be decoded or violates the format.
    Invalid,
}

impl Status {
    /// `exact`, `confident`, `ambiguous`, `stale`, `not_found`, `invalid`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Confident => "confident",
            Self::Ambiguous => "ambiguous",
            Self::Stale => "stale",
            Self::NotFound => "not_found",
            Self::Invalid => "invalid",
        }
    }
}

/// An alternate candidate of an ambiguous resolution.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// Range at `line:col` precision (scalar columns).
    pub range: SourceRange,
    /// Evidence score (an integer, except `NaN` for a zero max distance).
    pub score: f64,
    /// Why it is a candidate.
    pub reasons: Vec<String>,
}

/// Which strong locator signals backed the result (destructive-edit gate).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StrongSignals {
    /// `fh` matched.
    pub exact_hash: bool,
    /// A unique anchor matched.
    pub unique_anchor: bool,
    /// Both context hashes matched.
    pub both_context: bool,
    /// The witness equals the passage.
    pub witness_agreement: bool,
}

impl StrongSignals {
    fn any(&self) -> bool {
        self.exact_hash || self.unique_anchor || self.both_context || self.witness_agreement
    }
}

/// The resolution of one reference.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolveResult {
    /// The requested reference (witness stripped).
    pub reference: String,
    /// Outcome class.
    pub status: Status,
    /// 0 to 1.
    pub confidence: f64,
    /// Resolved range, scalar columns.
    pub range: Option<SourceRange>,
    /// Matched anchor id.
    pub anchor: Option<String>,
    /// Resolved source text.
    pub passage: Option<String>,
    /// Human-readable evidence messages.
    pub diagnostics: Vec<String>,
    /// Candidates (ambiguous results).
    pub candidates: Option<Vec<Candidate>>,
    /// Strong signals, when any.
    pub strong_signals: Option<StrongSignals>,
    /// Index of the identity heading when an extent was applied. `range` is
    /// then the extent, which may start inside a sub-section: editing hosts
    /// must use this rather than the section found at `range`.
    pub scope_section: Option<usize>,
}

/// Inputs besides the document and the reference.
#[derive(Debug, Clone, Copy, Default)]
pub struct ResolveOptions<'a> {
    /// Caller's expected text, same evidence semantics as `q` (preferred over it).
    pub witness: Option<&'a str>,
    /// Overrides the reference's `x`.
    pub extent: Option<Extent>,
}

/// Minimum confidence of a `confident` status.
pub const CONFIDENT_THRESHOLD: f64 = 0.75;
const FUZZY_HEADING_AMBIGUITY_MARGIN: u32 = 3;
const MAX_EXACT_HASH_SEARCH_UNITS: i64 = 1_500_000;

const C_AMBIGUOUS_DUPLICATE_ANCHOR: f64 = 0.6;
const C_RANGE_STRONG_EVIDENCE: f64 = 0.86;
const C_RANGE_WITH_PH: f64 = 0.78;
const C_RANGE_PH_SUPPRESSES_FH: f64 = 0.72;
const C_PH_DISAMBIGUATION: f64 = 0.78;
const C_RANGE_STALE: f64 = 0.55;
const C_AMBIGUOUS_EXACT_HASH: f64 = 0.7;
const C_STALE_EXACT_HASH_EVIDENCE: f64 = 0.6;
const C_AMBIGUOUS_CONTEXT: f64 = 0.65;
const C_CONTEXT_FULL: f64 = 0.88;
const C_CONTEXT_PARTIAL: f64 = 0.78;
const C_STRUCTURAL: f64 = 0.78;
const C_STALE_STRUCTURAL_EVIDENCE: f64 = 0.6;
const C_STALE_NO_FUZZY: f64 = 0.45;
const C_AMBIGUOUS_FUZZY: f64 = 0.65;
const C_STALE_FUZZY_EVIDENCE: f64 = 0.6;
const C_FUZZY_WITH_EVIDENCE_MIN: f64 = 0.86;

impl ResolveResult {
    fn bare(reference: &str, status: Status, confidence: f64, diagnostic: &str) -> Self {
        Self {
            reference: reference.to_owned(),
            status,
            confidence,
            range: None,
            anchor: None,
            passage: None,
            diagnostics: vec![diagnostic.to_owned()],
            candidates: None,
            strong_signals: None,
            scope_section: None,
        }
    }
}

/// Safety gate for destructive operations: `Err(reason)` when not allowed.
pub fn check_destructive_gate(
    result: &ResolveResult,
    strict: bool,
    force: bool,
) -> Result<(), String> {
    if force {
        return Ok(());
    }
    let status = result.status.as_str();
    if strict {
        if result.status != Status::Exact {
            return Err(format!("strict mode requires exact status, got {status}"));
        }
    } else if !matches!(result.status, Status::Exact | Status::Confident) {
        return Err(format!("status must be exact or confident, got {status}"));
    }
    if !result.strong_signals.is_some_and(|s| s.any()) {
        return Err("no strong locator signal present".to_owned());
    }
    Ok(())
}

/// Resolves `reference` (`^anchor` or `~mrfi`, witness already split off).
pub fn resolve(doc: &MrfiDoc, reference: &str, options: &ResolveOptions) -> ResolveResult {
    if reference.starts_with('^') {
        let result = resolve_anchor(doc, reference);
        return match options.extent {
            None => result,
            Some(x) => apply_extent(doc, result, Some(x), None, options.witness),
        };
    }
    resolve_mrfi(doc, reference, options)
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

fn full_line_range(doc: &MrfiDoc, start: usize, end: usize) -> SourceRange {
    SourceRange {
        start_line: start as u64,
        start_column: 1,
        end_line: end as u64,
        end_column: doc.line_end_column(end) as u64,
    }
}

fn resolve_anchor(doc: &MrfiDoc, reference: &str) -> ResolveResult {
    let anchor = &reference[1..];
    let lines = doc.anchor_lines(anchor);
    if lines.is_empty() {
        return ResolveResult::bare(reference, Status::NotFound, 0.0, "anchor not found");
    }
    if lines.len() > 1 {
        let mut result = ResolveResult::bare(
            reference,
            Status::Ambiguous,
            C_AMBIGUOUS_DUPLICATE_ANCHOR,
            "duplicate anchor",
        );
        result.anchor = Some(anchor.to_owned());
        result.candidates = Some(
            lines
                .iter()
                .map(|&l| Candidate {
                    range: full_line_range(doc, l, l),
                    score: 60.0,
                    reasons: vec!["anchor occurrence".to_owned()],
                })
                .collect(),
        );
        return result;
    }
    let line = lines[0];
    let (start, end) = match doc.section_containing_line(line) {
        Some(i) => (doc.sections()[i].line, doc.trimmed_end_line(i)),
        None => (line, line),
    };
    let mut result = ResolveResult::bare(reference, Status::Exact, 1.0, "unique anchor matched");
    result.range = Some(full_line_range(doc, start, end));
    result.anchor = Some(anchor.to_owned());
    result.passage = Some(doc.lines_text(start, end));
    result.strong_signals = Some(StrongSignals {
        unique_anchor: true,
        ..StrongSignals::default()
    });
    result
}

fn resolve_mrfi(doc: &MrfiDoc, reference: &str, options: &ResolveOptions) -> ResolveResult {
    let parsed = match parse_reference(reference) {
        Err(e) => {
            return ResolveResult::bare(reference, Status::Invalid, 0.0, e.message());
        }
        Ok(None) => {
            return ResolveResult::bare(
                reference,
                Status::Invalid,
                0.0,
                "unsupported MRFI payload",
            );
        }
        Ok(Some(p)) => p,
    };
    let violations = must_understand_violations(&parsed);
    if !violations.is_empty() {
        return ResolveResult::bare(
            reference,
            Status::Invalid,
            0.0,
            &format!("must-understand field violation: {}", violations.join(", ")),
        );
    }
    let mut resolver = Resolver::new(doc);
    let result = resolver.core(reference, &parsed, options.witness);
    let extent = options.extent.or(parsed.extent);
    apply_extent(
        doc,
        result,
        extent,
        parsed.quote.as_deref(),
        options.witness,
    )
}

struct Evidence<'a> {
    label: &'static str,
    text: &'a str,
}

fn evidence<'a>(parsed_quote: Option<&'a str>, witness: Option<&'a str>) -> Option<Evidence<'a>> {
    match (witness, parsed_quote) {
        (Some(w), _) => Some(Evidence {
            label: "witness text",
            text: w,
        }),
        (None, Some(q)) => Some(Evidence {
            label: "quote",
            text: q,
        }),
        _ => None,
    }
}

fn includes_normalized(haystack: &str, needle: &str) -> bool {
    normalize_for_compare(haystack).contains(&normalize_for_compare(needle))
}

/// CAS check: equal (not merely overlapping) under the `fh` normalization;
/// an empty witness never qualifies.
fn is_strong_witness(passage: &str, ev: &Option<Evidence>) -> bool {
    let Some(ev) = ev else { return false };
    let expected = normalize_for_compare(ev.text);
    !expected.is_empty() && normalize_for_compare(passage) == expected
}

fn strong(flags: StrongSignals) -> Option<StrongSignals> {
    flags.any().then_some(flags)
}

fn expected_fragment_length(parsed: &Mrfi) -> Option<i64> {
    if let Some(o) = &parsed.offset_range {
        return Some(o.end as i64 - o.start as i64);
    }
    parsed.range.as_ref().and_then(|r| {
        (r.start_line == r.end_line).then(|| r.end_column as i64 - r.start_column as i64)
    })
}

struct Resolver<'a> {
    doc: &'a MrfiDoc,
    chars: &'a [char],
    // 0 unknown, 1 no, 2 yes. Context hashes are recomputed for every window
    // length at every offset by the scans, so the answer is cached per offset.
    prefix_cache: Vec<u8>,
    suffix_cache: Vec<u8>,
}

impl<'a> Resolver<'a> {
    fn new(doc: &'a MrfiDoc) -> Self {
        let n = doc.chars().len() + 1;
        Self {
            doc,
            chars: doc.chars(),
            prefix_cache: vec![0; n],
            suffix_cache: vec![0; n],
        }
    }

    fn prefix_matches_at(&mut self, ctx: &Context, start: usize) -> bool {
        let Some(expected) = ctx.prefix.as_deref().filter(|p| !p.is_empty()) else {
            return false;
        };
        if start < self.prefix_cache.len() && self.prefix_cache[start] != 0 {
            return self.prefix_cache[start] == 2;
        }
        let max = start.min(64);
        let found = (1..=max).any(|w| {
            let text: String = self.chars[start - w..start].iter().collect();
            sha256_prefix(&text, 8) == expected
        });
        if start < self.prefix_cache.len() {
            self.prefix_cache[start] = if found { 2 } else { 1 };
        }
        found
    }

    fn suffix_matches_at(&mut self, ctx: &Context, end: usize) -> bool {
        let Some(expected) = ctx.suffix.as_deref().filter(|p| !p.is_empty()) else {
            return false;
        };
        if end < self.suffix_cache.len() && self.suffix_cache[end] != 0 {
            return self.suffix_cache[end] == 2;
        }
        let max = 64.min(self.chars.len().saturating_sub(end));
        let found = (1..=max).any(|w| {
            let text: String = self.chars[end..end + w].iter().collect();
            sha256_prefix(&text, 8) == expected
        });
        if end < self.suffix_cache.len() {
            self.suffix_cache[end] = if found { 2 } else { 1 };
        }
        found
    }

    fn context_diagnostics(
        &mut self,
        ctx: &Option<Context>,
        range: &SourceRange,
    ) -> Vec<&'static str> {
        let Some(ctx) = ctx else { return vec![] };
        let (start, end) = self.doc.offsets_of(range);
        let mut out = vec![];
        if ctx.prefix.as_deref().is_some_and(|p| !p.is_empty())
            && self.prefix_matches_at(ctx, start)
        {
            out.push("context prefix match");
        }
        if ctx.suffix.as_deref().is_some_and(|p| !p.is_empty()) && self.suffix_matches_at(ctx, end)
        {
            out.push("context suffix match");
        }
        out
    }

    fn core(&mut self, reference: &str, parsed: &Mrfi, witness: Option<&str>) -> ResolveResult {
        let doc = self.doc;
        let Some(range) = parsed.range else {
            return self
                .without_range(reference, parsed, witness)
                .unwrap_or_else(|| {
                    ResolveResult::bare(
                        reference,
                        Status::Invalid,
                        0.0,
                        "MRFI payload has no supported locator signal",
                    )
                });
        };
        if !doc.contains_range(&range) {
            return self
                .without_range(reference, parsed, witness)
                .unwrap_or_else(|| {
                    ResolveResult::bare(
                        reference,
                        Status::NotFound,
                        0.0,
                        "range is outside the document",
                    )
                });
        }
        let current = range;
        let anchor_result = parsed
            .anchor
            .as_deref()
            .filter(|a| !a.is_empty())
            .and_then(|a| anchor_signal(doc, reference, a));
        let anchor_contradicts = anchor_result.as_ref().is_some_and(|(line, _)| {
            !(current.start_line as usize <= *line && *line <= current.end_line as usize)
        });
        let passage = doc.range_text(&current);
        let mut diagnostics = vec!["range matched".to_owned()];
        let range_section = doc.section_containing_line(current.start_line as usize);
        let heading_text =
            range_section.map_or_else(|| passage.clone(), |s| doc.section_scope_text(s));
        let passage_smh = smh64(&passage);
        let heading_distance = parsed
            .heading_hash
            .map(|h| hamming(smh64(&heading_text), h.hash));
        if let Some(d) = heading_distance {
            diagnostics.push(format!("range smh64 distance {d}"));
        }
        let ph_distance = parsed.passage_hash.map(|h| hamming(passage_smh, h.hash));
        if let Some(d) = ph_distance {
            diagnostics.push(format!("range ph distance {d}"));
        }
        let ph_max = fuzzy_max(parsed.passage_hash);
        let ph_confirms = ph_distance.is_some_and(|d| d as u64 <= ph_max);
        let ph_contradicts = ph_distance.is_some_and(|d| d as u64 > ph_max);
        let exact_matched = parsed.exact_hash.as_ref().is_some_and(|h| {
            hash_signal_for(&h.algorithm, &passage).is_some_and(|p| p == h.prefix)
        });
        if exact_matched {
            diagnostics.push("range exact fragment hash matched".to_owned());
        }
        let ctx_diag = self.context_diagnostics(&parsed.context, &current);
        diagnostics.extend(ctx_diag.iter().map(|s| (*s).to_owned()));
        let prefix_matched = ctx_diag.contains(&"context prefix match");
        let suffix_matched = ctx_diag.contains(&"context suffix match");
        let ev = evidence(parsed.quote.as_deref(), witness);
        let ev_matched = ev
            .as_ref()
            .is_some_and(|e| includes_normalized(&passage, e.text));
        if let (true, Some(e)) = (ev_matched, &ev) {
            diagnostics.push(format!("{} matched", e.label));
        }

        if let Some((_, result)) = &anchor_result
            && anchor_contradicts
            && !exact_matched
            && ctx_diag.is_empty()
            && !ev_matched
        {
            return result.clone();
        }

        let evidence_contradicts = ev.is_some() && !ev_matched;
        let exact_failed = parsed.exact_hash.is_some() && !exact_matched;
        let exact_contradicts = exact_failed && !ph_confirms;
        let ctx_contradicts = has_context_signal(&parsed.context) && ctx_diag.is_empty();
        let heading_contradicts = heading_distance
            .is_some_and(|d| d as u64 > fuzzy_max(parsed.heading_hash))
            && !ph_confirms;
        let anchor_contradiction_weak =
            anchor_contradicts && !exact_matched && ctx_diag.is_empty() && !ev_matched;
        if evidence_contradicts
            || exact_contradicts
            || ctx_contradicts
            || heading_contradicts
            || ph_contradicts
            || anchor_contradiction_weak
        {
            if let (Some((_, result)), true) = (&anchor_result, anchor_contradicts) {
                return result.clone();
            }
            if let Some(r) = self.exact_hash_scan(reference, parsed, witness) {
                return r;
            }
            if let Some(r) = self.context_scan(reference, parsed, witness) {
                return r;
            }
            if parsed.heading_hash.is_some() {
                let r = self.fuzzy_heading(reference, parsed, witness);
                if matches!(r.status, Status::Confident | Status::Ambiguous) {
                    return r;
                }
            }
            if let Some(r) = self.structural(reference, parsed, witness) {
                return r;
            }
        }

        let graded_contradiction =
            exact_contradicts || ctx_contradicts || heading_contradicts || ph_contradicts;
        let (status, confidence) = if ev.is_some() {
            if ev_matched {
                (Status::Confident, C_RANGE_STRONG_EVIDENCE)
            } else {
                (Status::Stale, C_RANGE_STALE)
            }
        } else if graded_contradiction {
            (Status::Stale, C_RANGE_STALE)
        } else if ph_confirms {
            (
                Status::Confident,
                if exact_failed {
                    C_RANGE_PH_SUPPRESSES_FH
                } else {
                    C_RANGE_WITH_PH
                },
            )
        } else {
            (Status::Confident, CONFIDENT_THRESHOLD)
        };
        let signals = strong(StrongSignals {
            exact_hash: exact_matched,
            both_context: prefix_matched && suffix_matched,
            witness_agreement: is_strong_witness(&passage, &ev),
            ..StrongSignals::default()
        });
        ResolveResult {
            reference: reference.to_owned(),
            status,
            confidence,
            range: Some(current),
            anchor: None,
            passage: Some(passage),
            diagnostics,
            candidates: None,
            strong_signals: signals,
            scope_section: None,
        }
    }

    fn without_range(
        &mut self,
        reference: &str,
        parsed: &Mrfi,
        witness: Option<&str>,
    ) -> Option<ResolveResult> {
        if let Some(a) = parsed.anchor.as_deref().filter(|a| !a.is_empty())
            && let Some((_, r)) = anchor_signal(self.doc, reference, a)
        {
            return Some(r);
        }
        if let Some(r) = self.exact_hash_scan(reference, parsed, witness) {
            return Some(r);
        }
        if let Some(r) = self.context_scan(reference, parsed, witness) {
            return Some(r);
        }
        if parsed.heading_hash.is_some() {
            let r = self.fuzzy_heading(reference, parsed, witness);
            if matches!(r.status, Status::Confident | Status::Ambiguous) {
                return Some(r);
            }
        }
        if let Some(r) = self.structural(reference, parsed, witness) {
            return Some(r);
        }
        if parsed.heading_hash.is_some() {
            return Some(self.fuzzy_heading(reference, parsed, witness));
        }
        None
    }

    fn exact_hash_scan(
        &mut self,
        reference: &str,
        parsed: &Mrfi,
        witness: Option<&str>,
    ) -> Option<ResolveResult> {
        let hash = parsed.exact_hash.as_ref()?;
        if hash.algorithm != "sha256" && hash.algorithm != "xxh64" {
            return None;
        }
        let candidate_length = expected_fragment_length(parsed);
        if candidate_length.is_some_and(|l| l <= 0) {
            return None;
        }
        struct Found {
            diagnostics: Vec<&'static str>,
            passage: String,
            range: SourceRange,
            score: i64,
        }
        let mut found: Vec<Found> = vec![];
        let len = self.chars.len();
        let mut budget = MAX_EXACT_HASH_SEARCH_UNITS;
        let collect =
            |this: &mut Self, budget: &mut i64, source_length: usize, found: &mut Vec<Found>| {
                if source_length > len {
                    return;
                }
                for start in 0..=(len - source_length) {
                    if *budget <= 0 {
                        return;
                    }
                    *budget -= source_length as i64;
                    let end = start + source_length;
                    let candidate: String = this.chars[start..end].iter().collect();
                    if hash_signal_for(&hash.algorithm, &candidate).as_deref() != Some(&hash.prefix)
                    {
                        continue;
                    }
                    let Some((ts, te)) = trim_boundary(this.chars, start, end) else {
                        continue;
                    };
                    let range = this.doc.range_from_offsets(ts, te);
                    if found.iter().any(|f| f.range == range) {
                        continue;
                    }
                    let diagnostics = this.context_diagnostics(&parsed.context, &range);
                    found.push(Found {
                        score: 25 + diagnostics.len() as i64 * 10,
                        diagnostics,
                        passage: this.chars[ts..te].iter().collect(),
                        range,
                    });
                }
            };
        if let Some(l) = candidate_length {
            collect(self, &mut budget, l as usize, &mut found);
        }
        if found.is_empty() {
            let min = candidate_length.map_or(1, |l| (l - 64).max(1)) as usize;
            let max = candidate_length.map_or(len.min(512), |l| len.min(l as usize + 64));
            for length in min..=max {
                if Some(length as i64) == candidate_length {
                    continue;
                }
                if budget <= 0 {
                    break;
                }
                collect(self, &mut budget, length, &mut found);
            }
        }
        if found.is_empty() {
            return None;
        }
        found.sort_by_key(|a| std::cmp::Reverse(a.score));
        let best_score = found[0].score;
        let same: Vec<&Found> = found.iter().filter(|c| c.score == best_score).collect();
        if same.len() > 1 {
            let mut result = ResolveResult::bare(
                reference,
                Status::Ambiguous,
                C_AMBIGUOUS_EXACT_HASH,
                "exact fragment hash match is ambiguous",
            );
            result.candidates = Some(
                same.iter()
                    .take(5)
                    .map(|c| {
                        let mut reasons = vec!["exact fragment hash match".to_owned()];
                        reasons.extend(c.diagnostics.iter().map(|s| (*s).to_owned()));
                        Candidate {
                            range: c.range,
                            score: c.score as f64,
                            reasons,
                        }
                    })
                    .collect(),
            );
            return Some(result);
        }
        let best = &found[0];
        let ev = evidence(parsed.quote.as_deref(), witness);
        let ev_matched = ev
            .as_ref()
            .is_some_and(|e| includes_normalized(&best.passage, e.text));
        let mut diagnostics = vec!["exact fragment hash match".to_owned()];
        diagnostics.extend(best.diagnostics.iter().map(|s| (*s).to_owned()));
        if let Some(e) = &ev {
            if ev_matched {
                diagnostics.push(format!("{} matched", e.label));
            } else {
                diagnostics.push(format!("{} did not match exact hash candidate", e.label));
            }
        }
        let mismatch = ev.is_some() && !ev_matched;
        Some(ResolveResult {
            reference: reference.to_owned(),
            status: if mismatch {
                Status::Stale
            } else {
                Status::Exact
            },
            confidence: if mismatch {
                C_STALE_EXACT_HASH_EVIDENCE
            } else {
                1.0
            },
            range: Some(best.range),
            anchor: None,
            passage: Some(best.passage.clone()),
            diagnostics,
            candidates: None,
            strong_signals: strong(StrongSignals {
                exact_hash: true,
                witness_agreement: is_strong_witness(&best.passage, &ev),
                ..StrongSignals::default()
            }),
            scope_section: None,
        })
    }

    fn context_scan(
        &mut self,
        reference: &str,
        parsed: &Mrfi,
        witness: Option<&str>,
    ) -> Option<ResolveResult> {
        let ctx = parsed.context.as_ref()?;
        let candidate_length = expected_fragment_length(parsed).filter(|&l| l > 0)? as usize;
        let has_prefix = ctx.prefix.as_deref().is_some_and(|p| !p.is_empty());
        let has_suffix = ctx.suffix.as_deref().is_some_and(|p| !p.is_empty());
        let signal_count = usize::from(has_prefix) + usize::from(has_suffix);
        if signal_count == 0 {
            return None;
        }
        struct Found {
            diagnostics: Vec<&'static str>,
            matched: usize,
            passage: String,
            range: SourceRange,
            score: i64,
        }
        let len = self.chars.len();
        let mut found: Vec<Found> = vec![];
        let max_variable = 128.max(candidate_length * 4);
        let bonus = |actual: usize| -> i64 {
            let delta = candidate_length.abs_diff(actual).min(5) as i64;
            (5 - delta).max(0)
        };
        if has_prefix && has_suffix {
            for start in 0..len {
                if !self.prefix_matches_at(ctx, start) {
                    continue;
                }
                for end in (start + 1)..=len.min(start + max_variable) {
                    if !self.suffix_matches_at(ctx, end) {
                        continue;
                    }
                    let range = self.doc.range_from_offsets(start, end);
                    found.push(Found {
                        diagnostics: vec!["context prefix match", "context suffix match"],
                        matched: 2,
                        passage: self.doc.range_text(&range),
                        range,
                        score: 20 + bonus(end - start),
                    });
                }
            }
        } else if has_prefix {
            for start in 0..len {
                if !self.prefix_matches_at(ctx, start) {
                    continue;
                }
                let end = len.min(start + candidate_length);
                if end <= start {
                    continue;
                }
                let range = self.doc.range_from_offsets(start, end);
                found.push(Found {
                    diagnostics: vec!["context prefix match"],
                    matched: 1,
                    passage: self.doc.range_text(&range),
                    range,
                    score: 10 + bonus(end - start),
                });
            }
        } else {
            for end in 1..=len {
                if !self.suffix_matches_at(ctx, end) {
                    continue;
                }
                let start = end.saturating_sub(candidate_length);
                if start >= end {
                    continue;
                }
                let range = self.doc.range_from_offsets(start, end);
                found.push(Found {
                    diagnostics: vec!["context suffix match"],
                    matched: 1,
                    passage: self.doc.range_text(&range),
                    range,
                    score: 10 + bonus(end - start),
                });
            }
        }
        if found.is_empty() {
            let single_line = parsed
                .range
                .as_ref()
                .is_some_and(|r| r.start_line == r.end_line);
            let mut start = 0;
            while start + candidate_length <= len {
                let range = self.doc.range_from_offsets(start, start + candidate_length);
                let diagnostics = self.context_diagnostics(&parsed.context, &range);
                if !diagnostics.is_empty() {
                    let same_line_shape = single_line && range.start_line == range.end_line;
                    found.push(Found {
                        matched: diagnostics.len(),
                        score: diagnostics.len() as i64 * 10 + i64::from(same_line_shape),
                        passage: self.doc.range_text(&range),
                        diagnostics,
                        range,
                    });
                }
                start += 1;
            }
        }
        found.sort_by_key(|a| std::cmp::Reverse(a.score));
        let best_score = found.first()?.score;
        let same: Vec<&Found> = found.iter().filter(|c| c.score == best_score).collect();
        if same.len() > 1 {
            if let Some((i, distance)) = ph_disambiguate(&same, parsed, |c| c.passage.clone()) {
                let c = same[i];
                let mut diagnostics: Vec<String> =
                    c.diagnostics.iter().map(|s| (*s).to_owned()).collect();
                diagnostics.push(format!("ph distance {distance}"));
                return Some(ResolveResult {
                    reference: reference.to_owned(),
                    status: Status::Confident,
                    confidence: C_PH_DISAMBIGUATION,
                    range: Some(c.range),
                    anchor: None,
                    passage: Some(c.passage.clone()),
                    diagnostics,
                    candidates: None,
                    strong_signals: None,
                    scope_section: None,
                });
            }
            let mut result = ResolveResult::bare(
                reference,
                Status::Ambiguous,
                C_AMBIGUOUS_CONTEXT,
                "context match is ambiguous",
            );
            result.candidates = Some(
                same.iter()
                    .take(5)
                    .map(|c| Candidate {
                        range: c.range,
                        score: c.score as f64,
                        reasons: c.diagnostics.iter().map(|s| (*s).to_owned()).collect(),
                    })
                    .collect(),
            );
            return Some(result);
        }
        let best = &found[0];
        let ev = evidence(parsed.quote.as_deref(), witness);
        let ev_matched = ev
            .as_ref()
            .is_some_and(|e| includes_normalized(&best.passage, e.text));
        let mut diagnostics: Vec<String> =
            best.diagnostics.iter().map(|s| (*s).to_owned()).collect();
        if let Some(e) = &ev {
            if ev_matched {
                diagnostics.push(format!("{} matched", e.label));
            } else {
                diagnostics.push(format!("{} did not match context candidate", e.label));
            }
        }
        Some(ResolveResult {
            reference: reference.to_owned(),
            status: if ev.is_some() && !ev_matched {
                Status::Stale
            } else {
                Status::Confident
            },
            confidence: if best.matched == signal_count {
                C_CONTEXT_FULL
            } else {
                C_CONTEXT_PARTIAL
            },
            range: Some(best.range),
            anchor: None,
            passage: Some(best.passage.clone()),
            diagnostics,
            candidates: None,
            strong_signals: strong(StrongSignals {
                both_context: best.matched == 2,
                witness_agreement: is_strong_witness(&best.passage, &ev),
                ..StrongSignals::default()
            }),
            scope_section: None,
        })
    }

    fn structural(
        &mut self,
        reference: &str,
        parsed: &Mrfi,
        witness: Option<&str>,
    ) -> Option<ResolveResult> {
        let path = parsed
            .structural_path
            .as_deref()
            .filter(|p| !p.is_empty())?;
        let range = self.range_from_path(path)?;
        let passage = self.doc.range_text(&range);
        let ev = evidence(parsed.quote.as_deref(), witness);
        let ev_matched = ev
            .as_ref()
            .is_some_and(|e| includes_normalized(&passage, e.text));
        let mut diagnostics = vec!["structural path match".to_owned()];
        if let Some(e) = &ev {
            if ev_matched {
                diagnostics.push(format!("{} matched", e.label));
            } else {
                diagnostics.push(format!("{} did not match structural candidate", e.label));
            }
        }
        let mismatch = ev.is_some() && !ev_matched;
        Some(ResolveResult {
            reference: reference.to_owned(),
            status: if mismatch {
                Status::Stale
            } else {
                Status::Confident
            },
            confidence: if mismatch {
                C_STALE_STRUCTURAL_EVIDENCE
            } else {
                C_STRUCTURAL
            },
            range: Some(range),
            anchor: None,
            strong_signals: strong(StrongSignals {
                witness_agreement: is_strong_witness(&passage, &ev),
                ..StrongSignals::default()
            }),
            passage: Some(passage),
            diagnostics,
            candidates: None,
            scope_section: None,
        })
    }

    fn range_from_path(&self, path: &str) -> Option<SourceRange> {
        let doc = self.doc;
        let ParsedPath {
            levels,
            occurrences,
            blocks,
        } = parse_path(path)?;
        let mut current: Option<usize> = None;
        for (level, occ) in levels.iter().zip(&occurrences) {
            let matches: Vec<usize> = (0..doc.sections().len())
                .filter(|&i| doc.sections()[i].level == *level && doc.parent_section(i) == current)
                .collect();
            current = Some(*matches.get(occ.checked_sub(1)?)?);
        }
        let (node_start, text) = node_source(doc, current);
        let (start, end) = if blocks.is_empty() {
            current?;
            (node_start, node_start + text.chars().count())
        } else {
            let (s, e) = BlockTree::parse(&text).range_for_steps(&blocks)?;
            (node_start + s, node_start + e)
        };
        (end <= self.chars.len()).then(|| doc.range_from_offsets(start, end))
    }

    fn fuzzy_heading(
        &mut self,
        reference: &str,
        parsed: &Mrfi,
        witness: Option<&str>,
    ) -> ResolveResult {
        let doc = self.doc;
        let Some(hh) = parsed.heading_hash else {
            return ResolveResult::bare(
                reference,
                Status::Invalid,
                0.0,
                "MRFI payload has no fuzzy heading hash",
            );
        };
        let max_distance = fuzzy_max(Some(hh));
        struct Cand {
            distance: u32,
            index: usize,
            score: f64,
        }
        let mut candidates: Vec<Cand> = (0..doc.sections().len())
            .map(|i| {
                let distance = hamming(smh64(&doc.section_scope_text(i)), hh.hash);
                let ratio = 1.0 - distance as f64 / max_distance as f64;
                // JS Math.round: halves round up; NaN stays NaN.
                let score = (10.0 * js_max(0.0, ratio) + 0.5).floor();
                Cand {
                    distance,
                    index: i,
                    score,
                }
            })
            .filter(|c| c.distance as u64 <= max_distance)
            .collect();
        candidates.sort_by_key(|c| c.distance);
        let Some(best) = candidates.first() else {
            return ResolveResult::bare(
                reference,
                Status::Stale,
                C_STALE_NO_FUZZY,
                "no fuzzy heading match",
            );
        };
        let section_passage =
            |i: usize| doc.lines_text(doc.sections()[i].line, doc.trimmed_end_line(i));
        if let Some(second) = candidates.get(1)
            && second.distance - best.distance < FUZZY_HEADING_AMBIGUITY_MARGIN
        {
            if parsed.passage_hash.is_some() {
                let tied: Vec<&Cand> = candidates
                    .iter()
                    .filter(|c| c.distance - best.distance < FUZZY_HEADING_AMBIGUITY_MARGIN)
                    .collect();
                if let Some((i, ph)) = ph_disambiguate(&tied, parsed, |c| section_passage(c.index))
                {
                    let w = tied[i];
                    let end = doc.trimmed_end_line(w.index);
                    let line = doc.sections()[w.index].line;
                    let mut r = ResolveResult::bare(
                        reference,
                        Status::Confident,
                        C_PH_DISAMBIGUATION,
                        "fuzzy heading match",
                    );
                    r.diagnostics.push(format!("smh64 distance {}", w.distance));
                    r.diagnostics.push(format!("ph distance {ph}"));
                    r.range = Some(full_line_range(doc, line, end));
                    r.passage = Some(section_passage(w.index));
                    return r;
                }
            }
            let mut r = ResolveResult::bare(
                reference,
                Status::Ambiguous,
                C_AMBIGUOUS_FUZZY,
                "fuzzy heading match is ambiguous",
            );
            r.candidates = Some(
                candidates
                    .iter()
                    .take(5)
                    .map(|c| Candidate {
                        range: full_line_range(
                            doc,
                            doc.sections()[c.index].line,
                            doc.trimmed_end_line(c.index),
                        ),
                        score: c.score,
                        reasons: vec![format!("smh64 distance {}", c.distance)],
                    })
                    .collect(),
            );
            return r;
        }
        let end = doc.trimmed_end_line(best.index);
        let passage = section_passage(best.index);
        let mut diagnostics = vec![
            "fuzzy heading match".to_owned(),
            format!("smh64 distance {}", best.distance),
        ];
        let ev = evidence(parsed.quote.as_deref(), witness);
        let ev_matched = ev
            .as_ref()
            .is_some_and(|e| includes_normalized(&passage, e.text));
        if let Some(e) = &ev {
            if ev_matched {
                diagnostics.push(format!("{} matched", e.label));
            } else {
                diagnostics.push(format!("{} did not match best candidate", e.label));
            }
        }
        let base = js_max(
            CONFIDENT_THRESHOLD,
            1.0 - best.distance as f64 / (max_distance as f64 * 2.0),
        );
        let confidence = match &ev {
            None => base,
            Some(_) if ev_matched => js_max(C_FUZZY_WITH_EVIDENCE_MIN, base),
            Some(_) => C_STALE_FUZZY_EVIDENCE,
        };
        ResolveResult {
            reference: reference.to_owned(),
            status: if ev.is_some() && !ev_matched {
                Status::Stale
            } else {
                Status::Confident
            },
            confidence,
            range: Some(full_line_range(doc, doc.sections()[best.index].line, end)),
            anchor: None,
            strong_signals: strong(StrongSignals {
                witness_agreement: is_strong_witness(&passage, &ev),
                ..StrongSignals::default()
            }),
            passage: Some(passage),
            diagnostics,
            candidates: None,
            scope_section: None,
        }
    }
}

fn fuzzy_max(h: Option<FuzzyHash>) -> u64 {
    h.and_then(|h| h.max_distance)
        .unwrap_or(DEFAULT_SMH64_MAX_DISTANCE as u64)
}

fn has_context_signal(ctx: &Option<Context>) -> bool {
    ctx.as_ref()
        .is_some_and(|c| c.prefix.is_some() || c.suffix.is_some())
}

fn trim_boundary(chars: &[char], start: usize, end: usize) -> Option<(usize, usize)> {
    let (mut s, mut e) = (start, end);
    while s < e && super::text::is_js_whitespace(chars[s]) {
        s += 1;
    }
    while e > s && super::text::is_js_whitespace(chars[e - 1]) {
        e -= 1;
    }
    (s < e).then_some((s, e))
}

/// Tries to separate tied candidates by `ph`; returns the winner's index and distance.
fn ph_disambiguate<T>(
    candidates: &[T],
    parsed: &Mrfi,
    passage: impl Fn(&T) -> String,
) -> Option<(usize, u32)> {
    let ph = parsed.passage_hash?;
    if candidates.len() < 2 {
        return None;
    }
    let max = fuzzy_max(Some(ph));
    let mut scored: Vec<(usize, u32)> = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| (i, hamming(smh64(&passage(c)), ph.hash)))
        .collect();
    scored.sort_by_key(|&(_, d)| d);
    let (best, second) = (scored[0], scored[1]);
    (best.1 as u64 <= max
        && (second.1 as u64 > max || second.1 - best.1 >= FUZZY_HEADING_AMBIGUITY_MARGIN))
        .then_some(best)
}

fn anchor_signal(doc: &MrfiDoc, reference: &str, anchor: &str) -> Option<(usize, ResolveResult)> {
    let lines = doc.anchor_lines(anchor);
    let first = *lines.first()?;
    let mut result = resolve_anchor(doc, &format!("^{anchor}"));
    if !matches!(result.status, Status::Exact | Status::Ambiguous) {
        return None;
    }
    result.reference = reference.to_owned();
    result
        .diagnostics
        .insert(0, "MRFI anchor signal".to_owned());
    Some((first, result))
}

fn apply_extent(
    doc: &MrfiDoc,
    mut result: ResolveResult,
    extent: Option<Extent>,
    quote: Option<&str>,
    witness: Option<&str>,
) -> ResolveResult {
    let Some(selector) = extent else {
        return result;
    };
    if matches!(result.status, Status::Invalid | Status::NotFound) {
        return result;
    }
    let Some(identity) = result.range else {
        return result;
    };
    let start_line = identity.start_line as usize;
    let section = doc
        .section_containing_line(start_line)
        .filter(|&i| doc.sections()[i].line == start_line);
    let Some(section) = section else {
        result.status = Status::Stale;
        result.confidence = result.confidence.min(C_RANGE_STALE);
        result
            .diagnostics
            .push("scope reference identity node is not a heading".to_owned());
        return result;
    };
    let (range, passage) = extent_range(doc, section, selector);
    let ev = evidence(quote, witness);
    let witness_match = is_strong_witness(&passage, &ev);
    let mut signals = result.strong_signals;
    if witness_match {
        signals
            .get_or_insert_with(StrongSignals::default)
            .witness_agreement = true;
    }
    if witness_match && !matches!(result.status, Status::Exact | Status::Confident) {
        result.status = Status::Confident;
        result.confidence = js_max(result.confidence, C_RANGE_STRONG_EVIDENCE);
    }
    result.range = Some(range);
    result.passage = Some(passage);
    result.scope_section = Some(section);
    result
        .diagnostics
        .push(format!("extent selection: x={}", selector.as_str()));
    if let (true, Some(e)) = (witness_match, &ev) {
        result
            .diagnostics
            .push(format!("{} matched extent", e.label));
    }
    result.strong_signals = signals;
    result
}

/// Range and text of the extent of heading `index`. For an empty extent the
/// range is the zero-length position at the start of the line after the heading.
pub fn extent_range(doc: &MrfiDoc, index: usize, selector: Extent) -> (SourceRange, String) {
    let section = &doc.sections()[index];
    let level = section.level;
    let mut terminator = doc.line_count() + 1;
    for next in &doc.sections()[index + 1..] {
        if selector == Extent::Lead || next.level <= level {
            terminator = next.line;
            break;
        }
    }
    let start = if selector == Extent::Sec {
        section.line
    } else {
        section.heading_last_line + 1
    };
    let mut end = terminator - 1;
    let blank = |l: usize| js_trim(&doc.line_string(l)).is_empty();
    while end >= start && blank(end) {
        end -= 1;
    }
    let empty = || {
        let line = (section.heading_last_line + 1) as u64;
        (
            SourceRange {
                start_line: line,
                start_column: 1,
                end_line: line,
                end_column: 1,
            },
            String::new(),
        )
    };
    if end < start {
        return empty();
    }
    let mut first = start;
    if selector != Extent::Sec {
        while first <= end && blank(first) {
            first += 1;
        }
        if first > end {
            return empty();
        }
    }
    let range = full_line_range(doc, first, end);
    let passage = doc.range_text(&range);
    (range, passage)
}

/// A reference re-pointed at its current location, or the resolution that prevented it.
#[derive(Debug, Clone, PartialEq)]
pub enum Refresh {
    /// Regenerated reference.
    Refreshed(String),
    /// Not exact or confident: the resolve result.
    Unresolved(Box<ResolveResult>),
}

/// Resolves `reference` and, when exact or confident, regenerates it for the resolved range.
pub fn refresh(doc: &MrfiDoc, reference: &str, format: Format, profile: Profile) -> Refresh {
    let result = resolve(doc, reference, &ResolveOptions::default());
    if let (Status::Exact | Status::Confident, Some(range)) = (result.status, result.range) {
        let options = GenerateOptions {
            format,
            profile,
            ..GenerateOptions::default()
        };
        if let Ok(r) = generate(doc, Target::Range(range), &options) {
            return Refresh::Refreshed(r);
        }
    }
    Refresh::Unresolved(Box::new(result))
}
