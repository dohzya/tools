//! Review timestamps: 8-char base62 ("compact"), 4 Hangul syllables, ISO 8601.

/// Encoding of a timestamp value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// 6 base62 digits of epoch seconds + 2 of the UTC offset in minutes.
    Compact,
    /// 3 syllables of epoch seconds + 1 of the offset.
    Hangul,
    /// `2026-01-01T00:00:00+01:00`.
    Iso,
}

/// A decoded instant with the UTC offset it was written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewTimestamp {
    /// Seconds since the Unix epoch.
    pub unix_seconds: u64,
    /// Offset in minutes east of UTC.
    pub offset_minutes: i32,
}

/// Encoding failure (value out of the format's range).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RangeError(pub String);

use dz_encodings::base62::{self, Alphabet};
use dz_encodings::hangul;

const COMPACT_EPOCH_WIDTH: usize = 6;
const COMPACT_TZ_WIDTH: usize = 2;
const HANGUL_EPOCH_WIDTH: usize = 3;
const HANGUL_TZ_WIDTH: usize = 1;
// A 4-syllable word carries no envelope: the pre-13-bit layout is told apart
// by plausibility (year 2000..2100), as in the TS implementation.
const PLAUSIBLE_EPOCH_MIN: u64 = 946_684_800;
const PLAUSIBLE_EPOCH_MAX: u64 = 4_102_444_800;

fn offset_to_unsigned(offset: i32, modulus: i64, what: &str) -> Result<u128, RangeError> {
    let offset = i64::from(offset);
    if offset < -(modulus / 2) || offset > (modulus - 1) / 2 {
        return Err(RangeError(format!(
            "offsetMinutes out of {what} timestamp range: {offset}."
        )));
    }
    Ok(u128::try_from(if offset >= 0 {
        offset
    } else {
        modulus + offset
    })
    .unwrap_or(0))
}

fn unsigned_to_offset(raw: u128, modulus: i64) -> i32 {
    let raw = i64::try_from(raw).unwrap_or(0);
    i32::try_from(if raw < modulus / 2 {
        raw
    } else {
        raw - modulus
    })
    .unwrap_or(0)
}

/// Compact encoding.
pub fn encode_compact(unix_seconds: u64, offset_minutes: i32) -> Result<String, RangeError> {
    let modulus = 62i64.pow(COMPACT_TZ_WIDTH as u32);
    let offset = offset_to_unsigned(offset_minutes, modulus, "compact")?;
    if unix_seconds >= 62u64.pow(COMPACT_EPOCH_WIDTH as u32) {
        return Err(RangeError(format!(
            "unixSeconds out of compact timestamp range: {unix_seconds}."
        )));
    }
    Ok(base62::encode_unsigned(
        u128::from(unix_seconds),
        COMPACT_EPOCH_WIDTH,
        Alphabet::Timestamp,
    ) + &base62::encode_unsigned(offset, COMPACT_TZ_WIDTH, Alphabet::Timestamp))
}

/// Inverse of [`encode_compact`]; `None` unless 8 ASCII alphanumerics.
pub fn decode_compact(value: &str) -> Option<ReviewTimestamp> {
    if value.len() != 8 || !value.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    let (epoch, offset) = value.split_at(COMPACT_EPOCH_WIDTH);
    let modulus = 62i64.pow(COMPACT_TZ_WIDTH as u32);
    Some(ReviewTimestamp {
        unix_seconds: u64::try_from(base62::decode_unsigned(epoch, Alphabet::Timestamp).ok()?)
            .ok()?,
        offset_minutes: unsigned_to_offset(
            base62::decode_unsigned(offset, Alphabet::Timestamp).ok()?,
            modulus,
        ),
    })
}

