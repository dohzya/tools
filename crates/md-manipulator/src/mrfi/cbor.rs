//! The minimal CBOR subset, varuint, checksum and payload codecs of the
//! compact MRFI envelope. No knowledge of MRFI fields lives here.

use super::MrfiError;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;

/// Largest integer a JS number holds exactly; the TS codec rejects bigger ones.
const MAX_SAFE: u64 = (1 << 53) - 1;
const MAX_DEPTH: usize = 64;

pub(crate) const MAGIC: &[u8; 4] = b"MRFI";

/// A CBOR map key: unsigned integer or text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Key {
    /// Unsigned integer key.
    Num(u64),
    /// Text key.
    Text(String),
}

/// The CBOR values MRFI uses: unsigned integers, text, arrays and maps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cbor {
    /// Unsigned integer, at most 2^53 - 1.
    Uint(u64),
    /// UTF-8 text.
    Text(String),
    /// Array.
    Array(Vec<Cbor>),
    /// Map, entries in insertion order (encoding sorts them).
    Map(Vec<(Key, Cbor)>),
}

fn err(message: &str) -> MrfiError {
    MrfiError::new(message)
}

/// UTF-16 code unit order, the order of JS string comparison, which the TS
/// encoder uses for text keys (differs from UTF-8 order for astral characters).
fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn key_cmp(a: &Key, b: &Key) -> Ordering {
    match (a, b) {
        (Key::Num(x), Key::Num(y)) => x.cmp(y),
        (Key::Num(_), Key::Text(_)) => Ordering::Less,
        (Key::Text(_), Key::Num(_)) => Ordering::Greater,
        (Key::Text(x), Key::Text(y)) => utf16_cmp(x, y),
    }
}

/// Encodes a value; maps are written with sorted keys (numbers first).
pub fn encode(value: &Cbor) -> Result<Vec<u8>, MrfiError> {
    let mut out = vec![];
    encode_into(value, &mut out)?;
    Ok(out)
}

fn encode_into(value: &Cbor, out: &mut Vec<u8>) -> Result<(), MrfiError> {
    match value {
        Cbor::Uint(n) => head(0, *n, out)?,
        Cbor::Text(s) => {
            head(3, s.len() as u64, out)?;
            out.extend_from_slice(s.as_bytes());
        }
        Cbor::Array(items) => {
            head(4, items.len() as u64, out)?;
            for item in items {
                encode_into(item, out)?;
            }
        }
        Cbor::Map(entries) => {
            let mut sorted: Vec<&(Key, Cbor)> = entries.iter().collect();
            sorted.sort_by(|a, b| key_cmp(&a.0, &b.0));
            head(5, sorted.len() as u64, out)?;
            for (key, item) in sorted {
                match key {
                    Key::Num(n) => head(0, *n, out)?,
                    Key::Text(s) => encode_into(&Cbor::Text(s.clone()), out)?,
                }
                encode_into(item, out)?;
            }
        }
    }
    Ok(())
}

fn head(major: u8, value: u64, out: &mut Vec<u8>) -> Result<(), MrfiError> {
    if value > MAX_SAFE {
        return Err(err("CBOR encoder only supports uint values"));
    }
    let prefix = major << 5;
    if value < 24 {
        out.push(prefix | value as u8);
    } else if value <= 0xff {
        out.extend_from_slice(&[prefix | 24, value as u8]);
    } else if value <= 0xffff {
        out.push(prefix | 25);
        out.extend_from_slice(&(value as u16).to_be_bytes());
    } else if value <= 0xffff_ffff {
        out.push(prefix | 26);
        out.extend_from_slice(&(value as u32).to_be_bytes());
    } else {
        out.push(prefix | 27);
        out.extend_from_slice(&value.to_be_bytes());
    }
    Ok(())
}

/// Reads the first value of `bytes`; trailing bytes are ignored, as in the TS reader.
pub fn decode(bytes: &[u8]) -> Result<Cbor, MrfiError> {
    Reader { bytes, offset: 0 }.value(0)
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl Reader<'_> {
    fn value(&mut self, depth: usize) -> Result<Cbor, MrfiError> {
        if depth > MAX_DEPTH {
            return Err(err("CBOR nesting is too deep"));
        }
        let initial = *self
            .bytes
            .get(self.offset)
            .ok_or_else(|| err("Unexpected end of CBOR payload"))?;
        self.offset += 1;
        let major = initial >> 5;
        let length = self.length(initial & 0x1f)?;
        match major {
            0 => Ok(Cbor::Uint(length)),
            3 => {
                let raw = self.take(length)?;
                // TextDecoder drops a leading BOM.
                let raw = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(raw);
                Ok(Cbor::Text(String::from_utf8_lossy(raw).into_owned()))
            }
            4 => {
                let mut items = vec![];
                for _ in 0..length {
                    items.push(self.value(depth + 1)?);
                }
                Ok(Cbor::Array(items))
            }
            5 => {
                let mut entries = vec![];
                for _ in 0..length {
                    let key = match self.value(depth + 1)? {
                        Cbor::Uint(n) => Key::Num(n),
                        Cbor::Text(s) => Key::Text(s),
                        _ => return Err(err("Unsupported CBOR map key")),
                    };
                    entries.push((key, self.value(depth + 1)?));
                }
                Ok(Cbor::Map(entries))
            }
            _ => Err(err("Unsupported CBOR payload")),
        }
    }

    fn length(&mut self, additional: u8) -> Result<u64, MrfiError> {
        match additional {
            0..=23 => Ok(additional as u64),
            24 => self.uint(1),
            25 => self.uint(2),
            26 => self.uint(4),
            27 => self.uint(8),
            _ => Err(err("Unsupported CBOR length")),
        }
    }

    fn uint(&mut self, count: usize) -> Result<u64, MrfiError> {
        let value = self
            .take(count as u64)?
            .iter()
            .fold(0u128, |acc, &b| (acc << 8) | b as u128);
        if value > MAX_SAFE as u128 {
            return Err(err("CBOR uint is too large"));
        }
        Ok(value as u64)
    }

    fn take(&mut self, length: u64) -> Result<&[u8], MrfiError> {
        let end = usize::try_from(length)
            .ok()
            .and_then(|l| self.offset.checked_add(l))
            .filter(|&end| end <= self.bytes.len())
            .ok_or_else(|| err("Unexpected end of CBOR payload"))?;
        let slice = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(slice)
    }
}

