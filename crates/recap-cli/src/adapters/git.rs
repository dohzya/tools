//! Git adapter: shells out to the `git` binary, like the TS tool (no
//! libgit2: output must match what the user sees from `git` itself).

use crate::domain::ports::{GitInfo, GitStatusEntry, GitStatusResult};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};

/// Git queries through the `git` executable.
pub struct SystemGit;

struct GitOut {
    success: bool,
    stdout: String,
}

/// Runs git with explicit arguments (no shell, so `@{u}` and `^` are safe).
/// A missing git binary behaves like a failing command.
fn run_git(args: &[&str]) -> GitOut {
    match Command::new("git")
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    {
        Ok(out) => GitOut {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        },
        Err(_) => GitOut {
            success: false,
            stdout: String::new(),
        },
    }
}

fn git_dir(cwd: &str) -> Option<String> {
    let out = run_git(&["-C", cwd, "rev-parse", "--git-dir"]);
    if !out.success {
        return None;
    }
    let dir = out.stdout.trim();
    // git answers relative to cwd for a plain checkout.
    Some(if dir.starts_with('/') {
        dir.to_owned()
    } else {
        format!("{cwd}/{dir}")
    })
}

fn read_git_file(dir: &str, name: &str) -> Option<String> {
    std::fs::read(Path::new(dir).join(name))
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
}

fn short(hash: &str) -> String {
    hash.chars().take(7).collect()
}

#[derive(Clone, Copy, Default)]
struct DiffStats {
    additions: u64,
    deletions: u64,
}

fn parse_numstat(output: &str, stats: &mut HashMap<String, DiffStats>) {
    for line in output.split('\n') {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 3 {
            continue;
        }
        // Binary files report `-`: skipped.
        let (Ok(a), Ok(d)) = (fields[0].parse::<u64>(), fields[1].parse::<u64>()) else {
            continue;
        };
        let e = stats.entry(fields[2..].join("\t")).or_default();
        e.additions += a;
        e.deletions += d;
    }
}

/// Unstaged plus staged numstat, relative to `cwd`.
fn diff_stats(cwd: &str) -> HashMap<String, DiffStats> {
    let mut stats = HashMap::new();
    for extra in [&[][..], &["--cached"][..]] {
        let mut args = vec![
            "-C",
            cwd,
            "-c",
            "core.quotePath=false",
            "diff",
            "--relative",
        ];
        args.extend_from_slice(extra);
        args.extend(["--numstat", "--"]);
        parse_numstat(&run_git(&args).stdout, &mut stats);
    }
    stats
}

/// Untracked files have no diff: count their lines.
fn untracked_stats(cwd: &str, path: &str) -> Option<DiffStats> {
    let file = format!("{cwd}/{path}");
    if !std::fs::metadata(&file).ok()?.is_file() {
        return None;
    }
    let bytes = std::fs::read(&file).ok()?;
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count() as u64;
    let additions = match bytes.last() {
        None => 0,
        Some(b'\n') => newlines,
        Some(_) => newlines + 1,
    };
    Some(DiffStats {
        additions,
        deletions: 0,
    })
}

