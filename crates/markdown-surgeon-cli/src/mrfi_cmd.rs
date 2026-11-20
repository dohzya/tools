//! MRFI surface of the CLI: `ref`, `resolve`, `outline --mrfi` and the `~` /
//! `^` selectors of the editing commands.

use crate::cli::{MrfiGenerate, MrfiTarget};
use crate::error::Fail;
use md_manipulator::mrfi::{
    self, Extent, Format, GenerateOptions, MrfiDoc, Outcome, Profile, ResolveOptions,
    ResolveResult, SourceRange, Status, Target,
};
use md_manipulator::{Document, Edit};
use serde::{Serialize, Serializer};

type Res<T = ()> = Result<T, Fail>;

impl From<mrfi::MrfiError> for Fail {
    fn from(e: mrfi::MrfiError) -> Self {
        Fail::new("invalid_id", e.message())
    }
}

pub fn is_selector(s: &str) -> bool {
    s.starts_with(['~', '^'])
}

pub fn parse_format(value: &str) -> Res<Format> {
    match value {
        "debug" => Ok(Format::Debug),
        "base62" => Ok(Format::Base62),
        "hangul" => Ok(Format::Hangul),
        _ => Err(Fail::parse(format!(
            "Invalid MRFI format: {value}. Expected debug, base62, or hangul"
        ))),
    }
}

pub fn parse_profile(value: &str) -> Res<Profile> {
    match value {
        "min" => Ok(Profile::Min),
        "default" => Ok(Profile::Default),
        "full" => Ok(Profile::Full),
        _ => Err(Fail::parse(format!(
            "Invalid MRFI profile: {value}. Expected min, default, or full"
        ))),
    }
}

fn parse_extent(value: &str) -> Res<Extent> {
    Extent::parse(value).ok_or_else(|| {
        Fail::parse(format!(
            "Invalid extent value: {value}. Expected sec, body, or lead"
        ))
    })
}

/// Format, profile and quote options as generation options.
pub fn generate_options(o: &MrfiGenerate) -> Res<GenerateOptions> {
    Ok(GenerateOptions {
        format: parse_format(&o.format)?,
        profile: parse_profile(&o.profile)?,
        quote: o.quote,
        quote_max: o.quote_max as usize,
        extent: None,
    })
}

/// `startLine:startColumn-endLine:endColumn`, columns in Unicode scalar values.
fn parse_source_range(value: &str) -> Res<SourceRange> {
    let bad = || {
        Fail::new(
            "invalid_id",
            format!(
                "Invalid source range: {value}\nExpected format: \
                 startLine:startColumn-endLine:endColumn (e.g. 3:1-3:18)"
            ),
        )
    };
    let (a, b) = value.split_once('-').ok_or_else(bad)?;
    let (sl, sc) = a.split_once(':').ok_or_else(bad)?;
    let (el, ec) = b.split_once(':').ok_or_else(bad)?;
    let n = |s: &str| -> Res<u64> {
        if s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()) {
            return Err(bad());
        }
        Ok(s.parse().unwrap_or(u64::MAX))
    };
    let r = SourceRange {
        start_line: n(sl)?,
        start_column: n(sc)?,
        end_line: n(el)?,
        end_column: n(ec)?,
    };
    if r.start_line < 1
        || r.start_column < 1
        || r.end_line < 1
        || r.end_column < 1
        || r.end_line < r.start_line
        || (r.end_line == r.start_line && r.end_column < r.start_column)
    {
        return Err(bad());
    }
    Ok(r)
}

pub fn ref_cmd(
    read_file: impl Fn(&str) -> Res<String>,
    file_or_ref: &str,
    range: Option<&str>,
    opts: &MrfiGenerate,
) -> Res<String> {
    let options = generate_options(opts)?;
    let Some(range) = range else {
        let parsed = mrfi::parse_reference(file_or_ref)?.ok_or_else(|| {
            Fail::new(
                "invalid_id",
                format!("Unsupported MRFI reference for conversion: {file_or_ref}"),
            )
        })?;
        return Ok(mrfi::format_mrfi(&parsed, options.format)?);
    };
    let doc = MrfiDoc::new(&read_file(file_or_ref)?);
    let range = parse_source_range(range)?;
    Ok(mrfi::generate(&doc, Target::Range(range), &options)?)
}

struct ResolveInput {
    reference: String,
    witness: Option<String>,
}