/// Hangul encoding (rejects values whose legacy reading would win).
pub fn encode_hangul(unix_seconds: u64, offset_minutes: i32) -> Result<String, RangeError> {
    let modulus = 1i64 << hangul::BITS;
    let offset = offset_to_unsigned(offset_minutes, modulus, "hangul")?;
    if unix_seconds >= 1u64 << (hangul::BITS * HANGUL_EPOCH_WIDTH as u32) {
        return Err(RangeError(format!(
            "unixSeconds out of hangul timestamp range: {unix_seconds}."
        )));
    }
    let digits =
        |v: u128, n: usize| hangul::encode_digits(v, n).map_err(|e| RangeError(e.to_string()));
    let encoded =
        digits(u128::from(unix_seconds), HANGUL_EPOCH_WIDTH)? + &digits(offset, HANGUL_TZ_WIDTH)?;
    // Far-future epochs (~2448-4048) whose legacy reading is plausible would
    // be mis-decoded; reject them by reading back instead of guessing a window.
    let back = decode_hangul(&encoded);
    if back
        != Some(ReviewTimestamp {
            unix_seconds,
            offset_minutes,
        })
    {
        return Err(RangeError(format!(
            "unixSeconds not representable without legacy ambiguity: {unix_seconds}."
        )));
    }
    Ok(encoded)
}

fn read_hangul(value: &str, bits: u32) -> Option<ReviewTimestamp> {
    let split = value.char_indices().nth(HANGUL_EPOCH_WIDTH)?.0;
    let (epoch, offset) = value.split_at(split);
    let modulus = 1i64 << bits;
    Some(ReviewTimestamp {
        unix_seconds: u64::try_from(hangul::decode_digits_with_bits(epoch, bits).ok()?).ok()?,
        offset_minutes: unsigned_to_offset(
            hangul::decode_digits_with_bits(offset, bits).ok()?,
            modulus,
        ),
    })
}

fn is_plausible(t: ReviewTimestamp) -> bool {
    (PLAUSIBLE_EPOCH_MIN..=PLAUSIBLE_EPOCH_MAX).contains(&t.unix_seconds)
}

/// Inverse of [`encode_hangul`], with the 11-bit legacy fallback.
pub fn decode_hangul(value: &str) -> Option<ReviewTimestamp> {
    if !is_hangul_timestamp(value) {
        return None;
    }
    let current = read_hangul(value, hangul::BITS)?;
    if is_plausible(current) {
        return Some(current);
    }
    match read_hangul(value, hangul::LEGACY_BITS) {
        Some(legacy) if is_plausible(legacy) => Some(legacy),
        _ => Some(current),
    }
}

