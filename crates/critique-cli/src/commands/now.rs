//! `now`: a review timestamp for the current time or for `--date`.

use crate::args::{CliError, Options, Result};
use crate::ctx::Ctx;
use critique_core::timestamp::{
    Format, ReviewTimestamp, encode, format_for_display, parse_review_timestamp,
};

/// Seconds since the epoch of a JS-style date string (ISO forms only).
/// A date without time is UTC, a date-time without zone is local time, as in
/// `new Date(string)`; the other legacy formats V8 accepts are not supported.
fn parse_js_date(ctx: &Ctx<'_>, input: &str) -> Option<i64> {
    let (date, time) = match input.split_once(['T', ' ']) {
        Some((d, t)) => (d, Some(t)),
        None => (input, None),
    };
    let mut parts = date.split('-');
    let (y, mo, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || mo.len() != 2 || d.len() != 2 {
        return None;
    }
    let num = |s: &str| {
        s.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| s.parse::<i64>().ok())
            .flatten()
    };
    let (y, mo, d) = (num(y)?, num(mo)?, num(d)?);
    let (mut h, mut mi, mut s, mut ms, mut offset): (i64, i64, i64, i64, Option<i64>) =
        (0, 0, 0, 0, None);
    let mut local = false;
    if let Some(t) = time {
        let (clock, zone) = match t.find(['Z', '+', '-']) {
            Some(k) => (&t[..k], Some(&t[k..])),
            None => (t, None),
        };
        let mut c = clock.split(':');
        h = num(c.next()?)?;
        mi = num(c.next()?)?;
        if let Some(sec) = c.next() {
            let (whole, frac) = sec.split_once('.').unwrap_or((sec, ""));
            s = num(whole)?;
            if !frac.is_empty() {
                let digits: String = frac.chars().chain("000".chars()).take(3).collect();
                ms = num(&digits)?;
            }
        }
        if c.next().is_some() {
            return None;
        }
        match zone {
            None => local = true,
            Some("Z") => offset = Some(0),
            Some(z) => {
                let sign = if z.starts_with('-') { -1 } else { 1 };
                let body = &z[1..];
                let (oh, om) = body
                    .split_once(':')
                    .unwrap_or((&body[..body.len().min(2)], body.get(2..).unwrap_or("")));
                offset = Some(sign * (num(oh)? * 60 + num(om)?));
            }
        }
    }
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 24 || mi > 59 || s > 59 {
        return None;
    }
    let days = civil_days(y, mo, d)?;
    let naive = days * 86_400 + h * 3600 + mi * 60 + s;
    let _ = ms; // sub-second precision is dropped (floor), like `Math.floor(ms / 1000)`.
    Some(match (offset, local) {
        (Some(o), _) => naive - o * 60,
        (None, true) => {
            // Local wall clock: refine the offset once around the guess (DST).
            let guess = naive - i64::from(ctx.host.local_offset_minutes(naive)) * 60;
            naive - i64::from(ctx.host.local_offset_minutes(guess)) * 60
        }
        (None, false) => naive,
    })
}

fn civil_days(y: i64, m: i64, d: i64) -> Option<i64> {
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let dim = [
        31,
        if leap { 29 } else { 28 },
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
    if d > dim[(m - 1) as usize] {
        return None;
    }
    let yy = if m <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    Some(era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468)
}

/// Encodes an instant with the local offset (what `encodeTimestamp(date, fmt)` does).
pub fn encode_local(ctx: &Ctx<'_>, unix_seconds: i64, format: Format) -> Result<String> {
    let secs = u64::try_from(unix_seconds)
        .map_err(|_| CliError("Timestamp cannot be negative.".into()))?;
    let offset = ctx.host.local_offset_minutes(unix_seconds);
    encode(
        ReviewTimestamp {
            unix_seconds: secs,
            offset_minutes: offset,
        },
        format,
    )
    .map_err(|e| CliError(e.0))
}

/// `now`.
pub fn run(ctx: &mut Ctx<'_>, options: &Options) -> Result<()> {
    let format = options.timestamp_format;
    let text = match options.date.as_deref().filter(|d| !d.is_empty()) {
        None => encode_local(
            ctx,
            i64::try_from(ctx.host.now().unix_seconds).unwrap_or(0),
            format,
        )?,
        Some(input) => match parse_review_timestamp(input) {
            Some(t) if format == Format::Iso => format_for_display(t),
            Some(t) => encode(t, format).map_err(|e| CliError(e.0))?,
            None => match parse_js_date(ctx, input) {
                Some(secs) => encode_local(ctx, secs, format)?,
                None => return Err(CliError(format!("Invalid date: {input}"))),
            },
        },
    };
    ctx.print(&format!("{text}\n"));
    Ok(())
}
