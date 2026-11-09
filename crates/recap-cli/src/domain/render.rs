//! Text rendering of collected sections.

use super::config::{SectionData, Separator};

const SEPARATOR_LINE_LEN: usize = 40;

/// ANSI styling with an on/off switch; off means identity.
#[derive(Debug, Clone, Copy)]
pub struct Palette {
    color: bool,
}

impl Palette {
    /// A palette that styles only when `color` is true.
    pub fn new(color: bool) -> Self {
        Self { color }
    }

    fn paint(self, open: &str, close: &str, s: &str) -> String {
        if self.color {
            format!("\x1b[{open}m{s}\x1b[{close}m")
        } else {
            s.to_owned()
        }
    }

    /// Section titles: bold cyan.
    pub fn title(self, s: &str) -> String {
        if self.color {
            format!("\x1b[1m\x1b[36m{s}\x1b[39m\x1b[22m")
        } else {
            s.to_owned()
        }
    }

    /// Separator rule: dim.
    pub fn separator(self, s: &str) -> String {
        self.paint("2", "22", s)
    }

    /// Error text: red.
    pub fn error(self, s: &str) -> String {
        self.paint("31", "39", s)
    }
}

/// Renders sections: title, then lines or error, joined by their separator.
/// Sections with neither lines nor error are skipped entirely.
pub fn render_recap(sections: &[SectionData], palette: Palette) -> String {
    let mut parts: Vec<String> = Vec::new();
    for section in sections {
        if section.lines.is_empty() && section.error.is_none() {
            continue;
        }
        let mut body: Vec<String> = Vec::new();
        if let Some(title) = section.title.as_deref().filter(|t| !t.is_empty()) {
            body.push(palette.title(title));
        }
        match section.error.as_deref().filter(|e| !e.is_empty()) {
            Some(error) => body.push(palette.error(&format!("[{}] error: {error}", section.id))),
            None => body.extend(section.lines.iter().cloned()),
        }
        // The separator goes before the section, never before the first one.
        if !parts.is_empty() {
            match section.separator {
                Separator::BlankLine => parts.push(String::new()),
                Separator::Line => {
                    parts.push(palette.separator(&"─".repeat(SEPARATOR_LINE_LEN)));
                }
                Separator::None => {}
            }
        }
        parts.push(body.join("\n"));
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn section(id: &str, lines: &[&str], sep: Separator) -> SectionData {
        SectionData {
            id: id.into(),
            title: None,
            lines: lines.iter().map(|s| (*s).to_owned()).collect(),
            separator: sep,
            error: None,
        }
    }

    #[test]
    fn separators_go_between_sections_and_empty_ones_vanish() {
        let sections = [
            section("a", &["1"], Separator::Line),
            section("skipped", &[], Separator::Line),
            section("b", &["2"], Separator::Line),
            section("c", &["3"], Separator::BlankLine),
            section("d", &["4"], Separator::None),
        ];
        let text = render_recap(&sections, Palette::new(false));
        assert_eq!(text, format!("1\n{}\n2\n\n3\n4", "─".repeat(40)));
    }

    #[test]
    fn title_and_error_lines() {
        let mut s = section("x", &[], Separator::BlankLine);
        s.title = Some("T".into());
        s.error = Some("boom".into());
        assert_eq!(
            render_recap(&[s], Palette::new(false)),
            "T\n[x] error: boom"
        );
    }

    #[test]
    fn color_wraps_title_in_bold_cyan() {
        let mut s = section("x", &["l"], Separator::BlankLine);
        s.title = Some("T".into());
        assert_eq!(
            render_recap(&[s], Palette::new(true)),
            "\x1b[1m\x1b[36mT\x1b[39m\x1b[22m\nl"
        );
    }
}
