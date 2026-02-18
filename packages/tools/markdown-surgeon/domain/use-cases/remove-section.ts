/**
 * Use Case: RemoveSection
 *
 * Remove a section entirely (header + content + subsections).
 * Based on the cmdRemove() logic in cli.ts.
 *
 * Also includes "empty" functionality (remove content but keep header),
 * based on cmdEmpty() in cli.ts.
 *
 * Dependencies: ReadSectionUseCase for section lookup / end-line computation.
 */

import type { Document, MutationResult } from "../entities/document.ts";
import { MdError } from "../entities/document.ts";
import { ReadSectionUseCase } from "./read-section.ts";

export interface RemoveSectionInput {
  readonly doc: Document;
  readonly id: string;
}

export interface EmptySectionInput {
  readonly doc: Document;
  readonly id: string;
  readonly deep: boolean;
}

export interface RemoveSectionOutput {
  readonly result: MutationResult;
  readonly updatedLines: readonly string[];
}

export class RemoveSectionUseCase {
  private readonly readSection: ReadSectionUseCase;

  constructor() {
    this.readSection = new ReadSectionUseCase();
  }

  /**
   * Remove a section entirely (header + content + subsections).
   * Remove always includes subsections (deep behavior).
   */
  remove(input: RemoveSectionInput): RemoveSectionOutput {
    const { doc, id } = input;

    const section = this.readSection.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `Section ${id} not found`,
      );
    }

    // Remove always includes subsections (deep behavior)
    const endLine = this.readSection.getSectionEndLine(doc, section, true);
    const linesRemoved = endLine - section.line + 1; // +1 for header

    const beforeSection = doc.lines.slice(0, section.line - 1); // before header
    const afterSection = doc.lines.slice(endLine);

    const updatedLines = [...beforeSection, ...afterSection];

    const result: MutationResult = {
      action: "removed",
      id: section.id,
      lineStart: section.line,
      linesAdded: 0,
      linesRemoved,
    };

    return { result, updatedLines };
  }

  /**
   * Empty a section (keep header, remove content).
   * Based on cmdEmpty() in cli.ts.
   */
  empty(input: EmptySectionInput): RemoveSectionOutput {
    const { doc, id, deep } = input;

    const section = this.readSection.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `Section ${id} not found`,
      );
    }

    const endLine = this.readSection.getSectionEndLine(doc, section, deep);
    const linesRemoved = endLine - section.line;

    // Keep header, remove content
    const beforeContent = doc.lines.slice(0, section.line); // includes header
    const afterContent = doc.lines.slice(endLine);

    const updatedLines = [...beforeContent, ...afterContent];

    const result: MutationResult = {
      action: "emptied",
      id: section.id,
      lineStart: section.line,
      linesAdded: 0,
      linesRemoved,
    };

    return { result, updatedLines };
  }
}
