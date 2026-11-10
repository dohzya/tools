//! Dates and times, without a clock or a time zone database: the caller gives
//! the current time and the local UTC offset (see [`Clock`]). Timestamps are
//! kept as the strings the files hold; instants are only computed to compare
//! them, with the semantics of JavaScript's `new Date(string)` for the shapes
//! worklog writes.

/// Source of the current time and of the local time zone.
pub trait Clock {
    /// Milliseconds since the Unix epoch.
    fn now_ms(&self) -> i64;
    /// Offset of local time from UTC, in minutes, at this instant.
    fn local_offset_minutes(&self, utc_ms: i64) -> i32;
}

/// Days since 1970-01-01 of a civil date.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil date of a day count since 1970-01-01.
pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn civil_ms(y: i64, mo: i64, d: i64, h: i64, mi: i64, s: i64, ms: i64) -> Option<i64> {
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 24 || mi > 59 || s > 59 {
        return None;
    }
    // JS rejects 2023-02-31 in ISO strings.
    let (cy, cm, cd) = civil_from_days(days_from_civil(y, mo, d));
    if (cy, cm, cd) != (y, mo, d) {
        return None;
    }
    if h == 24 && (mi, s, ms) != (0, 0, 0) {
        return None;
    }
    Some(((days_from_civil(y, mo, d) * 24 + h) * 60 + mi) * 60_000 + s * 1000 + ms)
}

fn num(s: &str) -> Option<i64> {
    if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
        s.parse().ok()
    } else {
        None
    }
}

/// `new Date(s).getTime()` for `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm[:ss[.fff]]` and
/// the same with a `Z` or `±HH:MM` suffix. Values without an offset are local
/// time. `None` is JavaScript's `NaN`.
pub fn parse_instant(s: &str, clock: &dyn Clock) -> Option<i64> {
    if !s.is_ascii() || s.len() < 10 {
        return None;
    }
    let (y, mo, d) = (num(&s[0..4])?, num(&s[5..7])?, num(&s[8..10])?);
    if &s[4..5] != "-" || &s[7..8] != "-" {
        return None;
    }
    if s.len() == 10 {
        // Date-only ISO strings are UTC.
        return civil_ms(y, mo, d, 0, 0, 0, 0);
    }
    let rest = &s[10..];
    let rest = rest.strip_prefix(['T', 't', ' '])?;
    if rest.len() < 5 || &rest[2..3] != ":" {
        return None;
    }
    let (h, mi) = (num(&rest[0..2])?, num(&rest[3..5])?);
    let mut tail = &rest[5..];
    let mut sec = 0;
    let mut ms = 0;
    if let Some(t) = tail.strip_prefix(':') {
        if t.len() < 2 {
            return None;
        }
        sec = num(&t[0..2])?;
        tail = &t[2..];
        if let Some(f) = tail.strip_prefix('.') {
            let n = f.bytes().take_while(u8::is_ascii_digit).count();
            if n == 0 {
                return None;
            }
            let frac = format!("{:0<3}", &f[..n.min(3)]);
            ms = num(&frac)?;
            tail = &f[n..];
        }
    }
    let local = civil_ms(y, mo, d, h, mi, sec, ms)?;
    match tail {
        "" => {
            let off1 = i64::from(clock.local_offset_minutes(local));
            let utc = local - off1 * 60_000;
            let off2 = i64::from(clock.local_offset_minutes(utc));
            Some(if off1 == off2 {
                utc
            } else {
                local - off2 * 60_000
            })
        }
        "Z" | "z" => Some(local),
        t => {
            let sign = match t.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let t = &t[1..];
            let (oh, om) = match t.len() {
                5 if &t[2..3] == ":" => (num(&t[0..2])?, num(&t[3..5])?),
                4 => (num(&t[0..2])?, num(&t[2..4])?),
                _ => return None,
            };
            Some(local - sign * (oh * 60 + om) * 60_000)
        }
    }
}

/// Instant of a stored date: ISO, `YYYY-MM-DD HH:mm`, or `YYYY-MM-DD`
/// (local midnight), like the `parseDate` helpers of the TS code.
pub fn parse_stored_date(s: &str, clock: &dyn Clock) -> Option<i64> {
    if s.contains('T') {
        parse_instant(s, clock)
    } else if s.contains(' ') {
        parse_instant(&format!("{}:00", s.replacen(' ', "T", 1)), clock)
    } else {
        parse_instant(&format!("{s}T00:00:00"), clock)
    }
}

fn parts(ms: i64) -> (i64, i64, i64, i64, i64, i64, i64) {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, mo, d) = civil_from_days(days);
    (
        y,
        mo,
        d,
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000,
    )
}