fn parse_resolve_input(input: &str) -> Res<ResolveInput> {
    if input.starts_with('^') {
        if input.len() == 1 {
            return Err(Fail::new(
                "invalid_id",
                format!("Invalid anchor reference: {input}"),
            ));
        }
        return Ok(ResolveInput {
            reference: input.to_owned(),
            witness: None,
        });
    }
    if input.starts_with('~') {
        let (reference, witness) = split_witness(input);
        if witness.is_some_and(str::is_empty) {
            return Err(Fail::new(
                "invalid_id",
                format!("Empty witness text is not allowed: {input}"),
            ));
        }
        if reference.len() == 1 {
            return Err(Fail::new(
                "invalid_id",
                format!("Invalid MRFI reference: {input}"),
            ));
        }
        return Ok(ResolveInput {
            reference: reference.to_owned(),
            witness: witness.map(str::to_owned),
        });
    }
    Err(Fail::new(
        "invalid_id",
        format!("Invalid reference: {input}"),
    ))
}

/// `~ref::witness`; a debug reference ends at its first `}`.
fn split_witness(input: &str) -> (&str, Option<&str>) {
    if let Some(rest) = input.strip_prefix("~{") {
        if let Some(close) = rest.find('}')
            && let Some(witness) = rest[close + 1..].strip_prefix("::")
        {
            return (&input[..close + 3], Some(witness));
        }
        return (input, None);
    }
    match input.find("::") {
        Some(i) => (&input[..i], Some(&input[i + 2..])),
        None => (input, None),
    }
}

pub fn resolve_cmd(text: &str, inputs: &[String], json: bool) -> Res<String> {
    let doc = MrfiDoc::new(text);
    let mut results = vec![];
    for input in inputs {
        let parsed = parse_resolve_input(input)?;
        let options = ResolveOptions {
            witness: parsed.witness.as_deref(),
            extent: None,
        };
        results.push(mrfi::resolve(&doc, &parsed.reference, &options));
    }
    Ok(if json {
        crate::output::json(&results.iter().map(ResultJson::from).collect::<Vec<_>>())
    } else {
        results
            .iter()
            .map(format_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    })
}

/// JS `Number.prototype.toFixed(2)`: halves round up (Rust's `{:.2}` rounds to even).
fn to_fixed_2(x: f64) -> String {
    let exact = format!("{:.40}", x.abs());
    let (int, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut cents: u64 = format!("{int}{}", &frac[..2]).parse().unwrap_or(0);
    if frac.as_bytes()[2] >= b'5' {
        cents += 1;
    }
    let sign = if x < 0.0 && cents > 0 { "-" } else { "" };
    format!("{sign}{}.{:02}", cents / 100, cents % 100)
}

fn format_result(r: &ResolveResult) -> String {
    let mut header = vec![
        r.reference.clone(),
        r.status.as_str().to_owned(),
        to_fixed_2(r.confidence),
    ];
    if let Some(range) = &r.range {
        header.push(range.format());
    }
    if let Some(a) = r.anchor.as_deref().filter(|a| !a.is_empty()) {
        header.push(format!("^{a}"));
    }
    let mut lines = vec![header.join(" ")];
    if !r.diagnostics.is_empty() {
        lines.push(format!("reasons: {}", r.diagnostics.join(", ")));
    }
    if let Some(candidates) = r.candidates.as_ref().filter(|c| !c.is_empty()) {
        lines.push("candidates:".to_owned());
        for c in candidates {
            lines.push(format!(
                "- {} score {}: {}",
                c.range.format(),
                c.score,
                c.reasons.join(", ")
            ));
        }
    }
    if let Some(passage) = &r.passage {
        lines.push(String::new());
        lines.extend(passage.split('\n').map(|l| format!("    {l}")));
    }
    lines.join("\n")
}

/// A JS number: integral values print without a fraction, `NaN` as `null`.
struct Num(f64);

impl Serialize for Num {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if self.0.is_nan() {
            s.serialize_none()
        } else if self.0.fract() == 0.0 && self.0.abs() < 1e15 {
            s.serialize_i64(self.0 as i64)
        } else {
            s.serialize_f64(self.0)
        }
    }
}

#[derive(Serialize)]
struct CandidateJson<'a> {
    range: String,
    score: Num,
    reasons: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignalsJson {
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    exact_hash: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    unique_anchor: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    both_context: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    witness_agreement: bool,
}

/// Field order of the TS result objects.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultJson<'a> {
    #[serde(rename = "ref")]
    reference: &'a str,
    status: &'static str,
    confidence: Num,
    #[serde(skip_serializing_if = "Option::is_none")]
    range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    anchor: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    passage: Option<&'a str>,
    diagnostics: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    candidates: Option<Vec<CandidateJson<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strong_signals: Option<SignalsJson>,
}

