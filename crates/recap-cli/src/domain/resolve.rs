//! Layered config resolution: hardcoded defaults, then global, global
//! personal, local and local personal files, each resolving its `ref:`
//! entries against the layers below.

use super::config::*;
use super::error::{ErrorCode, RecapError};

/// The config files found by discovery, one slot per layer.
#[derive(Debug, Clone, Default)]
pub struct Layers {
    /// `~/.config/recap.yaml`
    pub global: Option<RawConfig>,
    /// `~/.config/recap.local.yaml`
    pub global_personal: Option<RawConfig>,
    /// `./.config/recap.yaml` (or the explicit `--config` file)
    pub local: Option<RawConfig>,
    /// `./.config/recap.local.yaml`
    pub local_personal: Option<RawConfig>,
}

/// Resolves the layers into the config a run executes.
///
/// `max_commits` and `max_worktasks` are the raw `MAX_COMMITS` /
/// `MAX_WORKTASKS` values; they override `max_lines` of the sections whose
/// id is `git-log` / `worktasks`.
pub fn resolve_config(
    layers: &Layers,
    max_commits: Option<&str>,
    max_worktasks: Option<&str>,
) -> Result<RecapConfig, RecapError> {
    let mut sections = hardcoded_sections();
    let mut enrichers = hardcoded_status_enrichers();
    let mut aliases = hardcoded_section_aliases();
    let mut warnings = Vec::new();
    // Every section any lower level ever had, oldest first: `ref:` can reach
    // them even when an intermediate level did not list them.
    let mut ancestors: Vec<ResolvedSection> = Vec::new();
    let mut dotenv: Vec<String> = Vec::new();

    for layer in [
        &layers.global,
        &layers.global_personal,
        &layers.local,
        &layers.local_personal,
    ]
    .into_iter()
    .flatten()
    {
        if let Some(files) = &layer.dotenv {
            // The more local the layer, the earlier its files.
            dotenv.splice(0..0, files.iter().cloned());
        }
        if let Some(entries) = &layer.sections {
            aliases = merge_aliases(aliases, entries);
            // Only a section definition replaces the parent's list; aliases
            // alone (or nothing) leave it as is.
            if entries.iter().any(|e| !matches!(e, RawEntry::Alias(_))) {
                let expanded =
                    expand_entries(entries, &sections, &ancestors, &aliases, &mut warnings)?;
                ancestors.extend(std::mem::replace(&mut sections, expanded));
            }
        }
        if let Some(child) = &layer.status_enrichers {
            enrichers = merge_enrichers(enrichers, child);
        }
    }

    for s in &mut sections {
        let (var, id) = if s.id == "git-log" {
            (max_commits, "git-log")
        } else {
            (max_worktasks, "worktasks")
        };
        if s.id == id
            && let Some(n) = var.and_then(js_parse_int)
        {
            s.common.max_lines = Some(n);
        }
    }

    Ok(RecapConfig {
        sections,
        status_enrichers: enrichers,
        section_aliases: aliases,
        warnings,
        dotenv,
    })
}

/// JavaScript `parseInt(s, 10)`: leading digits count, anything else is NaN.
pub fn js_parse_int(s: &str) -> Option<i64> {
    let s = s.trim_start();
    let (neg, rest) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let n: i64 = digits.parse().ok()?;
    Some(if neg { -n } else { n })
}

fn merge_aliases(parent: Vec<AliasEntry>, entries: &[RawEntry]) -> Vec<AliasEntry> {
    let child: Vec<&AliasEntry> = entries
        .iter()
        .filter_map(|e| match e {
            RawEntry::Alias(a) => Some(a),
            _ => None,
        })
        .collect();
    let mut merged: Vec<AliasEntry> = parent
        .iter()
        .map(|p| {
            // A duplicate id in the same file: the last one wins.
            child
                .iter()
                .rev()
                .find(|c| c.id == p.id)
                .map_or_else(|| p.clone(), |c| (*c).clone())
        })
        .collect();
    for c in child {
        if !parent.iter().any(|p| p.id == c.id) {
            merged.push(c.clone());
        }
    }
    merged
}