/// Big-endian base-128 length with a continuation bit on all but the last byte.
pub fn encode_var_uint(value: u64) -> Result<Vec<u8>, MrfiError> {
    if value > MAX_SAFE {
        return Err(err("Invalid compact MRFI length"));
    }
    let mut bytes = vec![(value & 0x7f) as u8];
    let mut rest = value >> 7;
    while rest > 0 {
        bytes.insert(0, ((rest & 0x7f) as u8) | 0x80);
        rest >>= 7;
    }
    Ok(bytes)
}

/// Returns the value and the offset after it.
pub fn decode_var_uint(bytes: &[u8], offset: usize) -> Result<(u64, usize), MrfiError> {
    let mut value = 0u64;
    for (i, &byte) in bytes.iter().enumerate().skip(offset) {
        // Saturating: such a length fails the envelope bounds check anyway.
        value = value
            .saturating_mul(128)
            .saturating_add((byte & 0x7f) as u64);
        if byte & 0x80 == 0 {
            return Ok((value, i + 1));
        }
    }
    Err(err("Invalid compact MRFI length"))
}

/// First 3 bytes of the SHA-256 digest.
pub fn checksum24(bytes: &[u8]) -> [u8; 3] {
    let digest = Sha256::digest(bytes);
    [digest[0], digest[1], digest[2]]
}

const ALPHABET: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Base62 of the bytes read as one big-endian integer: leading zero bytes are
/// lost and a zero value is `"0"`, exactly like the TS `BigInt` codec (hash
/// prefixes depend on it; `dz_encodings::base62` keeps leading zeros instead).
pub fn base62_encode(bytes: &[u8]) -> String {
    let mut number: Vec<u8> = bytes.iter().copied().skip_while(|&b| b == 0).collect();
    if number.is_empty() {
        return "0".to_owned();
    }
    let mut digits = vec![];
    while !number.is_empty() {
        let mut remainder = 0u32;
        let mut quotient = Vec::with_capacity(number.len());
        for &b in &number {
            let acc = (remainder << 8) | b as u32;
            let q = (acc / 62) as u8;
            remainder = acc % 62;
            if !quotient.is_empty() || q != 0 {
                quotient.push(q);
            }
        }
        digits.push(ALPHABET[remainder as usize]);
        number = quotient;
    }
    digits.reverse();
    String::from_utf8(digits).expect("ASCII alphabet")
}

/// Inverse of [`base62_encode`]; empty or non-alphanumeric text is an error.
pub fn base62_decode(payload: &str) -> Result<Vec<u8>, MrfiError> {
    let invalid = || err("Invalid base62 MRFI payload");
    if payload.is_empty() || !payload.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(invalid());
    }
    // Big-endian byte string, multiplied by 62 and incremented per digit.
    let mut number: Vec<u8> = vec![];
    for c in payload.bytes() {
        let digit = ALPHABET.iter().position(|&d| d == c).ok_or_else(invalid)? as u32;
        let mut carry = digit;
        for byte in number.iter_mut().rev() {
            let acc = (*byte as u32) * 62 + carry;
            *byte = (acc & 0xff) as u8;
            carry = acc >> 8;
        }
        while carry > 0 {
            number.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    Ok(number)
}

/// Hangul payload at the current (13 bits) or legacy (11 bits) width.
pub fn hangul_encode(bytes: &[u8], bits: u32) -> String {
    dz_encodings::hangul::encode_bytes_with_bits(bytes, bits).expect("supported width")
}

/// Inverse of [`hangul_encode`].
pub fn hangul_decode(payload: &str, bits: u32) -> Result<Vec<u8>, MrfiError> {
    dz_encodings::hangul::decode_bytes_with_bits(payload, bits)
        .map_err(|_| err("Invalid Hangul MRFI payload"))
}
