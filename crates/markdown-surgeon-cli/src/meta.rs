//! `md meta`: single-file get/set/delete and the multi-file queries.

use crate::error::Fail;
use crate::output::json;
use md_manipulator::{Document, Value};

/// Which multi-file query was asked for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Query {
    /// Values of the fields, duplicates kept.
    List,
    /// Distinct values with their counts.
    Aggregate,
    /// Number of values.
    Count,
}

/// Runs a multi-file query over already-read documents. Documents whose
/// frontmatter cannot be parsed are skipped, as are unreadable files (the
/// caller does not pass them).
pub fn query(kind: Query, spec: &str, docs: &[Document], as_json: bool) -> String {
    let fields: Vec<&str> = spec.split(',').map(str::trim).collect();
    // Per field: values in file order. `--list` ignores the field grouping.
    let mut per_field: Vec<Vec<Value>> = vec![vec![]; fields.len()];
    let mut listed: Vec<Value> = vec![];
    for doc in docs {
        let Ok(meta) = doc.meta() else { continue };
        for (i, field) in fields.iter().enumerate() {
            let target = if kind == Query::List {
                &mut listed
            } else {
                &mut per_field[i]
            };
            match meta.get_path(field) {
                None | Some(Value::Null) => {}
                Some(Value::Seq(items)) => target.extend(items.iter().cloned()),
                Some(v) => target.push(v.clone()),
            }
        }
    }
    match kind {
        Query::List if as_json => {
            format!(
                "[{}]",
                listed
                    .iter()
                    .map(Value::to_json)
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Query::List => listed
            .iter()
            .map(Value::to_display)
            .collect::<Vec<_>>()
            .join("\n"),
        Query::Aggregate => aggregate(&fields, &per_field, as_json),
        Query::Count => count(&fields, &per_field, as_json),
    }
}

/// Distinct values in first-seen order with their counts. Collections are
/// counted by their JSON text.
fn tally(values: &[Value]) -> Vec<(String, usize)> {
    let mut counts: Vec<(String, usize)> = vec![];
    for v in values {
        let key = match v {
            Value::Map(_) | Value::Seq(_) => v.to_json(),
            v => v.to_display(),
        };
        match counts.iter_mut().find(|(k, _)| *k == key) {
            Some(entry) => entry.1 += 1,
            None => counts.push((key, 1)),
        }
    }
    counts
}

fn object(counts: &[(String, usize)]) -> String {
    let body: Vec<String> = counts
        .iter()
        .map(|(k, n)| format!("{}:{n}", json(k)))
        .collect();
    format!("{{{}}}", body.join(","))
}

fn aggregate(fields: &[&str], values: &[Vec<Value>], as_json: bool) -> String {
    let counts: Vec<_> = values.iter().map(|v| tally(v)).collect();
    if as_json {
        if fields.len() == 1 {
            return object(&counts[0]);
        }
        let body: Vec<String> = fields
            .iter()
            .zip(&counts)
            .map(|(f, c)| format!("{}:{}", json(f), object(c)))
            .collect();
        return format!("{{{}}}", body.join(","));
    }
    let many = fields.len() > 1;
    let mut lines = vec![];
    for (field, c) in fields.iter().zip(&counts) {
        if many {
            lines.push(format!("{field}:"));
        }
        let mut sorted = c.clone();
        // Most frequent first; the sort is stable, so ties keep first-seen order.
        sorted.sort_by_key(|e| std::cmp::Reverse(e.1));
        let pad = if many { "  " } else { "" };
        lines.extend(sorted.into_iter().map(|(v, n)| format!("{pad}{n} {v}")));
    }
    lines.join("\n")
}

fn count(fields: &[&str], values: &[Vec<Value>], as_json: bool) -> String {
    let totals: Vec<usize> = values.iter().map(Vec::len).collect();
    match (as_json, fields.len()) {
        (_, 1) => totals[0].to_string(),
        (true, _) => {
            let body: Vec<String> = fields
                .iter()
                .zip(&totals)
                .map(|(f, n)| format!("{}:{n}", json(f)))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        (false, _) => fields
            .iter()
            .zip(&totals)
            .map(|(f, n)| format!("{f}: {n}"))
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// Fails the way the TS CLI did when a query is mixed with `--del`.
pub fn reject_mutation(flag: &str, del: bool) -> Result<(), Fail> {
    if del {
        return Err(Fail::parse(format!("Cannot use --set/--del with {flag}")));
    }
    Ok(())
}