fn merge_enrichers(parent: Vec<StatusEnricher>, child: &[StatusEnricher]) -> Vec<StatusEnricher> {
    let mut merged: Vec<StatusEnricher> = parent
        .iter()
        .map(|p| {
            child
                .iter()
                .rev()
                .find(|c| c.id() == p.id())
                .unwrap_or(p)
                .clone()
        })
        .collect();
    for c in child {
        if !parent.iter().any(|p| p.id() == c.id()) {
            merged.push(c.clone());
        }
    }
    merged
}

/// Looks an id up in the parent list, then in the older levels, nearest
/// first. The last duplicate wins, like the TS `Map`.
fn find_section<'a>(
    parent: &'a [ResolvedSection],
    ancestors: &'a [ResolvedSection],
    id: &str,
) -> Option<&'a ResolvedSection> {
    let find = |list: &'a [ResolvedSection]| list.iter().rev().find(|s| s.id == id);
    find(parent).or_else(|| find(ancestors))
}

fn alias_for<'a>(aliases: &'a [AliasEntry], id: &str) -> Option<&'a AliasEntry> {
    aliases.iter().rev().find(|a| a.id == id)
}

fn merge_ref(parent: &ResolvedSection, r: &RefEntry) -> ResolvedSection {
    ResolvedSection {
        id: parent.id.clone(),
        sh: r.sh.clone().or_else(|| parent.sh.clone()),
        // An unknown builtin name in an override is ignored.
        builtin: r
            .builtin
            .as_deref()
            .and_then(Builtin::parse)
            .or(parent.builtin),
        value: r.value.clone().or_else(|| parent.value.clone()),
        common: Common {
            title: r
                .common
                .title
                .clone()
                .or_else(|| parent.common.title.clone()),
            max_lines: r.common.max_lines.or(parent.common.max_lines),
            separator: r.common.separator.or(parent.common.separator),
        },
        env: r.env.clone().or_else(|| parent.env.clone()),
        cwd: r.cwd.clone().or_else(|| parent.cwd.clone()),
    }
}