/// `^[\uac00-\ucbff]{4}$`.
pub fn is_hangul_timestamp(value: &str) -> bool {
    value.chars().count() == 4
        && value
            .chars()
            .all(|c| ('\u{ac00}'..='\u{cbff}').contains(&c))
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Shape of `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`
/// (without the optional `%`); returns the parsed instant when the date is
/// valid for `new Date(...)`.
fn parse_iso(value: &str) -> Option<ReviewTimestamp> {
    let b = value.as_bytes();
    if b.len() < 20 || !value.is_ascii() {
        return None;
    }
    let num = |a: usize, n: usize| -> Option<i64> {
        let part = &value[a..a + n];
        part.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d, h, mi, s) = (
        num(0, 4)?,
        num(5, 2)?,
        num(8, 2)?,
        num(11, 2)?,
        num(14, 2)?,
        num(17, 2)?,
    );
    let tail = &value[19..];
    let offset = if tail == "Z" {
        0
    } else {
        let sign = match tail.as_bytes()[0] {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        let digits = tail[1..].replace(':', "");
        if tail[1..].matches(':').count() > 1
            || tail[1..].find(':').is_some_and(|i| i != 2)
            || digits.len() != 4
        {
            return None;
        }
        let (oh, om) = (num_of(&digits[..2])?, num_of(&digits[2..])?);
        if oh > 23 || om > 59 {
            return None;
        }
        sign * (oh * 60 + om)
    };
    let dim = [
        31,
        if is_leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1..=12).contains(&mo) || d < 1 || d > dim[(mo - 1) as usize] || mi > 59 || s > 59 {
        return None;
    }
    if h > 24 || (h == 24 && (mi != 0 || s != 0)) {
        return None;
    }
    let secs = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + s - offset * 60;
    Some(ReviewTimestamp {
        unix_seconds: u64::try_from(secs).ok()?,
        offset_minutes: i32::try_from(offset).ok()?,
    })
}

fn num_of(s: &str) -> Option<i64> {
    s.parse().ok()
}

/// Parses any of the three formats, with an optional leading `%`.
pub fn parse_review_timestamp(value: &str) -> Option<ReviewTimestamp> {
    let normalized = value.strip_prefix('%').unwrap_or(value);
    if normalized.len() == 8 && normalized.bytes().all(|b| b.is_ascii_alphanumeric()) {
        // An 8-char word is never ISO (>= 20 chars), so order is irrelevant.
        return decode_compact(normalized);
    }
    if is_hangul_timestamp(normalized) {
        return decode_hangul(normalized);
    }
    parse_iso(normalized)
}

/// ISO rendering in the timestamp's own offset.
pub fn format_for_display(timestamp: ReviewTimestamp) -> String {
    let shifted = i64::try_from(timestamp.unix_seconds).unwrap_or(0)
        + i64::from(timestamp.offset_minutes) * 60;
    let (days, rem) = (shifted.div_euclid(86_400), shifted.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    let offset = timestamp.offset_minutes;
    let abs = offset.abs();
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        if offset < 0 { '-' } else { '+' },
        abs / 60,
        abs % 60
    )
}

/// Renders an instant in `format`.
pub fn encode(timestamp: ReviewTimestamp, format: Format) -> Result<String, RangeError> {
    match format {
        Format::Compact => encode_compact(timestamp.unix_seconds, timestamp.offset_minutes),
        Format::Hangul => encode_hangul(timestamp.unix_seconds, timestamp.offset_minutes),
        Format::Iso => Ok(format_for_display(timestamp)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: u64 = 1_767_225_600; // 2026-01-01T00:00:00Z

    #[test]
    fn compact_matches_ts_vectors() {
        assert_eq!(encode_compact(T, 60).unwrap(), "1VB66I0Y");
        assert_eq!(encode_compact(T, -300).unwrap(), "1VB66IVa");
        assert_eq!(
            decode_compact("1VB66I0Y"),
            Some(ReviewTimestamp {
                unix_seconds: T,
                offset_minutes: 60
            })
        );
        assert_eq!(decode_compact("1VB66IVa").unwrap().offset_minutes, -300);
        assert_eq!(decode_compact("short"), None);
    }

    #[test]
    fn compact_rejects_out_of_range() {
        assert!(encode_compact(T, 2000).is_err());
        assert!(encode_compact(62u64.pow(6), 0).is_err());
    }

    #[test]
    fn hangul_matches_ts_vectors() {
        assert_eq!(encode_hangul(T, 60).unwrap(), "갚뚭씀갼");
        assert_eq!(decode_hangul("갚뚭씀갼").unwrap().unix_seconds, T);
        assert_eq!(decode_hangul("갚뚭씀갼").unwrap().offset_minutes, 60);
    }

    #[test]
    fn iso_parse_and_display() {
        let parsed = parse_review_timestamp("2026-01-01T00:00:00+01:00").unwrap();
        assert_eq!(parsed.unix_seconds, 1_767_222_000);
        assert_eq!(parsed.offset_minutes, 60);
        assert_eq!(
            format_for_display(ReviewTimestamp {
                unix_seconds: T,
                offset_minutes: -300
            }),
            "2025-12-31T19:00:00-05:00"
        );
        assert_eq!(
            parse_review_timestamp("%2026-01-01T00:00:00Z")
                .unwrap()
                .unix_seconds,
            T
        );
        assert_eq!(parse_review_timestamp("2026-02-30T00:00:00Z"), None);
        assert_eq!(
            parse_review_timestamp("2026-01-01T00:00:00+0100")
                .unwrap()
                .offset_minutes,
            60
        );
    }

    #[test]
    fn parse_dispatches_on_shape() {
        assert_eq!(parse_review_timestamp("1VB66I0Y").unwrap().unix_seconds, T);
        assert_eq!(parse_review_timestamp("%갚뚭씀갼").unwrap().unix_seconds, T);
        assert_eq!(parse_review_timestamp("nope"), None);
    }

    #[test]
    fn encode_dispatches_on_format() {
        let ts = ReviewTimestamp {
            unix_seconds: T,
            offset_minutes: 60,
        };
        assert_eq!(encode(ts, Format::Compact).unwrap(), "1VB66I0Y");
        assert_eq!(
            encode(ts, Format::Iso).unwrap(),
            "2026-01-01T01:00:00+01:00"
        );
    }
}
