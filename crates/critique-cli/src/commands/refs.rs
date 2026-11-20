//! `ref check|list|show|snapshots`: passage references in documents.

use crate::args::{CliError, Result, err};
use crate::commands::list::{emit_paged, slash};
use crate::config;
use crate::ctx::Ctx;
use crate::files;
use crate::paths;
use crate::subargs::{self, Parsed, Spec};
use critique_core::refs::{self, Reference, Target};
use critique_core::{ids, review, scan};
use serde_json::{Value, json};
use std::path::Path;

const DEFAULT_SNAPSHOT_LINES: usize = 10;
const CHECK: Spec = Spec {
    flags: &["--json"],
    values: &[],
};
const LIST: Spec = Spec {
    flags: &["--json", "--pager", "--no-pager"],
    values: &[],
};
const SHOW: Spec = Spec {
    flags: &["--json"],
    values: &["--snapshot-lines"],
};
const SNAPSHOTS: Spec = Spec {
    flags: &["--json"],
    values: &["--snapshot-lines", "--ref"],
};

struct Located {
    file: String,
    text: String,
    reference: Reference,
}

fn ref_files(ctx: &Ctx<'_>, given: &[String]) -> Result<Vec<String>> {
    let rules = files::read_rules(ctx);
    let resolved = files::resolve_review_files(ctx, given, &rules)?;
    Ok(files::filter_implicit_ignored(ctx, resolved, &rules, given))
}

fn located_references(ctx: &Ctx<'_>, file_list: &[String]) -> Result<Vec<Located>> {
    let mut out = Vec::new();
    for file in file_list {
        if !ctx.host.exists(file) {
            continue;
        }
        let text = ctx.read_file(file)?;
        for reference in refs::collect_references(&text) {
            out.push(Located {
                file: file.clone(),
                text: text.clone(),
                reference,
            });
        }
    }
    Ok(out)
}

fn target_json(t: &Target) -> Value {
    let mut o = serde_json::Map::new();
    if let Some(r) = t.line_range {
        o.insert("lineRange".into(), json!({"end": r.end, "start": r.start}));
    }
    if let Some(m) = &t.mrfi {
        o.insert("mrfi".into(), json!(m));
    }
    o.insert("path".into(), json!(t.path));
    o.insert("raw".into(), json!(t.raw));
    if let Some(r) = &t.review_id {
        o.insert("reviewId".into(), json!(r));
    }
    if let Some(s) = &t.snapshot {
        o.insert(
            "snapshot".into(),
            json!({"content": s.content, "label": s.label, "raw": s.raw}),
        );
    }
    if let Some(s) = &t.stable_id {
        o.insert("stableId".into(), json!(s));
    }
    Value::Object(o)
}

fn reference_json(l: &Located) -> Value {
    let r = &l.reference;
    let mut o = serde_json::Map::new();
    o.insert("end".into(), json!(refs::utf16_offset(&l.text, r.end)));
    o.insert("index".into(), json!(r.index));
    o.insert("lineEnd".into(), json!(r.line_end));
    o.insert("lineStart".into(), json!(r.line_start));
    o.insert("raw".into(), json!(r.raw));
    o.insert("start".into(), json!(refs::utf16_offset(&l.text, r.start)));
    o.insert(
        "targets".into(),
        Value::Array(r.targets.iter().map(target_json).collect()),
    );
    if let Some(t) = &r.timestamp {
        o.insert("timestamp".into(), json!(t));
    }
    Value::Object(o)
}

/// `{ "version": 1, "<key>": value }`: serde_json's `Value` sorts keys, but the
/// documented output has `version` first.
fn versioned(key: &str, value: &Value) -> String {
    let body = serde_json::to_string_pretty(value)
        .unwrap_or_default()
        .replace('\n', "\n  ");
    format!("{{\n  \"version\": 1,\n  \"{key}\": {body}\n}}\n")
}

