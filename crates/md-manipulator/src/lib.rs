//! Markdown section tree, section ids, frontmatter and MRFI references. Performs no I/O and builds for wasm32.
//!
//! Sections are located with a CommonMark parser (`pulldown-cmark`, used only
//! to find headings and their byte ranges); every edit is a splice on the
//! original text, so untouched bytes stay identical. The rules are in
//! `docs/specs/markdown-sections.md`.
//!
//! Frontmatter (`Document::meta_*`) is read as ordered data and edited
//! losslessly. `mrfi` holds the reference codec, generator and resolver.

mod concat;
mod document;
mod error;
mod frontmatter;
mod id;
pub mod mrfi;
mod ops;
mod search;

pub use concat::concat;
pub use document::{Document, LineEnding, SectionRead};
pub use error::Error;
pub use frontmatter::{EditMethod, MetaEdit, Value};
pub use id::{is_valid_id, section_id};
pub use ops::{Action, Edit, Mutation};
pub use search::{Match, SearchResult, SectionMatches, search};

use std::ops::Range;

/// A heading and the data needed to address and cut its section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    /// First 8 hex characters of the SHA-256 of `level:title.lowercase().trim():occurrence`.
    pub id: String,
    /// Heading level, 1 to 6.
    pub level: usize,
    /// Raw heading text: closing `#`s and markup are kept (ids depend on it);
    /// setext titles spanning several lines are joined with a space.
    pub title: String,
    /// How many earlier headings share this level and lowercased title.
    pub occurrence: usize,
    /// 1-based line of the heading (the first text line for setext headings).
    pub line: usize,
    /// 1-based last line of the heading (the underline for setext headings).
    pub heading_last_line: usize,
    /// Bytes of the heading lines, without the final line ending.
    pub heading_range: Range<usize>,
}
