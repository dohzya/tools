//! Binary entry point for `worklog`.

use clap::Parser;

/// Worklog CLI: task, trace and checkpoint model with its command handlers.
#[derive(Parser)]
#[command(name = "worklog", version)]
struct Cli {}

fn main() {
    Cli::parse();
}
