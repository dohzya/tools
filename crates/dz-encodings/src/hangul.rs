//! Hangul syllable codec: 13 bits per syllable.

use std::fmt;

/// First code point of the Hangul syllables block.
pub const BASE: u32 = 0xAC00;
/// Bits carried by one syllable.
pub const BITS: u32 = 13;
/// Last code point of the current 13-bit window.
pub const LIMIT: u32 = BASE + (1 << BITS) - 1;
/// Layout emitted before [`BITS`] moved to 13.
pub const LEGACY_BITS: u32 = 11;

/// Hangul codec failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The bit width is outside `1..=13`.
    InvalidBits(u32),
    /// A character is outside the syllable window.
    InvalidSyllable(char),
    /// Leftover bits after the last full byte are not zero.
    InvalidPadding,
    /// Empty text given to an integer decoder.
    EmptyInteger,
    /// The value does not fit the requested digits.
    ValueTooLarge,
    /// The decoded integer does not fit in `u128`.
    Overflow,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBits(bits) => write!(f, "Invalid Hangul bit width: {bits}."),
            Self::InvalidSyllable(c) => write!(f, "Invalid Hangul syllable: {c}."),
            Self::InvalidPadding => f.write_str("Invalid Hangul padding."),
            Self::EmptyInteger => f.write_str("Cannot decode an empty integer."),
            Self::ValueTooLarge => f.write_str("Value does not fit in the Hangul digits."),
            Self::Overflow => f.write_str("Decoded integer does not fit in u128."),
        }
    }
}

impl std::error::Error for Error {}

fn check_bits(bits: u32) -> Result<(), Error> {
    // 16384 syllables would overflow the Hangul block (AC00-D7A3).
    if (1..=BITS).contains(&bits) {
        Ok(())
    } else {
        Err(Error::InvalidBits(bits))
    }
}

fn syllable(value: u32) -> char {
    // `value < 1 << 13` keeps the code point inside the Hangul block.
    char::from_u32(BASE + value).expect("Hangul window holds valid scalar values")
}

fn digit_of(c: char, bits: u32) -> Result<u32, Error> {
    let code = u32::from(c);
    if code < BASE || code > BASE + (1 << bits) - 1 {
        return Err(Error::InvalidSyllable(c));
    }
    Ok(code - BASE)
}

/// Canonical composition of conjoining jamo into precomposed syllables.
///
/// The TS decoder runs `String.prototype.normalize("NFC")` first, which for
/// the characters this codec can accept only matters for decomposed jamo
/// (L+V and LV+T sequences); anything else NFC could change is rejected
/// afterwards anyway. Doing it by hand keeps the crate dependency-free.
fn compose_jamo(text: &str) -> Vec<char> {
    const L_BASE: u32 = 0x1100;
    const V_BASE: u32 = 0x1161;
    const T_BASE: u32 = 0x11A7;
    const L_COUNT: u32 = 19;
    const V_COUNT: u32 = 21;
    const T_COUNT: u32 = 28;
    const LAST_SYLLABLE: u32 = 0xD7A3;

    let mut out: Vec<char> = Vec::with_capacity(text.len());
    for c in text.chars() {
        let cur = u32::from(c);
        if let Some(&prev) = out.last() {
            let prev = u32::from(prev);
            let composed = if (L_BASE..L_BASE + L_COUNT).contains(&prev)
                && (V_BASE..V_BASE + V_COUNT).contains(&cur)
            {
                Some(BASE + ((prev - L_BASE) * V_COUNT + (cur - V_BASE)) * T_COUNT)
            } else if (BASE..=LAST_SYLLABLE).contains(&prev)
                && (prev - BASE).is_multiple_of(T_COUNT)
                && (T_BASE + 1..T_BASE + T_COUNT).contains(&cur)
            {
                Some(prev + (cur - T_BASE))
            } else {
                None
            };
            if let Some(code) = composed.and_then(char::from_u32) {
                *out.last_mut().expect("checked non-empty") = code;
                continue;
            }
        }
        out.push(c);
    }
    out
}

/// [`encode_bytes_with_bits`] at [`BITS`].
pub fn encode_bytes(bytes: &[u8]) -> String {
    encode_bytes_unchecked(bytes, BITS)
}

/// Packs bytes into syllables of `bits` bits, most significant bits first,
/// zero-padding the last syllable.
///
/// The byte length is not recoverable from the syllable count (2 and 3 bytes
/// both fit in 2 syllables), so [`decode_bytes_with_bits`] may return one
/// trailing zero byte the encoder never saw. Callers must know the length by
/// other means.
pub fn encode_bytes_with_bits(bytes: &[u8], bits: u32) -> Result<String, Error> {
    check_bits(bits)?;
    Ok(encode_bytes_unchecked(bytes, bits))
}

