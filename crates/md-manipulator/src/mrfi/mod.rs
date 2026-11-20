//! MRFI: Markdown Robust Fragment Identifiers. Pure functions, no I/O.
//!
//! References are compact, durable locators for a passage of a Markdown
//! document (`~<hangul>`, `~<base62>`, `~{v0;...}`), resolved against a
//! changed document with graded evidence. Spec: `docs/specs/mrfi.md`.
//!
//! # Units
//!
//! Everything is expressed in Unicode scalar values of the **LF-normalized**
//! document ([`MrfiDoc`] normalizes `\r\n` and lone `\r`): lines and columns
//! are 1-based, `o` offsets are scalar offsets. UTF-16 columns (JS, VS Code)
//! must be converted explicitly with [`MrfiDoc::column_from_utf16`] and
//! [`MrfiDoc::column_to_utf16`]; no function here accepts them. Byte offsets
//! into the raw file are the host's business.

mod blocks;
mod cbor;
mod codec;
mod compare;
mod doc;
mod generate;
mod resolve;
mod text;

pub use blocks::{BlockKind, BlockStep, BlockTree};
pub use cbor::{Cbor, Key};
pub use codec::{
    Context, Extent, Format, FuzzyHash, Mrfi, OffsetRange, SourceRange, compact_payload,
    decode_compact, decode_envelope, encode_compact, encode_envelope, format_mrfi,
    must_understand_violations, parse_debug, parse_reference, serialize_debug,
};
pub use compare::{
    Comparison, FieldComparison, Outcome, Ranked, Verdict, compare, compare_locators, rank,
};
pub use doc::{DocSection, MrfiDoc, normalize_line_endings};
pub use generate::{GenerateOptions, Profile, Target, generate, generate_mrfi, truncate_quote};
pub use resolve::{
    CONFIDENT_THRESHOLD, Candidate, Refresh, ResolveOptions, ResolveResult, Status, StrongSignals,
    check_destructive_gate, extent_range, refresh, resolve,
};
pub use text::{
    DEFAULT_SMH64_MAX_DISTANCE, HashSignal, hamming, is_js_whitespace, js_trim,
    normalize_for_compare, sha256_prefix, smh64, tokenize, xxh64, xxh64_prefix,
};

/// Low-level codecs of the compact envelope, exposed for conformance tests.
pub mod wire {
    pub use super::cbor::{
        base62_decode, base62_encode, checksum24, decode, decode_var_uint, encode, encode_var_uint,
        hangul_decode, hangul_encode,
    };
}

/// A malformed reference or an invalid request. The CLI maps it to `invalid_id`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct MrfiError(String);

impl MrfiError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    /// The message (identical to the TS implementation's).
    pub fn message(&self) -> &str {
        &self.0
    }
}
