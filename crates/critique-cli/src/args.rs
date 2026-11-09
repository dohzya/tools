//! Argument parsing. The TS tool translated its option library's result back
//! into a flat argv and re-parsed it ("legacy" parser) so that later options
//! override earlier ones; this port keeps that single left-to-right pass.

use critique_core::review::Filter;
use critique_core::timestamp::{Format, ReviewTimestamp, parse_review_timestamp};

/// Error shown as `error: invalid_args` plus the message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliError(pub String);

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        Self(e.to_string())
    }
}

/// Result alias.
pub type Result<T> = std::result::Result<T, CliError>;

pub(crate) fn err<T>(message: impl Into<String>) -> Result<T> {
    Err(CliError(message.into()))
}

/// Options before the command.
#[derive(Debug, Default, Clone)]
pub struct Global {
    /// `-C`
    pub cwd: Option<String>,
    /// `--state-dir`
    pub state_dir: Option<String>,
    /// `--ignore-file`
    pub ignore_file: Option<String>,
}

fn take_value(args: &[String], i: &mut usize, name: &str, what: &str) -> Result<String> {
    *i += 1;
    match args.get(*i) {
        Some(v) if !v.is_empty() => Ok(v.clone()),
        _ => err(format!("{name} requires {what}.")),
    }
}

/// Extracts the global options wherever they appear.
pub fn split_global(args: &[String]) -> Result<(Global, Vec<String>)> {
    let mut global = Global::default();
    let mut rest = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "-C" || a == "--cwd" {
            global.cwd = Some(take_value(args, &mut i, a, "a directory")?);
        } else if let Some(v) = a.strip_prefix("--cwd=") {
            global.cwd = Some(v.to_string());
        } else if a == "--state-dir" {
            global.state_dir = Some(take_value(args, &mut i, a, "a directory")?);
        } else if let Some(v) = a.strip_prefix("--state-dir=") {
            global.state_dir = Some(v.to_string());
        } else if a == "--ignore-file" {
            global.ignore_file = Some(take_value(args, &mut i, a, "a file")?);
        } else if let Some(v) = a.strip_prefix("--ignore-file=") {
            global.ignore_file = Some(v.to_string());
        } else {
            rest.push(a.clone());
        }
        i += 1;
    }
    Ok((global, rest))
}

/// Command of the legacy parser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Interactive review.
    Review,
    /// Counts.
    Status,
    /// Items.
    List,
    /// Items on added lines.
    Diff,
    /// Timestamp conversion.
    Timestamp,
    /// Current timestamp.
    Now,
}

impl Mode {
    /// Command name and aliases.
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "review" | "r" => Self::Review,
            "status" | "st" => Self::Status,
            "list" | "ls" | "l" => Self::List,
            "diff" | "d" => Self::Diff,
            "timestamp" | "timestamps" | "ts" => Self::Timestamp,
            "now" => Self::Now,
            _ => return None,
        })
    }
}

/// `status` layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusFormat {
    /// Per file, with the session line.
    Long,
    /// One line.
    Oneline,
    /// Compact per file.
    Short,
    /// `file<TAB>compact`.
    Recap,
}

/// Source lines shown around an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Context {
    /// Lines before.
    pub before: usize,
    /// Lines after.
    pub after: usize,
}

/// Default display context.
pub const DEFAULT_CONTEXT: Context = Context {
    before: 2,
    after: 0,
};

/// Where `timestamp` writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputMode {
    /// Standard output.
    Stdout,
    /// Rewrite the files.
    Inline,
    /// One output file.
    File(String),
}

/// `--color` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    /// Terminal only.
    Auto,
    /// Always.
    Always,
    /// Never.
    Never,
}