/// `./x` and `../x` are file-relative; other relative paths are relative to
/// the git root (else to the file).
fn target_file(ctx: &Ctx<'_>, source: &str, path: &str, git_root: Option<&Path>) -> String {
    let cwd = ctx.host.cwd();
    let abs = |p: &Path| paths::slashes(&paths::normalize(&cwd.join(p)));
    if Path::new(path).is_absolute() {
        return path.to_string();
    }
    let source_dir = Path::new(source).parent().unwrap_or_else(|| Path::new(""));
    if path.starts_with("./") || path.starts_with("../") {
        return abs(&source_dir.join(path));
    }
    match git_root {
        Some(root) => paths::slashes(&paths::normalize(&root.join(path))),
        None => abs(&source_dir.join(path)),
    }
}

fn excerpt(text: &str, range: refs::LineRange) -> String {
    let lines = critique_core::scan::lines(text);
    let start = (range.start as usize - 1).min(lines.len());
    let end = (range.end as usize).min(lines.len());
    lines[start..end].join("\n")
}

fn excerpt_of(ctx: &Ctx<'_>, target_path: &str, target: &Target) -> Result<Option<String>> {
    match target.line_range {
        Some(range) if ctx.host.exists(target_path) => {
            Ok(Some(excerpt(&ctx.read_file(target_path)?, range)))
        }
        _ => Ok(None),
    }
}

fn valid_debug_mrfi(reference: &str) -> bool {
    if !reference.ends_with('}') {
        return false;
    }
    let fields: Vec<&str> = reference[2..reference.len() - 1].split(';').collect();
    if fields.first() != Some(&"v0") {
        return false;
    }
    let mut seen: Vec<&str> = Vec::new();
    for field in &fields[1..] {
        let Some(sep) = field.find('=').filter(|&s| s > 0) else {
            return false;
        };
        let key = &field[..sep];
        if seen.contains(&key) || key.starts_with('!') {
            return false;
        }
        seen.push(key);
        if !valid_percent_encoding(&field[sep + 1..]) {
            return false;
        }
    }
    true
}

/// `decodeURIComponent` succeeds: every `%` starts two hex digits and the decoded bytes are UTF-8.
fn valid_percent_encoding(value: &str) -> bool {
    let b = value.as_bytes();
    let mut bytes = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = value
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok());
            match hex {
                Some(v) => bytes.push(v),
                None => return false,
            }
            i += 3;
        } else {
            bytes.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(bytes).is_ok()
}

fn valid_mrfi(reference: &str) -> bool {
    if reference.starts_with("~{") {
        return valid_debug_mrfi(reference);
    }
    if !reference.starts_with('~') || reference.len() == 1 {
        return false;
    }
    matches!(
        md_manipulator::mrfi::parse_reference(reference),
        Ok(Some(_))
    )
}

fn snapshot_matches_excerpt(snapshot: &str, excerpt: &str) -> bool {
    if refs::normalize_snapshot_content(snapshot) == refs::normalize_snapshot_content(excerpt) {
        return true;
    }
    let split = |v: &str| -> Vec<String> {
        let normalized = refs::normalize_snapshot_labels(v).replace("\r\n", "\n");
        let trimmed = md_manipulator::mrfi::js_trim(&normalized).to_string();
        if trimmed.is_empty() {
            Vec::new()
        } else {
            trimmed.split('\n').map(str::to_string).collect()
        }
    };
    let snapshot_lines = split(snapshot);
    let Some(last) = snapshot_lines.last() else {
        return false;
    };
    let last = md_manipulator::mrfi::js_trim(last);
    let omitted = last
        .strip_prefix("[ref snapshot truncated: ")
        .and_then(|r| r.strip_suffix(" omitted]"))
        .and_then(|r| r.strip_suffix(" lines").or_else(|| r.strip_suffix(" line")))
        .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|n| n.parse::<usize>().ok());
    let Some(omitted) = omitted else { return false };
    let prefix = &snapshot_lines[..snapshot_lines.len() - 1];
    let excerpt_lines = split(excerpt);
    if excerpt_lines.len() != prefix.len() + omitted {
        return false;
    }
    refs::normalize_snapshot_content(&prefix.join("\n"))
        == refs::normalize_snapshot_content(&excerpt_lines[..prefix.len()].join("\n"))
}

