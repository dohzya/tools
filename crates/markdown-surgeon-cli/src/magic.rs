//! Magic expressions in `write`/`append`/`meta --set`/`create` values.

use jiff::Zoned;
use md_manipulator::Value;

/// Replaces `{datetime}`, `{dt}`, `{datetime:short}`, `{dt:short}`, `{date}`,
/// `{time}` and `{meta:<key>}` (frontmatter value, empty if missing). Unknown
/// expressions are left as they are.
///
/// Matching follows the TS regex `\{([^}]+)\}` exactly: an expression runs to
/// the first `}`, so `{{date}` is one unknown expression and nothing is
/// expanded inside it.
pub fn expand(input: &str, meta: &Value, now: &Zoned) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('}') {
            Some(close) if close > 0 => {
                let whole = &rest[open..open + close + 2];
                out.push_str(&expression(after[..close].trim(), meta, now).unwrap_or(whole.into()));
                rest = &after[close + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn expression(expr: &str, meta: &Value, now: &Zoned) -> Option<String> {
    Some(match expr {
        "datetime" | "dt" => now.strftime("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        "datetime:short" | "dt:short" => now.strftime("%Y-%m-%d %H:%M").to_string(),
        "date" => now.strftime("%Y-%m-%d").to_string(),
        "time" => now.strftime("%H:%M:%S").to_string(),
        _ => {
            let key = expr.strip_prefix("meta:")?;
            meta.get_path(key)
                .map(Value::to_display)
                .unwrap_or_default()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(ts: &str) -> Zoned {
        ts.parse().unwrap()
    }

    fn meta() -> Value {
        Value::Map(vec![
            ("title".into(), Value::Str("Hi".into())),
            ("a".into(), Value::Map(vec![("b".into(), Value::Int(3))])),
            ("nothing".into(), Value::Null),
        ])
    }

    #[test]
    fn date_and_time_forms() {
        let now = at("2026-11-03T09:05:07+01:00[Europe/Paris]");
        let m = Value::Map(vec![]);
        assert_eq!(expand("{datetime}", &m, &now), "2026-11-03T09:05:07+01:00");
        assert_eq!(expand("{dt}", &m, &now), "2026-11-03T09:05:07+01:00");
        assert_eq!(expand("{dt:short}", &m, &now), "2026-11-03 09:05");
        assert_eq!(expand("{datetime:short}", &m, &now), "2026-11-03 09:05");
        assert_eq!(expand("{date} {time}", &m, &now), "2026-11-03 09:05:07");
    }

    #[test]
    fn utc_offset_is_written_as_plus_zero() {
        let now = at("2026-11-03T09:05:07+00:00[UTC]");
        assert_eq!(
            expand("{dt}", &Value::Map(vec![]), &now),
            "2026-11-03T09:05:07+00:00"
        );
    }

    #[test]
    fn meta_expressions_use_dotted_paths_and_default_to_empty() {
        let now = at("2026-11-03T09:05:07+00:00[UTC]");
        assert_eq!(expand("{meta:title}/{meta:a.b}", &meta(), &now), "Hi/3");
        assert_eq!(
            expand("[{meta:missing}][{meta:nothing}]", &meta(), &now),
            "[][]"
        );
    }

    #[test]
    fn unknown_and_malformed_expressions_are_kept() {
        let now = at("2026-11-03T09:05:07+00:00[UTC]");
        let m = Value::Map(vec![]);
        assert_eq!(
            expand("{foo} {} { date } { }", &m, &now),
            "{foo} {} 2026-11-03 { }"
        );
        assert_eq!(expand("a { b", &m, &now), "a { b");
        assert_eq!(expand("{{date}", &m, &now), "{{date}");
    }
}
