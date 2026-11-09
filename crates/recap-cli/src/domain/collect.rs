//! Runs the sections of a resolved config and gathers their output.

use super::config::*;
use super::ports::{Environment, GitInfo, GitStatusEntry, ShellRunner};
use std::collections::HashMap;

/// What sections need to run.
pub struct Providers<'a> {
    /// Shell command executor.
    pub shell: &'a dyn ShellRunner,
    /// Git queries.
    pub git: &'a dyn GitInfo,
    /// Default working directory (absolute); relative `cwd:` of sections are
    /// resolved against it, as `git -C` does.
    pub cwd: &'a str,
    /// System environment, which wins over dotenv files in `${VAR}`.
    pub env: &'a dyn Environment,
    /// Variables from dotenv files, minus those the system env already has.
    /// Exported to every command.
    pub dotenv: &'a [(String, String)],
    /// Whether colors are wanted: forwarded to commands through `FORCE_COLOR`
    /// & co. and to the git built-ins.
    pub use_color: bool,
}

/// Env injected into every command so tools agree with the recap's own color
/// decision. git ignores `FORCE_COLOR`, hence the `GIT_CONFIG_*` triplet
/// (git >= 2.31); `NO_COLOR` is enough for git >= 2.27 on the other path.
fn color_env(use_color: bool) -> Vec<(String, String)> {
    let pairs: &[(&str, &str)] = if use_color {
        &[
            ("FORCE_COLOR", "1"),
            ("CLICOLOR_FORCE", "1"),
            ("GIT_CONFIG_COUNT", "1"),
            ("GIT_CONFIG_KEY_0", "color.ui"),
            ("GIT_CONFIG_VALUE_0", "always"),
        ]
    } else {
        &[("NO_COLOR", "1")]
    };
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

/// Colors, then dotenv variables, then the section's own `env:` which always
/// wins.
fn command_env(
    use_color: bool,
    dotenv: &[(String, String)],
    own: Option<&EnvVars>,
) -> Vec<(String, String)> {
    let mut env = color_env(use_color);
    for (k, v) in dotenv.iter().chain(own.into_iter().flatten()) {
        match env.iter_mut().find(|(ek, _)| ek == k) {
            Some(slot) => slot.1.clone_from(v),
            None => env.push((k.clone(), v.clone())),
        }
    }
    env
}

/// Replaces `${VAR}` by its value, leaving unknown ones: the section's `env:`
/// first, then the system environment, then dotenv files.
fn interpolate(text: &str, own: Option<&EnvVars>, p: &Providers<'_>) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) if end > 0 => {
                let key = &after[..end];
                // The last duplicate wins, as in a JS object.
                let found = own
                    .and_then(|e| e.iter().rev().find(|(k, _)| k == key))
                    .map(|(_, v)| v.clone())
                    .or_else(|| p.env.get_env(key))
                    .or_else(|| {
                        p.dotenv
                            .iter()
                            .find(|(k, _)| k == key)
                            .map(|(_, v)| v.clone())
                    });
                match found {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&rest[start..start + 2 + end + 1]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str("${");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Keeps `max_lines` lines and notes how many were dropped. Negative values
/// follow JS `slice`, which counts from the end.
fn apply_max_lines(lines: Vec<String>, max_lines: Option<i64>) -> Vec<String> {
    let Some(max) = max_lines else { return lines };
    let len = i64::try_from(lines.len()).unwrap_or(i64::MAX);
    if len <= max {
        return lines;
    }
    let keep = if max < 0 { (len + max).max(0) } else { max };
    let mut out: Vec<String> = lines
        .into_iter()
        .take(usize::try_from(keep).unwrap_or(0))
        .collect();
    out.push(format!("... ({} more lines)", len - max));
    out
}

fn non_empty_lines(text: &str) -> Vec<String> {
    text.split('\n')
        .filter(|l| !l.is_empty())
        .map(str::to_owned)
        .collect()
}

fn parse_tsv(stdout: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in stdout.split('\n') {
        let Some(tab) = line.find('\t').filter(|&t| t > 0) else {
            continue;
        };
        let text = &line[tab + 1..];
        if !text.is_empty() {
            map.insert(line[..tab].to_owned(), text.to_owned());
        }
    }
    map
}

fn collect_enrichments(
    config: &RecapConfig,
    entries: &[GitStatusEntry],
    p: &Providers<'_>,
    cwd: &str,
) -> Result<HashMap<String, Vec<String>>, String> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    if entries.is_empty() {
        return Ok(out);
    }
    for enricher in &config.status_enrichers {
        match enricher {
            StatusEnricher::GitStats { .. } => {
                for e in entries {
                    if let Some(stats) = &e.stats {
                        out.entry(e.path.clone()).or_default().push(stats.clone());
                    }
                }
            }
            StatusEnricher::Sh {
                sh, env, cwd: own, ..
            } => {
                let result = p.shell.run(
                    sh,
                    &command_env(p.use_color, p.dotenv, env.as_ref()),
                    Some(
                        &own.as_deref()
                            .map_or_else(|| cwd.to_owned(), |c| resolve_cwd(Some(c), p.cwd)),
                    ),
                );
                if result.exit_code != 0 && result.stdout.trim().is_empty() {
                    return Err(failure_text(&result.stderr, result.exit_code));
                }
                for (path, text) in parse_tsv(&result.stdout) {
                    if entries.iter().any(|e| e.path == path) {
                        out.entry(path).or_default().push(text);
                    }
                }
            }
        }
    }
    Ok(out)
}

/// A section's `cwd:` against the run directory; absolute paths stay.
fn resolve_cwd(own: Option<&str>, base: &str) -> String {
    match own {
        None => base.to_owned(),
        Some(c) if c.starts_with('/') => c.to_owned(),
        Some(c) => format!("{base}/{c}"),
    }
}

fn failure_text(stderr: &str, exit_code: i32) -> String {
    let stderr = stderr.trim();
    if stderr.is_empty() {
        format!("exit code {exit_code}")
    } else {
        stderr.to_owned()
    }
}

/// Appends enrichments to the lines that came from `entries`, in order; the
/// aggregate "outside this dir" note matches no entry and is left alone.
fn append_enrichments(
    lines: Vec<String>,
    entries: &[GitStatusEntry],
    enrichments: &HashMap<String, Vec<String>>,
) -> Vec<String> {
    let mut next = 0;
    lines
        .into_iter()
        .map(|line| {
            let Some(entry) = entries.get(next).filter(|e| e.line == line) else {
                return line;
            };
            next += 1;
            match enrichments.get(&entry.path) {
                Some(suffixes) if !suffixes.is_empty() => format!("{line} {}", suffixes.join(" ")),
                _ => line,
            }
        })
        .collect()
}

fn execute(config: &RecapConfig, s: &ResolvedSection, p: &Providers<'_>) -> SectionData {
    let separator = s.common.separator.unwrap_or(Separator::BlankLine);
    let done = |lines: Vec<String>, error: Option<String>| SectionData {
        id: s.id.clone(),
        title: s.common.title.clone(),
        lines,
        separator,
        error,
    };
    let cwd = &resolve_cwd(s.cwd.as_deref(), p.cwd);
    let max = s.common.max_lines;

    if let Some(sh) = &s.sh {
        let result = p.shell.run(
            sh,
            &command_env(p.use_color, p.dotenv, s.env.as_ref()),
            Some(cwd),
        );
        if result.exit_code != 0 && result.stdout.trim().is_empty() {
            return done(vec![], Some(failure_text(&result.stderr, result.exit_code)));
        }
        return done(apply_max_lines(non_empty_lines(&result.stdout), max), None);
    }
    match s.builtin {
        Some(Builtin::GitSubdir) => done(p.git.subdir(cwd).into_iter().collect(), None),
        Some(Builtin::GitOps) => done(p.git.ops(cwd).into_iter().collect(), None),
        Some(Builtin::GitLog) => {
            let lines = p.git.log(cwd, max.unwrap_or(6), p.use_color);
            done(apply_max_lines(lines, max), None)
        }
        Some(Builtin::GitStash) => done(apply_max_lines(p.git.stash(cwd), max), None),
        Some(b @ (Builtin::Status | Builtin::GitStatus | Builtin::GitStatusLocal)) => {
            let local_only = b != Builtin::GitStatus;
            let status = p.git.status(cwd, local_only, p.use_color);
            match collect_enrichments(config, &status.entries, p, cwd) {
                Ok(enrichments) => {
                    let lines = append_enrichments(status.lines, &status.entries, &enrichments);
                    done(apply_max_lines(lines, max), None)
                }
                Err(e) => done(vec![], Some(e)),
            }
        }
        None => match &s.value {
            Some(v) => done(
                apply_max_lines(non_empty_lines(&interpolate(v, s.env.as_ref(), p)), max),
                None,
            ),
            None => done(
                vec![],
                Some("section has no sh, builtin, or value".to_owned()),
            ),
        },
    }
}

/// Runs every section concurrently (commands may be slow) and returns their
/// data in config order.
pub fn collect_sections(config: &RecapConfig, p: &Providers<'_>) -> Vec<SectionData> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = config
            .sections
            .iter()
            .map(|s| scope.spawn(move || execute(config, s, p)))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ports::{GitStatusResult, ShellResult};
    use std::sync::Mutex;

    type Call = (String, Vec<(String, String)>, Option<String>);

    struct FakeShell {
        calls: Mutex<Vec<Call>>,
        reply: fn(&str) -> ShellResult,
    }

    impl FakeShell {
        fn new(reply: fn(&str) -> ShellResult) -> Self {
            Self {
                calls: Mutex::new(vec![]),
                reply,
            }
        }
    }

    impl ShellRunner for FakeShell {
        fn run(&self, command: &str, env: &[(String, String)], cwd: Option<&str>) -> ShellResult {
            self.calls.lock().unwrap().push((
                command.to_owned(),
                env.to_vec(),
                cwd.map(str::to_owned),
            ));
            (self.reply)(command)
        }
    }

    fn ok(stdout: &str) -> ShellResult {
        ShellResult {
            stdout: stdout.into(),
            stderr: String::new(),
            exit_code: 0,
        }
    }

    struct FakeEnv;

    impl Environment for FakeEnv {
        fn get_env(&self, name: &str) -> Option<String> {
            (name == "SYS").then(|| "sys".to_owned())
        }
        fn is_terminal(&self) -> bool {
            false
        }
        fn cwd(&self) -> String {
            "/w".into()
        }
        fn home(&self) -> Option<String> {
            None
        }
    }

    #[derive(Default)]
    struct FakeGit {
        status: GitStatusResult,
    }

    impl GitInfo for FakeGit {
        fn ops(&self, _: &str) -> Option<String> {
            Some("merging abc".into())
        }
        fn subdir(&self, _: &str) -> Option<String> {
            None
        }
        fn log(&self, _: &str, max: i64, _: bool) -> Vec<String> {
            (0..max + 3).map(|i| format!("c{i}")).collect()
        }
        fn status(&self, _: &str, _: bool, _: bool) -> GitStatusResult {
            self.status.clone()
        }
        fn stash(&self, _: &str) -> Vec<String> {
            vec![]
        }
    }

    fn sh(id: &str, cmd: &str) -> ResolvedSection {
        ResolvedSection {
            id: id.into(),
            sh: Some(cmd.into()),
            ..Default::default()
        }
    }

    fn run_with(
        sections: Vec<ResolvedSection>,
        shell: &FakeShell,
        git: &FakeGit,
        color: bool,
    ) -> Vec<SectionData> {
        let config = RecapConfig {
            sections,
            status_enrichers: hardcoded_status_enrichers(),
            ..Default::default()
        };
        collect_sections(
            &config,
            &Providers {
                shell,
                git,
                cwd: "/w",
                env: &FakeEnv,
                dotenv: &[("FROM_FILE".into(), "f".into())],
                use_color: color,
            },
        )
    }

    #[test]
    fn shell_output_drops_empty_lines_and_truncates() {
        let shell = FakeShell::new(|_| ok("a\n\nb\nc\n"));
        let mut s = sh("x", "cmd");
        s.common.max_lines = Some(2);
        let out = run_with(vec![s], &shell, &FakeGit::default(), false);
        assert_eq!(out[0].lines, ["a", "b", "... (1 more lines)"]);
    }

    #[test]
    fn failing_command_with_output_is_not_an_error() {
        let shell = FakeShell::new(|_| ShellResult {
            exit_code: 3,
            ..ok("partial\n")
        });
        let out = run_with(vec![sh("x", "c")], &shell, &FakeGit::default(), false);
        assert_eq!(
            (out[0].lines.clone(), out[0].error.clone()),
            (vec!["partial".to_owned()], None)
        );
    }

    #[test]
    fn failing_command_without_output_reports_stderr_or_exit_code() {
        let shell = FakeShell::new(|c| ShellResult {
            stdout: String::new(),
            stderr: if c == "a" {
                " boom \n".into()
            } else {
                String::new()
            },
            exit_code: 2,
        });
        let out = run_with(
            vec![sh("a", "a"), sh("b", "b")],
            &shell,
            &FakeGit::default(),
            false,
        );
        assert_eq!(out[0].error.as_deref(), Some("boom"));
        assert_eq!(out[1].error.as_deref(), Some("exit code 2"));
    }

    #[test]
    fn color_env_is_injected_and_section_env_wins() {
        let shell = FakeShell::new(|_| ok("x"));
        let mut s = sh("x", "c");
        s.env = Some(vec![
            ("NO_COLOR".into(), "0".into()),
            ("A".into(), "b".into()),
        ]);
        s.cwd = Some("/other".into());
        run_with(vec![s], &shell, &FakeGit::default(), false);
        let calls = shell.calls.lock().unwrap();
        assert_eq!(
            calls[0].1,
            [
                ("NO_COLOR".into(), "0".into()),
                ("FROM_FILE".into(), "f".into()),
                ("A".into(), "b".into())
            ]
        );
        assert_eq!(calls[0].2.as_deref(), Some("/other"));
        drop(calls);
        let shell = FakeShell::new(|_| ok("x"));
        run_with(vec![sh("x", "c")], &shell, &FakeGit::default(), true);
        assert!(
            shell.calls.lock().unwrap()[0]
                .1
                .contains(&("FORCE_COLOR".into(), "1".into()))
        );
    }

    #[test]
    fn value_sections_interpolate_only_their_own_env() {
        let shell = FakeShell::new(|_| ok(""));
        let s = ResolvedSection {
            id: "v".into(),
            value: Some("hi ${NAME} ${UNKNOWN} ${} ${".into()),
            env: Some(vec![("NAME".into(), "Ada".into())]),
            ..Default::default()
        };
        let out = run_with(vec![s], &shell, &FakeGit::default(), false);
        assert_eq!(out[0].lines, ["hi Ada ${UNKNOWN} ${} ${"]);
    }

    #[test]
    fn value_interpolation_prefers_section_env_then_system_then_dotenv() {
        let shell = FakeShell::new(|_| ok(""));
        let s = ResolvedSection {
            id: "v".into(),
            value: Some("${SYS} ${FROM_FILE} ${A} ${NOPE}".into()),
            env: Some(vec![
                ("A".into(), "own".into()),
                ("SYS".into(), "own".into()),
            ]),
            ..Default::default()
        };
        let out = run_with(vec![s], &shell, &FakeGit::default(), false);
        assert_eq!(out[0].lines, ["own f own ${NOPE}"]);
        let s = ResolvedSection {
            id: "v".into(),
            value: Some("${SYS} ${FROM_FILE}".into()),
            ..Default::default()
        };
        let out = run_with(vec![s], &shell, &FakeGit::default(), false);
        assert_eq!(out[0].lines, ["sys f"]);
    }

    #[test]
    fn dotenv_vars_are_exported_and_relative_cwd_follows_the_run_dir() {
        let shell = FakeShell::new(|_| ok("x"));
        let mut rel = sh("rel", "c");
        rel.cwd = Some("deep".into());
        let mut abs = sh("abs", "c");
        abs.cwd = Some("/abs".into());
        run_with(
            vec![rel, abs, sh("none", "c")],
            &shell,
            &FakeGit::default(),
            false,
        );
        let calls = shell.calls.lock().unwrap();
        let cwds: Vec<_> = calls.iter().map(|c| c.2.clone().unwrap()).collect();
        assert!(cwds.contains(&"/w/deep".to_owned()));
        assert!(cwds.contains(&"/abs".to_owned()));
        assert!(cwds.contains(&"/w".to_owned()));
        assert!(calls[0].1.contains(&("FROM_FILE".into(), "f".into())));
    }

    #[test]
    fn git_log_asks_for_six_by_default_and_truncates_only_when_configured() {
        let shell = FakeShell::new(|_| ok(""));
        let log = |max| ResolvedSection {
            id: "l".into(),
            builtin: Some(Builtin::GitLog),
            common: Common {
                max_lines: max,
                ..Default::default()
            },
            ..Default::default()
        };
        let out = run_with(
            vec![log(None), log(Some(2))],
            &shell,
            &FakeGit::default(),
            false,
        );
        assert_eq!(out[0].lines.len(), 9);
        assert_eq!(out[1].lines, ["c0", "c1", "... (3 more lines)"]);
    }

    #[test]
    fn status_lines_get_git_stats_and_shell_enrichers() {
        let status = GitStatusResult {
            lines: vec![" M a.txt".into(), "(1 change outside this dir)".into()],
            entries: vec![GitStatusEntry {
                path: "a.txt".into(),
                line: " M a.txt".into(),
                stats: Some("(1+ 0-)".into()),
            }],
        };
        let shell = FakeShell::new(|_| ok("a.txt\tlint ok\nzzz\tignored\nbad line\n"));
        let git = FakeGit { status };
        let config = RecapConfig {
            sections: vec![ResolvedSection {
                id: "status".into(),
                builtin: Some(Builtin::Status),
                ..Default::default()
            }],
            status_enrichers: vec![
                StatusEnricher::GitStats {
                    id: "git-stats".into(),
                },
                StatusEnricher::Sh {
                    id: "lint".into(),
                    sh: "lint".into(),
                    env: None,
                    cwd: None,
                },
            ],
            ..Default::default()
        };
        let out = collect_sections(
            &config,
            &Providers {
                shell: &shell,
                git: &git,
                cwd: "/w",
                env: &FakeEnv,
                dotenv: &[],
                use_color: false,
            },
        );
        assert_eq!(
            out[0].lines,
            [" M a.txt (1+ 0-) lint ok", "(1 change outside this dir)"]
        );
    }

    #[test]
    fn section_without_a_source_is_an_error_and_order_is_kept() {
        let shell = FakeShell::new(|_| ok("x"));
        let empty = ResolvedSection {
            id: "e".into(),
            ..Default::default()
        };
        let out = run_with(
            vec![empty, sh("s", "c")],
            &shell,
            &FakeGit::default(),
            false,
        );
        assert_eq!(
            out[0].error.as_deref(),
            Some("section has no sh, builtin, or value")
        );
        assert_eq!(out[1].id, "s");
    }

    #[test]
    fn negative_max_lines_follows_js_slice() {
        let lines: Vec<String> = ["a", "b", "c"].map(String::from).to_vec();
        assert_eq!(
            apply_max_lines(lines, Some(-1)),
            ["a", "b", "... (4 more lines)"]
        );
    }
}
