//! Frontmatter: reading as ordered data and targeted, lossless edits.
//!
//! Spec decisions 8 and 10 (`docs/specs/markdown-sections.md`): the block is
//! detected by [`Document`]; an edit goes through the `yaml-edit` syntax tree
//! so that comments, quoting and key order of the untouched entries survive,
//! falls back to a narrow line-based edit when the tree cannot do it, and in
//! every case re-reads its own output and compares it to the intended data
//! before returning it. An unparseable frontmatter is never rewritten: the
//! edit fails with [`Error::FrontmatterParse`].

mod lossless;
mod read;
mod textual;
mod value;

pub use value::Value;

use crate::{Document, Error};
use value::split_path;

/// How an edit was made, for diagnostics and tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditMethod {
    /// Through the `yaml-edit` syntax tree.
    Lossless,
    /// By the line-based fallback.
    Textual,
    /// The document had no frontmatter: a new block was added.
    Created,
    /// The last key was deleted: the block is gone.
    Removed,
}

/// Result of [`Document::meta_set`] / [`Document::meta_delete`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetaEdit {
    /// The whole new text.
    pub text: String,
    /// Which mechanism produced it.
    pub method: EditMethod,
}

pub(crate) enum Op {
    Set(Value),
    Delete,
}

/// Blank and comment-only text have the data of an empty mapping.
fn data(raw: &str) -> Result<Value, Error> {
    match read::parse(raw) {
        Ok(Value::Null) => Ok(Value::Map(vec![])),
        Ok(v) => Ok(v),
        Err(e) => Err(Error::FrontmatterParse(e)),
    }
}

impl Document {
    /// Text between the delimiter lines (line endings kept inside, none at
    /// the end), or `None` without frontmatter.
    pub fn frontmatter_raw(&self) -> Option<&str> {
        let body = self.frontmatter_body_bytes()?;
        Some(self.text()[body].trim_end_matches(['\n', '\r']))
    }

    /// All the frontmatter data: an empty mapping when there is none.
    pub fn meta(&self) -> Result<Value, Error> {
        data(self.frontmatter_raw().unwrap_or_default())
    }

    /// Value at a dotted path (`a.b`, `list.0`); `None` when absent.
    pub fn meta_get(&self, path: &str) -> Result<Option<Value>, Error> {
        Ok(self.meta()?.get_path(path).cloned())
    }

    /// Sets the value at a dotted path, creating the frontmatter if needed.
    pub fn meta_set(&self, path: &str, value: Value) -> Result<MetaEdit, Error> {
        self.edit_meta(path, Op::Set(value))
    }

    /// Deletes the entry at a dotted path; [`Error::KeyNotFound`] if absent.
    /// Deleting the last key removes the block.
    pub fn meta_delete(&self, path: &str) -> Result<MetaEdit, Error> {
        self.edit_meta(path, Op::Delete)
    }

    fn edit_meta(&self, path: &str, op: Op) -> Result<MetaEdit, Error> {
        let segs = split_path(path);
        let body = self.frontmatter_body_bytes();
        let old_raw = body.clone().map_or("", |r| &self.text()[r]);
        let mut expected = data(old_raw)?;
        if !matches!(expected, Value::Map(_)) {
            return Err(Error::InvalidKeyPath(
                path.to_owned(),
                "the frontmatter is not a mapping".into(),
            ));
        }
        match &op {
            Op::Set(v) => expected
                .set_path(&segs, v.clone())
                .map_err(|why| Error::InvalidKeyPath(path.to_owned(), why))?,
            Op::Delete if !expected.delete_path(&segs) => {
                return Err(Error::KeyNotFound(path.to_owned()));
            }
            Op::Delete => {}
        }

        if matches!(op, Op::Delete) && expected == Value::Map(vec![]) {
            // Same as the TS code: no key left, no block (comments included).
            return Ok(MetaEdit {
                text: self.without_frontmatter(),
                method: EditMethod::Removed,
            });
        }

        let crlf =
            old_raw.contains("\r\n") || (body.is_none() && self.line_ending().as_str() == "\r\n");
        let eol = if crlf { "\r\n" } else { "\n" };
        // Never trust an edit blindly: its result must read back as the data
        // we meant to produce.
        let accept = |candidate: String| {
            let candidate = if crlf {
                candidate.replace("\r\n", "\n").replace('\n', "\r\n")
            } else {
                candidate
            };
            let reads_back = read::parse(&candidate).is_ok_and(|v| match v {
                Value::Null => expected == Value::Map(vec![]),
                v => v == expected,
            });
            reads_back.then_some(candidate)
        };
        let lossless = if body.is_some() && !read::is_blank(old_raw) {
            lossless::edit(old_raw, &segs, &op).and_then(accept)
        } else {
            None
        };
        let (new_body, method) = match lossless {
            Some(b) => (b, EditMethod::Lossless),
            None => {
                let b = textual::edit(old_raw, &segs, &op, eol)
                    .and_then(accept)
                    .ok_or_else(|| Error::FrontmatterEdit(path.to_owned()))?;
                (
                    b,
                    if body.is_some() {
                        EditMethod::Textual
                    } else {
                        EditMethod::Created
                    },
                )
            }
        };

        let text = self.text();
        let text = match body {
            Some(range) => format!("{}{}{}", &text[..range.start], new_body, &text[range.end..]),
            None => format!("---{eol}{new_body}---{eol}{eol}{text}"),
        };
        Ok(MetaEdit { text, method })
    }
}
