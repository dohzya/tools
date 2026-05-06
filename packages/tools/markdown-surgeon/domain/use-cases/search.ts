/**
 * Use Case: Search
 *
 * Search for a pattern across a parsed document.
 * Based on the cmdSearch() logic in cli.ts.
 *
 * Dependencies: ReadSectionUseCase for finding sections at line positions.
 */

import type {
  Document,
  SearchMatch,
  SearchSummary,
} from "../entities/document.ts";
import { ReadSectionUseCase } from "./read-section.ts";

/** Input for the Search use case */
export interface SearchInput {
  /** Parsed document to search within */
  readonly doc: Document;
  /** Plain-text pattern to search for */
  readonly pattern: string;
}

/** Result of a search operation */
export interface SearchResult {
  /** Individual line-level matches */
  readonly matches: SearchMatch[];
  /** Matches grouped by section */
  readonly summaries: SearchSummary[];
}

/** Searches for a text pattern across a parsed document */
export class SearchUseCase {
  private readonly readSection: ReadSectionUseCase;

  /** Create a SearchUseCase */
  constructor() {
    this.readSection = new ReadSectionUseCase();
  }

  /** Search the document for all lines containing the pattern */
  execute(input: SearchInput): SearchResult {
    const { doc, pattern } = input;

    const matches: SearchMatch[] = [];

    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i];
      if (line.includes(pattern)) {
        const lineNum = i + 1; // 1-indexed
        const section = this.readSection.findSectionAtLine(doc, lineNum);
        matches.push({
          sectionId: section?.id ?? null,
          line: lineNum,
          content: line,
        });
      }
    }

    // Build summaries grouped by section
    const sectionMap = new Map<string, SearchSummary>();

    for (const match of matches) {
      if (!match.sectionId) continue;

      const section = this.readSection.findSection(doc, match.sectionId);
      if (!section) continue;

      const existing = sectionMap.get(match.sectionId);
      if (!existing) {
        sectionMap.set(match.sectionId, {
          id: section.id,
          level: section.level,
          title: section.title,
          lines: [match.line],
          matchCount: 1,
        });
      } else {
        // Build new summary with added line/count (immutable style)
        sectionMap.set(match.sectionId, {
          ...existing,
          lines: [...existing.lines, match.line],
          matchCount: existing.matchCount + 1,
        });
      }
    }

    const summaries = Array.from(sectionMap.values());

    return { matches, summaries };
  }
}
