/**
 * Use Case: AppendSection
 *
 * Append content to a section (or to the document if no ID given).
 * Based on the cmdAppend() logic in cli.ts.
 *
 * Dependencies:
 *   - HashService (port) for re-parsing to get new section IDs
 *   - ReadSectionUseCase for section lookup / end-line computation
 *   - ParseDocumentUseCase for re-parsing after append (to get new section IDs)
 */

import type { Document, MutationResult } from "../entities/document.ts";
import { MdError } from "../entities/document.ts";
import type { HashService } from "../ports/hash-service.ts";
import { ParseDocumentUseCase } from "./parse-document.ts";
import { ReadSectionUseCase } from "./read-section.ts";

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;

export interface AppendSectionInput {
  readonly doc: Document;
  readonly id: string | null;
  readonly content: string;
  readonly deep: boolean;
  readonly before: boolean;
}

export interface AppendSectionOutput {
  readonly result: MutationResult;
  readonly updatedLines: readonly string[];
}

/**
 * Check if content starts with a markdown header.
 * Equivalent to startsWithHeader() from parser.ts.
 */
function startsWithHeader(
  content: string,
): { level: number; title: string } | null {
  const firstLine = content.split("\n")[0];
  const match = firstLine?.match(HEADER_REGEX);
  if (match) {
    return { level: match[1].length, title: match[2].trim() };
  }
  return null;
}

export class AppendSectionUseCase {
  private readonly readSection: ReadSectionUseCase;
  private readonly parseDocument: ParseDocumentUseCase;

  constructor(private readonly hashService: HashService) {
    this.readSection = new ReadSectionUseCase();
    this.parseDocument = new ParseDocumentUseCase(hashService);
  }

  async execute(input: AppendSectionInput): Promise<AppendSectionOutput> {
    const { doc, id, content, deep, before } = input;

    const newLines = content.split("\n");
    let insertLine: number;
    let sectionId: string | null = null;

    if (id === null) {
      // No ID: append to file start (--before) or end (default/--after)
      if (before) {
        // Insert after frontmatter if present
        insertLine = doc.frontmatterEndLine;
      } else {
        // Insert at end of file
        insertLine = doc.lines.length;
      }
    } else {
      // With ID: append relative to section
      const section = this.readSection.findSection(doc, id);

      if (!section) {
        throw new MdError(
          "section_not_found",
          `Section ${id} not found`,
        );
      }
      sectionId = section.id;

      if (before) {
        // Insert before the section's header
        insertLine = section.line - 1; // 0-indexed, before header
      } else {
        // Insert at end of section (or after subsections with --deep)
        const endLine = this.readSection.getSectionEndLine(doc, section, deep);
        insertLine = endLine; // 0-indexed position to insert
      }
    }

    // Add blank line before if inserting after content and content doesn't start with blank
    if (
      !before && insertLine > 0 && doc.lines[insertLine - 1]?.trim() !== "" &&
      newLines[0]?.trim() !== ""
    ) {
      newLines.unshift("");
    }

    // Insert the new lines
    const updatedLines = [...doc.lines];
    updatedLines.splice(insertLine, 0, ...newLines);

    // Determine if we created a new section
    const headerInfo = startsWithHeader(content);
    const action = headerInfo ? "created" : "appended";

    // For created, compute the new section's ID
    let resultId = sectionId ?? "-";
    if (headerInfo) {
      // Re-parse to get the new section's ID
      const newDoc = await this.parseDocument.execute({
        content: updatedLines.join("\n"),
      });
      const newSection = newDoc.sections.find(
        (s) => s.line === insertLine + 1 && s.title === headerInfo.title,
      );
      if (newSection) {
        resultId = newSection.id;
      }
    }

    const result: MutationResult = {
      action,
      id: resultId,
      lineStart: insertLine + 1, // 1-indexed
      lineEnd: headerInfo ? insertLine + newLines.length : undefined,
      linesAdded: newLines.length,
      linesRemoved: 0,
    };

    return { result, updatedLines };
  }
}