/// Parsed options of one command.
#[derive(Debug, Clone)]
pub struct Options {
    /// Command.
    pub mode: Mode,
    /// Display context.
    pub context: Context,
    /// Conversation blocks only.
    pub conversation_only: bool,
    /// Status filter.
    pub filter: Filter,
    /// File arguments.
    pub files: Vec<String>,
    /// Restrict to the git diff.
    pub git: bool,
    /// JSON output.
    pub json: bool,
    /// `review --list`.
    pub list: bool,
    /// `--since`.
    pub since: Option<ReviewTimestamp>,
    /// `status` layout.
    pub status_format: StatusFormat,
    /// `status --quiet`.
    pub quiet: bool,
    /// `status --recap --template`.
    pub template: Option<String>,
    /// Timestamp format.
    pub timestamp_format: Format,
    /// `now --date`.
    pub date: Option<String>,
    /// `timestamp --stdin` (or implied).
    pub stdin: bool,
    /// `timestamp` output.
    pub output: OutputMode,
    /// `timestamp --format-info`.
    pub format_info: bool,
    /// `--color`.
    pub color: Option<ColorMode>,
    /// `--pager` / `--no-pager`.
    pub pager: Option<bool>,
}

/// Order in which the TS rebuilt the selection flags.
const SELECTION_ORDER: &[(&str, bool, Filter)] = &[
    ("--pending", false, Filter::Pending),
    ("--open", false, Filter::Open),
    ("--wip", false, Filter::Wip),
    ("--handled", false, Filter::Handled),
    ("--resolved", false, Filter::Resolved),
    ("--conversation", true, Filter::All),
    ("--conversations", true, Filter::All),
    ("--open-conversations", true, Filter::Open),
    ("--wip-conversations", true, Filter::Wip),
    ("--handled-conversations", true, Filter::Handled),
    ("--resolved-conversations", true, Filter::Resolved),
    ("--pending-conversations", true, Filter::Pending),
    ("--ignore-closed-conversations", true, Filter::Pending),
];

const COMMON: &[&str] = &[
    "--pending",
    "--open",
    "--wip",
    "--handled",
    "--resolved",
    "--conversation",
    "--conversations",
    "--open-conversations",
    "--wip-conversations",
    "--handled-conversations",
    "--resolved-conversations",
    "--pending-conversations",
    "--ignore-closed-conversations",
    "--since",
    "--color",
    "--no-color",
];

fn allowed(mode: Mode, flag: &str) -> bool {
    let name = flag.split('=').next().unwrap_or(flag);
    let context = ["--context", "--context-before", "--context-after", "-c"];
    let pager = ["--pager", "--no-pager"];
    let common = COMMON.contains(&name);
    match mode {
        Mode::Review => {
            common
                || pager.contains(&name)
                || context.contains(&name)
                || [
                    "--git",
                    "--diff",
                    "--list",
                    "--diff-conversations",
                    "--list-diff-conversations",
                ]
                .contains(&name)
        }
        Mode::Status => {
            common
                || [
                    "--git",
                    "--diff",
                    "--oneline",
                    "--short",
                    "--recap",
                    "--quiet",
                    "-q",
                    "--template",
                ]
                .contains(&name)
        }
        Mode::List => {
            common
                || pager.contains(&name)
                || context.contains(&name)
                || ["--git", "--diff", "--json"].contains(&name)
        }
        Mode::Diff => common || pager.contains(&name) || context.contains(&name),
        Mode::Timestamp => [
            "--inline",
            "-i",
            "--output",
            "-o",
            "--stdout",
            "-s",
            "--stdin",
            "--compact",
            "-S",
            "--short",
            "-H",
            "--hangul",
            "-I",
            "--iso",
            "--format-info",
            "--timestamp-format",
        ]
        .contains(&name),
        Mode::Now => [
            "--compact",
            "-S",
            "--short",
            "-H",
            "--hangul",
            "-I",
            "--iso",
            "--timestamp-format",
            "--date",
            "-d",
        ]
        .contains(&name),
    }
}

fn non_negative(value: &str, option: &str) -> Result<usize> {
    if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) {
        return value
            .parse()
            .or_else(|_| err(format!("{option} expects a non-negative integer.")));
    }
    err(format!("{option} expects a non-negative integer."))
}

