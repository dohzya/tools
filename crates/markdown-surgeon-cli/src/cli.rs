//! Command line definition. Names, options and defaults follow the TS CLI.

use clap::{Args, Parser, Subcommand};
use clap_complete::Shell;

/// Manipulate Markdown files by section
#[derive(Debug, Parser)]
#[command(name = "md", version, about = "Manipulate Markdown files by section")]
pub struct Cli {
    /// What to do
    #[command(subcommand)]
    pub command: Command,
}

/// Options that only make sense with MRFI selectors (`~...` or `^anchor`).
#[derive(Debug, Args)]
pub struct MrfiTarget {
    /// Extent selector: sec, body, or lead (MRFI refs only)
    #[arg(short = 'x', long)]
    pub extent: Option<String>,
    /// Only allow exact resolution (MRFI refs only)
    #[arg(long)]
    pub strict: bool,
    /// Skip safety gate (MRFI refs only)
    #[arg(long)]
    pub force: bool,
}

/// Options that generate MRFI references.
#[derive(Debug, Args)]
pub struct MrfiGenerate {
    /// MRFI output format: hangul, debug, or base62
    #[arg(long, default_value = "hangul")]
    pub format: String,
    /// MRFI field profile: min, default, or full
    #[arg(long, default_value = "default")]
    pub profile: String,
    /// Include q= quote evidence in generated MRFI references
    #[arg(long)]
    pub quote: bool,
    /// Maximum q= quote length
    #[arg(long, default_value_t = 80)]
    pub quote_max: u32,
}

/// `md <command>`
#[derive(Debug, Subcommand)]
pub enum Command {
    /// List sections in a Markdown file
    Outline {
        /// Markdown file
        file: String,
        /// Show only subsections after this section
        #[arg(long)]
        after: Option<String>,
        /// Show only the last subsection
        #[arg(long)]
        last: bool,
        /// Show count only
        #[arg(long)]
        count: bool,
        /// Include MRFI references for sections
        #[arg(long)]
        mrfi: bool,
        #[command(flatten)]
        mrfi_opts: MrfiGenerate,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Read section content
    Read {
        /// Markdown file
        file: String,
        /// Section id or heading selector (`## Title`)
        selector: String,
        /// Include subsections
        #[arg(long)]
        deep: bool,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Update section content
    Write {
        /// Markdown file
        file: String,
        /// Section id or heading selector (`## Title`)
        selector: String,
        /// New content (read from stdin when omitted)
        #[arg(allow_hyphen_values = true)]
        content: Option<String>,
        /// Replace including subsections
        #[arg(long)]
        deep: bool,
        #[command(flatten)]
        mrfi: MrfiTarget,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Append content to a section
    Append {
        /// Markdown file
        file: String,
        /// A section selector followed by the content, or only the content
        /// (appended at the end of the file); read from stdin when omitted
        #[arg(allow_hyphen_values = true)]
        id_or_content: Option<String>,
        /// Content when a selector is given
        #[arg(allow_hyphen_values = true)]
        content: Option<String>,
        /// Append after subsections
        #[arg(long)]
        deep: bool,
        /// Insert before section instead of after
        #[arg(long)]
        before: bool,
        #[command(flatten)]
        mrfi: MrfiTarget,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Empty a section (keep header)
    Empty {
        /// Markdown file
        file: String,
        /// Section id or heading selector (`## Title`)
        selector: String,
        /// Also empty subsections
        #[arg(long)]
        deep: bool,
        #[command(flatten)]
        mrfi: MrfiTarget,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Remove a section and its subsections
    Remove {
        /// Markdown file
        file: String,
        /// Section id or heading selector (`## Title`)
        selector: String,
        #[command(flatten)]
        mrfi: MrfiTarget,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Search for a pattern in a file
    Search {
        /// Markdown file
        file: String,
        /// Plain text to look for (not a regular expression)
        pattern: String,
        /// Group results by section
        #[arg(long)]
        summary: bool,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Generate or transform Markdown fragment references
    Ref {
        /// A Markdown file (with a range) or a reference to convert
        file_or_ref: String,
        /// Source range `startLine:startColumn-endLine:endColumn`
        range: Option<String>,
        #[command(flatten)]
        mrfi: MrfiGenerate,
    },
    /// Resolve Markdown fragment references
    Resolve {
        /// Markdown file
        file: String,
        /// References to resolve
        #[arg(required = true)]
        refs: Vec<String>,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Compare two Markdown fragment references without resolving them
    ///
    /// Prints a verdict (same, likely, possible, incomparable, unrelated,
    /// invalid) with the similarity and comparability scores and the fields
    /// that match, conflict or are absent. A prefilter, not a decision: even
    /// `same` does not prove the same passage (duplicated content).
    Compare {
        /// First MRFI reference
        a: String,
        /// Second MRFI reference
        b: String,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Rank candidate references by proximity to a target, without resolving
    ///
    /// Best first: same, likely, possible, incomparable, unrelated, invalid
    /// (an incomparable candidate may still resolve, an unrelated one has
    /// evidence against it). Ties share a rank and keep the given order.
    Rank {
        /// MRFI reference the ranking is relative to
        target: String,
        /// MRFI references to rank
        #[arg(required_unless_present = "stdin")]
        candidates: Vec<String>,
        /// Also read candidates from stdin, one per line (blank lines ignored)
        #[arg(long)]
        stdin: bool,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Concatenate multiple Markdown files
    Concat {
        /// Files to concatenate
        #[arg(required = true)]
        files: Vec<String>,
        /// Shift header levels by N
        #[arg(short, long, default_value_t = 0, allow_negative_numbers = true)]
        shift: i64,
    },
    /// Manage YAML frontmatter
    Meta {
        /// The file, or its first file with --list/--aggregate/--count
        file_or_key: String,
        /// Key and value, or more files with --list/--aggregate/--count
        args: Vec<String>,
        /// List metadata from multiple files (concat with duplicates)
        #[arg(long, value_name = "FIELDS")]
        list: Option<String>,
        /// Show unique metadata values with counts from multiple files
        #[arg(long, value_name = "FIELDS")]
        aggregate: Option<String>,
        /// Show total count only from multiple files
        #[arg(long, value_name = "FIELDS")]
        count: Option<String>,
        /// Set a key (single file only); a value argument sets it anyway
        #[arg(long)]
        set: bool,
        /// Delete a key (single file only)
        #[arg(long)]
        del: bool,
        /// Get the H1 title (single file only)
        #[arg(long)]
        h1: bool,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Create a new Markdown file
    Create {
        /// File to create
        file: String,
        /// Initial content
        #[arg(allow_hyphen_values = true)]
        content: Option<String>,
        /// Set the H1 title
        #[arg(long)]
        title: Option<String>,
        /// Set frontmatter key=value (repeatable)
        #[arg(long, value_name = "KV")]
        meta: Vec<String>,
        /// Overwrite existing file
        #[arg(long)]
        force: bool,
    },
    /// Print AGENTS.md instructions for md
    AgentInstructions,
    /// Generate shell completions
    Completions {
        /// Target shell
        shell: Shell,
    },
}