impl<'a> From<&'a ResolveResult> for ResultJson<'a> {
    fn from(r: &'a ResolveResult) -> Self {
        Self {
            reference: &r.reference,
            status: r.status.as_str(),
            confidence: Num(r.confidence),
            range: r.range.as_ref().map(SourceRange::format),
            anchor: r.anchor.as_deref(),
            passage: r.passage.as_deref(),
            diagnostics: &r.diagnostics,
            candidates: r.candidates.as_ref().map(|c| {
                c.iter()
                    .map(|c| CandidateJson {
                        range: c.range.format(),
                        score: Num(c.score),
                        reasons: &c.reasons,
                    })
                    .collect()
            }),
            strong_signals: r.strong_signals.map(|s| SignalsJson {
                exact_hash: s.exact_hash,
                unique_anchor: s.unique_anchor,
                both_context: s.both_context,
                witness_agreement: s.witness_agreement,
            }),
        }
    }
}

/// `compare`: the verdict is the answer, so an invalid reference is reported
/// as `invalid` with exit status 0 (unlike `resolve`, which has nothing to
/// print for it).
pub fn compare_cmd(a: &str, b: &str, json: bool) -> String {
    let comparison = mrfi::compare(a, b);
    if json {
        crate::output::json(&ComparisonJson::from(&comparison))
    } else {
        format_comparison(&comparison)
    }
}

/// `rank`: candidates best first, ties sharing a rank.
pub fn rank_cmd(target: &str, candidates: &[String], json: bool) -> String {
    let ranked = mrfi::rank(target, candidates);
    if json {
        return crate::output::json(
            &ranked
                .iter()
                .map(|r| RankedJson {
                    rank: r.rank,
                    reference: &r.reference,
                    comparison: ComparisonJson::from(&r.comparison),
                })
                .collect::<Vec<_>>(),
        );
    }
    ranked
        .iter()
        .map(|r| {
            let detail = format_comparison(&r.comparison);
            let (head, rest) = detail.split_once('\n').unwrap_or((&detail, ""));
            let mut block = format!("#{} {} {}", r.rank, head, r.reference);
            for line in rest.lines() {
                block.push_str("\n    ");
                block.push_str(line);
            }
            block
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Header line, then the fields grouped by outcome (empty groups omitted).
fn format_comparison(c: &mrfi::Comparison) -> String {
    let mut lines = vec![format!(
        "{} similarity={} comparability={}",
        c.verdict.as_str(),
        to_fixed_2(c.similarity),
        to_fixed_2(c.comparability)
    )];
    for outcome in [Outcome::Match, Outcome::Conflict, Outcome::Absent] {
        let items: Vec<String> = c
            .fields
            .iter()
            .filter(|f| f.outcome == outcome)
            .map(|f| match f.similarity {
                Some(s) => format!("{}={}", f.field, to_fixed_2(s)),
                None => f.field.to_owned(),
            })
            .collect();
        if !items.is_empty() {
            lines.push(format!("{}: {}", outcome.as_str(), items.join(", ")));
        }
    }
    if !c.diagnostics.is_empty() {
        lines.push(format!("reasons: {}", c.diagnostics.join(", ")));
    }
    lines.join("\n")
}

#[derive(Serialize)]
struct FieldJson {
    field: &'static str,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    similarity: Option<Num>,
}

#[derive(Serialize)]
struct ComparisonJson<'a> {
    verdict: &'static str,
    similarity: Num,
    comparability: Num,
    fields: Vec<FieldJson>,
    diagnostics: &'a [String],
}

impl<'a> From<&'a mrfi::Comparison> for ComparisonJson<'a> {
    fn from(c: &'a mrfi::Comparison) -> Self {
        Self {
            verdict: c.verdict.as_str(),
            similarity: Num(c.similarity),
            comparability: Num(c.comparability),
            fields: c
                .fields
                .iter()
                .map(|f| FieldJson {
                    field: f.field,
                    outcome: f.outcome.as_str(),
                    similarity: f.similarity.map(Num),
                })
                .collect(),
            diagnostics: &c.diagnostics,
        }
    }
}

#[derive(Serialize)]
struct RankedJson<'a> {
    rank: usize,
    #[serde(rename = "ref")]
    reference: &'a str,
    #[serde(flatten)]
    comparison: ComparisonJson<'a>,
}

