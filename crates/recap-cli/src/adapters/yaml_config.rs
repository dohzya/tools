//! Config loader: reads a YAML file and validates it against the shape the
//! TS Zod schema accepts.
//!
//! The schema is a union tried in order (sh, builtin, value, ref, alias), the
//! first branch that fits wins and unknown keys are dropped. So an entry with
//! both `ref` and `id` + `sh` is a shell section. Numbers must be integers (a
//! float `max_lines` is rejected here; the TS tool accepted it).

use crate::domain::config::*;
use crate::domain::error::{ErrorCode, RecapError};
use crate::domain::ports::{ConfigResolver, FileSystem};
use serde_yaml_ng::{Mapping, Value};
use std::sync::Arc;

/// Loads config files through a [`FileSystem`].
pub struct YamlConfigResolver {
    fs: Arc<dyn FileSystem>,
}

impl YamlConfigResolver {
    /// A resolver reading from `fs`.
    pub fn new(fs: Arc<dyn FileSystem>) -> Self {
        Self { fs }
    }
}

impl ConfigResolver for YamlConfigResolver {
    fn load_config(&self, path: &str) -> Result<Option<RawConfig>, RecapError> {
        let Some(content) = self.fs.read_to_string(path)? else {
            return Ok(None);
        };
        parse_config(&content, path).map(Some)
    }
}

/// Parses a config file's text. `path` only appears in messages.
pub fn parse_config(content: &str, path: &str) -> Result<RawConfig, RecapError> {
    let value: Value = serde_yaml_ng::from_str(content).map_err(|e| {
        RecapError::new(
            ErrorCode::ConfigParse,
            format!("Invalid YAML in {path}: {e}"),
        )
    })?;
    // An empty file is an empty config, not an error.
    if value.is_null() {
        return Ok(RawConfig {
            sections: Some(vec![]),
            ..Default::default()
        });
    }
    raw_config(&value).map_err(|e| {
        RecapError::new(
            ErrorCode::ConfigValidation,
            format!("Config validation error in {path}: {e}"),
        )
    })
}

type Res<T> = Result<T, String>;

fn raw_config(v: &Value) -> Res<RawConfig> {
    let map = v
        .as_mapping()
        .ok_or("expected a mapping at the top level")?;
    let dotenv = opt(map, "dotenv", |v| {
        v.as_sequence()
            .ok_or("expected a list")?
            .iter()
            .map(|d| {
                d.as_str()
                    .map(str::to_owned)
                    .ok_or("expected a string".to_owned())
            })
            .collect::<Res<Vec<_>>>()
    })
    .map_err(|e| format!("dotenv: {e}"))?;
    let sections = opt(map, "sections", |v| {
        let items = v.as_sequence().ok_or("expected a list")?;
        items
            .iter()
            .enumerate()
            .map(|(i, e)| entry(e).map_err(|m| format!("[{i}]: {m}")))
            .collect::<Res<Vec<_>>>()
    })
    .map_err(|e| format!("sections{e}"))?;
    let status_enrichers = opt(map, "status_enrichers", |v| {
        let items = v.as_sequence().ok_or("expected a list")?;
        items
            .iter()
            .enumerate()
            .map(|(i, e)| enricher(e).ok_or(format!("[{i}]: invalid status enricher")))
            .collect::<Res<Vec<_>>>()
    })
    .map_err(|e| format!("status_enrichers{e}"))?;
    Ok(RawConfig {
        dotenv,
        sections,
        status_enrichers,
    })
}

/// An optional key: absent is `None`, present must parse (so `key:` with a
/// null value is an error, as with Zod's `optional`).
fn opt<T>(map: &Mapping, key: &str, f: impl FnOnce(&Value) -> Res<T>) -> Res<Option<T>> {
    map.get(key).map(f).transpose()
}

fn str_of(map: &Mapping, key: &str) -> Option<String> {
    map.get(key)?.as_str().map(str::to_owned)
}

/// Required string field, as an `Option` so that union branches can use `?`.
fn req(map: &Mapping, key: &str) -> Option<String> {
    str_of(map, key)
}

/// Optional field: `Err(())` when present but invalid.
fn field<T>(
    map: &Mapping,
    key: &str,
    f: impl FnOnce(&Value) -> Option<T>,
) -> Result<Option<T>, ()> {
    match map.get(key) {
        None => Ok(None),
        Some(v) => f(v).map(Some).ok_or(()),
    }
}

