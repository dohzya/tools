//! The use cases behind the commands: discover config files, resolve them,
//! pick sections, run and render.

use super::collect::{Providers, collect_sections};
use super::config::*;
use super::dotenv::load_dotenv;
use super::error::{ErrorCode, RecapError};
use super::ports::Ports;
use super::render::{Palette, render_recap};
use super::resolve::{Layers, resolve_config};

/// Which discovery slot a config file filled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    /// `--config <path>`
    Explicit,
    /// `~/.config/recap.yaml`
    Global,
    /// `~/.config/recap.local.yaml`
    GlobalPersonal,
    /// `<cwd>/.config/recap.yaml`
    Local,
    /// `<cwd>/.config/recap.local.yaml`
    LocalPersonal,
}

impl SourceKind {
    /// Name printed by `config files -v`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Global => "global",
            Self::GlobalPersonal => "global-personal",
            Self::Local => "local",
            Self::LocalPersonal => "local-personal",
        }
    }
}

/// A config file that was found and parsed.
#[derive(Debug, Clone)]
pub struct LoadedSource {
    /// Slot it filled.
    pub kind: SourceKind,
    /// Path, as written (`<root>/.config/<name>`).
    pub path: String,
    /// Parsed content.
    pub config: RawConfig,
}

/// Result of config discovery.
#[derive(Debug, Default)]
pub struct LoadedConfig {
    /// The layers, ready to resolve.
    pub layers: Layers,
    /// The files, lowest layer first.
    pub sources: Vec<LoadedSource>,
}

const CONFIG_NAMES: [&str; 2] = ["recap.yaml", "recap.yml"];
/// Gitignored personal overrides next to the committed config, like
/// `.env.local` or `CLAUDE.local.md`.
const PERSONAL_NAMES: [&str; 2] = ["recap.local.yaml", "recap.local.yml"];

fn first_existing(
    kind: SourceKind,
    root: &str,
    names: [&str; 2],
    ports: &Ports,
) -> Result<Option<LoadedSource>, RecapError> {
    for name in names {
        let path = format!("{root}/.config/{name}");
        if let Some(config) = ports.config.load_config(&path)? {
            return Ok(Some(LoadedSource { kind, path, config }));
        }
    }
    Ok(None)
}

/// Finds the config files: with `--config` only that one, otherwise the
/// global pair in the home directory and the local pair in `cwd` (not
/// searched upwards).
pub fn load_recap_config(
    config_path: Option<&str>,
    cwd: &str,
    ports: &Ports,
) -> Result<LoadedConfig, RecapError> {
    let mut loaded = LoadedConfig::default();
    if let Some(path) = config_path.filter(|p| !p.is_empty()) {
        if let Some(config) = ports.config.load_config(path)? {
            loaded.layers.local = Some(config.clone());
            loaded.sources.push(LoadedSource {
                kind: SourceKind::Explicit,
                path: path.to_owned(),
                config,
            });
        }
        return Ok(loaded);
    }
    let mut slots = Vec::new();
    if let Some(home) = ports.env.home().filter(|h| !h.is_empty()) {
        slots.push((SourceKind::Global, home.clone(), CONFIG_NAMES));
        slots.push((SourceKind::GlobalPersonal, home, PERSONAL_NAMES));
    }
    slots.push((SourceKind::Local, cwd.to_owned(), CONFIG_NAMES));
    slots.push((SourceKind::LocalPersonal, cwd.to_owned(), PERSONAL_NAMES));
    for (kind, root, names) in slots {
        if let Some(source) = first_existing(kind, &root, names, ports)? {
            let layer = match kind {
                SourceKind::Global => &mut loaded.layers.global,
                SourceKind::GlobalPersonal => &mut loaded.layers.global_personal,
                SourceKind::Local | SourceKind::Explicit => &mut loaded.layers.local,
                SourceKind::LocalPersonal => &mut loaded.layers.local_personal,
            };
            *layer = Some(source.config.clone());
            loaded.sources.push(source);
        }
    }
    Ok(loaded)
}

