/**
 * Use Case: WriteSection
 *
 * Write/replace content of a section (identified by ID).
 * Based on the cmdWrite() logic in cli.ts.
 *
 * Dependencies: ReadSectionUseCase for section lookup / end-line computation.
 */

import type { Document, MutationResult } from "../entities/document.ts";
import { MdError } from "../entities/document.ts";
import { ReadSectionUseCase } from "./read-section.ts";

export interface WriteSectionInput {
  readonly doc: Document;
  readonly id: string;
  readonly content: string;
  readonly deep: boolean;
}

export interface WriteSectionOutput {
  readonly result: MutationResult;
  readonly updatedLines: readonly string[];
}

export class WriteSectionUseCase {
  private readonly readSection: ReadSectionUseCase;

  constructor() {
    this.readSection = new ReadSectionUseCase();
  }

  execute(input: WriteSectionInput): WriteSectionOutput {
    const { doc, id, content, deep } = input;

    const section = this.readSection.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `Section ${id} not found`,
      );
    }

    const endLine = this.readSection.getSectionEndLine(doc, section, deep);
    const oldLineCount = endLine - section.line; // Lines after header

    // Prepare new content lines
    const newLines = content === "" ? [] : content.split("\n");
    // Ensure content doesn't start right after header - add blank line if needed
    if (newLines.length > 0 && newLines[0].trim() !== "") {
      newLines.unshift("");
    }

    // Replace lines: keep header (section.line - 1 in 0-indexed), replace rest
    const beforeSection = doc.lines.slice(0, section.line); // includes header
    const afterSection = doc.lines.slice(endLine);

    const updatedLines = [...beforeSection, ...newLines, ...afterSection];

    const result: MutationResult = {
      action: "updated",
      id: section.id,
      lineStart: section.line,
      lineEnd: section.line + newLines.length,
      linesAdded: newLines.length,
      linesRemoved: oldLineCount,
    };

    return { result, updatedLines };
  }
}
