//! Block-tree steps of a `p` path below the heading ancestry: `p`, `ul`, `ol`,
//! `li` and `blockquote` nodes with one-based sibling occurrences.
//!
//! Mirrors the TS adapter built on commonmark.js `sourcepos`: only those five
//! kinds count, every other block (code, HTML, heading, thematic break) is
//! skipped without taking an index. Tight list items have no paragraph event
//! in pulldown-cmark but have one in commonmark.js, so the leading inline run
//! of an item is turned into a synthetic `p`.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// Kind of a counted block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    /// Paragraph.
    P,
    /// Bullet list.
    Ul,
    /// Ordered list.
    Ol,
    /// List item.
    Li,
    /// Block quote.
    Blockquote,
}

impl BlockKind {
    /// `p`, `ul`, `ol`, `li`, `blockquote`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::P => "p",
            Self::Ul => "ul",
            Self::Ol => "ol",
            Self::Li => "li",
            Self::Blockquote => "blockquote",
        }
    }

    /// Inverse of [`Self::as_str`].
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "p" => Self::P,
            "ul" => Self::Ul,
            "ol" => Self::Ol,
            "li" => Self::Li,
            "blockquote" => Self::Blockquote,
            _ => return None,
        })
    }
}

/// One step: a kind and its one-based occurrence among same-kind siblings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockStep {
    /// Node kind.
    pub kind: BlockKind,
    /// One-based index among siblings of the same kind.
    pub occurrence: usize,
}

struct Node {
    kind: BlockKind,
    /// Scalar offsets, end exclusive.
    start: usize,
    end: usize,
    children: Vec<Node>,
}

/// Counted blocks of a Markdown fragment, with scalar-offset ranges.
pub struct BlockTree {
    roots: Vec<Node>,
}

