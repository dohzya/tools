//! Command handlers: read files, call `md-manipulator`, write files, print.

use crate::cli::{Command, MrfiGenerate, MrfiTarget};
use crate::error::Fail;
use crate::mrfi_cmd::{self, Op};
use crate::output::{self as out, json};
use crate::{Env, create, magic, meta};
use md_manipulator::{Document, Edit, Section, Value, concat, is_valid_id, search};
use std::fs;
use std::io::ErrorKind;

type Res<T = ()> = Result<T, Fail>;

pub fn dispatch(command: Command, env: &mut Env<'_>) -> Res {
    match command {
        Command::Outline {
            file,
            after,
            last,
            count,
            mrfi,
            mrfi_opts,
            json,
        } => outline(
            env,
            &file,
            after.as_deref(),
            last,
            count,
            json,
            mrfi.then_some(&mrfi_opts),
        ),
        Command::Read {
            file,
            selector,
            deep,
            json,
        } => read(env, &file, &selector, deep, json),
        Command::Write {
            file,
            selector,
            content,
            deep,
            mrfi,
            json,
        } => {
            let content = content_or_stdin(env, content)?;
            check_mrfi_flags(&selector, &mrfi)?;
            mutate(env, &file, json, |doc, now| {
                let text = magic::expand(&content, &doc_meta(doc), now);
                if is_mrfi_selector(&selector) {
                    let target = mrfi_cmd::resolve_for_mutation(doc.text(), &selector, &mrfi)?;
                    return mrfi_cmd::apply(doc, &target, Op::Write(&text));
                }
                Ok(doc.write(&selector, &text, deep)?)
            })
        }
        Command::Append {
            file,
            id_or_content,
            content,
            deep,
            before,
            mrfi,
            json,
        } => {
            // A first argument is a selector when it is an id, an MRFI
            // selector, or a heading selector followed by content; otherwise
            // it is the content itself.
            let has_selector = id_or_content.as_deref().is_some_and(|s| {
                is_valid_id(s) || is_mrfi_selector(s) || (content.is_some() && s.starts_with('#'))
            });
            let (selector, content) = if has_selector {
                (id_or_content, content)
            } else {
                (None, id_or_content)
            };
            let content = content_or_stdin(env, content)?;
            if let Some(sel) = &selector {
                check_mrfi_flags(sel, &mrfi)?;
            }
            mutate(env, &file, json, |doc, now| {
                let text = magic::expand(&content, &doc_meta(doc), now);
                if let Some(sel) = selector.as_deref().filter(|s| is_mrfi_selector(s)) {
                    let target = mrfi_cmd::resolve_for_mutation(doc.text(), sel, &mrfi)?;
                    return mrfi_cmd::apply(doc, &target, Op::Append(&text, before));
                }
                Ok(doc.append(selector.as_deref(), &text, deep, before)?)
            })
        }
        Command::Empty {
            file,
            selector,
            deep,
            mrfi,
            json,
        } => {
            check_mrfi_flags(&selector, &mrfi)?;
            mutate(env, &file, json, |doc, _| {
                if is_mrfi_selector(&selector) {
                    let target = mrfi_cmd::resolve_for_mutation(doc.text(), &selector, &mrfi)?;
                    return mrfi_cmd::apply(doc, &target, Op::Empty);
                }
                Ok(doc.empty(&selector, deep)?)
            })
        }
        Command::Remove {
            file,
            selector,
            mrfi,
            json,
        } => {
            check_mrfi_flags(&selector, &mrfi)?;
            mutate(env, &file, json, |doc, _| {
                if is_mrfi_selector(&selector) {
                    let target = mrfi_cmd::resolve_for_mutation(doc.text(), &selector, &mrfi)?;
                    return mrfi_cmd::apply(doc, &target, Op::Remove);
                }
                Ok(doc.remove(&selector)?)
            })
        }
        Command::Search {
            file,
            pattern,
            summary,
            json,
        } => search_cmd(env, &file, &pattern, summary, json),
        Command::Ref {
            file_or_ref,
            range,
            mrfi,
        } => {
            let text = mrfi_cmd::ref_cmd(read_file, &file_or_ref, range.as_deref(), &mrfi)?;
            print(env, &text)
        }
        Command::Resolve { file, refs, json } => {
            let text = mrfi_cmd::resolve_cmd(&read_file(&file)?, &refs, json)?;
            print(env, &text)
        }
        Command::Compare { a, b, json } => print(env, &mrfi_cmd::compare_cmd(&a, &b, json)),
        Command::Rank {
            target,
            mut candidates,
            stdin,
            json,
        } => {
            if stdin {
                // Positional candidates first: they keep precedence among ties.
                let mut input = String::new();
                env.stdin
                    .read_to_string(&mut input)
                    .map_err(|e| Fail::parse(format!("Cannot read stdin: {e}")))?;
                candidates.extend(
                    input
                        .lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_owned),
                );
            }
            if candidates.is_empty() {
                return Err(Fail::parse("No candidate reference given"));
            }
            print(env, &mrfi_cmd::rank_cmd(&target, &candidates, json))
        }
        Command::Concat { files, shift } => {
            let docs = files
                .iter()
                .map(|f| read_file(f).map(|t| Document::parse(&t)))
                .collect::<Res<Vec<_>>>()?;
            print(env, &concat(&docs, shift))
        }
        Command::Meta {
            file_or_key,
            args,
            list,
            aggregate,
            count,
            del,
            h1,
            json,
            set: _,
        } => meta_cmd(
            env,
            MetaArgs {
                file_or_key,
                args,
                list,
                aggregate,
                count,
                del,
                h1,
                json,
            },
        ),
        Command::Create {
            file,
            content,
            title,
            meta,
            force,
        } => create_cmd(
            env,
            &file,
            content.as_deref(),
            title.as_deref(),
            &meta,
            force,
        ),
        Command::AgentInstructions => print(
            env,
            dz_cli_support::agent_instructions::agent_instructions(
                dz_cli_support::agent_instructions::Tool::MarkdownSurgeon,
                false,
            ),
        ),
        Command::Completions { shell } => {
            let mut cmd = crate::command();
            clap_complete::generate(shell, &mut cmd, "md", env.stdout);
            Ok(())
        }
    }
}