fn review_id_exists(ctx: &Ctx<'_>, file: &str, text: &str, review_id: &str) -> Result<bool> {
    let items = review::collect_review_items(text, false, review::Filter::All);
    // Keyed like `list`, by the cwd-relative path: ids hash the path, and an
    // absolute one would mint other ids (and a second map entry).
    let assigned = ctx.assign_ids(&ctx.rel(file), text, &items)?;
    Ok(crate::commands::session::resolve_prefix(review_id, &assigned).is_some())
}

struct Issue<'a> {
    kind: &'static str,
    message: String,
    located: &'a Located,
    target: Option<&'a Target>,
}

fn collect_issues<'a>(ctx: &Ctx<'_>, located: &'a [Located]) -> Result<Vec<Issue<'a>>> {
    let git_root = config::git_root(ctx.host);
    let mut issues = Vec::new();
    for item in located {
        for s in refs::validate_snapshots(&item.reference) {
            issues.push(Issue {
                kind: s.kind,
                message: format!("snapshot label {} is invalid", s.label),
                located: item,
                target: None,
            });
        }
        for target in &item.reference.targets {
            let issue = |kind, message: String| Issue {
                kind,
                message,
                located: item,
                target: Some(target),
            };
            if target.line_range.is_none() {
                issues.push(issue("invalid-target", "invalid target".into()));
                continue;
            }
            let path = target_file(ctx, &item.file, &target.path, git_root.as_deref());
            if !ctx.host.exists(&path) {
                issues.push(issue(
                    "missing-file",
                    format!("missing file {}", target.path),
                ));
                continue;
            }
            if let Some(m) = &target.mrfi
                && !valid_mrfi(m)
            {
                issues.push(issue("invalid-mrfi", format!("invalid MRFI reference {m}")));
            }
            let text = ctx.read_file(&path)?;
            if let Some(r) = &target.review_id
                && !review_id_exists(ctx, &path, &text, r)?
            {
                issues.push(issue(
                    "missing-review-id",
                    format!("missing review id ~{r}"),
                ));
            }
            if let Some(s) = &target.stable_id
                && !refs::collect_reference_ids(&text).contains(s)
            {
                issues.push(issue(
                    "missing-stable-id",
                    format!("missing stable ref id ^{s}"),
                ));
            }
            if let (Some(snapshot), Some(range)) = (&target.snapshot, target.line_range)
                && !snapshot_matches_excerpt(&snapshot.content, &excerpt(&text, range))
            {
                issues.push(issue("stale-snapshot", "stale snapshot".into()));
            }
        }
    }
    Ok(issues)
}

fn check(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let list = ref_files(ctx, &parsed.positional)?;
    let located = located_references(ctx, &list)?;
    let issues = collect_issues(ctx, &located)?;
    if parsed.flag("json") {
        let items: Vec<Value> = issues
            .iter()
            .map(|i| {
                let mut o = serde_json::Map::new();
                o.insert("kind".into(), json!(i.kind));
                o.insert("message".into(), json!(i.message));
                o.insert("reference".into(), reference_json(i.located));
                o.insert("sourceFile".into(), json!(i.located.file));
                if let Some(t) = i.target {
                    o.insert("target".into(), target_json(t));
                }
                Value::Object(o)
            })
            .collect();
        ctx.print(&versioned("issues", &json!(items)));
    } else if issues.is_empty() {
        ctx.print("ref check ok\n");
    } else {
        let text: String = issues
            .iter()
            .map(|i| {
                let target = i
                    .target
                    .map_or(String::new(), |t| format!(" {}", refs::format_target(t).0));
                format!(
                    "{}:{}{target}: {}\n",
                    slash(&i.located.file),
                    i.located.reference.line_start,
                    i.message
                )
            })
            .collect();
        ctx.print(&text);
    }
    if issues.is_empty() {
        Ok(())
    } else {
        err("ref check failed")
    }
}

