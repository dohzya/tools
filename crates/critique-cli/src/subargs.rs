//! Tiny option parser for the `session`, `agent` and `ref` subcommands.

use crate::args::{Result, err};
use std::collections::HashMap;

/// Options a subcommand accepts. Names are `-x,--long` alias lists; the
/// first alias without dashes is the key used in [`Parsed`].
pub struct Spec {
    /// Options without a value.
    pub flags: &'static [&'static str],
    /// Options with a value (repeatable).
    pub values: &'static [&'static str],
}

/// Result of [`parse`].
#[derive(Debug, Default)]
pub struct Parsed {
    flags: Vec<String>,
    values: HashMap<String, Vec<String>>,
    /// Positional arguments.
    pub positional: Vec<String>,
}

impl Parsed {
    /// Whether the flag was given.
    pub fn flag(&self, key: &str) -> bool {
        self.flags.iter().any(|f| f == key)
    }

    /// Last value of an option.
    pub fn value(&self, key: &str) -> Option<&str> {
        self.values
            .get(key)
            .and_then(|v| v.last())
            .map(String::as_str)
    }

    /// All values of a repeatable option.
    pub fn all(&self, key: &str) -> &[String] {
        self.values.get(key).map_or(&[], Vec::as_slice)
    }
}

fn key_of(alias_list: &str) -> String {
    let long = alias_list
        .split(',')
        .find(|a| a.starts_with("--"))
        .unwrap_or(alias_list);
    long.trim_start_matches('-').to_string()
}

fn find<'a>(list: &'a [&'static str], arg: &str) -> Option<&'a str> {
    list.iter()
        .copied()
        .find(|spec| spec.split(',').any(|a| a == arg))
}

/// Parses `args` against `spec`.
pub fn parse(args: &[String], spec: &Spec) -> Result<Parsed> {
    let mut out = Parsed::default();
    let mut i = 0;
    let mut only_positional = false;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        if only_positional || !arg.starts_with('-') || arg == "-" {
            out.positional.push(arg.clone());
            continue;
        }
        if arg == "--" {
            only_positional = true;
            continue;
        }
        let (name, inline) = match arg.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n.to_string(), Some(v.to_string())),
            _ => (arg.clone(), None),
        };
        if let Some(spec_name) = find(spec.flags, &name) {
            out.flags.push(key_of(spec_name));
        } else if let Some(spec_name) = find(spec.values, &name) {
            let value = match inline {
                Some(v) => v,
                None => match args.get(i) {
                    // An empty value counts as missing, like the option library.
                    Some(v) if !v.is_empty() => {
                        i += 1;
                        v.clone()
                    }
                    _ => return err(format!("Missing value for option \"{name}\".")),
                },
            };
            out.values.entry(key_of(spec_name)).or_default().push(value);
        } else {
            return err(format!("Unknown option \"{arg}\"."));
        }
    }
    Ok(out)
}
