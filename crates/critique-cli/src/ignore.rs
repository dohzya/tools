//! `.critique-ignore` rules: gitignore-like globs matched against paths
//! relative to the working directory.

use crate::host::{EntryKind, Host};

#[derive(Debug, Clone)]
enum Tok {
    Lit(char),
    /// `*`
    Star,
    /// `**`
    DoubleStar,
    /// `**/`: any number of leading directories
    Dirs,
    /// `?`
    One,
}

/// One compiled rule.
#[derive(Debug, Clone)]
pub struct Rule {
    /// `false` for `!pattern`.
    pub ignored: bool,
    /// Normalized pattern.
    pub pattern: String,
    /// Trailing `/`.
    pub directory_only: bool,
    anchored: bool,
    toks: Vec<Tok>,
}

/// Compiles a line; `None` for blanks and comments.
pub fn compile(line: &str) -> Option<Rule> {
    let mut pattern = md_manipulator::mrfi::js_trim(line).to_string();
    if pattern.is_empty() || pattern.starts_with('#') {
        return None;
    }
    let mut ignored = true;
    if let Some(rest) = pattern.strip_prefix('!') {
        ignored = false;
        pattern = md_manipulator::mrfi::js_trim(rest).to_string();
    }
    if pattern.is_empty() {
        return None;
    }
    pattern = pattern.replace('\\', "/");
    if let Some(rest) = pattern.strip_prefix("./") {
        pattern = rest.to_string();
    }
    let anchored = pattern.starts_with('/');
    let directory_only = pattern.ends_with('/');
    let pattern = pattern
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string();
    if pattern.is_empty() {
        return None;
    }
    let anchored = anchored || pattern.contains('/');
    let chars: Vec<char> = pattern.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        match (chars[i], chars.get(i + 1)) {
            ('*', Some('*')) => {
                if chars.get(i + 2) == Some(&'/') {
                    toks.push(Tok::Dirs);
                    i += 3;
                } else {
                    toks.push(Tok::DoubleStar);
                    i += 2;
                }
            }
            ('*', _) => {
                toks.push(Tok::Star);
                i += 1;
            }
            ('?', _) => {
                toks.push(Tok::One);
                i += 1;
            }
            (c, _) => {
                toks.push(Tok::Lit(c));
                i += 1;
            }
        }
    }
    Some(Rule {
        ignored,
        pattern,
        directory_only,
        anchored,
        toks,
    })
}

fn matches_from(toks: &[Tok], text: &[char], pos: usize, tail: &dyn Fn(usize) -> bool) -> bool {
    let Some((tok, rest)) = toks.split_first() else {
        return tail(pos);
    };
    match tok {
        Tok::Lit(c) => text.get(pos) == Some(c) && matches_from(rest, text, pos + 1, tail),
        Tok::One => {
            text.get(pos).is_some_and(|&c| c != '/' && c != '\n')
                && matches_from(rest, text, pos + 1, tail)
        }
        Tok::Star => {
            let mut end = pos;
            loop {
                if matches_from(rest, text, end, tail) {
                    return true;
                }
                match text.get(end) {
                    Some(&c) if c != '/' && c != '\n' => end += 1,
                    _ => return false,
                }
            }
        }
        Tok::DoubleStar => {
            let mut end = pos;
            loop {
                if matches_from(rest, text, end, tail) {
                    return true;
                }
                match text.get(end) {
                    Some(&c) if c != '\n' => end += 1,
                    _ => return false,
                }
            }
        }
        Tok::Dirs => {
            if matches_from(rest, text, pos, tail) {
                return true;
            }
            (pos + 1..=text.len()).any(|j| {
                text[j - 1] == '/'
                    && text[pos..j].iter().all(|&c| c != '\n')
                    && matches_from(rest, text, j, tail)
            })
        }
    }
}

impl Rule {
    /// JS `regex.test(path)` of the compiled rule.
    pub fn is_match(&self, path: &str) -> bool {
        let text: Vec<char> = path.chars().collect();
        let tail = |end: usize| -> bool {
            if self.anchored && !self.directory_only {
                end == text.len()
            } else {
                end == text.len() || text.get(end) == Some(&'/')
            }
        };
        if self.anchored {
            return matches_from(&self.toks, &text, 0, &tail);
        }
        (0..=text.len())
            .filter(|&s| s == 0 || text[s - 1] == '/')
            .any(|s| matches_from(&self.toks, &text, s, &tail))
    }
}

/// Whether the rules ignore `path` (last matching rule wins).
pub fn is_ignored(path: &str, rules: &[Rule]) -> bool {
    let mut ignored = false;
    for rule in rules {
        if rule.is_match(path) {
            ignored = rule.ignored;
        }
    }
    ignored
}

fn has_glob(s: &str) -> bool {
    s.contains(['*', '?', '['])
}

fn scan_root(rule: &Rule) -> String {
    if !has_glob(&rule.pattern) && !rule.directory_only {
        return rule.pattern.clone();
    }
    let fixed: Vec<&str> = rule
        .pattern
        .split('/')
        .take_while(|s| !has_glob(s))
        .collect();
    if fixed.is_empty() {
        ".".into()
    } else {
        fixed.join("/")
    }
}

fn walk(host: &dyn Host, file: &str, rule: &Rule, out: &mut Vec<String>) {
    match host.entry_kind(file) {
        Some(EntryKind::File) => {
            let normalized = crate::paths::relative_to(&host.cwd(), file);
            if rule.is_match(&normalized) && !out.contains(&normalized) {
                out.push(normalized);
            }
        }
        Some(EntryKind::Dir) => {
            if file.rsplit('/').next() == Some(".git") {
                return;
            }
            let Ok(mut names) = host.read_dir(file) else {
                return;
            };
            names.sort();
            for name in names {
                walk(
                    host,
                    &format!("{}/{}", file.trim_end_matches('/'), name),
                    rule,
                    out,
                );
            }
        }
        _ => {}
    }
}

/// Files re-included by `!pattern` rules (they are not reported by `git status`).
pub fn files_included_by_rules(host: &dyn Host, rules: &[Rule]) -> Vec<String> {
    let mut out = Vec::new();
    for rule in rules.iter().filter(|r| !r.ignored) {
        walk(host, &scan_root(rule), rule, &mut out);
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ignored(rules: &[&str], path: &str) -> bool {
        let rules: Vec<Rule> = rules.iter().filter_map(|r| compile(r)).collect();
        is_ignored(path, &rules)
    }

    #[test]
    fn globs() {
        assert!(ignored(&["*.md"], "a/b/doc.md"));
        assert!(!ignored(&["/*.md"], "a/doc.md"));
        assert!(ignored(&["/*.md"], "doc.md"));
        assert!(ignored(&["drafts/"], "x/drafts/a.md"));
        assert!(ignored(&["docs/**/*.md"], "docs/a/b/c.md"));
        assert!(ignored(&["docs/**/*.md"], "docs/c.md"));
        assert!(!ignored(&["*.md", "!keep.md"], "keep.md"));
        assert!(ignored(&["doc.md"], "sub/doc.md/inner"));
        assert!(!ignored(&["# comment", ""], "doc.md"));
    }
}
