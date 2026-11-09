use crate::Document;

/// `# Title` with at least one whitespace after the hashes. Same shape as the
/// TS regex `^(#{1,6})\s+(.+)$`, so the shift is as naive as before: fenced
/// code is not special-cased.
fn shifted(line: &str, shift: usize) -> Option<String> {
    let hashes = line.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = &line[hashes..];
    let title = rest.trim_start();
    let title = if title.is_empty() {
        // `\s+` gives one character back to `.+` when nothing else follows.
        let last = rest
            .chars()
            .next_back()
            .filter(|_| rest.chars().count() >= 2)?;
        &rest[rest.len() - last.len_utf8()..]
    } else if rest.len() == title.len() {
        return None;
    } else {
        title
    };
    Some(format!("{} {title}", "#".repeat((hashes + shift).min(6))))
}

/// Concatenates documents: the frontmatter of the first one (if any), then
/// every body, joined by two line feeds. Headings are moved down by `shift`
/// levels (at most level 6); a shift of 0 or less changes nothing. Line
/// endings of the result are `\n`.
pub fn concat(docs: &[Document], shift: i64) -> String {
    let shift = usize::try_from(shift).unwrap_or(0);
    let bodies: Vec<String> = docs
        .iter()
        .map(|d| {
            d.lines()
                .skip(d.frontmatter_lines())
                .map(|l| {
                    if shift > 0 {
                        shifted(l, shift).unwrap_or_else(|| l.to_owned())
                    } else {
                        l.to_owned()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .collect();
    let body = bodies.join("\n\n");
    match docs.first() {
        Some(first) if first.frontmatter_lines() > 0 => {
            let fm: Vec<&str> = first.lines().take(first.frontmatter_lines()).collect();
            format!("{}\n\n{body}", fm.join("\n"))
        }
        _ => body,
    }
}