fn is_mrfi_selector(s: &str) -> bool {
    mrfi_cmd::is_selector(s)
}

/// `-x`, `--strict` and `--force` only apply to MRFI selectors.
fn check_mrfi_flags(selector: &str, opts: &MrfiTarget) -> Res {
    if !is_mrfi_selector(selector) && (opts.extent.is_some() || opts.strict || opts.force) {
        return Err(Fail::parse(
            "--extent, --strict, and --force are only valid with MRFI refs (~mrfi or ^anchor)",
        ));
    }
    Ok(())
}

fn read_file(path: &str) -> Res<String> {
    fs::read_to_string(path).map_err(|e| match e.kind() {
        ErrorKind::NotFound => Fail::new("file_not_found", format!("File not found: {path}")),
        _ => Fail::new("io_error", format!("Failed to read file: {path}")),
    })
}

fn write_file(path: &str, text: &str) -> Res {
    fs::write(path, text)
        .map_err(|_| Fail::new("io_error", format!("Failed to write file: {path}")))
}

fn content_or_stdin(env: &mut Env<'_>, content: Option<String>) -> Res<String> {
    match content {
        Some(c) => Ok(c),
        None => {
            let mut bytes = vec![];
            env.stdin
                .read_to_end(&mut bytes)
                .map_err(|_| Fail::new("io_error", "Failed to read stdin"))?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
    }
}

/// Prints like `console.log`, except that nothing at all is printed for an
/// empty text.
fn print(env: &mut Env<'_>, text: &str) -> Res {
    if !text.is_empty() {
        let _ = writeln!(env.stdout, "{text}");
    }
    Ok(())
}

/// Frontmatter data for `{meta:...}`; an unreadable frontmatter counts as empty.
fn doc_meta(doc: &Document) -> Value {
    doc.meta().unwrap_or(Value::Map(vec![]))
}

fn outline(
    env: &mut Env<'_>,
    file: &str,
    after: Option<&str>,
    last: bool,
    count: bool,
    as_json: bool,
    mrfi: Option<&MrfiGenerate>,
) -> Res {
    let source = read_file(file)?;
    let doc = Document::parse(&source);
    let sections: Vec<&Section> = match after {
        Some(sel) => doc.outline_after(sel)?,
        None => doc.sections().iter().collect(),
    };
    let listed: &[&Section] = match (last, count) {
        (true, false) => sections.last().map_or(&[], std::slice::from_ref),
        _ => &sections,
    };
    let refs = match (mrfi, count) {
        (Some(opts), false) => Some(mrfi_cmd::section_references(&source, &doc, listed, opts)?),
        _ => None,
    };
    let text = if count {
        if as_json {
            json(&serde_json::json!({ "count": sections.len() }))
        } else {
            sections.len().to_string()
        }
    } else if last && listed.is_empty() {
        if as_json {
            "null".into()
        } else {
            String::new()
        }
    } else if let Some(refs) = refs {
        let mut entries = listed
            .iter()
            .zip(&refs)
            .map(|(s, r)| out::MrfiOutlineEntry::new(s, r));
        if as_json && last {
            json(&entries.next_back().expect("one entry"))
        } else if as_json {
            json(&entries.collect::<Vec<_>>())
        } else {
            listed
                .iter()
                .zip(&refs)
                .map(|(s, r)| out::outline_line_with_ref(s, r))
                .collect::<Vec<_>>()
                .join("\n")
        }
    } else if last {
        let s = listed[0];
        if as_json {
            json(&out::OutlineEntry::from(s))
        } else {
            out::outline_line(s)
        }
    } else if as_json {
        json(
            &sections
                .iter()
                .map(|s| (*s).into())
                .collect::<Vec<out::OutlineEntry>>(),
        )
    } else {
        sections
            .iter()
            .map(|s| out::outline_line(s))
            .collect::<Vec<_>>()
            .join("\n")
    };
    print(env, &text)
}

fn read(env: &mut Env<'_>, file: &str, selector: &str, deep: bool, as_json: bool) -> Res {
    let doc = Document::parse(&read_file(file)?);
    let r = doc.read(selector, deep)?;
    let text = if as_json {
        json(&out::ReadJson::new(r.section, r.end_line, &r.content))
    } else if r.content.trim().is_empty() {
        out::read_header(r.section, r.end_line)
    } else {
        format!(
            "{}\n\n{}",
            out::read_header(r.section, r.end_line),
            r.content
        )
    };
    print(env, &text)
}

/// Read, edit, write back (only when the text changed), report.
fn mutate(
    env: &mut Env<'_>,
    file: &str,
    as_json: bool,
    edit: impl FnOnce(&Document, &jiff::Zoned) -> Res<Edit>,
) -> Res {
    let text = read_file(file)?;
    let doc = Document::parse(&text);
    let edit = edit(&doc, &env.now)?;
    if edit.text != text {
        write_file(file, &edit.text)?;
    }
    let report = if as_json {
        json(&out::MutationJson::from(&edit))
    } else {
        out::mutation_text(&edit)
    };
    print(env, &report)
}

fn search_cmd(env: &mut Env<'_>, file: &str, pattern: &str, summary: bool, as_json: bool) -> Res {
    let doc = Document::parse(&read_file(file)?);
    let found = search(&doc, pattern);
    let text = match (summary, as_json) {
        (false, true) => json(
            &found
                .matches
                .iter()
                .map(out::MatchJson::from)
                .collect::<Vec<_>>(),
        ),
        (false, false) => found
            .matches
            .iter()
            .map(out::match_line)
            .collect::<Vec<_>>()
            .join("\n"),
        (true, true) => json(
            &found
                .summaries
                .iter()
                .map(out::SummaryJson::from)
                .collect::<Vec<_>>(),
        ),
        (true, false) => found
            .summaries
            .iter()
            .map(out::summary_line)
            .collect::<Vec<_>>()
            .join("\n"),
    };
    print(env, &text)
}

struct MetaArgs {
    file_or_key: String,
    args: Vec<String>,
    list: Option<String>,
    aggregate: Option<String>,
    count: Option<String>,
    del: bool,
    h1: bool,
    json: bool,
}

fn meta_cmd(env: &mut Env<'_>, a: MetaArgs) -> Res {
    let query = [
        (a.list.as_deref(), meta::Query::List, "--list"),
        (
            a.aggregate.as_deref(),
            meta::Query::Aggregate,
            "--aggregate",
        ),
        (a.count.as_deref(), meta::Query::Count, "--count"),
    ]
    .into_iter()
    .find_map(|(spec, kind, flag)| spec.map(|s| (s, kind, flag)));
    if let Some((spec, kind, flag)) = query {
        meta::reject_mutation(flag, a.del)?;
        let patterns: Vec<String> = std::iter::once(a.file_or_key).chain(a.args).collect();
        let docs: Vec<Document> = expand_patterns(&patterns)?
            .iter()
            .filter_map(|f| fs::read_to_string(f).ok())
            .map(|t| Document::parse(&t))
            .collect();
        return print(env, &meta::query(kind, spec, &docs, a.json));
    }

    let file = &a.file_or_key;
    let text = read_file(file)?;
    let doc = Document::parse(&text);
    if a.h1 {
        let title = doc.sections().iter().find(|s| s.level == 1);
        return print(env, title.map_or("", |s| s.title.as_str()));
    }
    let key = a.args.first().map(String::as_str);
    let value = a.args.get(1).map(String::as_str);
    if a.del {
        let key = key.ok_or_else(|| Fail::parse("Usage: md meta <file> --del <key>"))?;
        write_file(file, &doc.meta_delete(key)?.text)?;
        return print(env, &format!("deleted {key}"));
    }
    match (key, value) {
        (Some(key), Some(value)) => {
            let value = magic::expand(value, &doc_meta(&doc), &env.now);
            write_file(file, &doc.meta_set(key, Value::from_cli_arg(&value))?.text)?;
            print(env, &format!("set {key}"))
        }
        (Some(key), None) => {
            let v = doc.meta_get(key)?;
            print(env, &v.map_or(String::new(), |v| v.to_display()))
        }
        (None, _) => print(env, doc.frontmatter_raw().unwrap_or_default()),
    }
}

/// Files for the multi-file queries: plain paths must exist, patterns with
/// wildcards keep only `.md` files. Duplicates are dropped.
fn expand_patterns(patterns: &[String]) -> Res<Vec<String>> {
    let mut files: Vec<String> = vec![];
    let mut add = |f: String| {
        if !files.contains(&f) {
            files.push(f);
        }
    };
    for pattern in patterns {
        if pattern.contains(['*', '?', '[']) {
            let paths = glob::glob(pattern)
                .map_err(|e| Fail::parse(format!("Invalid pattern {pattern}: {e}")))?;
            for path in paths.flatten() {
                if path.is_file() && path.extension().is_some_and(|e| e == "md") {
                    add(path.to_string_lossy().into_owned());
                }
            }
        } else {
            match fs::metadata(pattern) {
                Ok(m) if m.is_file() => add(pattern.clone()),
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => {
                    return Err(Fail::new(
                        "file_not_found",
                        format!("File not found: {pattern}"),
                    ));
                }
                Err(e) => return Err(Fail::new("io_error", e.to_string())),
            }
        }
    }
    if files.is_empty() {
        return Err(Fail::new(
            "file_not_found",
            "No markdown files found matching patterns",
        ));
    }
    Ok(files)
}

fn create_cmd(
    env: &mut Env<'_>,
    file: &str,
    content: Option<&str>,
    title: Option<&str>,
    meta: &[String],
    force: bool,
) -> Res {
    let entries = meta
        .iter()
        .map(|m| create::parse_meta_entry(m))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            Fail::parse(format!(
                "Invalid --meta format: {}. Expected key=value",
                e.0
            ))
        })?;
    match fs::metadata(file) {
        Ok(_) if !force => {
            return Err(Fail::new(
                "io_error",
                format!("File already exists: {file}. Use --force to overwrite."),
            ));
        }
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(_) => {
            return Err(Fail::new(
                "io_error",
                format!("Failed to check file: {file}"),
            ));
        }
    }
    let text = create::build(title, &entries, content, &env.now).map_err(Fail::parse)?;
    write_file(file, &text)?;
    print(env, &format!("created {file}"))
}