impl BlockTree {
    /// Parses `source` (a section's text, or a whole document).
    pub fn parse(source: &str) -> Self {
        // Byte -> scalar offset, since pulldown reports bytes.
        let mut scalar_at = vec![0usize; source.len() + 1];
        let mut n = 0;
        for (b, c) in source.char_indices() {
            for k in 0..c.len_utf8() {
                scalar_at[b + k] = n;
            }
            n += 1;
        }
        scalar_at[source.len()] = n;
        let end_of = |byte_end: usize| -> usize {
            // pulldown ranges include the final line ending; commonmark.js ends at the last column.
            let mut e = byte_end;
            while e > 0 && matches!(source.as_bytes()[e - 1], b'\n' | b'\r') {
                e -= 1;
            }
            scalar_at[e]
        };
        // Lists and items: pulldown keeps trailing lines that hold only an
        // outer quote marker or spaces (`>`), commonmark.js ends at the last
        // content line.
        let container_end = |byte_start: usize, byte_end: usize| -> usize {
            let mut e = byte_end;
            loop {
                while e > byte_start && matches!(source.as_bytes()[e - 1], b'\n' | b'\r') {
                    e -= 1;
                }
                let line_start = source[..e].rfind('\n').map_or(0, |i| i + 1);
                if line_start > byte_start
                    && source[line_start..e]
                        .chars()
                        .all(|c| matches!(c, ' ' | '\t' | '>'))
                {
                    e = line_start;
                } else {
                    return scalar_at[e];
                }
            }
        };

        let mut stack: Vec<Node> = vec![];
        let mut roots: Vec<Node> = vec![];
        // Depth of non-counted block containers (and counted paragraphs) being skipped.
        let mut skip = 0usize;
        // Inline run of a tight item: (first byte start, last byte end).
        let mut run: Option<(usize, usize)> = None;

        fn close_run(
            run: &mut Option<(usize, usize)>,
            stack: &mut [Node],
            scalar_at: &[usize],
            end_of: &dyn Fn(usize) -> usize,
        ) {
            if let (Some((s, e)), Some(parent)) = (run.take(), stack.last_mut())
                && parent.kind == BlockKind::Li
            {
                parent.children.push(Node {
                    kind: BlockKind::P,
                    start: scalar_at[s],
                    end: end_of(e),
                    children: vec![],
                });
            }
        }

        let attach =
            |node: Node, stack: &mut Vec<Node>, roots: &mut Vec<Node>| match stack.last_mut() {
                Some(parent) => parent.children.push(node),
                None => roots.push(node),
            };

        for (event, range) in Parser::new_ext(source, Options::empty()).into_offset_iter() {
            match event {
                Event::Start(tag) => {
                    if skip > 0 {
                        skip += 1;
                        continue;
                    }
                    let kind = match &tag {
                        Tag::Paragraph => Some(BlockKind::P),
                        Tag::Item => Some(BlockKind::Li),
                        Tag::BlockQuote(_) => Some(BlockKind::Blockquote),
                        Tag::List(Some(_)) => Some(BlockKind::Ol),
                        Tag::List(None) => Some(BlockKind::Ul),
                        _ => None,
                    };
                    let in_item = stack.last().is_some_and(|n| n.kind == BlockKind::Li);
                    let is_block = matches!(
                        tag,
                        Tag::Paragraph
                            | Tag::Item
                            | Tag::BlockQuote(_)
                            | Tag::List(_)
                            | Tag::Heading { .. }
                            | Tag::CodeBlock(_)
                            | Tag::HtmlBlock
                            | Tag::Table(_)
                            | Tag::FootnoteDefinition(_)
                    );
                    if in_item && !is_block {
                        // Start of an inline element of a tight item.
                        let r = run.get_or_insert((range.start, range.end));
                        r.1 = range.end;
                        skip += 1;
                        continue;
                    }
                    if is_block {
                        close_run(&mut run, &mut stack, &scalar_at, &end_of);
                    }
                    match kind {
                        Some(BlockKind::P) => {
                            // Children of a paragraph are inline only.
                            attach(
                                Node {
                                    kind: BlockKind::P,
                                    start: scalar_at[range.start],
                                    end: end_of(range.end),
                                    children: vec![],
                                },
                                &mut stack,
                                &mut roots,
                            );
                            skip += 1;
                        }
                        Some(k) => stack.push(Node {
                            kind: k,
                            start: scalar_at[range.start],
                            end: if k == BlockKind::Blockquote {
                                end_of(range.end)
                            } else {
                                container_end(range.start, range.end)
                            },
                            children: vec![],
                        }),
                        None => skip += 1,
                    }
                }
                Event::End(end) => {
                    if skip > 0 {
                        skip -= 1;
                        continue;
                    }
                    if matches!(end, TagEnd::Item | TagEnd::List(_) | TagEnd::BlockQuote(_)) {
                        close_run(&mut run, &mut stack, &scalar_at, &end_of);
                        if let Some(node) = stack.pop() {
                            attach(node, &mut stack, &mut roots);
                        }
                    }
                }
                Event::Text(_)
                | Event::Code(_)
                | Event::InlineHtml(_)
                | Event::SoftBreak
                | Event::HardBreak
                | Event::Html(_)
                | Event::FootnoteReference(_)
                | Event::InlineMath(_)
                | Event::DisplayMath(_)
                    if skip == 0 && stack.last().is_some_and(|n| n.kind == BlockKind::Li) =>
                {
                    let r = run.get_or_insert((range.start, range.end));
                    r.1 = range.end;
                }
                _ => {}
            }
        }
        Self { roots }
    }

    /// Steps (root to leaf) of the deepest counted block that fully contains
    /// `start..end`; empty when none does.
    pub fn steps_for_range(&self, start: usize, end: usize) -> Vec<BlockStep> {
        let mut steps = vec![];
        let mut level = &self.roots;
        'outer: loop {
            let mut counts = [0usize; 5];
            for node in level {
                counts[node.kind as usize] += 1;
                if node.start <= start && end <= node.end {
                    steps.push(BlockStep {
                        kind: node.kind,
                        occurrence: counts[node.kind as usize],
                    });
                    level = &node.children;
                    continue 'outer;
                }
            }
            return steps;
        }
    }

    /// Scalar range of the block reached by `steps`, if the shape matches.
    pub fn range_for_steps(&self, steps: &[BlockStep]) -> Option<(usize, usize)> {
        if steps.is_empty() {
            return None;
        }
        let mut level = &self.roots;
        let mut found: Option<&Node> = None;
        for step in steps {
            let mut count = 0;
            found = level.iter().find(|n| {
                if n.kind == step.kind {
                    count += 1;
                    count == step.occurrence
                } else {
                    false
                }
            });
            level = &found?.children;
        }
        found.map(|n| (n.start, n.end))
    }
}