/// `Date.prototype.toISOString`
pub fn to_iso_string(ms: i64) -> String {
    let (y, mo, d, h, mi, s, f) = parts(ms);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{f:03}Z")
}

/// Local ISO timestamp with offset: `2026-11-10T10:44:00+01:00`.
pub fn local_iso(clock: &dyn Clock) -> String {
    let now = clock.now_ms();
    let off = clock.local_offset_minutes(now);
    let (y, mo, d, h, mi, s, _) = parts(now + i64::from(off) * 60_000);
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}{}",
        offset_text(off)
    )
}

/// Local short timestamp: `2026-11-10 10:44`.
pub fn local_short(clock: &dyn Clock) -> String {
    let now = clock.now_ms();
    let off = clock.local_offset_minutes(now);
    let (y, mo, d, h, mi, _, _) = parts(now + i64::from(off) * 60_000);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}")
}

/// Local date: `2026-11-10`.
pub fn local_date(clock: &dyn Clock) -> String {
    local_short(clock)[..10].to_string()
}

/// `+01:00` style suffix of an offset in minutes.
pub fn offset_text(off: i32) -> String {
    let sign = if off >= 0 { '+' } else { '-' };
    let a = off.abs();
    format!("{sign}{:02}:{:02}", a / 60, a % 60)
}

/// `parseFlexibleTimestamp`: `[YYYY-MM-DD]THH:mm[:SS][<tz>]`, with today's date
/// for `THH:mm` and `:00` seconds when missing. `None` for any other shape.
pub fn parse_flexible_timestamp(input: &str, today: &str) -> Option<String> {
    let mut result = if input.starts_with('T') {
        format!("{today}{input}")
    } else {
        input.to_string()
    };
    let has_tz = has_tz_suffix(&result);
    let t = result.find('T')?;
    let b = result.as_bytes();
    let digit = |i: usize| b.get(i).is_some_and(u8::is_ascii_digit);
    let ok =
        digit(t + 1) && digit(t + 2) && b.get(t + 3) == Some(&b':') && digit(t + 4) && digit(t + 5);
    if !ok {
        return None;
    }
    let has_seconds = b.get(t + 6) == Some(&b':') && digit(t + 7) && digit(t + 8);
    if !has_seconds {
        if has_tz {
            let pos = result.rfind('+').max(result.rfind('-')).unwrap_or(0);
            let (before, tz) = result.split_at(pos);
            result = format!("{before}:00{tz}");
        } else {
            result.push_str(":00");
        }
    }
    Some(result)
}

/// `/[+-]\d{2}:\d{2}$/`
pub fn has_tz_suffix(s: &str) -> bool {
    let b = s.as_bytes();
    let n = b.len();
    n >= 6
        && matches!(b[n - 6], b'+' | b'-')
        && b[n - 5].is_ascii_digit()
        && b[n - 4].is_ascii_digit()
        && b[n - 3] == b':'
        && b[n - 2].is_ascii_digit()
        && b[n - 1].is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixed(i32);
    impl Clock for Fixed {
        fn now_ms(&self) -> i64 {
            1_762_771_440_000
        }
        fn local_offset_minutes(&self, _: i64) -> i32 {
            self.0
        }
    }

    #[test]
    fn parses_like_js_dates() {
        let c = Fixed(0);
        assert_eq!(parse_instant("1970-01-02", &c), Some(86_400_000));
        assert_eq!(parse_instant("1970-01-01T01:00:00+01:00", &c), Some(0));
        assert_eq!(parse_instant("1970-01-01T00:00:00Z", &c), Some(0));
        assert_eq!(parse_instant("2023-02-31T00:00:00Z", &c), None);
        assert_eq!(parse_instant("garbage", &c), None);
        let paris = Fixed(60);
        assert_eq!(parse_stored_date("1970-01-01 01:00", &paris), Some(0));
        assert_eq!(parse_stored_date("1970-01-01", &paris), Some(-3_600_000));
    }

    #[test]
    fn formats_local_time() {
        let c = Fixed(60);
        assert_eq!(local_iso(&c), "2025-11-10T11:44:00+01:00");
        assert_eq!(local_short(&c), "2025-11-10 11:44");
        assert_eq!(to_iso_string(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn flexible_timestamps() {
        assert_eq!(
            parse_flexible_timestamp("T11:15", "2025-01-02").as_deref(),
            Some("2025-01-02T11:15:00")
        );
        assert_eq!(
            parse_flexible_timestamp("2024-12-15T11:15+01:00", "x").as_deref(),
            Some("2024-12-15T11:15:00+01:00")
        );
        assert_eq!(parse_flexible_timestamp("nope", "x"), None);
    }
}
