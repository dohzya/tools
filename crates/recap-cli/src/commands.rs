//! Command handlers.

use crate::Io;
use crate::cli::{Cli, Command, ConfigCommand};
use crate::domain::error::{ErrorCode, RecapError};
use crate::domain::init::generate_config_content;
use crate::domain::ports::Ports;
use crate::domain::render::Palette;
use crate::domain::run::{
    LoadedSource, RunOptions, load_recap_config, load_resolved_config, run_recap,
};
use crate::domain::{show, yaml_out};
use dz_cli_support::agent_instructions::{Tool, agent_instructions};

/// Exit status of a command that did not fail with a [`RecapError`].
type Outcome = Result<i32, RecapError>;

/// Lexically resolves `path` against `base` like Node's `path.resolve`:
/// `.` and `..` are folded, symlinks are not looked at.
fn resolve_path(base: &str, path: &str) -> String {
    let joined = if path.starts_with('/') {
        path.to_owned()
    } else {
        format!("{base}/{path}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}

pub fn dispatch(cli: Cli, io: &mut Io<'_>, ports: &Ports) -> Outcome {
    // An empty `-C ""` is ignored, like any falsy value in the TS CLI.
    let cwd = cli
        .dir
        .as_deref()
        .filter(|d| !d.is_empty())
        .map(|d| resolve_path(&ports.env.cwd(), d));
    let config_path = cli.config.as_deref();
    match cli.command {
        None => print_recap(&cli, cwd.as_deref(), &[], io, ports),
        Some(Command::Show { ref section_ids }) => {
            print_recap(&cli, cwd.as_deref(), section_ids, io, ports)
        }
        Some(Command::Config { command }) => {
            let cwd = cwd.unwrap_or_else(|| ports.env.cwd());
            match command {
                ConfigCommand::Show => {
                    let config = load_resolved_config(config_path, &cwd, ports)?;
                    let yaml = yaml_out::stringify(&show::config_node(&config));
                    out(io, &format!("{}\n", yaml.trim_end()));
                }
                ConfigCommand::Files { verbose } => {
                    let loaded = load_recap_config(config_path, &cwd, ports)?;
                    let mut sources = loaded.sources;
                    sources.reverse();
                    let text = if verbose {
                        files_verbose(&sources)
                    } else {
                        sources
                            .iter()
                            .map(|s| s.path.clone())
                            .collect::<Vec<_>>()
                            .join("\n")
                    };
                    if !text.is_empty() {
                        out(io, &format!("{text}\n"));
                    }
                }
            }
            Ok(0)
        }
        Some(Command::Init { global }) => init(global, cwd.as_deref(), io, ports),
        Some(Command::AgentInstructions) => {
            out(io, &format!("{}\n", agent_instructions(Tool::Recap, false)));
            Ok(0)
        }
        Some(Command::Completions { shell }) => {
            clap_complete::generate(shell, &mut crate::command(), "recap", io.stdout);
            Ok(0)
        }
    }
}

fn out(io: &mut Io<'_>, text: &str) {
    let _ = io.stdout.write_all(text.as_bytes());
}

fn files_verbose(sources: &[LoadedSource]) -> String {
    let mut blocks: Vec<String> = sources
        .iter()
        .map(|s| {
            let yaml = yaml_out::stringify(&show::raw_config_node(&s.config));
            format!("{}: {}\n{}", s.kind.as_str(), s.path, yaml.trim_end())
        })
        .collect();
    let default = yaml_out::stringify(&show::default_config_node());
    blocks.push(format!("default: built-in\n{}", default.trim_end()));
    blocks.join("\n\n")
}

fn print_recap(
    cli: &Cli,
    cwd: Option<&str>,
    section_ids: &[String],
    io: &mut Io<'_>,
    ports: &Ports,
) -> Outcome {
    let no_color = cli.no_color || ports.env.get_env("NO_COLOR").is_some_and(|v| !v.is_empty());
    let use_color = !no_color && ports.env.is_terminal();
    let result = run_recap(
        &RunOptions {
            config_path: cli.config.as_deref(),
            cwd,
            section_ids,
            use_color,
        },
        ports,
        Palette::new(use_color),
    )?;
    for warning in &result.warnings {
        let _ = writeln!(io.stderr, "recap warning: {warning}");
    }
    if cli.json {
        let json = serde_json::to_string_pretty(&result.sections)
            .map_err(|e| RecapError::new(ErrorCode::Io, e.to_string()))?;
        out(io, &format!("{json}\n"));
    } else if !result.text.trim().is_empty() {
        out(io, &format!("{}\n", result.text));
    }
    Ok(0)
}

fn init(global: bool, cwd: Option<&str>, io: &mut Io<'_>, ports: &Ports) -> Outcome {
    let content = generate_config_content(global);
    let path = if global {
        let home = ports
            .env
            .home()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| RecapError::new(ErrorCode::Io, "cannot determine home directory"))?;
        resolve_path("/", &format!("{home}/.config/recap.yaml"))
    } else {
        let base = cwd.map_or_else(|| ports.env.cwd(), str::to_owned);
        resolve_path("/", &format!("{base}/.config/recap.yaml"))
    };
    // Created before the existence check, as in the TS tool.
    let dir = path.rsplit_once('/').map_or("/", |(d, _)| d);
    ports.fs.ensure_dir(dir)?;
    if ports.fs.exists(&path) {
        let _ = writeln!(io.stderr, "recap: config already exists at {path}");
        let _ = writeln!(
            io.stderr,
            "recap: use --force to overwrite (not implemented yet)"
        );
        return Ok(1);
    }
    ports.fs.write_file(&path, &content)?;
    out(io, &format!("recap: created {path}\n"));
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::resolve_path;

    #[test]
    fn resolve_path_folds_dots_like_node() {
        assert_eq!(resolve_path("/a/b", "../c"), "/a/c");
        assert_eq!(resolve_path("/a/b", "./x/./y"), "/a/b/x/y");
        assert_eq!(resolve_path("/a/b", "/abs//p/"), "/abs/p");
        assert_eq!(resolve_path("/", "../.."), "/");
    }
}
