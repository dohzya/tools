//! `review`: interactive loop over items, driven by stdin lines when stdin
//! is not a terminal (that is the only mode this port supports and tests).

use crate::args::{Options, Result};
use crate::commands::list::{display_id, emit_paged, slash};
use crate::ctx::Ctx;
use crate::files;
use crate::format::{self, Paint, Style};
use critique_core::actions::{self, Action};
use critique_core::review::{self, Filter, ReviewItem};
use critique_core::scan::{self, Kind, Status};

enum Answer {
    Skip,
    Delete,
    ToggleOk,
    Reply,
    Apply,
    Cancel,
    NextPending,
    NextFile,
    Quit,
}

/// Answers read from stdin; an exhausted input answers "" (skip).
struct Prompt {
    answers: Vec<String>,
    next: usize,
}

impl Prompt {
    fn question(&mut self, ctx: &mut Ctx<'_>, text: &str) -> String {
        ctx.print(text);
        let answer = self.answers.get(self.next).cloned().unwrap_or_default();
        self.next += 1;
        answer
    }
}

fn action_prompt(style: &Style, conversation: bool) -> String {
    let c = |t: &str, p| style.paint(t, p);
    if conversation {
        format!(
            "{} {}ext {}elete {}k {}eply next-[{}]ile {}uit [?]: ",
            c("Action", Paint::Bold),
            c("[n]", Paint::Cyan),
            c("[d]", Paint::Red),
            c("[o]", Paint::Green),
            c("[r]", Paint::Yellow),
            c("f", Paint::Cyan),
            c("[q]", Paint::Red)
        )
    } else {
        format!(
            "{} {}ext {}pply {}cancel {}elete next-[{}]ile {}uit [?]: ",
            c("Action", Paint::Bold),
            c("[n]", Paint::Cyan),
            c("[a]", Paint::Green),
            c("[x]", Paint::Yellow),
            c("[d]", Paint::Red),
            c("f", Paint::Cyan),
            c("[q]", Paint::Red)
        )
    }
}

fn ask(ctx: &mut Ctx<'_>, prompt: &mut Prompt, style: &Style, conversation: bool) -> Answer {
    loop {
        let raw = prompt.question(ctx, &action_prompt(style, conversation));
        let answer = md_manipulator::mrfi::js_trim(&raw).to_lowercase();
        match (answer.as_str(), conversation) {
            ("" | "n" | "s", _) => return Answer::Skip,
            ("d", _) => return Answer::Delete,
            ("o", true) => return Answer::ToggleOk,
            ("r", true) => return Answer::Reply,
            ("a", false) => return Answer::Apply,
            ("x", false) => return Answer::Cancel,
            ("p", _) => return Answer::NextPending,
            ("f", _) => return Answer::NextFile,
            ("q", _) => return Answer::Quit,
            ("?", true) => ctx.print("n next, d delete, o toggle trailing @me ok, r reply, p next pending conversation, f next file, q quit\n"),
            ("?", false) => ctx.print("n next, a apply, x cancel, d delete raw block, p next pending conversation, f next file, q quit\n"),
            _ => {}
        }
    }
}

fn next_pending(items: &[ReviewItem], current: usize) -> Option<usize> {
    (current + 1..items.len()).find(|&i| {
        let item = &items[i];
        item.from_conversations
            && item.ann.kind == Kind::Conversation
            && matches!(
                scan::conversation_status(&item.ann.raw),
                Status::Open | Status::Wip
            )
    })
}

