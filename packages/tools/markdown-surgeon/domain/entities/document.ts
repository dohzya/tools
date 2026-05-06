/**
 * Domain entities for markdown-surgeon.
 *
 * All types are immutable (readonly properties).
 * This module has ZERO external dependencies.
 */

/** Represents a section in a Markdown document */
export interface Section {
  /** Unique hash-based identifier for this section */
  readonly id: string;
  /** Header level (1-6) */
  readonly level: number;
  /** Header title text (without the leading `#` marks) */
  readonly title: string;
  /** 1-indexed line number of the header */
  readonly line: number;
  /** 1-indexed line number of the last content line (before next section or EOF) */
  readonly lineEnd: number;
}

/** Parsed document with sections and raw lines */
export interface Document {
  /** Ordered list of parsed sections */
  readonly sections: readonly Section[];
  /** Raw lines of the entire document */
  readonly lines: readonly string[];
  /** Raw frontmatter including delimiters, or null if absent */
  readonly frontmatter: string | null;
  /** Line after closing `---` (0 if no frontmatter) */
  readonly frontmatterEndLine: number;
}

/** Result of a write/append/empty/remove operation */
export interface MutationResult {
  /** Kind of mutation that was performed */
  readonly action: "updated" | "created" | "appended" | "emptied" | "removed";
  /** Section ID affected by the mutation */
  readonly id: string;
  /** 1-indexed start line of the affected range */
  readonly lineStart: number;
  /** 1-indexed end line of the affected range (if applicable) */
  readonly lineEnd?: number;
  /** Number of lines added */
  readonly linesAdded: number;
  /** Number of lines removed */
  readonly linesRemoved: number;
}

/** A single search match within the document */
export interface SearchMatch {
  /** Section ID containing the match, or null if outside any section */
  readonly sectionId: string | null;
  /** 1-indexed line number of the match */
  readonly line: number;
  /** Full text of the matching line */
  readonly content: string;
}

/** Summary of search matches grouped by section */
export interface SearchSummary {
  /** Section ID */
  readonly id: string;
  /** Header level (1-6) */
  readonly level: number;
  /** Header title text */
  readonly title: string;
  /** 1-indexed line numbers of matches in this section */
  readonly lines: readonly number[];
  /** Total number of matches in this section */
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
  /** Machine-readable error code */
  readonly code: ErrorCode;
  /** File path that triggered the error, if applicable */
  readonly file?: string;
  /** Section ID that triggered the error, if applicable */
  readonly id?: string;

  /** Create a structured error with code, message, and optional context */
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

  /** Format the error as a human-readable string */
  format(): string {
    return `error: ${this.code}\n${this.message}`;
  }
}
