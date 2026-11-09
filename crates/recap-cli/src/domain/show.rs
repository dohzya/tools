//! Config to YAML trees, for `config show` and `config files -v`. Key order
//! and which keys appear mirror the TS output.

use super::config::*;
use super::yaml_out::Node;

fn put(pairs: &mut Vec<(String, Node)>, key: &str, value: Option<Node>) {
    if let Some(v) = value {
        pairs.push((key.to_owned(), v));
    }
}

fn text(s: &Option<String>) -> Option<Node> {
    s.clone().map(Node::Str)
}

fn env_node(env: &Option<EnvVars>) -> Option<Node> {
    env.as_ref().map(|e| {
        Node::Map(
            e.iter()
                .map(|(k, v)| (k.clone(), Node::Str(v.clone())))
                .collect(),
        )
    })
}

fn common(pairs: &mut Vec<(String, Node)>, c: &Common) {
    put(pairs, "title", text(&c.title));
    put(pairs, "max_lines", c.max_lines.map(Node::Int));
    put(
        pairs,
        "separator",
        c.separator.map(|s| Node::Str(s.as_str().to_owned())),
    );
}

fn alias_node(a: &AliasEntry) -> Node {
    let mut p = vec![
        ("id".to_owned(), Node::Str(a.id.clone())),
        ("alias".to_owned(), Node::Str(a.alias.clone())),
    ];
    put(&mut p, "deprecated", a.deprecated.map(Node::Bool));
    Node::Map(p)
}

fn resolved_node(s: &ResolvedSection) -> Node {
    let mut p = vec![("id".to_owned(), Node::Str(s.id.clone()))];
    put(&mut p, "sh", text(&s.sh));
    put(
        &mut p,
        "builtin",
        s.builtin.map(|b| Node::Str(b.as_str().to_owned())),
    );
    put(&mut p, "value", text(&s.value));
    common(&mut p, &s.common);
    put(&mut p, "env", env_node(&s.env));
    put(&mut p, "cwd", text(&s.cwd));
    Node::Map(p)
}

/// Enrichers print `id`, `format`, then their kind-specific keys.
fn enricher_node(e: &StatusEnricher) -> Node {
    let mut p = vec![("id".to_owned(), Node::Str(e.id().to_owned()))];
    p.push(("format".to_owned(), Node::Str("tsv".to_owned())));
    match e {
        StatusEnricher::GitStats { .. } => {
            p.push(("builtin".to_owned(), Node::Str("git-stats".to_owned())))
        }
        StatusEnricher::Sh { sh, env, cwd, .. } => {
            p.push(("sh".to_owned(), Node::Str(sh.clone())));
            put(&mut p, "env", env_node(env));
            put(&mut p, "cwd", text(cwd));
        }
    }
    Node::Map(p)
}

/// Files print what the schema parsed: `id`, the kind key, then `format`.
fn raw_enricher_node(e: &StatusEnricher) -> Node {
    let mut p = vec![("id".to_owned(), Node::Str(e.id().to_owned()))];
    match e {
        StatusEnricher::GitStats { .. } => {
            p.push(("builtin".to_owned(), Node::Str("git-stats".to_owned())));
            p.push(("format".to_owned(), Node::Str("tsv".to_owned())));
        }
        StatusEnricher::Sh { sh, env, cwd, .. } => {
            p.push(("sh".to_owned(), Node::Str(sh.clone())));
            p.push(("format".to_owned(), Node::Str("tsv".to_owned())));
            put(&mut p, "env", env_node(env));
            put(&mut p, "cwd", text(cwd));
        }
    }
    Node::Map(p)
}

/// The resolved config as `config show` prints it.
pub fn config_node(c: &RecapConfig) -> Node {
    let sections = c
        .sections
        .iter()
        .map(resolved_node)
        .chain(c.section_aliases.iter().map(alias_node))
        .collect();
    Node::Map(vec![
        ("sections".to_owned(), Node::Seq(sections)),
        (
            "status_enrichers".to_owned(),
            Node::Seq(c.status_enrichers.iter().map(enricher_node).collect()),
        ),
    ])
}

/// The built-in layer, as shown at the end of `config files -v`.
pub fn default_config_node() -> Node {
    config_node(&RecapConfig {
        sections: hardcoded_sections(),
        status_enrichers: hardcoded_status_enrichers(),
        section_aliases: hardcoded_section_aliases(),
        warnings: vec![],
        dotenv: vec![],
    })
}

fn raw_entry_node(e: &RawEntry) -> Node {
    let mut p = Vec::new();
    match e {
        RawEntry::Sh(s) => {
            p.push(("id".to_owned(), Node::Str(s.id.clone())));
            p.push(("sh".to_owned(), Node::Str(s.sh.clone())));
            common(&mut p, &s.common);
            put(&mut p, "env", env_node(&s.env));
            put(&mut p, "cwd", text(&s.cwd));
        }
        RawEntry::Builtin(b) => {
            p.push(("id".to_owned(), Node::Str(b.id.clone())));
            p.push((
                "builtin".to_owned(),
                Node::Str(b.builtin.as_str().to_owned()),
            ));
            common(&mut p, &b.common);
        }
        RawEntry::Value(v) => {
            p.push(("id".to_owned(), Node::Str(v.id.clone())));
            p.push(("value".to_owned(), Node::Str(v.value.clone())));
            common(&mut p, &v.common);
        }
        RawEntry::Ref(r) => {
            p.push(("ref".to_owned(), Node::Str(r.reference.clone())));
            common(&mut p, &r.common);
            put(&mut p, "sh", text(&r.sh));
            put(&mut p, "builtin", text(&r.builtin));
            put(&mut p, "value", text(&r.value));
            put(&mut p, "env", env_node(&r.env));
            put(&mut p, "cwd", text(&r.cwd));
        }
        RawEntry::Alias(a) => return alias_node(a),
    }
    Node::Map(p)
}

/// A config file as parsed (`config files -v`).
pub fn raw_config_node(c: &RawConfig) -> Node {
    let mut p = Vec::new();
    put(
        &mut p,
        "dotenv",
        c.dotenv
            .as_ref()
            .map(|d| Node::Seq(d.iter().cloned().map(Node::Str).collect())),
    );
    put(
        &mut p,
        "sections",
        c.sections
            .as_ref()
            .map(|s| Node::Seq(s.iter().map(raw_entry_node).collect())),
    );
    put(
        &mut p,
        "status_enrichers",
        c.status_enrichers
            .as_ref()
            .map(|e| Node::Seq(e.iter().map(raw_enricher_node).collect())),
    );
    Node::Map(p)
}
