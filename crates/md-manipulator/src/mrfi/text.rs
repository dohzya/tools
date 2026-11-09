//! Text normalization and the hashes used by MRFI: xxh64 (`fh`), SHA-256
//! prefixes (`ctx`), the simhash `smh64` (`hh`, `ph`, `doc`).

use super::cbor::base62_encode;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

/// JavaScript's `\s` (and `String.prototype.trim`) set. Differs from
/// `char::is_whitespace`: U+FEFF counts, U+0085 does not.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// NFC, lowercase, whitespace runs collapsed to one space, trimmed: the
/// normalization every hash and witness comparison applies.
pub fn normalize_for_compare(value: &str) -> String {
    let lowered: String = value.nfc().collect::<String>().to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut pending = false;
    for c in lowered.chars() {
        if is_js_whitespace(c) {
            pending = true;
        } else {
            if pending && !out.is_empty() {
                out.push(' ');
            }
            pending = false;
            out.push(c);
        }
    }
    out
}

/// Runs of letters and digits (`[\p{L}\p{N}]+`) of the NFC lowercase text.
pub fn tokenize(text: &str) -> Vec<String> {
    let lowered: String = text.nfc().collect::<String>().to_lowercase();
    let mut tokens = vec![];
    let mut current = String::new();
    for c in lowered.chars() {
        if matches!(
            c.general_category(),
            GeneralCategory::UppercaseLetter
                | GeneralCategory::LowercaseLetter
                | GeneralCategory::TitlecaseLetter
                | GeneralCategory::ModifierLetter
                | GeneralCategory::OtherLetter
                | GeneralCategory::DecimalNumber
                | GeneralCategory::LetterNumber
                | GeneralCategory::OtherNumber
        ) {
            current.push(c);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

const P1: u64 = 11400714785074694791;
const P2: u64 = 14029467366897019727;
const P3: u64 = 1609587929392839161;
const P4: u64 = 9650029242287828579;
const P5: u64 = 2870177450012600261;

fn round(acc: u64, input: u64) -> u64 {
    acc.wrapping_add(input.wrapping_mul(P2))
        .rotate_left(31)
        .wrapping_mul(P1)
}

fn merge(acc: u64, value: u64) -> u64 {
    (acc ^ round(0, value)).wrapping_mul(P1).wrapping_add(P4)
}

/// xxHash64, seed 0, of the UTF-8 bytes.
pub fn xxh64(text: &str) -> u64 {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let u64_at = |i: usize| u64::from_le_bytes(bytes[i..i + 8].try_into().expect("8 bytes"));
    let mut offset = 0;
    let mut h = if len >= 32 {
        let mut v = [P1.wrapping_add(P2), P2, 0, 0u64.wrapping_sub(P1)];
        while offset + 32 <= len {
            for (i, lane) in v.iter_mut().enumerate() {
                *lane = round(*lane, u64_at(offset + 8 * i));
            }
            offset += 32;
        }
        let mut h = v[0]
            .rotate_left(1)
            .wrapping_add(v[1].rotate_left(7))
            .wrapping_add(v[2].rotate_left(12))
            .wrapping_add(v[3].rotate_left(18));
        for lane in v {
            h = merge(h, lane);
        }
        h
    } else {
        P5
    };
    h = h.wrapping_add(len as u64);
    while offset + 8 <= len {
        h ^= round(0, u64_at(offset));
        h = h.rotate_left(27).wrapping_mul(P1).wrapping_add(P4);
        offset += 8;
    }
    if offset + 4 <= len {
        let k = u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("4 bytes"));
        h ^= (k as u64).wrapping_mul(P1);
        h = h.rotate_left(23).wrapping_mul(P2).wrapping_add(P3);
        offset += 4;
    }
    while offset < len {
        h ^= (bytes[offset] as u64).wrapping_mul(P5);
        h = h.rotate_left(11).wrapping_mul(P1);
        offset += 1;
    }
    h ^= h >> 33;
    h = h.wrapping_mul(P2);
    h ^= h >> 29;
    h = h.wrapping_mul(P3);
    h ^= h >> 32;
    h
}

/// A hash prefix with the algorithm tag it was computed with (`fh`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashSignal {
    /// `xxh64`, `sha256` or any tag read from a reference.
    pub algorithm: String,
    /// Truncated base62 digest.
    pub prefix: String,
}

fn prefix_of(full: String, length: usize) -> String {
    full.chars().take(length).collect()
}

/// `xxh64` signal of the normalized text (default `fh` tag).
pub fn xxh64_prefix(text: &str, length: usize) -> String {
    prefix_of(
        base62_encode(&xxh64(&normalize_for_compare(text)).to_be_bytes()),
        length,
    )
}

/// `sha256` signal of the normalized text (`ctx` windows).
pub fn sha256_prefix(text: &str, length: usize) -> String {
    let digest = Sha256::digest(normalize_for_compare(text).as_bytes());
    prefix_of(base62_encode(&digest), length)
}

/// Recomputes a signal for a tag the resolver knows (`xxh64`, `sha256`).
pub fn hash_signal_for(algorithm: &str, text: &str) -> Option<String> {
    match algorithm {
        "sha256" => Some(sha256_prefix(text, 8)),
        "xxh64" => Some(xxh64_prefix(text, 8)),
        _ => None,
    }
}

/// 64-bit simhash over letter/digit tokens and bigrams (`smh64` tag).
pub fn smh64(text: &str) -> u64 {
    let tokens = tokenize(text);
    let mut acc = [0i64; 64];
    let mut add = |feature: &str, weight: i64| {
        let mut hasher = Sha256::new();
        hasher.update(b"mrfi-smh64-v0\0");
        hasher.update(feature.as_bytes());
        let digest = hasher.finalize();
        let hash = u64::from_be_bytes(digest[..8].try_into().expect("8 bytes"));
        for (bit, slot) in acc.iter_mut().enumerate() {
            if hash & (1 << (63 - bit)) == 0 {
                *slot -= weight;
            } else {
                *slot += weight;
            }
        }
    };
    if tokens.is_empty() {
        add("empty", 1);
    }
    for t in &tokens {
        add(&format!("u:{t}"), 1);
    }
    for pair in tokens.windows(2) {
        add(&format!("b:{}\0{}", pair[0], pair[1]), 2);
    }
    acc.iter()
        .enumerate()
        .filter(|&(_, &a)| a >= 0)
        .fold(0u64, |r, (bit, _)| r | (1 << (63 - bit)))
}

/// Number of differing bits.
pub fn hamming(left: u64, right: u64) -> u32 {
    (left ^ right).count_ones()
}

/// Acceptance distance of `hh`, `ph` and `doc` when the reference has none.
pub const DEFAULT_SMH64_MAX_DISTANCE: u32 = 8;
