//! Lexical path helpers (no file system access), `/`-separated output.

use std::path::{Component, Path, PathBuf};

/// `path.normalize`: drops `.`, resolves `..` where possible.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out: Vec<Component<'_>> = Vec::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => match out.last() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => out.push(c),
            },
            other => out.push(other),
        }
    }
    if out.is_empty() {
        return PathBuf::from(".");
    }
    out.iter().collect()
}

/// `path.relative(cwd, resolve(file))` with `/` separators.
pub fn relative_to(cwd: &Path, file: &str) -> String {
    let target = normalize(&cwd.join(file));
    let base = normalize(cwd);
    let (t, b): (Vec<_>, Vec<_>) = (target.components().collect(), base.components().collect());
    let common = t.iter().zip(&b).take_while(|(x, y)| x == y).count();
    if common == 0 && (t.first() != b.first()) {
        return slashes(&target);
    }
    let mut parts: Vec<String> = vec!["..".to_string(); b.len() - common];
    parts.extend(
        t[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

/// Separators to `/`.
pub fn slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        let cwd = Path::new("/w/proj");
        assert_eq!(relative_to(cwd, "doc.md"), "doc.md");
        assert_eq!(relative_to(cwd, "./a/../doc.md"), "doc.md");
        assert_eq!(relative_to(cwd, "../other/x.md"), "../other/x.md");
        assert_eq!(relative_to(cwd, "/w/proj/sub/x.md"), "sub/x.md");
        assert_eq!(relative_to(cwd, "."), "");
    }
}