/// `COUNT` or `BEFORE:AFTER`.
pub fn parse_context(value: &str) -> Result<Context> {
    let parts: Vec<&str> = value.split(':').collect();
    match parts.as_slice() {
        [n] => {
            let n = non_negative(n, "--context")?;
            Ok(Context {
                before: n,
                after: n,
            })
        }
        [b, a] => Ok(Context {
            before: non_negative(b, "--context")?,
            after: non_negative(a, "--context")?,
        }),
        _ => err("--context expects COUNT or BEFORE:AFTER, for example 2 or 2:0."),
    }
}

fn parse_since(value: &str) -> Result<ReviewTimestamp> {
    parse_review_timestamp(value).map_or_else(
        || err("--since expects an ISO, compact, or hangul review timestamp."),
        Ok,
    )
}

fn parse_format(value: &str) -> Result<Format> {
    match value {
        "compact" | "short" => Ok(Format::Compact),
        "iso" => Ok(Format::Iso),
        "hangul" => Ok(Format::Hangul),
        _ => err("--timestamp-format expects short, hangul, or iso."),
    }
}

fn parse_color(value: &str) -> Result<ColorMode> {
    match value {
        "auto" => Ok(ColorMode::Auto),
        "always" => Ok(ColorMode::Always),
        "never" => Ok(ColorMode::Never),
        _ => err("--color expects auto, always, or never."),
    }
}

