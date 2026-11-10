//! Path arithmetic on `/`-separated strings (the form git prints on every
//! platform, and what the scope files store).

/// Whether the path is absolute (`/x` or `C:/x`).
pub fn is_absolute(p: &str) -> bool {
    p.starts_with('/') || has_drive(p)
}

fn has_drive(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 2
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && b.get(2).is_none_or(|c| *c == b'/')
}

/// Replaces `\` by `/`.
pub fn slashes(p: &str) -> String {
    p.replace('\\', "/")
}

/// `a/b`, without normalizing.
pub fn join(a: &str, b: &str) -> String {
    if a.is_empty() {
        return b.to_string();
    }
    format!("{}/{}", a.trim_end_matches('/'), b)
}

/// Directory part; `a/b` gives `a`, `a` gives `.`, `/a` gives `/`.
pub fn dirname(p: &str) -> String {
    let t = p.trim_end_matches('/');
    match t.rfind('/') {
        Some(0) => "/".into(),
        Some(i) => t[..i].to_string(),
        None => ".".into(),
    }
}

/// Last component.
pub fn basename(p: &str) -> String {
    let t = p.trim_end_matches('/');
    t.rsplit('/').next().unwrap_or(t).to_string()
}

/// Joins and normalizes (`.` and `..`), like `path.resolve(base, rel)`.
pub fn resolve(base: &str, rel: &str) -> String {
    let full = if is_absolute(rel) {
        rel.to_string()
    } else {
        join(base, rel)
    };
    normalize(&full)
}

/// Collapses `.`, `..` and repeated separators.
pub fn normalize(p: &str) -> String {
    let (root, rest) = if let Some(r) = p.strip_prefix('/') {
        ("/".to_string(), r)
    } else if has_drive(p) {
        let end = if p.len() > 2 { 3 } else { 2 };
        (p[..end].to_string(), p.get(end..).unwrap_or(""))
    } else {
        (String::new(), p)
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in rest.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|l| *l != "..") {
                    parts.pop();
                } else if root.is_empty() {
                    parts.push("..");
                }
            }
            s => parts.push(s),
        }
    }
    let body = parts.join("/");
    if root.is_empty() {
        if body.is_empty() { ".".into() } else { body }
    } else {
        format!("{root}{body}")
    }
}

/// `resolveRelativePath`: like [`resolve`] but always rooted at `/` for
/// relative inputs, dropping a leading `..` that has nothing to climb.
pub fn resolve_relative(base: &str, relative: &str) -> String {
    if is_absolute(relative) {
        return relative.to_string();
    }
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for part in relative.split('/').filter(|p| !p.is_empty()) {
        match part {
            ".." => {
                parts.pop();
            }
            "." => {}
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}

/// `calculateRelativePath(from, to)`.
pub fn relative_path(from: &str, to: &str) -> String {
    let f: Vec<&str> = from.split('/').filter(|p| !p.is_empty()).collect();
    let t: Vec<&str> = to.split('/').filter(|p| !p.is_empty()).collect();
    let common = f.iter().zip(t.iter()).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; f.len() - common];
    parts.extend(&t[common..]);
    if parts.is_empty() {
        ".".into()
    } else {
        parts.join("/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_and_relates_paths() {
        assert_eq!(resolve("/a/b", "../c"), "/a/c");
        assert_eq!(resolve("/a/b", "/x/./y"), "/x/y");
        assert_eq!(dirname("/a/b/c"), "/a/b");
        assert_eq!(basename("/a/b/"), "b");
        assert_eq!(relative_path("/r/a/b", "/r"), "../..");
        assert_eq!(relative_path("/r", "/r/a/b"), "a/b");
        assert_eq!(relative_path("/r", "/r"), ".");
        assert_eq!(resolve_relative("/r/a", "../b"), "/r/b");
        assert!(is_absolute("C:/x"));
        assert!(is_absolute("C:"));
        assert!(!is_absolute("CC:/x"));
        assert!(!is_absolute("rel/C:/x"));
    }
}
