//! Base62 codec.

use std::fmt;

/// Digit ordering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alphabet {
    /// `0-9A-Za-z`, used by MRFI payloads.
    Mrfi,
    /// `0-9a-zA-Z`, used by review timestamps.
    Timestamp,
}

/// Base62 codec failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Empty text.
    Empty,
    /// A character is not in the alphabet.
    InvalidCharacter(char),
    /// The decoded integer does not fit in `u128`.
    Overflow,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => f.write_str("Cannot decode an empty base62 text."),
            Self::InvalidCharacter(c) => write!(f, "Invalid base62 character: {c}."),
            Self::Overflow => f.write_str("Decoded integer does not fit in u128."),
        }
    }
}

impl std::error::Error for Error {}

impl Alphabet {
    fn digits(self) -> &'static [u8; 62] {
        match self {
            Self::Mrfi => b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
            Self::Timestamp => b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }
    }

    fn value_of(self, c: char) -> Result<u32, Error> {
        u8::try_from(c)
            .ok()
            .and_then(|b| self.digits().iter().position(|&d| d == b))
            .map(|p| p as u32)
            .ok_or(Error::InvalidCharacter(c))
    }
}

/// Encodes bytes: each leading `0x00` byte becomes one zero digit, the rest is
/// read as one big-endian number (base58-style, no extra character).
///
/// Empty input gives `""`, `n` zero bytes give `n` zero digits. Input without
/// leading zero bytes is bit-identical to the TS codec, which lost leading
/// zeros and rendered empty or all-zero input as `"0"`: that legacy `"0"` now
/// means a single zero byte. MRFI payloads (CBOR) never start with `0x00`, so
/// TS-written references decode the same.
pub fn encode_bytes(bytes: &[u8], alphabet: Alphabet) -> String {
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    let mut number: Vec<u8> = bytes[zeros..].to_vec();

    let digits = alphabet.digits();
    let mut out = Vec::new();
    while !number.is_empty() {
        // In-place long division by 62 on the big-endian byte string.
        let mut remainder = 0u32;
        for byte in &mut number {
            let acc = (remainder << 8) | u32::from(*byte);
            *byte = (acc / 62) as u8;
            remainder = acc % 62;
        }
        out.push(digits[remainder as usize]);
        let leading_zeros = number.iter().take_while(|&&b| b == 0).count();
        number.drain(..leading_zeros);
    }
    out.extend(std::iter::repeat_n(digits[0], zeros));
    out.reverse();
    String::from_utf8(out).expect("alphabet is ASCII")
}

/// Inverse of [`encode_bytes`]: each leading zero digit is a `0x00` byte, the
/// rest is a big number. Empty text decodes to empty bytes.
pub fn decode_bytes(text: &str, alphabet: Alphabet) -> Result<Vec<u8>, Error> {
    let zero_digit = char::from(alphabet.digits()[0]);
    let zeros = text.chars().take_while(|&c| c == zero_digit).count();

    // Little-endian accumulator: number = number * 62 + digit.
    let mut number: Vec<u8> = Vec::new();
    for c in text.chars().skip(zeros) {
        let mut carry = alphabet.value_of(c)?;
        for byte in &mut number {
            let acc = u32::from(*byte) * 62 + carry;
            *byte = (acc & 0xFF) as u8;
            carry = acc >> 8;
        }
        while carry > 0 {
            number.push((carry & 0xFF) as u8);
            carry >>= 8;
        }
    }
    number.extend(std::iter::repeat_n(0, zeros));
    number.reverse();
    Ok(number)
}

/// Unsigned integer, left-padded with the zero digit up to `width`; longer
/// values are not truncated. `0` renders as a single zero digit.
pub fn encode_unsigned(value: u128, width: usize, alphabet: Alphabet) -> String {
    let digits = alphabet.digits();
    let mut out = Vec::new();
    let mut remaining = value;
    while remaining > 0 {
        out.push(digits[(remaining % 62) as usize]);
        remaining /= 62;
    }
    if out.is_empty() {
        out.push(digits[0]);
    }
    while out.len() < width {
        out.push(digits[0]);
    }
    out.reverse();
    String::from_utf8(out).expect("alphabet is ASCII")
}

/// Inverse of [`encode_unsigned`]; leading zero digits are accepted.
pub fn decode_unsigned(text: &str, alphabet: Alphabet) -> Result<u128, Error> {
    if text.is_empty() {
        return Err(Error::Empty);
    }
    let mut out = 0u128;
    for c in text.chars() {
        out = out
            .checked_mul(62)
            .and_then(|v| v.checked_add(u128::from(alphabet.value_of(c).ok()?)))
            .ok_or(Error::Overflow)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leading_zero_bytes_are_kept() {
        assert_eq!(encode_bytes(&[0, 0, 1], Alphabet::Mrfi), "001");
        assert_eq!(encode_bytes(&[], Alphabet::Mrfi), "");
        assert_eq!(encode_bytes(&[0, 0], Alphabet::Mrfi), "00");
        assert_eq!(decode_bytes("001", Alphabet::Mrfi), Ok(vec![0, 0, 1]));
        assert_eq!(decode_bytes("", Alphabet::Mrfi), Ok(vec![]));
    }

    #[test]
    fn alphabets_differ_in_case_order() {
        assert_eq!(encode_unsigned(10, 0, Alphabet::Mrfi), "A");
        assert_eq!(encode_unsigned(10, 0, Alphabet::Timestamp), "a");
    }

    #[test]
    fn non_ascii_is_rejected() {
        assert_eq!(
            decode_bytes("é", Alphabet::Mrfi),
            Err(Error::InvalidCharacter('é'))
        );
    }
}
