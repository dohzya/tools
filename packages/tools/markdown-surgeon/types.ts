/**
 * Backward-compatible re-exports from domain entities.
 *
 * All types and classes are now defined in domain/entities/document.ts.
 * This file exists for backward compatibility with existing imports.
 */

export type {
  Document,
  ErrorCode,
  MutationResult,
  SearchMatch,
  SearchSummary,
  Section,
} from "./domain/entities/document.ts";

export { MdError } from "./domain/entities/document.ts";