fn indent(excerpt: &str) -> String {
    excerpt
        .split('\n')
        .map(|l| format!("  {}", l.strip_suffix('\r').unwrap_or(l)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn list(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let files_list = ref_files(ctx, &parsed.positional)?;
    let located = located_references(ctx, &files_list)?;
    let git_root = config::git_root(ctx.host);
    let mut items = Vec::new();
    let mut lines = Vec::new();
    for l in &located {
        for target in &l.reference.targets {
            let path = target_file(ctx, &l.file, &target.path, git_root.as_deref());
            let ex = excerpt_of(ctx, &path, target)?;
            let mut o = serde_json::Map::new();
            if let Some(e) = &ex {
                o.insert("excerpt".into(), json!(e));
            }
            o.insert("reference".into(), reference_json(l));
            o.insert("sourceFile".into(), json!(l.file));
            o.insert("target".into(), target_json(target));
            o.insert("targetFile".into(), json!(path));
            items.push(Value::Object(o));
            lines.push(format!(
                "{}:{} -> {}",
                slash(&l.file),
                l.reference.line_start,
                refs::format_target(target).1
            ));
            if let Some(e) = ex.filter(|e| !e.is_empty()) {
                lines.push(indent(&e));
            }
        }
    }
    if parsed.flag("json") {
        ctx.print(&versioned("refs", &json!(items)));
        return Ok(());
    }
    let text = if items.is_empty() {
        "No references found.\n".to_string()
    } else {
        format!("{}\n", lines.join("\n"))
    };
    let pager = if parsed.flag("no-pager") {
        Some(false)
    } else if parsed.flag("pager") {
        Some(true)
    } else {
        None
    };
    emit_paged(ctx, &text, pager, false)
}

fn snapshot_lines(parsed: &Parsed) -> Result<usize> {
    match parsed.value("snapshot-lines") {
        Some(v) if !v.is_empty() => {
            if v.bytes().all(|b| b.is_ascii_digit()) {
                v.parse()
                    .or_else(|_| err("--snapshot-lines expects a non-negative integer."))
            } else {
                err("--snapshot-lines expects a non-negative integer.")
            }
        }
        _ => Ok(DEFAULT_SNAPSHOT_LINES),
    }
}

fn label(reference: &Reference, target_index: usize) -> String {
    fn b36(mut n: usize) -> String {
        if n == 0 {
            return "0".into();
        }
        let mut out = Vec::new();
        while n > 0 {
            out.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[n % 36]);
            n /= 36;
        }
        out.reverse();
        String::from_utf8(out).unwrap_or_default()
    }
    format!(
        "r{}{}{}",
        b36(reference.line_start),
        b36(reference.index),
        b36(target_index + 1)
    )
}

fn limit_excerpt(excerpt: &str, max: usize) -> String {
    if max == 0 || excerpt.is_empty() {
        return excerpt.to_string();
    }
    let lines: Vec<&str> = excerpt
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    if lines.len() <= max {
        return excerpt.to_string();
    }
    let omitted = lines.len() - max;
    let mut out: Vec<String> = lines[..max].iter().map(|l| l.to_string()).collect();
    out.push(format!(
        "[ref snapshot truncated: {omitted} {} omitted]",
        if omitted == 1 { "line" } else { "lines" }
    ));
    out.join("\n")
}

fn generated_snapshot(
    reference: &Reference,
    target_index: usize,
    excerpt: &str,
    max: usize,
) -> String {
    let label = label(reference, target_index);
    format!("{{&&{label}\n{}\n{label}&&}}", limit_excerpt(excerpt, max))
}

fn show(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let list = ref_files(ctx, &parsed.positional)?;
    let max = snapshot_lines(parsed)?;
    if parsed.flag("json") {
        ctx.print(&versioned("files", &json!(list)));
        return Ok(());
    }
    let git_root = config::git_root(ctx.host);
    let mut rendered_files = Vec::new();
    for file in &list {
        let text = ctx.read_file(file)?;
        let references = refs::collect_references(&text);
        if references.is_empty() {
            rendered_files.push(if text.ends_with('\n') {
                text
            } else {
                format!("{text}\n")
            });
            continue;
        }
        let (mut out, mut cursor) = (String::new(), 0);
        for reference in &references {
            out.push_str(&text[cursor..reference.start]);
            let ts = reference
                .timestamp
                .as_ref()
                .map_or(String::new(), |t| format!("%{t}"));
            let rendered: Vec<String> = reference
                .targets
                .iter()
                .enumerate()
                .map(|(i, target)| {
                    if target.snapshot.is_some() {
                        return Ok(target.raw.clone());
                    }
                    let path = target_file(ctx, file, &target.path, git_root.as_deref());
                    let ex = excerpt_of(ctx, &path, target)?.unwrap_or_default();
                    Ok::<_, CliError>(format!(
                        "{} {}",
                        refs::format_target(target).0,
                        generated_snapshot(reference, i, &ex, max)
                    ))
                })
                .collect::<Result<_>>()?;
            if rendered.len() == 1 && !rendered[0].contains('\n') {
                out.push_str(&format!("<!-- ref{ts}: {} -->", rendered[0]));
            } else {
                out.push_str(&format!("<!-- ref{ts}:\n  {}\n-->", rendered.join(";\n  ")));
            }
            cursor = reference.end;
        }
        out.push_str(&text[cursor..]);
        rendered_files.push(if out.ends_with('\n') {
            out
        } else {
            format!("{out}\n")
        });
    }
    ctx.print(&rendered_files.join("\n"));
    Ok(())
}

fn snapshots(ctx: &mut Ctx<'_>, parsed: &Parsed) -> Result<()> {
    let list = ref_files(ctx, &parsed.positional)?;
    let max = snapshot_lines(parsed)?;
    let selectors = parsed.all("ref");
    let located = located_references(ctx, &list)?;
    let git_root = config::git_root(ctx.host);
    let mut json_items = Vec::new();
    let mut blocks = Vec::new();
    for l in &located {
        for (i, target) in l.reference.targets.iter().enumerate() {
            let path = target_file(ctx, &l.file, &target.path, git_root.as_deref());
            let ex = excerpt_of(ctx, &path, target)?.unwrap_or_default();
            let lbl = target
                .snapshot
                .as_ref()
                .map_or_else(|| label(&l.reference, i), |s| s.label.clone());
            let snapshot = target.snapshot.as_ref().map_or_else(
                || generated_snapshot(&l.reference, i, &ex, max),
                |s| s.raw.clone(),
            );
            let (canonical, location) = refs::format_target(target);
            let source = slash(&l.file);
            let candidates = [
                lbl.clone(),
                source.clone(),
                format!("{source}:{}", l.reference.line_start),
                canonical,
                location.clone(),
                target.raw.clone(),
            ];
            let selected = selectors.is_empty()
                || selectors.iter().any(|sel| {
                    candidates
                        .iter()
                        .any(|c| c == sel || c.ends_with(&format!("/{sel}")))
                });
            if !selected {
                continue;
            }
            json_items.push(json!({
                "label": lbl, "reference": reference_json(l), "snapshot": snapshot,
                "sourceFile": l.file, "target": target_json(target), "targetFile": path,
            }));
            blocks.push(format!(
                "{source}:{} -> {location} {lbl}\n{snapshot}",
                l.reference.line_start
            ));
        }
    }
    if parsed.flag("json") {
        ctx.print(&versioned("snapshots", &json!(json_items)));
    } else if blocks.is_empty() {
        ctx.print("No reference snapshots found.\n");
    } else {
        ctx.print(&format!("{}\n", blocks.join("\n\n")));
    }
    Ok(())
}

/// `ref <sub>`; `false` when `sub` is unknown.
pub fn run(ctx: &mut Ctx<'_>, sub: &str, rest: &[String]) -> Result<bool> {
    type Handler = fn(&mut Ctx<'_>, &Parsed) -> Result<()>;
    let (spec, handler): (Spec, Handler) = match sub {
        "check" => (CHECK, check),
        "list" => (LIST, list),
        "show" => (SHOW, show),
        "snapshots" => (SNAPSHOTS, snapshots),
        _ => return Ok(false),
    };
    handler(ctx, &subargs::parse(rest, &spec)?)?;
    let _ = (ids::PREFIX, scan::Kind::Addition);
    Ok(true)
}
