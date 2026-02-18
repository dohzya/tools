/**
 * Use Case: ReadSection
 *
 * Find a section by ID, return its content with appropriate end-line
 * calculation based on the deep flag.
 *
 * Based on findSection() + getSectionContent() + getSectionEndLine() from parser.ts.
 *
 * Dependencies: entities only (no external ports needed).
 */

import type { Document, Section } from "../entities/document.ts";
import { MdError } from "../entities/document.ts";

export interface ReadSectionInput {
  readonly doc: Document;
  readonly id: string;
  readonly deep: boolean;
}

export interface ReadSectionResult {
  readonly section: Section;
  readonly content: string;
  readonly endLine: number;
}

export class ReadSectionUseCase {
  /**
   * Find a section by ID and return its content.
   */
  execute(input: ReadSectionInput): ReadSectionResult {
    const { doc, id, deep } = input;

    const section = this.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `Section ${id} not found`,
      );
    }

    const endLine = this.getSectionEndLine(doc, section, deep);
    const content = this.getSectionContent(doc, section, endLine);

    return { section, content, endLine };
  }

  /**
   * Find a section by ID.
   * Equivalent to findSection() from parser.ts.
   */
  findSection(doc: Document, id: string): Section | undefined {
    return doc.sections.find((s) => s.id === id);
  }

  /**
   * Find the section containing a given line number (1-indexed).
   * Equivalent to findSectionAtLine() from parser.ts.
   */
  findSectionAtLine(doc: Document, lineNum: number): Section | undefined {
    // Find the last section that starts at or before this line
    for (let i = doc.sections.length - 1; i >= 0; i--) {
      if (doc.sections[i].line <= lineNum) {
        return doc.sections[i];
      }
    }
    return undefined;
  }

  /**
   * Get the end line for a section based on --deep flag.
   * Without --deep: stops at next header (any level)
   * With --deep: stops at next header with level <= current
   *
   * Equivalent to getSectionEndLine() from parser.ts.
   */
  getSectionEndLine(
    doc: Document,
    section: Section,
    deep: boolean,
  ): number {
    const sectionIndex = doc.sections.findIndex((s) => s.id === section.id);
    if (sectionIndex === -1) {
      throw new MdError(
        "section_not_found",
        `Section ${section.id} not found`,
      );
    }

    if (!deep) {
      // Stop at very next header
      return section.lineEnd;
    }

    // With --deep, find next header with level <= current
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

  /**
   * Get section content (lines after header until end).
   * Equivalent to getSectionContent() from parser.ts.
   */
  private getSectionContent(
    doc: Document,
    section: Section,
    endLine: number,
  ): string {
    // Content starts after header line
    const contentLines = doc.lines.slice(section.line, endLine);
    return contentLines.join("\n");
  }
}