/// Returns `true` when the user quit.
fn process_file(
    ctx: &mut Ctx<'_>,
    options: &Options,
    added: Option<&files::AddedLines>,
    file: &str,
    prompt: &mut Prompt,
    style: &Style,
) -> Result<bool> {
    let initial = ctx.read_file(file)?;
    let filter_lines = files::lines_of(added, &slash(file));
    let all = review::collect_review_items(&initial, options.conversation_only, Filter::All);
    let ids = ctx.assign_ids(&slash(file), &initial, &all)?;
    let selected: Vec<(String, ReviewItem)> = ids
        .into_iter()
        .zip(all)
        .filter(|(_, item)| {
            review::matches_filter(item, options.filter)
                && review::matches_since(item, options.since, true)
                && match filter_lines {
                    None => true,
                    Some(None) => false,
                    Some(Some(lines)) => review::overlaps_lines(&item.ann, lines),
                }
        })
        .collect();
    if selected.is_empty() {
        return Ok(false);
    }
    let all_ids = ctx.project_ids(
        &selected
            .iter()
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
    )?;
    let items: Vec<ReviewItem> = selected.iter().map(|(_, i)| i.clone()).collect();
    let mut text = initial;
    let mut delta: isize = 0;
    let mut changed = false;
    let mut index = 0;
    while index < selected.len() {
        let (id, original) = &selected[index];
        let start = (original.ann.start as isize + delta) as usize;
        let end = (original.ann.end as isize + delta) as usize;
        let mut item = original.clone();
        item.ann.start = start;
        item.ann.end = end;
        item.ann.raw = text[start..end].to_string();

        let block = format::full_item(
            style,
            &format::Shown {
                file,
                index: index + 1,
                total: selected.len(),
                item: &item,
                text: &text,
                id: &display_id(id, &all_ids),
            },
            options.context,
        );
        ctx.print(&block);
        let conversation = item.ann.kind == Kind::Conversation;
        let answer = ask(ctx, prompt, style, conversation);
        let action = match answer {
            Answer::Quit => {
                if changed {
                    ctx.host.write(file, &text)?;
                }
                return Ok(true);
            }
            Answer::NextFile => break,
            Answer::NextPending => match next_pending(&items, index) {
                None => {
                    ctx.print("No next pending conversation.\n");
                    break;
                }
                Some(next) => {
                    index = next;
                    continue;
                }
            },
            Answer::Skip => {
                index += 1;
                continue;
            }
            Answer::Delete => Action::Delete,
            Answer::ToggleOk => Action::ToggleOk,
            Answer::Apply => Action::Apply,
            Answer::Cancel => Action::Cancel,
            Answer::Reply => {
                let body = prompt.question(ctx, "Reply: ");
                let body = md_manipulator::mrfi::js_trim(&body).to_string();
                if body.is_empty() {
                    index += 1;
                    continue;
                }
                Action::Reply(body)
            }
        };
        let replacement = actions::replacement(&item.ann.raw, &action);
        let before = text.len();
        text = actions::splice(&text, start, end, &replacement);
        delta += text.len() as isize - before as isize;
        changed = true;
        index += 1;
    }
    if changed {
        ctx.host.write(file, &text)?;
    }
    Ok(false)
}

/// `--list`: items without context.
fn list_items(
    ctx: &mut Ctx<'_>,
    options: &Options,
    file_list: &[String],
    added: Option<&files::AddedLines>,
    style: &Style,
) -> Result<()> {
    let located = crate::commands::list::collect_located(
        ctx,
        file_list,
        added,
        options.conversation_only,
        options.filter,
        options.since,
    )?;
    let text = if located.is_empty() {
        "No review annotations found.\n".to_string()
    } else {
        let all = ctx.project_ids(&located.iter().map(|l| l.id.clone()).collect::<Vec<_>>())?;
        located
            .iter()
            .enumerate()
            .map(|(i, l)| {
                format!(
                    "{}{}\n",
                    format::item_header(
                        style,
                        &l.file,
                        i + 1,
                        None,
                        &l.item.ann,
                        Some(&display_id(&l.id, &all))
                    ),
                    review::summarize(&l.item.ann, &format::SUMMARY)
                )
            })
            .collect()
    };
    emit_paged(ctx, &text, options.pager, false)
}

/// `review`.
pub fn run(ctx: &mut Ctx<'_>, options: &Options) -> Result<()> {
    let rules = files::read_rules(ctx);
    let (file_list, added) = files::resolve_files_and_diff(ctx, options, &rules)?;
    let file_list = files::filter_ignored(ctx, file_list, &rules);
    if file_list.is_empty() {
        ctx.print("No review annotations found.\n");
        return Ok(());
    }
    let style = Style::resolve(ctx.host, options.color);
    if options.list {
        return list_items(ctx, options, &file_list, added.as_ref(), &style);
    }
    let answers = ctx
        .host
        .read_stdin()
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    let mut prompt = Prompt { answers, next: 0 };
    for file in &file_list {
        if process_file(ctx, options, added.as_ref(), file, &mut prompt, &style)? {
            break;
        }
    }
    Ok(())
}
