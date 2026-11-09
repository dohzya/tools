//! Command line definition. Names, options and defaults follow the TS CLI.

use clap::{Parser, Subcommand};
use clap_complete::Shell;

/// Context snapshot for AI assistants
#[derive(Debug, Parser)]
#[command(name = "recap", version, about = "Context snapshot for AI assistants")]
pub struct Cli {
    /// Run as if started in <dir> (affects config discovery and shell commands)
    #[arg(short = 'C', value_name = "dir", global = true)]
    pub dir: Option<String>,
    /// Explicit config path (skip auto-discovery)
    #[arg(short = 'c', long, value_name = "path", global = true)]
    pub config: Option<String>,
    /// Disable ANSI color output
    #[arg(long, global = true)]
    pub no_color: bool,
    /// Output as JSON instead of formatted text
    #[arg(long, global = true)]
    pub json: bool,
    /// What to do; without a command, print every section
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// `recap <command>`
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Run selected sections by ID
    Show {
        /// Section ids, printed in this order
        #[arg(required = true, num_args = 1..)]
        section_ids: Vec<String>,
    },
    /// Inspect recap configuration
    Config {
        /// What to inspect
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Generate a recap config file
    Init {
        /// Generate global config (~/.config/recap.yaml)
        #[arg(long)]
        global: bool,
    },
    /// Print AGENTS.md instructions for recap
    AgentInstructions,
    /// Generate shell completions
    Completions {
        /// Target shell
        shell: Shell,
    },
}

/// `recap config <command>`
#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    /// Print the fully resolved config as YAML
    Show,
    /// List config files loaded by recap
    Files {
        /// Also print each file config
        #[arg(short, long)]
        verbose: bool,
    },
}
