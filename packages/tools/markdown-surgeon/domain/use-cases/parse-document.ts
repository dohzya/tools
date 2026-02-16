/**
 * Use Case: ParseDocument
 *
 * Parses a raw markdown string into a Document entity.
 * Reproduces the EXACT behavior of parseDocument() from parser.ts.
 *
 * Dependencies: HashService (port) for generating section IDs.
 */

import type { Document, Section } from "../entities/document.ts";
import type { HashService } from "../ports/hash-service.ts";

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;
const FRONTMATTER_DELIMITER = "---";

export interface ParseDocumentInput {
  readonly content: string;
}

export class ParseDocumentUseCase {
  constructor(private readonly hashService: HashService) {}

  async execute(input: ParseDocumentInput): Promise<Document> {
    const lines = input.content.split("\n");
    const sections: Section[] = [];

    // Track occurrences of each (level, normalizedTitle) for unique IDs
    const occurrences = new Map<string, number>();

    // Parse frontmatter
    let frontmatter: string | null = null;
    let frontmatterEndLine = 0;
    let startLine = 0;

    if (lines[0]?.trim() === FRONTMATTER_DELIMITER) {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === FRONTMATTER_DELIMITER) {
          frontmatter = lines.slice(0, i + 1).join("\n");
          frontmatterEndLine = i + 1; // 1-indexed
          startLine = i + 1;
          break;
        }
      }
    }

    // Parse sections (skip content inside code blocks)
    let inCodeBlock = false;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      // Track code block state (``` or ~~~)
      if (line.trim().startsWith("```") || line.trim().startsWith("~~~")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // Skip headers inside code blocks
      if (inCodeBlock) continue;

      const match = line.match(HEADER_REGEX);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();
        const normalizedKey = `${level}:${title.toLowerCase().trim()}`;

        const occurrence = occurrences.get(normalizedKey) ?? 0;
        occurrences.set(normalizedKey, occurrence + 1);

        const id = await this.hashService.hash(level, title, occurrence);

        sections.push({
          id,
          level,
          title,
          line: i + 1, // 1-indexed
          lineEnd: lines.length, // Will be adjusted below
        });
      }
    }

    // Compute lineEnd for each section (line before next section or EOF)
    for (let i = 0; i < sections.length; i++) {
      const nextSection = sections[i + 1];
      if (nextSection) {
        // Use mutable cast to set lineEnd - matching original parser behavior
        (sections[i] as { lineEnd: number }).lineEnd = nextSection.line - 1;
      } else {
        // Last section goes to end of file
        // Trim trailing empty lines for lineEnd
        let lastContentLine = lines.length;
        while (
          lastContentLine > sections[i].line &&
          lines[lastContentLine - 1]?.trim() === ""
        ) {
          lastContentLine--;
        }
        (sections[i] as { lineEnd: number }).lineEnd = lastContentLine;
      }
    }

    return { sections, lines, frontmatter, frontmatterEndLine };
  }
}
