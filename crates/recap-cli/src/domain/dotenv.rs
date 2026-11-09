//! `dotenv:` files: `KEY=value` lines merged with the system environment.

use super::ports::{Environment, FileSystem};

/// Parses `KEY=value` lines. Blank lines and `#` comments are skipped, a
/// matching pair of quotes around the value is stripped, there is no escape
/// processing or `export` prefix.
pub fn parse_dotenv(content: &str) -> Vec<(String, String)> {
    content
        .split('\n')
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            let (key, value) = (key.trim(), value.trim());
            let quoted = value.len() >= 2
                && ((value.starts_with('"') && value.ends_with('"'))
                    || (value.starts_with('\'') && value.ends_with('\'')));
            let value = if quoted {
                &value[1..value.len() - 1]
            } else {
                value
            };
            (!key.is_empty()).then(|| (key.to_owned(), value.to_owned()))
        })
        .collect()
}

/// Loads the files in order; the first file defining a variable wins and a
/// variable already set in the system environment is left out (the system
/// value wins, and commands inherit it anyway). Relative paths are resolved
/// against `cwd` (the project dir, `-C` included). A missing or unreadable
/// file is skipped: `.env.local` style files are optional by nature.
pub fn load_dotenv(
    paths: &[String],
    cwd: &str,
    fs: &dyn FileSystem,
    env: &dyn Environment,
) -> Vec<(String, String)> {
    let mut vars: Vec<(String, String)> = Vec::new();
    for path in paths {
        let full = if path.starts_with('/') {
            path.clone()
        } else {
            format!("{cwd}/{path}")
        };
        let Ok(Some(content)) = fs.read_to_string(&full) else {
            continue;
        };
        for (k, v) in parse_dotenv(&content) {
            if env.get_env(&k).is_none() && !vars.iter().any(|(ek, _)| *ek == k) {
                vars.push((k, v));
            }
        }
    }
    vars
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pairs_comments_and_quotes() {
        let v = parse_dotenv("# c\n\nA=1\n B = two words \nC=\"q v\"\nD='s'\nnoequal\n=x\nE=a=b\n");
        let want = |k: &str, v: &str| (k.to_owned(), v.to_owned());
        assert_eq!(
            v,
            [
                want("A", "1"),
                want("B", "two words"),
                want("C", "q v"),
                want("D", "s"),
                want("E", "a=b")
            ]
        );
    }
}