/// Undoes git's C-style quoting of paths (`"a\tb"`, octal UTF-8 bytes).
fn decode_quoted_path(path: &str) -> String {
    if !(path.starts_with('"') && path.ends_with('"') && path.len() >= 2) {
        return path.to_owned();
    }
    let inner = &path.as_bytes()[1..path.len() - 1];
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < inner.len() {
        if inner[i] != b'\\' {
            out.push(inner[i]);
            i += 1;
            continue;
        }
        let Some(&esc) = inner.get(i + 1) else {
            out.push(b'\\');
            i += 1;
            continue;
        };
        if (b'0'..=b'7').contains(&esc) {
            let digits: Vec<u8> = inner[i + 1..]
                .iter()
                .take(3)
                .take_while(|d| (b'0'..=b'7').contains(d))
                .copied()
                .collect();
            let value = digits
                .iter()
                .fold(0u32, |acc, d| acc * 8 + u32::from(d - b'0'));
            out.push(u8::try_from(value & 0xff).unwrap_or(0));
            i += 1 + digits.len();
            continue;
        }
        out.push(match esc {
            b'a' => 0x07,
            b'b' => 0x08,
            b'f' => 0x0c,
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            b'v' => 0x0b,
            other => other,
        });
        i += 2;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn paint(open: &str, close: &str, s: &str) -> String {
    format!("\x1b[{open}m{s}\x1b[{close}m")
}

fn format_status(status: &str, use_color: bool) -> String {
    if !use_color {
        return status.to_owned();
    }
    status
        .chars()
        .map(|c| {
            let s = c.to_string();
            match c {
                'A' => paint("32", "39", &s),
                'M' => paint("33", "39", &s),
                'D' | 'U' => paint("31", "39", &s),
                'R' | 'C' | '?' => paint("36", "39", &s),
                _ => s,
            }
        })
        .collect()
}

fn format_stats(stats: DiffStats, use_color: bool) -> String {
    let (a, d) = (
        format!("{}+", stats.additions),
        format!("{}-", stats.deletions),
    );
    if use_color {
        format!("({} {})", paint("32", "39", &a), paint("31", "39", &d))
    } else {
        format!("({a} {d})")
    }
}

const OUTSIDE_KINDS: [&str; 5] = [
    "added file",
    "change",
    "deleted file",
    "unmerged file",
    "untracked file",
];

fn outside_kind(status: &str) -> &'static str {
    if status == "??" {
        "untracked file"
    } else if status.contains('U') || status == "AA" || status == "DD" {
        "unmerged file"
    } else if status.contains('D') {
        "deleted file"
    } else if status.contains('A') {
        "added file"
    } else {
        "change"
    }
}

fn outside_summary(counts: &HashMap<&'static str, usize>) -> Option<String> {
    let parts: Vec<String> = OUTSIDE_KINDS
        .iter()
        .filter_map(|kind| {
            let n = *counts.get(kind)?;
            Some(format!("{n} {kind}{}", if n == 1 { "" } else { "s" }))
        })
        .collect();
    let joined = match parts.as_slice() {
        [] => return None,
        [one] => one.clone(),
        [a, b] => format!("{a} and {b}"),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    };
    Some(format!("({joined} outside this dir)"))
}

impl GitInfo for SystemGit {
    fn ops(&self, cwd: &str) -> Option<String> {
        let dir = git_dir(cwd)?;
        let exists = |name: &str| Path::new(&dir).join(name).exists();
        if exists("rebase-merge") {
            let head = read_git_file(&dir, "rebase-merge/head-name").filter(|s| !s.is_empty());
            let onto = read_git_file(&dir, "rebase-merge/onto").filter(|s| !s.is_empty());
            return Some(match (head, onto) {
                (Some(h), Some(o)) => format!("rebasing {h} onto {}", short(&o)),
                _ => "rebase in progress".to_owned(),
            });
        }
        if exists("rebase-apply") {
            return Some("rebase-apply in progress".to_owned());
        }
        if exists("MERGE_HEAD") {
            let head = read_git_file(&dir, "MERGE_HEAD").filter(|s| !s.is_empty());
            return Some(format!(
                "merging {}",
                head.map_or_else(|| "unknown".to_owned(), |h| short(&h))
            ));
        }
        if exists("CHERRY_PICK_HEAD") {
            return Some("cherry-pick in progress".to_owned());
        }
        if exists("REVERT_HEAD") {
            return Some("revert in progress".to_owned());
        }
        None
    }

    fn subdir(&self, cwd: &str) -> Option<String> {
        let out = run_git(&["-C", cwd, "rev-parse", "--show-prefix"]);
        if !out.success {
            return None;
        }
        let prefix = out.stdout.trim();
        if prefix.is_empty() {
            return None;
        }
        Some(format!(
            "(in ./{})",
            prefix.strip_suffix('/').unwrap_or(prefix)
        ))
    }

    fn log(&self, cwd: &str, max_lines: i64, use_color: bool) -> Vec<String> {
        let git = |extra: &[&str]| {
            let mut args = vec!["-C", cwd];
            args.extend_from_slice(extra);
            run_git(&args)
        };
        let limit = format!("-{max_lines}");
        // Only the commits not on the upstream yet; failing that, not on the
        // remote's default branch; failing that, the latest ones.
        let range = {
            let upstream = git(&["rev-parse", "--abbrev-ref", "@{u}"]);
            if upstream.success {
                Some(format!("{}^..HEAD", upstream.stdout.trim()))
            } else {
                let origin = git(&["rev-parse", "--verify", "refs/remotes/origin/HEAD"]);
                origin
                    .success
                    .then(|| format!("{}^..HEAD", short(origin.stdout.trim())))
            }
        };
        let mut args: Vec<&str> = Vec::new();
        // `-c` has to precede the subcommand; the rev-parse probes print
        // nothing the user sees, so only the final call gets it.
        if use_color {
            args.extend(["-c", "color.ui=always"]);
        }
        args.push("log");
        if let Some(r) = &range {
            args.push(r);
        }
        args.push(&limit);
        // `%C(auto)` only emits ANSI when color.ui resolves to always.
        args.push(if use_color {
            "--pretty=format:%C(auto)%h%d%Creset %s"
        } else {
            "--pretty=format:%h%d %s"
        });
        let out = git(&args);
        out.stdout
            .split('\n')
            .filter(|l| !l.trim().is_empty())
            .map(str::to_owned)
            .collect()
    }

    fn stash(&self, cwd: &str) -> Vec<String> {
        let out = run_git(&["-C", cwd, "stash", "list"]);
        let count = out
            .stdout
            .split('\n')
            .filter(|l| !l.trim().is_empty())
            .count();
        match count {
            0 => vec![],
            1 => vec!["(1 stashed entry)".to_owned()],
            n => vec![format!("({n} stashed entries)")],
        }
    }

    fn status(&self, cwd: &str, local_only: bool, use_color: bool) -> GitStatusResult {
        let out = run_git(&[
            "-C",
            cwd,
            "-c",
            "core.quotePath=false",
            "status",
            "--short",
            "--untracked-files=normal",
            "--renames",
        ]);
        let lines: Vec<String> = out
            .stdout
            .split('\n')
            .filter(|l| !l.trim().is_empty())
            .map(str::to_owned)
            .collect();
        let path_of = |line: &str| decode_quoted_path(line.get(3..).unwrap_or(""));
        if !local_only {
            let entries = lines
                .iter()
                .map(|line| GitStatusEntry {
                    path: path_of(line),
                    line: line.clone(),
                    stats: None,
                })
                .collect();
            return GitStatusResult { lines, entries };
        }

        let stats_by_path = diff_stats(cwd);
        let mut shown = Vec::new();
        let mut entries = Vec::new();
        let mut outside: HashMap<&'static str, usize> = HashMap::new();
        for line in &lines {
            let status = line.get(..2).unwrap_or(line);
            let path = path_of(line);
            if path.starts_with("../") {
                *outside.entry(outside_kind(status)).or_default() += 1;
                continue;
            }
            let stats = if status == "??" {
                untracked_stats(cwd, &path)
            } else {
                stats_by_path.get(&path).copied()
            };
            let local = format!(
                "{}{}",
                format_status(status, use_color),
                line.get(2..).unwrap_or("")
            );
            shown.push(local.clone());
            entries.push(GitStatusEntry {
                path,
                line: local,
                stats: stats.map(|s| format_stats(s, use_color)),
            });
        }
        shown.extend(outside_summary(&outside));
        GitStatusResult {
            lines: shown,
            entries,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_paths_are_decoded() {
        assert_eq!(decode_quoted_path("plain"), "plain");
        assert_eq!(decode_quoted_path(r#""a\tb\"c""#), "a\tb\"c");
        assert_eq!(decode_quoted_path(r#""caf\303\251""#), "café");
    }

    #[test]
    fn outside_summary_wording() {
        let mut c = HashMap::new();
        assert_eq!(outside_summary(&c), None);
        c.insert("change", 1);
        assert_eq!(outside_summary(&c).unwrap(), "(1 change outside this dir)");
        c.insert("untracked file", 2);
        c.insert("added file", 3);
        assert_eq!(
            outside_summary(&c).unwrap(),
            "(3 added files, 1 change and 2 untracked files outside this dir)"
        );
    }

    #[test]
    fn stats_formatting() {
        let s = DiffStats {
            additions: 3,
            deletions: 4,
        };
        assert_eq!(format_stats(s, false), "(3+ 4-)");
        assert_eq!(format_status("M?", false), "M?");
    }
}