fn expand_entries(
    entries: &[RawEntry],
    parent: &[ResolvedSection],
    ancestors: &[ResolvedSection],
    aliases: &[AliasEntry],
    warnings: &mut Vec<String>,
) -> Result<Vec<ResolvedSection>, RecapError> {
    // Ids referenced explicitly are skipped by `ref: "*"`, so they are not
    // listed twice.
    let explicit: Vec<&str> = entries
        .iter()
        .filter_map(|e| match e {
            RawEntry::Ref(r) if r.reference != "*" => Some(
                alias_for(aliases, &r.reference).map_or(r.reference.as_str(), |a| a.alias.as_str()),
            ),
            _ => None,
        })
        .collect();

    let mut out = Vec::new();
    for entry in entries {
        match entry {
            RawEntry::Alias(_) => {}
            RawEntry::Sh(e) => out.push(ResolvedSection {
                id: e.id.clone(),
                sh: Some(e.sh.clone()),
                common: e.common.clone(),
                env: e.env.clone(),
                cwd: e.cwd.clone(),
                ..Default::default()
            }),
            RawEntry::Builtin(e) => out.push(ResolvedSection {
                id: e.id.clone(),
                builtin: Some(e.builtin),
                common: e.common.clone(),
                ..Default::default()
            }),
            RawEntry::Value(e) => out.push(ResolvedSection {
                id: e.id.clone(),
                value: Some(e.value.clone()),
                common: e.common.clone(),
                ..Default::default()
            }),
            RawEntry::Ref(r) if r.reference == "*" => {
                for p in parent {
                    if !explicit.contains(&p.id.as_str()) {
                        out.push(merge_ref(p, r));
                    }
                }
            }
            RawEntry::Ref(r) => {
                let alias = alias_for(aliases, &r.reference);
                if let Some(a) = alias.filter(|a| a.deprecated == Some(true)) {
                    warnings.push(format!(
                        "section \"{}\" is deprecated; use \"{}\" instead",
                        a.id, a.alias
                    ));
                }
                let target = alias.map_or(r.reference.as_str(), |a| a.alias.as_str());
                let p = find_section(parent, ancestors, target).ok_or_else(|| {
                    RecapError::new(
                        ErrorCode::RefNotFound,
                        format!("ref: \"{}\" not found in parent config", r.reference),
                    )
                })?;
                out.push(merge_ref(p, r));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(id: &str, v: &str) -> RawEntry {
        RawEntry::Value(ValueEntry {
            id: id.into(),
            value: v.into(),
            common: Common::default(),
        })
    }

    fn reference(r: &str) -> RefEntry {
        RefEntry {
            reference: r.into(),
            common: Common::default(),
            sh: None,
            builtin: None,
            value: None,
            env: None,
            cwd: None,
        }
    }

    fn cfg(sections: Vec<RawEntry>) -> RawConfig {
        RawConfig {
            sections: Some(sections),
            ..Default::default()
        }
    }

    fn ids(c: &RecapConfig) -> Vec<&str> {
        c.sections.iter().map(|s| s.id.as_str()).collect()
    }

    #[test]
    fn no_file_gives_the_hardcoded_defaults() {
        let c = resolve_config(&Layers::default(), None, None).unwrap();
        assert_eq!(
            ids(&c),
            [
                "git-branch-track",
                "git-subdir",
                "git-ops",
                "git-log",
                "git-stash",
                "status"
            ]
        );
        assert_eq!(c.section_aliases, hardcoded_section_aliases());
    }

    #[test]
    fn a_local_file_replaces_the_sections_it_does_not_ref() {
        let layers = Layers {
            local: Some(cfg(vec![value("a", "x"), value("b", "y")])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(ids(&c), ["a", "b"]);
    }

    #[test]
    fn ref_star_expands_the_parent_but_skips_explicit_refs() {
        let layers = Layers {
            local: Some(cfg(vec![
                RawEntry::Ref(reference("*")),
                RawEntry::Ref(RefEntry {
                    common: Common {
                        title: Some("T".into()),
                        ..Default::default()
                    },
                    ..reference("git-ops")
                }),
            ])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        // git-ops appears once, at the position of its explicit ref.
        assert_eq!(
            ids(&c),
            [
                "git-branch-track",
                "git-subdir",
                "git-log",
                "git-stash",
                "status",
                "git-ops"
            ]
        );
        assert_eq!(c.sections[5].common.title.as_deref(), Some("T"));
        assert_eq!(c.sections[5].builtin, Some(Builtin::GitOps));
    }

    #[test]
    fn unknown_ref_is_an_error() {
        let layers = Layers {
            local: Some(cfg(vec![RawEntry::Ref(reference("nope"))])),
            ..Default::default()
        };
        let e = resolve_config(&layers, None, None).unwrap_err();
        assert_eq!(e.code, ErrorCode::RefNotFound);
        assert_eq!(e.message, "ref: \"nope\" not found in parent config");
    }

    #[test]
    fn deprecated_alias_ref_warns_and_resolves() {
        let layers = Layers {
            local: Some(cfg(vec![RawEntry::Ref(reference("git-status"))])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(ids(&c), ["status"]);
        assert_eq!(
            c.warnings,
            ["section \"git-status\" is deprecated; use \"status\" instead"]
        );
    }

    #[test]
    fn ref_override_keeps_parent_fields() {
        let layers = Layers {
            local: Some(cfg(vec![RawEntry::Ref(RefEntry {
                sh: Some("echo hi".into()),
                ..reference("git-log")
            })])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(c.sections[0].sh.as_deref(), Some("echo hi"));
        assert_eq!(c.sections[0].builtin, Some(Builtin::GitLog));
        assert_eq!(c.sections[0].common.max_lines, Some(6));
    }

    #[test]
    fn unknown_builtin_override_falls_back_to_the_parent() {
        let layers = Layers {
            local: Some(cfg(vec![RawEntry::Ref(RefEntry {
                builtin: Some("bogus".into()),
                ..reference("git-log")
            })])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(c.sections[0].builtin, Some(Builtin::GitLog));
    }

    #[test]
    fn layers_resolve_against_the_ones_below() {
        let layers = Layers {
            global: Some(cfg(vec![value("g", "1")])),
            global_personal: Some(cfg(vec![RawEntry::Ref(reference("*")), value("gp", "2")])),
            local: Some(cfg(vec![RawEntry::Ref(reference("gp"))])),
            local_personal: Some(cfg(vec![RawEntry::Ref(reference("*")), value("lp", "3")])),
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(ids(&c), ["gp", "lp"]);
    }

    #[test]
    fn env_overrides_apply_to_git_log_and_worktasks() {
        let layers = Layers {
            local: Some(cfg(vec![
                RawEntry::Ref(reference("git-log")),
                RawEntry::Sh(ShEntry {
                    id: "worktasks".into(),
                    sh: "wl list".into(),
                    common: Common::default(),
                    env: None,
                    cwd: None,
                }),
            ])),
            ..Default::default()
        };
        let c = resolve_config(&layers, Some("3"), Some("9 tasks")).unwrap();
        assert_eq!(c.sections[0].common.max_lines, Some(3));
        // parseInt semantics: leading digits count.
        assert_eq!(c.sections[1].common.max_lines, Some(9));
        let c = resolve_config(&layers, Some("abc"), None).unwrap();
        assert_eq!(c.sections[0].common.max_lines, Some(6));
    }

    #[test]
    fn ref_reaches_sections_of_any_ancestor() {
        let layers = Layers {
            global: Some(cfg(vec![value("foo", "1")])),
            local: Some(cfg(vec![value("bar", "2")])),
            local_personal: Some(cfg(vec![
                RawEntry::Ref(reference("foo")),
                RawEntry::Ref(reference("bar")),
                // The hardcoded defaults are ancestors too.
                RawEntry::Ref(reference("git-log")),
            ])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(ids(&c), ["foo", "bar", "git-log"]);
    }

    #[test]
    fn nearest_ancestor_wins_and_star_only_expands_the_parent() {
        let layers = Layers {
            global: Some(cfg(vec![value("x", "old"), value("only-global", "g")])),
            local: Some(cfg(vec![value("x", "new")])),
            local_personal: Some(cfg(vec![
                RawEntry::Ref(reference("*")),
                RawEntry::Ref(reference("only-global")),
            ])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(ids(&c), ["x", "only-global"]);
        assert_eq!(c.sections[0].value.as_deref(), Some("new"));
    }

    #[test]
    fn alias_only_sections_inherit_but_register_the_aliases() {
        let alias = RawEntry::Alias(AliasEntry {
            id: "old".into(),
            alias: "foo".into(),
            deprecated: Some(true),
        });
        let layers = Layers {
            global: Some(cfg(vec![value("foo", "1")])),
            local: Some(cfg(vec![alias.clone()])),
            local_personal: Some(cfg(vec![RawEntry::Ref(reference("old"))])),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(ids(&c), ["foo"]);
        assert_eq!(c.section_aliases.len(), 2);
        // An empty list defines no section either.
        let layers = Layers {
            global: Some(cfg(vec![value("foo", "1")])),
            local: Some(cfg(vec![])),
            ..Default::default()
        };
        assert_eq!(ids(&resolve_config(&layers, None, None).unwrap()), ["foo"]);
    }

    #[test]
    fn dotenv_paths_come_most_local_first() {
        let with = |d: &str| RawConfig {
            dotenv: Some(vec![d.into()]),
            ..Default::default()
        };
        let layers = Layers {
            global: Some(with("g")),
            local: Some(with("l")),
            local_personal: Some(with("lp")),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(c.dotenv, ["lp", "l", "g"]);
    }

    #[test]
    fn enrichers_merge_by_id_and_aliases_by_id() {
        let layers = Layers {
            local: Some(RawConfig {
                sections: Some(vec![RawEntry::Alias(AliasEntry {
                    id: "git-status".into(),
                    alias: "status".into(),
                    deprecated: Some(false),
                })]),
                status_enrichers: Some(vec![
                    StatusEnricher::Sh {
                        id: "git-stats".into(),
                        sh: "true".into(),
                        env: None,
                        cwd: None,
                    },
                    StatusEnricher::GitStats { id: "other".into() },
                ]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let c = resolve_config(&layers, None, None).unwrap();
        assert_eq!(c.section_aliases.len(), 1);
        assert_eq!(c.section_aliases[0].deprecated, Some(false));
        assert_eq!(c.status_enrichers.len(), 2);
        assert!(matches!(c.status_enrichers[0], StatusEnricher::Sh { .. }));
        // A list holding only aliases defines no section: the parent's stay.
        assert_eq!(c.sections.len(), 6);
    }
}
