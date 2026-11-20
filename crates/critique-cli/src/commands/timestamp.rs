//! `timestamp`: add or convert review timestamps.

use crate::args::{CliError, Options, OutputMode, Result};
use crate::commands::now::encode_local;
use crate::ctx::Ctx;
use crate::files;
use critique_core::scan::{self, FormatStats};
use critique_core::timestamp::Format;

const DOMINANT_RATIO: f64 = 0.9;

fn dominant(name: &str, count: usize, total: usize) -> String {
    let percentage = ((count as f64 / total as f64) * 100.0 + 0.5).floor() as usize;
    if percentage == 100 {
        format!("{name} 100%")
    } else {
        format!("{name} {percentage}% ({count}/{total} timestamps)")
    }
}

/// `compact 100%`, `mixed`, `none`...
pub fn format_stats(stats: FormatStats) -> String {
    let total = stats.compact + stats.hangul + stats.iso;
    if total == 0 {
        return "none".into();
    }
    for (name, count) in [
        ("compact", stats.compact),
        ("hangul", stats.hangul),
        ("iso", stats.iso),
    ] {
        if count as f64 / total as f64 >= DOMINANT_RATIO {
            return dominant(name, count, total);
        }
    }
    "mixed".into()
}

fn name(format: Format) -> &'static str {
    match format {
        Format::Compact => "compact",
        Format::Hangul => "hangul",
        Format::Iso => "iso",
    }
}

fn transform(
    ctx: &Ctx<'_>,
    text: &str,
    fallback_secs: i64,
    format: Format,
) -> Result<(usize, String)> {
    let fallback = encode_local(ctx, fallback_secs, format)?;
    scan::transform_timestamps(text, &fallback, format).map_err(CliError)
}

/// `timestamp`.
pub fn run(ctx: &mut Ctx<'_>, options: &Options) -> Result<()> {
    let rules = files::read_rules(ctx);
    let now = i64::try_from(ctx.host.now().unix_seconds).unwrap_or(0);
    if options.stdin {
        let text = ctx.host.read_stdin();
        let (_, updated) = transform(ctx, &text, now, options.timestamp_format)?;
        ctx.print(&updated);
        return Ok(());
    }
    let (file_list, _) = files::resolve_files_and_diff(ctx, options, &rules)?;
    let file_list = files::filter_ignored(ctx, file_list, &rules);
    if file_list.is_empty() {
        ctx.print("No review annotations found.\n");
        return Ok(());
    }
    if options.format_info {
        for file in &file_list {
            let text = ctx.read_file(file)?;
            ctx.print(&format!(
                "{}: {}\n",
                ctx.rel(file),
                format_stats(scan::timestamp_format_stats(&text))
            ));
        }
        return Ok(());
    }
    if options.output != OutputMode::Inline && file_list.len() != 1 {
        return Err(CliError("timestamp stdout and -o modes require exactly one input file. Use -i for multiple files.".into()));
    }
    for file in &file_list {
        let text = ctx.read_file(file)?;
        let summary = format_stats(scan::timestamp_format_stats(&text));
        let mtime = ctx
            .host
            .mtime_seconds(file)
            .map_or(now, |s| i64::try_from(s).unwrap_or(0));
        let (count, updated) = transform(ctx, &text, mtime, options.timestamp_format)?;
        match &options.output {
            OutputMode::Stdout => ctx.print(&updated),
            OutputMode::File(out) => ctx.host.write(out, &updated)?,
            OutputMode::Inline => {
                if updated != text {
                    ctx.host.write(file, &updated)?;
                }
                let detail = if summary == "none" {
                    String::new()
                } else {
                    format!(
                        "; existing format: {summary}; output format: {}",
                        name(options.timestamp_format)
                    )
                };
                let noun = if count == 1 {
                    "timestamp"
                } else {
                    "timestamps"
                };
                ctx.print(&format!(
                    "{}: {count} {noun} updated{detail}\n",
                    ctx.rel(file)
                ));
            }
        }
    }
    Ok(())
}