/// What an editing command acts on after resolving an MRFI selector.
pub struct Resolved {
    /// Identity section and extent of a scope reference.
    pub scope: Option<(usize, Extent)>,
    /// Resolved lines (1-based, inclusive) of a plain reference.
    pub lines: Option<(usize, usize)>,
}

/// Resolves a `~`/`^` selector for a destructive command: the safety gate
/// must pass; scope references yield their heading, others their lines.
pub fn resolve_for_mutation(text: &str, selector: &str, opts: &MrfiTarget) -> Res<Resolved> {
    let parsed = parse_resolve_input(selector)?;
    let override_extent = opts.extent.as_deref().map(parse_extent).transpose()?;
    let doc = MrfiDoc::new(text);
    let result = mrfi::resolve(
        &doc,
        &parsed.reference,
        &ResolveOptions {
            witness: parsed.witness.as_deref(),
            extent: override_extent,
        },
    );
    if let Err(reason) = mrfi::check_destructive_gate(&result, opts.strict, opts.force) {
        return Err(Fail::parse(format!(
            "Safety gate rejected: {reason} (ref: {}, status: {})",
            parsed.reference,
            result.status.as_str()
        )));
    }
    let embedded = result.diagnostics.iter().find_map(|d| {
        d.strip_prefix("extent selection: x=")
            .and_then(Extent::parse)
    });
    let extent = override_extent.or(embedded);
    let range = result.range.filter(|_| result.status != Status::Invalid);
    if let (Some(extent), Some(_)) = (extent, range) {
        // The identity heading, not the section found at the extent's first
        // line: a `body` extent may start at a sub-section's heading.
        return match result.scope_section {
            Some(section) => Ok(Resolved {
                scope: Some((section, extent)),
                lines: None,
            }),
            None => Err(Fail::parse(
                "Extent selection requires identity node to be a heading",
            )),
        };
    }
    let range = range.ok_or_else(|| Fail::parse("Resolved ref has no range"))?;
    Ok(Resolved {
        scope: None,
        lines: Some((range.start_line as usize, range.end_line as usize)),
    })
}

/// The section id of the `index`-th heading (the `Document` and `MrfiDoc`
/// section lists are parsed from the same text, so indices agree).
pub fn section_id(doc: &Document, index: usize) -> String {
    doc.sections()[index].id.clone()
}

pub enum Op<'a> {
    Write(&'a str),
    Append(&'a str, bool),
    Empty,
    Remove,
}

/// Applies a destructive command to a resolved MRFI selector.
pub fn apply(doc: &Document, resolved: &Resolved, op: Op) -> Res<Edit> {
    if let Some((section, extent)) = resolved.scope {
        let id = section_id(doc, section);
        let deep = extent != Extent::Lead;
        return Ok(match op {
            Op::Write(content) => doc.write(&id, content, deep)?,
            Op::Append(content, before) => doc.append(Some(&id), content, deep, before)?,
            Op::Empty => doc.empty(&id, deep)?,
            Op::Remove if extent == Extent::Sec => doc.remove(&id)?,
            Op::Remove => doc.empty(&id, deep)?,
        });
    }
    let (first, last) = resolved.lines.expect("plain reference has lines");
    Ok(match op {
        Op::Write(content) => doc.write_lines(first, last, content),
        Op::Append(content, before) => doc.append_lines(first, last, content, before),
        Op::Empty | Op::Remove => doc.remove_lines(first, last),
    })
}

/// `outline --mrfi` rows: the reference of each listed section.
pub fn section_references(
    text: &str,
    doc: &Document,
    sections: &[&md_manipulator::Section],
    opts: &MrfiGenerate,
) -> Res<Vec<String>> {
    let options = generate_options(opts)?;
    let mdoc = MrfiDoc::new(text);
    sections
        .iter()
        .map(|s| {
            let index = doc
                .sections()
                .iter()
                .position(|d| d.line == s.line)
                .expect("listed section belongs to the document");
            Ok(mrfi::generate(&mdoc, Target::Section(index), &options)?)
        })
        .collect()
}
