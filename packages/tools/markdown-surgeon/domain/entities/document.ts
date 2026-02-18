/**
 * Domain entities for markdown-surgeon.
 *
 * All types are immutable (readonly properties).
 * This module has ZERO external dependencies.
 */

/** Represents a section in a Markdown document */
export interface Section {
  readonly id: string;
  readonly level: number;
  readonly title: string;
  readonly line: number; // 1-indexed line number of the header
  readonly lineEnd: number; // 1-indexed line number of last content line (before next section or EOF)
}

/** Parsed document with sections and raw lines */
export interface Document {
  readonly sections: readonly Section[];
  readonly lines: readonly string[];
  readonly frontmatter: string | null; // Raw frontmatter including delimiters, or null
  readonly frontmatterEndLine: number; // 0 if no frontmatter, otherwise line after closing ---
}

/** Result of a write/append/empty/remove operation */
export interface MutationResult {
  readonly action: "updated" | "created" | "appended" | "emptied" | "removed";
  readonly id: string;
  readonly lineStart: number;
  readonly lineEnd?: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

/** A single search match within the document */
export interface SearchMatch {
  readonly sectionId: string | null; // null if outside any section
  readonly line: number;
  readonly content: string;
}

/** Summary of search matches grouped by section */
export interface SearchSummary {
  readonly id: string;
  readonly level: number;
  readonly title: string;
  readonly lines: readonly number[];
  readonly matchCount: number;
}

/** Error codes for structured error handling */
export type ErrorCode =
  | "file_not_found"
  | "section_not_found"
  | "parse_error"
  | "invalid_id"
  | "io_error";

/** Structured error with code, message, and optional context */
export class MdError extends Error {
  readonly code: ErrorCode;
  readonly file?: string;
  readonly id?: string;

  constructor(
    code: ErrorCode,
    message: string,
    file?: string,
    id?: string,
  ) {
    super(message);
    this.name = "MdError";
    this.code = code;
    this.file = file;
    this.id = id;
  }

  format(): string {
    return `error: ${this.code}\n${this.message}`;
  }
}
