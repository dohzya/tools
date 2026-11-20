//! `status`: counts per file.

use crate::args::{Options, Result, StatusFormat};
use crate::ctx::Ctx;
use crate::files;
use crate::format::{self, Paint, Stats, Style};
use critique_core::review;

fn collect_stats(
    ctx: &Ctx<'_>,
    file_list: &[String],
    added: Option<&files::AddedLines>,
    options: &Options,
) -> Result<Stats> {
    let mut stats = Stats::default();
    for file in file_list {
        // Unlike `list`, the diff is keyed by the cwd-relative path here.
        let lines = match files::lines_of(added, &ctx.rel(file)) {
            Some(None) => continue,
            Some(Some(l)) => Some(l),
            None => None,
        };
        let text = ctx.read_file(file)?;
        for item in review::collect_review_items(&text, options.conversation_only, options.filter) {
            if !review::matches_since(&item, options.since, false)
                || lines.is_some_and(|l| !review::overlaps_lines(&item.ann, l))
            {
                continue;
            }
            stats.add(&item);
        }
    }
    Ok(stats)
}

/// `status`.
pub fn run(ctx: &mut Ctx<'_>, options: &Options) -> Result<()> {
    let rules = files::read_rules(ctx);
    let active = ctx.has_session();
    if options.quiet
        && options.files.is_empty()
        && !options.git
        && !files::inside_work_tree(ctx)
        && !active
    {
        return Ok(());
    }
    let (file_list, added) = files::resolve_files_and_diff(ctx, options, &rules)?;
    let file_list = files::filter_implicit_ignored(ctx, file_list, &rules, &options.files);
    let style = Style::resolve(ctx.host, options.color);
    let prefix = |text: String| {
        if active {
            format!("active review session - {text}")
        } else {
            text
        }
    };

    if options.status_format == StatusFormat::Oneline {
        let stats = collect_stats(ctx, &file_list, added.as_ref(), options)?;
        if options.quiet && stats.is_empty() && !active {
            return Ok(());
        }
        let rendered =
            format::format_stats(&style, &stats, options.conversation_only, options.filter);
        ctx.print(&format!("{}\n", prefix(rendered)));
        return Ok(());
    }

    let long = options.status_format == StatusFormat::Long;
    let mut lines: Vec<String> = Vec::new();
    if long {
        lines.push(format!(
            "Review session: {}",
            if active { "active" } else { "none" }
        ));
    }
    for file in &file_list {
        let stats = collect_stats(ctx, std::slice::from_ref(file), added.as_ref(), options)?;
        if stats.is_empty() {
            continue;
        }
        let name = ctx.rel(file);
        match options.status_format {
            StatusFormat::Recap => {
                let short = format::format_short_status_stats(&style, ctx.host, &stats);
                let status = options
                    .template
                    .as_ref()
                    .map_or(short.clone(), |t| t.replace("%(status)", &short));
                lines.push(format!("{name}\t{status}"));
            }
            StatusFormat::Short => {
                let short = format::format_short_status_stats(&style, ctx.host, &stats);
                lines.push(format!(
                    "{}: {}",
                    style.paint(&name, Paint::Bold),
                    prefix(short)
                ));
            }
            _ => {
                let long_stats = format::format_status_stats(
                    &style,
                    &stats,
                    options.conversation_only,
                    options.filter,
                );
                lines.push(format!("{}: {long_stats}", style.paint(&name, Paint::Bold)));
            }
        }
    }
    let base = usize::from(long);
    if options.quiet && !active && lines.len() <= base {
        return Ok(());
    }
    let joined = lines.join("\n");
    if lines.len() > base {
        ctx.print(&format!("{joined}\n"));
    } else {
        ctx.print(&format!(
            "{joined}{}No review annotations found.\n",
            if lines.is_empty() { "" } else { "\n" }
        ));
    }
    Ok(())
}
