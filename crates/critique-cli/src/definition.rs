//! Command tree used for `--help` and `completions`. Parsing is done by
//! [`crate::args`] and [`crate::subargs`] (they keep the TS tool's
//! left-to-right semantics); this model only has to describe the same
//! commands and options.

use clap::{Arg, ArgAction, Command};

fn flag(long: &'static str, help: &'static str) -> Arg {
    Arg::new(long)
        .long(long)
        .help(help)
        .action(ArgAction::SetTrue)
}

fn value(long: &'static str, name: &'static str, help: &'static str) -> Arg {
    Arg::new(long)
        .long(long)
        .value_name(name)
        .help(help)
        .action(ArgAction::Set)
}

fn selection(cmd: Command) -> Command {
    cmd.args([
        flag(
            "pending",
            "Keep open and wip conversations, plus annotations.",
        ),
        flag("open", "Keep open conversations, plus annotations."),
        flag("wip", "Keep wip conversations, plus annotations."),
        flag("handled", "Keep handled conversations, plus annotations."),
        flag("resolved", "Keep resolved conversations, plus annotations."),
        flag("conversation", "Alias for --conversations."),
        flag("conversations", "Keep conversation blocks only."),
        flag("open-conversations", "Keep open conversations only."),
        flag("wip-conversations", "Keep wip conversations only."),
        flag("handled-conversations", "Keep handled conversations only."),
        flag(
            "resolved-conversations",
            "Keep resolved conversations only.",
        ),
        flag(
            "pending-conversations",
            "Keep open and wip conversations only.",
        ),
        flag(
            "ignore-closed-conversations",
            "Alias for --pending-conversations.",
        ),
        value(
            "since",
            "timestamp",
            "Keep timestamped items from this date onward.",
        ),
        value("color", "mode", "Color mode: auto, always, or never."),
        flag("no-color", "Disable colored output."),
    ])
}

fn context(cmd: Command) -> Command {
    cmd.args([
        Arg::new("context")
            .short('c')
            .long("context")
            .value_name("beforeAfter")
            .help("Display context lines."),
        value("context-before", "lines", "Display lines before an item."),
        value("context-after", "lines", "Display lines after an item."),
    ])
}

fn pager(cmd: Command) -> Command {
    cmd.args([
        flag("pager", "Page text output with $PAGER."),
        flag("no-pager", "Print text output directly."),
    ])
}

fn files(cmd: Command) -> Command {
    cmd.arg(
        Arg::new("files")
            .num_args(0..)
            .value_name("files")
            .help("Markdown files"),
    )
}

fn json(cmd: Command) -> Command {
    cmd.arg(flag("json", "Print structured JSON."))
}

