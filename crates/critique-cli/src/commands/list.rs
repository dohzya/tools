//! `list` and `diff`: located review items, as text or JSON.

use crate::args::{Options, Result};
use crate::ctx::Ctx;
use crate::files::{self, AddedLines};
use crate::format::{self, Style};
use critique_core::agent::{self, AgentItem};
pub use critique_core::ids::display_id;
use critique_core::review::{self, Filter, ReviewItem};
use serde::Serialize;

/// An item with its file, id and the file text.
pub struct Located {
    /// File as given.
    pub file: String,
    /// Persistent id.
    pub id: String,
    /// The item.
    pub item: ReviewItem,
    /// File content.
    pub text: String,
}

/// File name as stored in ids and JSON (only the separator is normalized).
pub fn slash(file: &str) -> String {
    file.replace(std::path::MAIN_SEPARATOR, "/")
}

/// Items of `files` with persistent ids, filtered.
pub fn collect_located(
    ctx: &Ctx<'_>,
    file_list: &[String],
    added: Option<&AddedLines>,
    conversation_only: bool,
    filter: Filter,
    since: Option<critique_core::timestamp::ReviewTimestamp>,
) -> Result<Vec<Located>> {
    let mut located = Vec::new();
    for file in file_list {
        let lines = files::lines_of(added, &slash(file));
        let lines = match lines {
            Some(None) => continue,
            Some(Some(l)) => Some(l),
            None => None,
        };
        let text = ctx.read_file(file)?;
        let items = review::collect_review_items(&text, conversation_only, Filter::All);
        let ids = ctx.assign_ids(&slash(file), &text, &items)?;
        for (item, id) in items.into_iter().zip(ids) {
            if !review::matches_filter(&item, filter)
                || !review::matches_since(&item, since, true)
                || lines.is_some_and(|l| !review::overlaps_lines(&item.ann, l))
            {
                continue;
            }
            located.push(Located {
                file: file.clone(),
                id,
                item,
                text: text.clone(),
            });
        }
    }
    Ok(located)
}

#[derive(Serialize)]
struct Listing {
    version: u32,
    items: Vec<AgentItem>,
}

/// Prints text through the pager when appropriate.
pub fn emit_paged(ctx: &mut Ctx<'_>, text: &str, pager: Option<bool>, json: bool) -> Result<()> {
    let use_pager = if json {
        false
    } else if let Some(p) = pager {
        p
    } else if ctx.host.env("NO_PAGER").is_some_and(|v| !v.is_empty()) {
        false
    } else if ctx
        .host
        .env("FORCE_PAGER")
        .is_some_and(|v| !v.is_empty() && v != "0")
    {
        true
    } else {
        ctx.host.stdout_is_terminal()
    };
    if use_pager {
        ctx.host.page(text)?;
    } else {
        ctx.print(text);
    }
    Ok(())
}

/// `list` / `diff`.
pub fn run(ctx: &mut Ctx<'_>, options: &Options) -> Result<()> {
    let rules = files::read_rules(ctx);
    let (file_list, added) = files::resolve_files_and_diff(ctx, options, &rules)?;
    let file_list = if options.mode == crate::args::Mode::List {
        files::filter_implicit_ignored(ctx, file_list, &rules, &options.files)
    } else {
        files::filter_ignored(ctx, file_list, &rules)
    };
    let located = collect_located(
        ctx,
        &file_list,
        added.as_ref(),
        options.conversation_only,
        options.filter,
        options.since,
    )?;
    if options.json {
        let items = located
            .iter()
            .map(|l| agent::to_agent_item(&slash(&l.file), &l.id, &l.item))
            .collect();
        let mut text =
            serde_json::to_string_pretty(&Listing { version: 1, items }).unwrap_or_default();
        text.push('\n');
        ctx.print(&text);
        return Ok(());
    }
    let style = Style::resolve(ctx.host, options.color);
    let text = if located.is_empty() {
        "No review annotations found.\n".to_string()
    } else {
        let all: Vec<String> = located.iter().map(|l| l.id.clone()).collect();
        located
            .iter()
            .enumerate()
            .map(|(i, l)| {
                format::full_item(
                    &style,
                    &format::Shown {
                        file: &l.file,
                        index: i + 1,
                        total: located.len(),
                        item: &l.item,
                        text: &l.text,
                        id: &display_id(&l.id, &all),
                    },
                    options.context,
                )
            })
            .collect()
    };
    emit_paged(ctx, &text, options.pager, false)
}
