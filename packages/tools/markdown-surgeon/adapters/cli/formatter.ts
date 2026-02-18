/**
 * CLI output formatters for markdown-surgeon.
 *
 * Text and JSON formatting for all command outputs.
 * These are pure functions with no side effects.
 */

import type {
  Document,
  MutationResult,
  SearchMatch,
  SearchSummary,
  Section,
} from "../../domain/entities/document.ts";

// ============================================================================
// Text formatters
// ============================================================================

export function formatOutline(doc: Document): string {
  return doc.sections
    .map((s) => `${"#".repeat(s.level)} ${s.title} ^${s.id} L${s.line}`)
    .join("\n");
}

export function formatRead(
  section: Section,
  content: string,
  endLine: number,
): string {
  const header = `${
    "#".repeat(section.level)
  } ${section.title} ^${section.id} L${section.line}-L${endLine}`;
  if (content.trim() === "") {
    return header;
  }
  return `${header}\n\n${content}`;
}

export function formatMutation(result: MutationResult): string {
  const range = result.lineEnd
    ? `L${result.lineStart}-L${result.lineEnd}`
    : `L${result.lineStart}`;
  const delta = [];
  if (result.linesAdded > 0) delta.push(`+${result.linesAdded}`);
  if (result.linesRemoved > 0) delta.push(`-${result.linesRemoved}`);
  const deltaStr = delta.length > 0 ? ` (${delta.join(", ")})` : "";
  return `${result.action} ^${result.id} ${range}${deltaStr}`;
}

export function formatSearchMatches(matches: SearchMatch[]): string {
  return matches
    .map((m) => {
      const sectionPart = m.sectionId ? `^${m.sectionId}` : "^-";
      return `${sectionPart} L${m.line} ${m.content}`;
    })
    .join("\n");
}

export function formatSearchSummary(summaries: SearchSummary[]): string {
  return summaries
    .map((s) => {
      const header = `${"#".repeat(s.level)} ${s.title}`;
      const lines = s.lines.map((l) => `L${l}`).join(",");
      const matchWord = s.matchCount === 1 ? "match" : "matches";
      return `${header} ^${s.id} ${lines} (${s.matchCount} ${matchWord})`;
    })
    .join("\n");
}

// ============================================================================
// JSON formatters
// ============================================================================

export function jsonOutline(doc: Document): string {
  return JSON.stringify(
    doc.sections.map((s) => ({
      id: s.id,
      level: s.level,
      title: s.title,
      line: s.line,
    })),
  );
}

export function jsonRead(
  section: Section,
  content: string,
  endLine: number,
): string {
  return JSON.stringify({
    id: section.id,
    level: section.level,
    title: section.title,
    lineStart: section.line,
    lineEnd: endLine,
    content,
  });
}

export function jsonMutation(result: MutationResult): string {
  return JSON.stringify(result);
}

export function jsonSearchMatches(matches: SearchMatch[]): string {
  return JSON.stringify(matches);
}

export function jsonSearchSummary(summaries: SearchSummary[]): string {
  return JSON.stringify(summaries);
}
