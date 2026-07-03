/**
 * Port: ReferenceLocatorService
 *
 * Thin port over markdown-surgeon's MRFI (Markdown Fragment Reference) use
 * cases: generate a fresh reference for a range, resolve an existing
 * `^anchor`/`~mrfi` reference against a document, and refresh a reference
 * whose target content may have moved.
 *
 * dz-review already has its own `ReferenceTarget` (see `ref-core.ts`) for
 * the review-comment reference syntax (`ref:`, `<!-- ref ... -->`) parsed
 * out of a Markdown file — that type is unrelated to and named
 * differently from this port, which only wraps markdown-surgeon's
 * lower-level MRFI locator engine.
 *
 * Deliberately narrower than markdown-surgeon's own GenerateReferenceUseCase:
 * that use case also supports generating a reference for a whole *section*
 * (`GenerateReferenceTarget`'s `"section"` variant), which would require
 * this port to import `Section` from markdown-surgeon and re-export a
 * union type sourced from a use-case file rather than an entity — a real
 * ports-import-entities-only violation, not just style. dz-review's own
 * annotations always locate a concrete text range, never "the whole
 * section", so `generateReference` only takes a `SourceRange`; the adapter
 * wraps it as `{ kind: "range", range }` when calling the underlying use
 * case. Widen this port if a genuine section-level need shows up later.
 */

import type { Document } from "../../../markdown-surgeon/domain/entities/document.ts";
import type {
  MrfiFormat,
  MrfiProfile,
  RefreshReferenceOutput,
  ResolveResult,
  SourceRange,
} from "../../../markdown-surgeon/domain/entities/mrfi.ts";

export type {
  Document,
  MrfiFormat,
  MrfiProfile,
  RefreshReferenceOutput,
  ResolveResult,
  SourceRange,
};

/**
 * Field verbosity + output encoding for a generated reference — groups the
 * `format`/`profile`/`quote`/`quoteMax` fields GenerateReferenceUseCase
 * takes alongside `doc`/`target` (which are passed as separate arguments
 * on the port method below).
 */
export interface GenerateReferenceOptions {
  readonly format: MrfiFormat;
  readonly profile: MrfiProfile;
  readonly quote: boolean;
  readonly quoteMax: number;
}

/** Locates and (re)generates MRFI passage references within a document */
export interface ReferenceLocatorService {
  /** Generate a fresh MRFI reference for a source range */
  generateReference(
    doc: Document,
    range: SourceRange,
    options: GenerateReferenceOptions,
  ): Promise<string>;

  /** Resolve a `^anchor` or `~mrfi` reference against a document */
  resolveReference(
    doc: Document,
    ref: string,
    witness?: string,
  ): Promise<ResolveResult>;

  /** Re-point a reference at its current location, or report why it couldn't */
  refreshReference(
    doc: Document,
    ref: string,
    format: MrfiFormat,
    profile: MrfiProfile,
  ): Promise<RefreshReferenceOutput>;
}