/// Loads and resolves the config, reading the `MAX_*` overrides from the
/// environment.
pub fn load_resolved_config(
    config_path: Option<&str>,
    cwd: &str,
    ports: &Ports,
) -> Result<RecapConfig, RecapError> {
    let loaded = load_recap_config(config_path, cwd, ports)?;
    resolve_with_env(&loaded.layers, ports)
}

fn resolve_with_env(layers: &Layers, ports: &Ports) -> Result<RecapConfig, RecapError> {
    let non_empty = |name| ports.env.get_env(name).filter(|v| !v.is_empty());
    resolve_config(
        layers,
        non_empty("MAX_COMMITS").as_deref(),
        non_empty("MAX_WORKTASKS").as_deref(),
    )
}

/// What `recap` and `recap show` need to know.
pub struct RunOptions<'a> {
    /// `--config`
    pub config_path: Option<&'a str>,
    /// `-C`, already absolute.
    pub cwd: Option<&'a str>,
    /// Sections to run, in this order; empty means all.
    pub section_ids: &'a [String],
    /// Whether colors are enabled.
    pub use_color: bool,
}

/// Outcome of a run.
#[derive(Debug)]
pub struct RunResult {
    /// Collected sections.
    pub sections: Vec<SectionData>,
    /// Rendered text.
    pub text: String,
    /// Deduplicated warnings.
    pub warnings: Vec<String>,
}

fn select_sections(
    config: &RecapConfig,
    ids: &[String],
) -> Result<(Vec<ResolvedSection>, Vec<String>), RecapError> {
    if ids.is_empty() {
        return Ok((config.sections.clone(), vec![]));
    }
    let mut warnings = Vec::new();
    let resolved: Vec<&str> = ids
        .iter()
        .map(|id| {
            let alias = config.section_aliases.iter().rev().find(|a| &a.id == id);
            if let Some(a) = alias.filter(|a| a.deprecated == Some(true)) {
                warnings.push(format!(
                    "section \"{}\" is deprecated; use \"{}\" instead",
                    a.id, a.alias
                ));
            }
            alias.map_or(id.as_str(), |a| a.alias.as_str())
        })
        .collect();
    // With duplicate ids the last section wins, like a `Map` built in order.
    let find = |id: &str| config.sections.iter().rev().find(|s| s.id == id);
    let missing: Vec<String> = resolved
        .iter()
        .filter(|id| find(id).is_none())
        .map(|id| format!("\"{id}\""))
        .collect();
    if !missing.is_empty() {
        let label = if missing.len() == 1 {
            "section"
        } else {
            "sections"
        };
        return Err(RecapError::new(
            ErrorCode::ConfigValidation,
            format!("{label} {} not found", missing.join(", ")),
        ));
    }
    let picked = resolved.iter().filter_map(|id| find(id).cloned()).collect();
    Ok((picked, warnings))
}

fn unique(warnings: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in warnings {
        if !out.contains(&w) {
            out.push(w);
        }
    }
    out
}

/// Resolve, select, collect, render.
pub fn run_recap(
    options: &RunOptions<'_>,
    ports: &Ports,
    palette: Palette,
) -> Result<RunResult, RecapError> {
    let cwd = options.cwd.map_or_else(|| ports.env.cwd(), str::to_owned);
    let mut config = load_resolved_config(options.config_path, &cwd, ports)?;
    let (sections, selection_warnings) = select_sections(&config, options.section_ids)?;
    let warnings = unique(
        config
            .warnings
            .iter()
            .cloned()
            .chain(selection_warnings)
            .collect(),
    );
    config.sections = sections;
    let dotenv = load_dotenv(&config.dotenv, &cwd, ports.fs.as_ref(), ports.env.as_ref());
    let collected = collect_sections(
        &config,
        &Providers {
            shell: ports.shell.as_ref(),
            git: ports.git.as_ref(),
            cwd: &cwd,
            env: ports.env.as_ref(),
            dotenv: &dotenv,
            use_color: options.use_color,
        },
    );
    let text = render_recap(&collected, palette);
    Ok(RunResult {
        sections: collected,
        text,
        warnings,
    })
}
