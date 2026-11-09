//! Which files a command works on, and the git diff restricting them.

use crate::args::{CliError, Options, Result};
use crate::config;
use crate::ctx::Ctx;
use crate::ignore::{self, Rule};
use critique_core::review;
use std::collections::BTreeSet;

/// Added lines per file.
pub type AddedLines = Vec<(String, BTreeSet<usize>)>;

/// Ignore rules: state directories, then the ignore file.
pub fn read_rules(ctx: &Ctx<'_>) -> Vec<Rule> {
    let mut rules: Vec<Rule> = config::default_ignore_patterns(ctx.host, &ctx.settings)
        .iter()
        .filter_map(|p| ignore::compile(p))
        .collect();
    let file = config::ignore_file(ctx.host, &ctx.settings);
    if let Ok(text) = ctx.host.read_to_string(&file) {
        rules.extend(
            text.split('\n')
                .map(|l| l.strip_suffix('\r').unwrap_or(l))
                .filter_map(ignore::compile),
        );
    }
    rules
}

/// `git rev-parse --is-inside-work-tree`.
pub fn inside_work_tree(ctx: &Ctx<'_>) -> bool {
    ctx.host
        .git(&["rev-parse", "--is-inside-work-tree"])
        .is_some_and(|o| o.success && o.stdout.trim() == "true")
}

fn git_status_files(ctx: &Ctx<'_>) -> Result<Vec<String>> {
    let out = ctx
        .host
        .git(&[
            "-c",
            "core.quotePath=false",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ])
        .ok_or_else(|| CliError("git status failed".into()))?;
    if !out.success {
        return Err(CliError(if out.stderr.is_empty() {
            "git status failed".into()
        } else {
            out.stderr
        }));
    }
    let entries: Vec<&str> = out.stdout.split('\0').collect();
    let mut files = Vec::new();
    let mut i = 0;
    while i < entries.len() {
        let entry = entries[i];
        i += 1;
        if entry.is_empty() {
            continue;
        }
        let status: String = entry.chars().take(2).collect();
        let file: String = entry.chars().skip(3).collect();
        if status.contains('D') {
            continue;
        }
        if status.starts_with(['R', 'C']) {
            i += 1;
        }
        if ctx.host.is_file(&file) {
            files.push(file);
        }
    }
    Ok(unique(ctx, files))
}

fn unique(ctx: &Ctx<'_>, files: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for f in files {
        let rel = ctx.rel(&f);
        if !out.contains(&rel) {
            out.push(rel);
        }
    }
    out
}

pub fn resolve_review_files(
    ctx: &Ctx<'_>,
    explicit: &[String],
    rules: &[Rule],
) -> Result<Vec<String>> {
    if !explicit.is_empty() {
        return Ok(explicit.to_vec());
    }
    if ctx.has_session() {
        return Ok(ctx
            .read_session()?
            .files
            .into_iter()
            .map(|f| f.path)
            .collect());
    }
    if !inside_work_tree(ctx) {
        return Ok(Vec::new());
    }
    let mut files = git_status_files(ctx)?;
    files.extend(ignore::files_included_by_rules(ctx.host, rules));
    Ok(unique(ctx, files))
}

/// `git diff HEAD --unified=0` for `files`.
pub fn worktree_diff(ctx: &Ctx<'_>, files: &[String]) -> Result<String> {
    let mut args = vec![
        "-c",
        "core.quotePath=false",
        "diff",
        "--no-color",
        "--unified=0",
        "--no-ext-diff",
        "HEAD",
        "--",
    ];
    args.extend(files.iter().map(String::as_str));
    let out = ctx
        .host
        .git(&args)
        .ok_or_else(|| CliError("git diff failed".into()))?;
    if !out.success {
        return Err(CliError(if out.stderr.is_empty() {
            "git diff failed".into()
        } else {
            out.stderr
        }));
    }
    Ok(out.stdout)
}

/// Files and (with `--git`) the added lines.
pub fn resolve_files_and_diff(
    ctx: &Ctx<'_>,
    options: &Options,
    rules: &[Rule],
) -> Result<(Vec<String>, Option<AddedLines>)> {
    let files = resolve_review_files(ctx, &options.files, rules)?;
    if !options.git {
        return Ok((files, None));
    }
    let diff = worktree_diff(ctx, &files)?;
    Ok((files, Some(review::added_lines_by_file(&diff))))
}

/// Drops ignored files.
pub fn filter_ignored(ctx: &Ctx<'_>, files: Vec<String>, rules: &[Rule]) -> Vec<String> {
    if rules.is_empty() {
        return files;
    }
    files
        .into_iter()
        .filter(|f| !ignore::is_ignored(&ctx.rel(f), rules))
        .collect()
}

/// Drops ignored files unless the user named files explicitly.
pub fn filter_implicit_ignored(
    ctx: &Ctx<'_>,
    files: Vec<String>,
    rules: &[Rule],
    explicit: &[String],
) -> Vec<String> {
    if explicit.is_empty() {
        filter_ignored(ctx, files, rules)
    } else {
        files
    }
}

/// Added lines of `file`, if the diff is in use.
pub fn lines_of<'a>(
    added: Option<&'a AddedLines>,
    rel: &str,
) -> Option<Option<&'a BTreeSet<usize>>> {
    added.map(|a| a.iter().find(|(f, _)| f == rel).map(|(_, l)| l))
}
