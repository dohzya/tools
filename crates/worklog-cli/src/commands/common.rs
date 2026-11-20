//! Helpers shared by the command handlers.

use crate::ctx::{Ctx, Res, fail};
use crate::scope::resolve_active_scope;
use serde::Serialize;
use worklog_core::error::Code;
use worklog_core::taskfile::normalize_desc;
use worklog_core::time;
use worklog_core::types::TraceKind;
use worklog_core::yaml::Value;

/// Prints a result as JSON or text.
pub fn emit<T: Serialize>(ctx: &mut Ctx, json: bool, out: &T, text: impl FnOnce() -> String) {
    let s = if json { to_json(out) } else { text() };
    ctx.println(&s);
}

/// `JSON.stringify`
pub fn to_json<T: Serialize>(out: &T) -> String {
    serde_json::to_string(out).unwrap_or_default()
}

/// `resolveScopeContext`: acts in the scope selected by `--scope` or by the
/// nearest worklog. Returns the original directory and the git root.
pub fn scope_context(
    ctx: &mut Ctx,
    scope: Option<&str>,
    explicit_worklog: bool,
) -> Res<(String, Option<String>)> {
    if explicit_worklog {
        if scope.is_some_and(|s| !s.is_empty()) {
            return fail(Code::InvalidArgs, "Cannot use --scope with --worklog-dir");
        }
        return Ok((ctx.cwd.clone(), None));
    }
    let cwd = ctx.cwd.clone();
    let git_root = ctx.ports.git.root(&cwd);
    let scope = scope.filter(|s| !s.is_empty());
    if scope.is_some() || git_root.is_some() {
        match resolve_active_scope(ctx, &cwd, scope, git_root.as_deref()) {
            Ok(active) => {
                let dir = active[..active.len().saturating_sub(ctx.wl_dir.len() + 1)].to_string();
                if !dir.is_empty() && dir != cwd {
                    ctx.cwd = dir;
                }
            }
            Err(e) => {
                if scope.is_some() {
                    return Err(e);
                }
            }
        }
    }
    Ok((cwd, git_root))
}

/// `--scope` makes the git root irrelevant for id resolution.
pub fn root_for_ids<'a>(scope: Option<&str>, git_root: &'a Option<String>) -> Option<&'a str> {
    if scope.is_some_and(|s| !s.is_empty()) {
        None
    } else {
        git_root.as_deref()
    }
}

/// `--meta key=value` options; keys must be non-empty.
pub fn parse_meta_option(values: &[String]) -> Option<Vec<(String, String)>> {
    let mut out: Vec<(String, String)> = Vec::new();
    for kv in values {
        if let Some(i) = kv.find('=')
            && i > 0
        {
            let (k, v) = (kv[..i].to_string(), kv[i + 1..].to_string());
            match out.iter_mut().find(|(ek, _)| *ek == k) {
                Some(slot) => slot.1 = v,
                None => out.push((k, v)),
            }
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

/// `parseTraceKind`
pub fn parse_trace_kind(value: &str) -> Res<TraceKind> {
    match TraceKind::parse(value) {
        Some(k) => Ok(k),
        None => fail(
            Code::InvalidArgs,
            format!(
                "Invalid trace kind: {value}. Expected one of: {}",
                TraceKind::ALL
                    .iter()
                    .map(|k| k.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ),
    }
}

/// `parseTraceKindList`
pub fn parse_trace_kind_list(value: Option<&str>) -> Res<Vec<TraceKind>> {
    match value.filter(|v| !v.is_empty()) {
        None => Ok(Vec::new()),
        Some(v) => v.split(',').map(|k| parse_trace_kind(k.trim())).collect(),
    }
}

/// Handles `--timestamp` as `parseFlexibleTimestamp` does, or fails with the
/// message of the CLI.
pub fn flexible_timestamp(ctx: &Ctx, input: &str) -> Res<String> {
    let today = time::local_date(ctx.ports.clock.as_ref());
    match time::parse_flexible_timestamp(input, &today) {
        Some(t) => Ok(t),
        None => fail(
            Code::InvalidArgs,
            format!("Invalid timestamp format: {input}. Use format [YYYY-MM-DD]THH:mm[:SS][<tz>]"),
        ),
    }
}

/// Reads a `--desc-src` value: `-` is stdin, anything else a file.
pub fn read_desc_src(ctx: &Ctx, source: &str) -> Res<String> {
    if source == "-" {
        return ctx
            .ports
            .env
            .read_stdin()
            .or_else(|_| fail(Code::IoError, "Failed to read stdin"));
    }
    Ok(ctx.read_text_raw(source)?)
}

/// Description parts from several `--desc-src`.
pub fn desc_src_parts(ctx: &Ctx, sources: &[String]) -> Res<Vec<String>> {
    if sources.iter().any(|s| s == "-") && sources.len() > 1 {
        return fail(
            Code::InvalidArgs,
            "--desc-src - cannot be combined with other --desc-src values",
        );
    }
    let mut parts = Vec::new();
    for s in sources {
        parts.push(read_desc_src(ctx, s)?);
    }
    Ok(normalize_desc(Some(&Value::Seq(
        parts.into_iter().map(Value::Str).collect(),
    ))))
}

/// Description parts from `--desc` values.
pub fn desc_parts(values: &[String]) -> Vec<String> {
    values.iter().filter(|p| !p.is_empty()).cloned().collect()
}

/// Reads the system clipboard.
pub fn read_clipboard(ctx: &Ctx) -> Res<String> {
    let candidates: Vec<Vec<&str>> = match ctx.ports.env.os() {
        "darwin" => vec![vec!["pbpaste"]],
        "linux" => vec![
            vec!["wl-paste", "--no-newline"],
            vec!["xclip", "-selection", "clipboard", "-o"],
            vec!["xsel", "--clipboard", "--output"],
        ],
        "windows" => vec![vec![
            "powershell.exe",
            "-NoProfile",
            "-Command",
            "Get-Clipboard -Raw",
        ]],
        _ => vec![],
    };
    for c in &candidates {
        let cmd: Vec<String> = c.iter().map(|s| s.to_string()).collect();
        if let Some(out) = ctx.ports.proc_.capture(&cmd) {
            return Ok(out);
        }
    }
    let tried = if candidates.is_empty() {
        "no clipboard command configured for this platform".to_string()
    } else {
        candidates
            .iter()
            .map(|c| c[0])
            .collect::<Vec<_>>()
            .join(", ")
    };
    fail(
        Code::IoError,
        format!("Could not read clipboard. Tried: {tried}"),
    )
}

/// `Value` for a list of strings.
pub fn str_seq(items: &[String]) -> Value {
    Value::Seq(items.iter().cloned().map(Value::Str).collect())
}