fn as_string(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

fn as_env(v: &Value) -> Option<EnvVars> {
    v.as_mapping()?
        .iter()
        .map(|(k, v)| Some((k.as_str()?.to_owned(), v.as_str()?.to_owned())))
        .collect()
}

fn as_common(map: &Mapping) -> Result<Common, ()> {
    Ok(Common {
        title: field(map, "title", as_string)?,
        max_lines: field(map, "max_lines", Value::as_i64)?,
        separator: field(map, "separator", |v| Separator::parse(v.as_str()?))?,
    })
}

fn entry(v: &Value) -> Res<RawEntry> {
    let map = v.as_mapping().ok_or("expected a mapping")?;
    try_sh(map)
        .or_else(|| try_builtin(map))
        .or_else(|| try_value(map))
        .or_else(|| try_ref(map))
        .or_else(|| try_alias(map))
        .ok_or_else(|| {
            "invalid section entry (expected id with sh, builtin or value, or ref, or id with alias)"
                .to_owned()
        })
}

fn try_sh(map: &Mapping) -> Option<RawEntry> {
    Some(RawEntry::Sh(ShEntry {
        id: req(map, "id")?,
        sh: req(map, "sh")?,
        common: as_common(map).ok()?,
        env: field(map, "env", as_env).ok()?,
        cwd: field(map, "cwd", as_string).ok()?,
    }))
}

fn try_builtin(map: &Mapping) -> Option<RawEntry> {
    Some(RawEntry::Builtin(BuiltinEntry {
        id: req(map, "id")?,
        // `git-status`... all kinds except the alias target are accepted.
        builtin: Builtin::parse(&req(map, "builtin")?)?,
        common: as_common(map).ok()?,
    }))
}

fn try_value(map: &Mapping) -> Option<RawEntry> {
    Some(RawEntry::Value(ValueEntry {
        id: req(map, "id")?,
        value: req(map, "value")?,
        common: as_common(map).ok()?,
    }))
}

fn try_ref(map: &Mapping) -> Option<RawEntry> {
    Some(RawEntry::Ref(RefEntry {
        reference: req(map, "ref")?,
        common: as_common(map).ok()?,
        sh: field(map, "sh", as_string).ok()?,
        builtin: field(map, "builtin", as_string).ok()?,
        value: field(map, "value", as_string).ok()?,
        env: field(map, "env", as_env).ok()?,
        cwd: field(map, "cwd", as_string).ok()?,
    }))
}

fn try_alias(map: &Mapping) -> Option<RawEntry> {
    Some(RawEntry::Alias(AliasEntry {
        id: req(map, "id")?,
        alias: req(map, "alias")?,
        deprecated: field(map, "deprecated", Value::as_bool).ok()?,
    }))
}

fn enricher(v: &Value) -> Option<StatusEnricher> {
    let map = v.as_mapping()?;
    if str_of(map, "format").as_deref() != Some("tsv") {
        return None;
    }
    let id = req(map, "id")?;
    if let Some(sh) = req(map, "sh") {
        return Some(StatusEnricher::Sh {
            id,
            sh,
            env: field(map, "env", as_env).ok()?,
            cwd: field(map, "cwd", as_string).ok()?,
        });
    }
    (str_of(map, "builtin").as_deref() == Some("git-stats"))
        .then_some(StatusEnricher::GitStats { id })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<RawConfig, RecapError> {
        parse_config(text, "f.yaml")
    }

    #[test]
    fn empty_file_is_an_empty_config() {
        assert_eq!(parse("").unwrap().sections, Some(vec![]));
        assert_eq!(parse("# nothing\n").unwrap().sections, Some(vec![]));
    }

    #[test]
    fn entries_pick_the_first_matching_branch() {
        let c = parse(
            "sections:
  - id: a
    sh: echo
    ref: x
  - ref: '*'
    title: T
  - id: b
    builtin: git-log
    max_lines: 3
    separator: line
  - id: c
    value: v
    env: {A: b}
  - id: old
    alias: new
    deprecated: true
",
        )
        .unwrap();
        let s = c.sections.unwrap();
        assert!(matches!(&s[0], RawEntry::Sh(e) if e.sh == "echo"));
        assert!(matches!(&s[1], RawEntry::Ref(r) if r.reference == "*"));
        assert!(
            matches!(&s[2], RawEntry::Builtin(b) if b.builtin == Builtin::GitLog
            && b.common.max_lines == Some(3) && b.common.separator == Some(Separator::Line))
        );
        assert!(matches!(&s[3], RawEntry::Value(_)));
        assert!(matches!(&s[4], RawEntry::Alias(a) if a.deprecated == Some(true)));
    }

    #[test]
    fn invalid_shapes_are_validation_errors() {
        for bad in [
            "sections: [{id: a}]",
            "sections: [{id: 1, sh: x}]",
            "sections: [{id: a, value: v, max_lines: x}]",
            "sections: [{id: a, builtin: bogus}]",
            "sections: [{id: a, value: v, separator: dots}]",
            "sections:",
            "sections: nope",
            "[1, 2]",
            "status_enrichers: [{id: a, sh: x, format: json}]",
        ] {
            let e = parse(bad).unwrap_err();
            assert_eq!(e.code, ErrorCode::ConfigValidation, "{bad}");
            assert!(e.message.starts_with("Config validation error in f.yaml: "));
        }
    }

    #[test]
    fn broken_yaml_is_a_parse_error() {
        let e = parse("sections: [unclosed\n  - : :").unwrap_err();
        assert_eq!(e.code, ErrorCode::ConfigParse);
        assert!(e.message.starts_with("Invalid YAML in f.yaml: "));
    }

    #[test]
    fn enrichers_and_dotenv() {
        let c = parse(
            "dotenv: [.env]
status_enrichers:
  - {id: s, sh: lint, format: tsv, cwd: sub}
  - {id: git-stats, builtin: git-stats, format: tsv}
",
        )
        .unwrap();
        assert_eq!(c.dotenv, Some(vec![".env".to_owned()]));
        let e = c.status_enrichers.unwrap();
        assert!(matches!(&e[0], StatusEnricher::Sh { cwd: Some(c), .. } if c == "sub"));
        assert!(matches!(&e[1], StatusEnricher::GitStats { .. }));
    }
}
