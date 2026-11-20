//! Text codecs without domain knowledge: Hangul (13 bits per syllable) and
//! base62.
//!
//! Zero dependencies and no I/O, so the crate builds for `wasm32`. Both codecs
//! are bit-compatible with the TypeScript implementations they replace
//! (`packages/tools/hangul.ts`, the MRFI base62 payload codec and the
//! review-timestamp integer codec); `tests/vectors.json` pins that.

pub mod base62;
pub mod hangul;