/// The whole command tree.
pub fn command() -> Command {
    let items = |name: &'static str, about: &'static str| {
        files(context(pager(selection(Command::new(name).about(about)))))
    };
    let session = Command::new("session")
        .about("Run review session lifecycle commands")
        .subcommand_required(true)
        .subcommand(files(json(
            Command::new("start")
                .about("Record a review snapshot and print an agent inbox")
                .arg(flag(
                    "dry-run",
                    "Print the inbox without writing a snapshot or files.",
                ))
                .arg(
                    Arg::new("force")
                        .short('f')
                        .long("force")
                        .action(ArgAction::SetTrue)
                        .help("Overwrite an existing agent session snapshot."),
                ),
        )))
        .subcommand(json(
            Command::new("add-file")
                .about("Add files to the active agent review session")
                .arg(Arg::new("files").num_args(1..).required(true)),
        ))
        .subcommand(files(json(
            Command::new("status").about("Print status for the active agent review session"),
        )))
        .subcommand(
            Command::new("active")
                .about("Print a recap-friendly marker when a review session is active")
                .arg(value(
                    "template",
                    "message",
                    "Message to print when a review session is active.",
                )),
        )
        .subcommand(files(json(
            Command::new("done")
                .about("Compare against the agent snapshot and print a handoff")
                .arg(value(
                    "acknowledge",
                    "ids",
                    "Dismiss guardrail for manually verified item IDs (comma-separated).",
                )),
        )))
        .subcommand(files(json(
            Command::new("rollback").about("Restore files to their pre-agent-start content"),
        )));
    let agent = Command::new("agent")
        .about("Run agent-oriented review actions")
        .subcommand_required(true)
        .subcommand(files(json(
            Command::new("list")
                .visible_alias("inbox")
                .about("List current actionable review items for the active session")
                .arg(value("limit", "count", "Limit the number of items.")),
        )))
        .subcommand(files(json(
            Command::new("show")
                .about("Show one review item from the active session by stable ID")
                .arg(Arg::new("id").required(true))
                .arg(
                    Arg::new("context")
                        .short('c')
                        .long("context")
                        .value_name("beforeAfter"),
                ),
        )))
        .subcommand(files(json(
            Command::new("respond")
                .about("Append an @agent reply to a conversation by stable ID")
                .arg(Arg::new("id").required(true))
                .arg(
                    Arg::new("message")
                        .short('m')
                        .long("message")
                        .value_name("message"),
                ),
        )))
        .subcommand(files(json(
            Command::new("apply")
                .about("Apply, replace or remove a review annotation by stable ID")
                .arg(Arg::new("id").required(true))
                .arg(value(
                    "replace",
                    "text",
                    "Replace the targeted annotation with text.",
                ))
                .arg(flag(
                    "remove",
                    "Delete the annotation without applying or cancelling it. Excludes --replace.",
                ))
                .arg(
                    Arg::new("message")
                        .short('m')
                        .long("message")
                        .value_name("message"),
                ),
        )))
        .subcommand(json(
            Command::new("clean")
                .about("Clean validated conversations by stable ID")
                .arg(flag(
                    "validated",
                    "Only clean conversations validated by a human ok.",
                ))
                .arg(flag("dry-run", "Preview cleanup without editing files."))
                .arg(Arg::new("ids").num_args(0..)),
        ))
        .subcommand(files(json(
            Command::new("diff").about("Print a semantic diff for the active agent session"),
        )))
        .subcommand(files(json(
            Command::new("status").about("Print status for the active agent review session"),
        )));
    let reference = Command::new("ref")
        .about("Inspect and validate Markdown passage references")
        .subcommand_required(true)
        .subcommand(files(json(Command::new("check").about("Validate refs"))))
        .subcommand(files(json(pager(Command::new("list").about("List refs and referenced passages")))))
        .subcommand(files(json(Command::new("show").about("Print documents with referenced passages expanded").arg(value("snapshot-lines", "count", "Maximum source lines in generated snapshots. Defaults to 10; 0 means unlimited.")))))
        .subcommand(files(json(Command::new("snapshots").about("Print only reference snapshots").arg(value("snapshot-lines", "count", "Maximum source lines in generated snapshots.")).arg(value("ref", "selector", "Filter snapshots by source location, target, or snapshot label. Repeatable.").action(ArgAction::Append)))));
    let me = Command::new("me")
        .about("Run human-oriented review commands")
        .subcommand_required(true)
        .subcommand(files(context(pager(selection(
            Command::new("review")
                .visible_alias("r")
                .about("Review annotations and conversations interactively")
                .arg(flag(
                    "list",
                    "List matching review items without editing files.",
                ))
                .arg(flag(
                    "git",
                    "Review only items on lines added in git diff HEAD.",
                )),
        )))))
        .subcommand(files(json(context(pager(selection(
            Command::new("list")
                .visible_aliases(["l", "ls"])
                .about("List matching review items without editing files"),
        ))))))
        .subcommand(
            items(
                "diff",
                "List review items on lines added in the current Git diff",
            )
            .visible_alias("d"),
        )
        .subcommand(files(json(selection(
            Command::new("status")
                .about("Print things to do for the human")
                .arg(flag("oneline", "Print one aggregate summary."))
                .arg(flag("short", "Print compact per-file stats."))
                .arg(flag(
                    "recap",
                    "Print file and compact status separated by a tab.",
                ))
                .arg(
                    Arg::new("quiet")
                        .short('q')
                        .long("quiet")
                        .action(ArgAction::SetTrue),
                )
                .arg(value(
                    "template",
                    "template",
                    "Format --recap status with %(status).",
                ))
                .arg(flag(
                    "git",
                    "Restrict status to lines added in git diff HEAD.",
                )),
        ))));
    Command::new("critique")
        .version(env!("CARGO_PKG_VERSION"))
        .about("Markdown review syntax helper")
        .arg(Arg::new("cwd").short('C').long("cwd").value_name("dir").global(true).help("Change directory before running the command."))
        .arg(Arg::new("state-dir").long("state-dir").value_name("dir").global(true).help("Agent state directory. Defaults to CRITIQUE_STATE_DIR (or DZ_REVIEW_STATE_DIR) or Git-root .critique; a legacy .dz-review is read when .critique is absent."))
        .arg(Arg::new("ignore-file").long("ignore-file").value_name("file").global(true).help("Review ignore file. Defaults to CRITIQUE_IGNORE_FILE (or DZ_REVIEW_IGNORE_FILE) or .critique-ignore."))
        .subcommand(files(context(pager(selection(Command::new("review").visible_alias("r").about("Review annotations and conversations interactively").arg(flag("list", "List matching review items without editing files.")).arg(flag("git", "Review only items on lines added in git diff HEAD.")))))))
        .subcommand(files(selection(Command::new("status").visible_alias("st").about("Print review status").arg(flag("oneline", "Print one aggregate summary.")).arg(flag("short", "Print compact per-file stats.")).arg(flag("recap", "Print file and compact status separated by a tab.")).arg(Arg::new("quiet").short('q').long("quiet").action(ArgAction::SetTrue).help("Print nothing when status is empty and no review session is active.")).arg(value("template", "template", "Format --recap status with %(status).")).arg(flag("git", "Restrict status to lines added in git diff HEAD.")))))
        .subcommand(files(json(context(pager(selection(Command::new("list").visible_aliases(["l", "ls"]).about("List matching review items without editing files")))))))
        .subcommand(items("diff", "List review items on lines added in the current Git diff").visible_alias("d"))
        .subcommand(files(Command::new("timestamp").visible_aliases(["ts", "timestamps"]).about("Add or convert review timestamps").args([
            Arg::new("inline").short('i').long("inline").action(ArgAction::SetTrue).help("Rewrite source files in place."),
            Arg::new("output").short('o').long("output").value_name("file").help("Write transformed output to a file."),
            Arg::new("stdout").short('s').long("stdout").action(ArgAction::SetTrue).help("Write transformed output to stdout."),
            flag("stdin", "Read Markdown from stdin."),
            flag("compact", "Use compact timestamps."),
            Arg::new("short").short('S').long("short").action(ArgAction::SetTrue).help("Use compact timestamps."),
            Arg::new("hangul").short('H').long("hangul").action(ArgAction::SetTrue).help("Use 4-character Hangul timestamps."),
            Arg::new("iso").short('I').long("iso").action(ArgAction::SetTrue).help("Use ISO timestamps."),
            flag("format-info", "Print detected timestamp format information."),
            value("timestamp-format", "format", "Compatibility alias for short, hangul, or iso."),
        ])))
        .subcommand(Command::new("now").about("Print a review timestamp for now or for --date").args([
            flag("compact", "Use compact timestamps."),
            Arg::new("short").short('S').long("short").action(ArgAction::SetTrue).help("Use compact timestamps."),
            Arg::new("hangul").short('H').long("hangul").action(ArgAction::SetTrue).help("Use 4-character Hangul timestamps."),
            Arg::new("iso").short('I').long("iso").action(ArgAction::SetTrue).help("Use ISO timestamps."),
            value("timestamp-format", "format", "Compatibility alias for short, hangul, or iso."),
            Arg::new("date").short('d').long("date").value_name("date").help("Date to convert instead of now."),
        ]))
        .subcommand(reference)
        .subcommand(session)
        .subcommand(agent)
        .subcommand(me)
        .subcommand(Command::new("agent-instructions").about("Print AGENTS.md guidance for critique"))
        .subcommand(Command::new("completions").about("Generate shell completions").arg(Arg::new("shell").required(true).value_parser(clap::value_parser!(clap_complete::Shell))))
}

/// Help text of `path` (`["agent", "show"]`), or of the root for `[]`.
pub fn help_for(path: &[&str]) -> String {
    let mut cmd = command();
    cmd.build();
    let mut current = &cmd;
    for name in path {
        match current.find_subcommand(name) {
            Some(sub) => current = sub,
            None => break,
        }
    }
    let mut owned = current.clone();
    owned.render_long_help().to_string()
}

/// Completion script for `shell`.
pub fn completions(shell: clap_complete::Shell) -> String {
    let mut out = Vec::new();
    clap_complete::generate(shell, &mut command(), "critique", &mut out);
    String::from_utf8_lossy(&out).into_owned()
}