fn encode_bytes_unchecked(bytes: &[u8], bits: u32) -> String {
    let mask = (1u32 << bits) - 1;
    let mut result = String::new();
    let mut buffer = 0u32;
    let mut bit_count = 0u32;

    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bit_count += 8;
        while bit_count >= bits {
            bit_count -= bits;
            result.push(syllable((buffer >> bit_count) & mask));
            buffer &= (1 << bit_count) - 1;
        }
    }
    if bit_count > 0 {
        result.push(syllable((buffer << (bits - bit_count)) & mask));
    }
    result
}

/// [`decode_bytes_with_bits`] at [`BITS`].
pub fn decode_bytes(text: &str) -> Result<Vec<u8>, Error> {
    decode_bytes_with_bits(text, BITS)
}

/// Inverse of [`encode_bytes_with_bits`]; decomposed jamo are composed first.
pub fn decode_bytes_with_bits(text: &str, bits: u32) -> Result<Vec<u8>, Error> {
    check_bits(bits)?;
    let mut bytes = Vec::new();
    let mut buffer = 0u32;
    let mut bit_count = 0u32;

    for c in compose_jamo(text) {
        buffer = (buffer << bits) | digit_of(c, bits)?;
        bit_count += bits;
        while bit_count >= 8 {
            bit_count -= 8;
            bytes.push(((buffer >> bit_count) & 0xFF) as u8);
            buffer &= (1 << bit_count) - 1;
        }
    }
    if bit_count > 0 && buffer != 0 {
        return Err(Error::InvalidPadding);
    }
    Ok(bytes)
}

/// [`encode_digits_with_bits`] at [`BITS`].
pub fn encode_digits(value: u128, digits: usize) -> Result<String, Error> {
    encode_digits_with_bits(value, digits, BITS)
}

/// Fixed-width positional numeral: `digits` syllables carry exactly
/// `digits * bits` bits, most significant first, zero-padded on the left.
pub fn encode_digits_with_bits(value: u128, digits: usize, bits: u32) -> Result<String, Error> {
    check_bits(bits)?;
    let total_bits = u32::try_from(digits)
        .ok()
        .and_then(|d| d.checked_mul(bits))
        .unwrap_or(u32::MAX);
    if total_bits < 128 && value >> total_bits != 0 {
        return Err(Error::ValueTooLarge);
    }

    let mask = (1u128 << bits) - 1;
    let mut remaining = value;
    let mut out = Vec::with_capacity(digits);
    for _ in 0..digits {
        out.push(syllable((remaining & mask) as u32));
        remaining >>= bits;
    }
    Ok(out.into_iter().rev().collect())
}

/// [`decode_digits_with_bits`] at [`BITS`].
pub fn decode_digits(text: &str) -> Result<u128, Error> {
    decode_digits_with_bits(text, BITS)
}

/// Inverse of [`encode_digits_with_bits`]; the width is not checked.
pub fn decode_digits_with_bits(text: &str, bits: u32) -> Result<u128, Error> {
    check_bits(bits)?;
    if text.is_empty() {
        return Err(Error::EmptyInteger);
    }
    let mut result = 0u128;
    for c in compose_jamo(text) {
        let digit = digit_of(c, bits)?;
        result = result
            .checked_mul(1 << bits)
            .and_then(|r| r.checked_add(u128::from(digit)))
            .ok_or(Error::Overflow)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Ported from packages/tools/hangul.test.ts.
    #[test]
    fn window_is_8192_syllables_from_block_start() {
        assert_eq!(BASE, 0xAC00);
        assert_eq!(BITS, 13);
        assert_eq!(LIMIT, 0xCBFF);
        assert_eq!(LIMIT - BASE + 1, 1 << BITS);
    }

    #[test]
    fn packs_13_bits_per_syllable() {
        assert_eq!(encode_bytes(&[0xFF; 13]).chars().count(), 8);
        let legacy = encode_bytes_with_bits(&[0xFF; 13], LEGACY_BITS).unwrap();
        assert_eq!(legacy.chars().count(), 10);
    }

    #[test]
    fn rejects_syllable_past_window() {
        let past = char::from_u32(LIMIT + 1).unwrap();
        assert_eq!(
            decode_bytes(&past.to_string()),
            Err(Error::InvalidSyllable(past))
        );
    }

    #[test]
    fn rejects_value_wider_than_digits() {
        assert_eq!(encode_digits(1 << 39, 3), Err(Error::ValueTooLarge));
        assert_eq!(
            encode_digits((1 << 39) - 1, 3).map(|s| s.chars().count()),
            Ok(3)
        );
    }

    #[test]
    fn rejects_unsupported_bit_widths() {
        assert_eq!(encode_bytes_with_bits(&[1], 0), Err(Error::InvalidBits(0)));
        assert_eq!(decode_bytes_with_bits("", 14), Err(Error::InvalidBits(14)));
    }

    #[test]
    fn legacy_digits_misread_at_current_width() {
        let epoch = 1_787_000_000u128;
        let text = encode_digits_with_bits(epoch, 3, LEGACY_BITS).unwrap();
        assert_eq!(decode_digits_with_bits(&text, LEGACY_BITS), Ok(epoch));
        assert!(decode_digits(&text).unwrap() > epoch * 15);
    }
}