/// Parses everything after the command name. `program` names the tool in messages.
pub fn parse_options(mode: Mode, argv: &[String], program: &str) -> Result<Options> {
    let mut o = Options {
        mode,
        context: DEFAULT_CONTEXT,
        conversation_only: false,
        filter: Filter::All,
        files: Vec::new(),
        git: mode == Mode::Diff,
        json: false,
        list: false,
        since: None,
        status_format: StatusFormat::Long,
        quiet: false,
        template: None,
        timestamp_format: Format::Compact,
        date: None,
        stdin: false,
        output: OutputMode::Stdout,
        format_info: false,
        color: None,
        pager: None,
    };
    // The option library hands over a record, not an ordered list: the TS
    // rebuilt argv in a fixed order, so for these groups the later entry of
    // that fixed order wins, not the later one on the command line.
    let mut selections: Vec<&str> = Vec::new();
    let (mut colors, mut no_color) = (None, false);
    let (mut ctx_pair, mut ctx_before, mut ctx_after) = (None, None, None);
    let mut i = 0;
    while i < argv.len() {
        let arg = argv[i].as_str();
        // `--name=value` and `--name value` are equivalent for long options.
        let (name, inline) = match arg.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n, Some(v.to_string())),
            _ => (arg, None),
        };
        if arg.starts_with('-') && arg != "-" && !allowed(mode, arg) {
            return err(format!("Unknown option: {arg}"));
        }
        let value = |what: &str, i: &mut usize| -> Result<String> {
            if let Some(v) = &inline {
                return Ok(v.clone());
            }
            *i += 1;
            match argv.get(*i) {
                Some(v) if !v.is_empty() => Ok(v.clone()),
                _ => err(format!("{name} requires {what}.")),
            }
        };
        match name {
            "--conversation"
            | "--conversations"
            | "--open-conversations"
            | "--wip-conversations"
            | "--handled-conversations"
            | "--resolved-conversations"
            | "--pending-conversations"
            | "--ignore-closed-conversations"
            | "--open"
            | "--wip"
            | "--handled"
            | "--resolved"
            | "--pending" => selections.push(name),
            "--oneline" | "--short" | "--recap" if mode == Mode::Status => {
                if o.status_format != StatusFormat::Long {
                    return err(
                        "Use only one status format option: --oneline, --short, or --recap.",
                    );
                }
                o.status_format = match name {
                    "--oneline" => StatusFormat::Oneline,
                    "--short" => StatusFormat::Short,
                    _ => StatusFormat::Recap,
                };
            }
            "-q" | "--quiet" if mode == Mode::Status => o.quiet = true,
            "--color" => colors = Some(parse_color(&value("auto, always, or never", &mut i)?)?),
            "--no-color" => no_color = true,
            "--pager" => o.pager = Some(true),
            "--no-pager" => o.pager = Some(false),
            "--since" => o.since = Some(parse_since(&value("a timestamp", &mut i)?)?),
            "--timestamp-format" => {
                o.timestamp_format = parse_format(&value("short, hangul, or iso", &mut i)?)?
            }
            "-I" | "--iso" => o.timestamp_format = Format::Iso,
            "-H" | "--hangul" => o.timestamp_format = Format::Hangul,
            "-S" | "--short" | "--compact" => o.timestamp_format = Format::Compact,
            "--template" => o.template = Some(value("a value containing %(status)", &mut i)?),
            "--format-info" => o.format_info = true,
            "-s" | "--stdout" => o.output = OutputMode::Stdout,
            "-d" | "--date" => o.date = Some(value("a date", &mut i)?),
            "--stdin" => {
                if mode != Mode::Timestamp {
                    return err(format!(
                        "--stdin can only be used with {program} timestamp or {program} ts."
                    ));
                }
                o.stdin = true;
            }
            "-i" | "--inline" => o.output = OutputMode::Inline,
            "-o" | "--output" => o.output = OutputMode::File(value("an output file", &mut i)?),
            "--git" | "--diff" => o.git = true,
            "--json" => o.json = true,
            "--list" => o.list = true,
            "--context" | "-c" => {
                ctx_pair = Some(parse_context(&value("a value like 2 or 2:0", &mut i)?)?)
            }
            "--context-before" => {
                ctx_before = Some(non_negative(
                    &value("a non-negative integer", &mut i)?,
                    "--context-before",
                )?)
            }
            "--context-after" => {
                ctx_after = Some(non_negative(
                    &value("a non-negative integer", &mut i)?,
                    "--context-after",
                )?)
            }
            "--diff-conversations" => {
                (o.git, o.conversation_only, o.filter) = (true, true, Filter::All)
            }
            "--list-diff-conversations" => {
                (o.git, o.list, o.conversation_only, o.filter) = (true, true, true, Filter::All)
            }
            _ if arg.starts_with('-') && arg != "-" => {
                return err(format!("Unknown option: {arg}"));
            }
            _ => o.files.push(arg.to_string()),
        }
        i += 1;
    }
    for (flag, only, filter) in SELECTION_ORDER {
        if selections.contains(flag) {
            (o.conversation_only, o.filter) = (*only, *filter);
        }
    }
    o.color = if no_color {
        Some(ColorMode::Never)
    } else {
        colors
    };
    if let Some(pair) = ctx_pair {
        o.context = pair;
    }
    if let Some(b) = ctx_before {
        o.context.before = b;
    }
    if let Some(a) = ctx_after {
        o.context.after = a;
    }
    if mode == Mode::Now && !o.files.is_empty() {
        return err(format!(
            "{program} now does not accept file arguments. Use -d/--date to provide a date."
        ));
    }
    if let Some(template) = &o.template {
        if mode != Mode::Status || o.status_format != StatusFormat::Recap {
            return err(format!(
                "--template can only be used with {program} status --recap."
            ));
        }
        if !template.contains("%(status)") {
            return err("--template requires %(status).");
        }
    }
    Ok(o)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(mode: Mode, args: &[&str]) -> Options {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        parse_options(mode, &args, "critique").unwrap()
    }

    #[test]
    fn selection_flags_resolve_in_the_fixed_order_not_the_cli_order() {
        // `--handled` comes first in the fixed order, `--conversations` later wins.
        let o = parse(Mode::List, &["--conversations", "--handled", "doc.md"]);
        assert!(o.conversation_only);
        assert_eq!(o.filter, Filter::All);
    }

    #[test]
    fn context_parts_override_the_pair() {
        let o = parse(Mode::List, &["--context-before", "1", "-c", "5", "doc.md"]);
        assert_eq!((o.context.before, o.context.after), (1, 5));
        assert!(parse_options(Mode::List, &["-c".into(), "x:y".into()], "critique").is_err());
    }

    #[test]
    fn unknown_and_misplaced_options_are_errors() {
        assert!(parse_options(Mode::List, &["--oneline".into()], "critique").is_err());
        assert!(parse_options(Mode::Now, &["file.md".into()], "critique").is_err());
    }
}
