/**
 * Backward-compatible shim for parser.ts.
 *
 * Provides the same mutable Document/Section API that worklog/cli.ts depends on.
 * Delegates parsing to ParseDocumentUseCase but returns mutable objects.
 */

import { MdError } from "./domain/entities/document.ts";
import { Blake3HashService } from "./adapters/services/blake3-hash.ts";
import { ParseDocumentUseCase } from "./domain/use-cases/parse-document.ts";

// Mutable interfaces matching the old types.ts (before hexagonal refactoring)
export interface Section {
  id: string;
  level: number;
  title: string;
  line: number;
  lineEnd: number;
}

export interface Document {
  sections: Section[];
  lines: string[];
  frontmatter: string | null;
  frontmatterEndLine: number;
}

const _hashService = new Blake3HashService();
const _parseUseCase = new ParseDocumentUseCase(_hashService);

/** Parse a Markdown file into a mutable Document structure */
export async function parseDocument(content: string): Promise<Document> {
  const immutableDoc = await _parseUseCase.execute({ content });
  // Convert readonly arrays to mutable for backward compat
  return {
    sections: immutableDoc.sections.map((s) => ({ ...s })),
    lines: [...immutableDoc.lines],
    frontmatter: immutableDoc.frontmatter,
    frontmatterEndLine: immutableDoc.frontmatterEndLine,
  };
}

/** Find a section by ID */
export function findSection(doc: Document, id: string): Section | undefined {
  return doc.sections.find((s) => s.id === id);
}

/** Find the section containing a given line number (1-indexed) */
export function findSectionAtLine(
  doc: Document,
  lineNum: number,
): Section | undefined {
  for (let i = doc.sections.length - 1; i >= 0; i--) {
    if (doc.sections[i].line <= lineNum) {
      return doc.sections[i];
    }
  }
  return undefined;
}

/**
 * Get the end line for a section based on --deep flag
 * Without --deep: stops at next header (any level)
 * With --deep: stops at next header with level >= current
 */
export function getSectionEndLine(
  doc: Document,
  section: Section,
  deep: boolean,
): number {
  const sectionIndex = doc.sections.findIndex((s) => s.id === section.id);
  if (sectionIndex === -1) {
    throw new MdError("section_not_found", `Section ${section.id} not found`);
  }

  if (!deep) {
    return section.lineEnd;
  }

  // With --deep, find next header with level >= current
  for (let i = sectionIndex + 1; i < doc.sections.length; i++) {
    if (doc.sections[i].level <= section.level) {
      return doc.sections[i].line - 1;
    }
  }

  // No such header found, go to end of file
  let lastLine = doc.lines.length;
  while (lastLine > section.line && doc.lines[lastLine - 1]?.trim() === "") {
    lastLine--;
  }
  return lastLine;
}

/** Get section content (lines after header until end) */
export function getSectionContent(
  doc: Document,
  section: Section,
  deep: boolean,
): string {
  const endLine = getSectionEndLine(doc, section, deep);
  const contentLines = doc.lines.slice(section.line, endLine);
  return contentLines.join("\n");
}

/** Serialize document back to string */
export function serializeDocument(doc: Document): string {
  return doc.lines.join("\n");
}

/**
 * Get the raw YAML content from frontmatter (without delimiters)
 */
export function getFrontmatterContent(doc: Document): string {
  if (!doc.frontmatter) {
    return "";
  }
  const lines = doc.frontmatter.split("\n");
  return lines.slice(1, -1).join("\n");
}

/**
 * Set the frontmatter content (adds delimiters). Mutates the document.
 */
export function setFrontmatter(doc: Document, yamlContent: string): void {
  const newFrontmatter = yamlContent.trim()
    ? `---\n${yamlContent.trim()}\n---`
    : null;

  if (doc.frontmatter) {
    const oldEndLine = doc.frontmatterEndLine;
    const newLines = newFrontmatter ? newFrontmatter.split("\n") : [];
    doc.lines = [...newLines, ...doc.lines.slice(oldEndLine)];
    doc.frontmatter = newFrontmatter;
    doc.frontmatterEndLine = newLines.length;
  } else if (newFrontmatter) {
    const newLines = newFrontmatter.split("\n");
    doc.lines = [...newLines, "", ...doc.lines];
    doc.frontmatter = newFrontmatter;
    doc.frontmatterEndLine = newLines.length;
  }
}

/** Check if content starts with a markdown header */
export function startsWithHeader(
  content: string,
): { level: number; title: string } | null {
  const firstLine = content.split("\n")[0];
  const match = firstLine?.match(/^(#{1,6})\s+(.+)$/);
  if (match) {
    return { level: match[1].length, title: match[2].trim() };
  }
  return null;
}
