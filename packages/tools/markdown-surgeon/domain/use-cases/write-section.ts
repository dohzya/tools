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

/** Input for the WriteSection use case */
export interface WriteSectionInput {
  /** Parsed document to modify */
  readonly doc: Document;
  /** Section ID to replace content of */
  readonly id: string;
  /** New content to write (replaces existing body) */
  readonly content: string;
  /** Whether to replace nested subsections too */
  readonly deep: boolean;
}

/** Output of writing a section */
export interface WriteSectionOutput {
  /** Mutation metadata (action, line counts) */
  readonly result: MutationResult;
  /** The full document lines after the write */
  readonly updatedLines: readonly string[];
}

/** Replaces the body content of a section identified by ID */
export class WriteSectionUseCase {
  private readonly readSection: ReadSectionUseCase;

  /** Create a WriteSectionUseCase */
  constructor() {
    this.readSection = new ReadSectionUseCase();
  }

  /** Replace the content of a section, keeping its header */
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
