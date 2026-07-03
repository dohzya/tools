/**
 * Use Case: RefreshReference
 *
 * Re-points a `^anchor`/`~mrfi` reference at its current location: resolves
 * it against the document (ResolveReferenceUseCase), and if the match is
 * `exact` or `confident`, regenerates a canonical reference for the
 * up-to-date range (GenerateReferenceUseCase) — so a reference that has
 * drifted because of line moves or light edits can be re-synced without
 * hand-editing it. When the reference can't be confidently placed
 * (`ambiguous`/`stale`/`not_found`/`invalid`), no reference is produced;
 * the resolve status/diagnostics are surfaced instead so callers can tell
 * "refreshed" from "couldn't".
 *
 * Composed from ResolveReferenceUseCase + GenerateReferenceUseCase, the
 * same way SearchUseCase composes ReadSectionUseCase.
 */

import type { Document } from "../entities/document.ts";
import type {
  MrfiFormat,
  MrfiProfile,
  RefreshReferenceOutput,
} from "../entities/mrfi.ts";
import { ResolveReferenceUseCase } from "./resolve-reference.ts";
import { GenerateReferenceUseCase } from "./generate-reference.ts";
import { getLineEndColumn } from "./mrfi-text.ts";

export type {
  RefreshedReference,
  RefreshReferenceOutput,
  UnresolvedReference,
} from "../entities/mrfi.ts";

/** Input for the RefreshReference use case */
export interface RefreshReferenceInput {
  /** Parsed document to resolve and regenerate the reference against */
  readonly doc: Document;
  /** The `^anchor` or `~mrfi` reference to refresh */
  readonly ref: string;
  /** Output encoding for the regenerated reference (pinned, not defaulted) */
  readonly format: MrfiFormat;
  /** Field verbosity profile for the regenerated reference (pinned, not defaulted) */
  readonly profile: MrfiProfile;
}

/** Re-points a reference at its current location, or reports why it couldn't */
export class RefreshReferenceUseCase {
  private readonly resolveReference: ResolveReferenceUseCase;
  private readonly generateReference: GenerateReferenceUseCase;

  /** Create a RefreshReferenceUseCase */
  constructor() {
    this.resolveReference = new ResolveReferenceUseCase();
    this.generateReference = new GenerateReferenceUseCase();
  }

  /** Resolve the reference and, if confidently placed, regenerate it for the current range */
  async execute(input: RefreshReferenceInput): Promise<RefreshReferenceOutput> {
    const { doc, ref, format, profile } = input;
    const result = await this.resolveReference.execute({ doc, ref });

    if (
      (result.status === "exact" || result.status === "confident") &&
      result.range !== undefined
    ) {
      const refreshed = await this.generateReference.execute({
        doc,
        target: { kind: "range", range: parseResolvedRange(doc, result.range) },
        format,
        profile,
        quote: false,
        quoteMax: 80,
      });
      return { kind: "refreshed", ref: refreshed };
    }

    return { kind: "unresolved", result };
  }
}

/**
 * ResolveResult.range only ever carries line numbers (see formatLineRange
 * in mrfi-text.ts) — resolution never exposes sub-line column precision.
 * Refresh therefore regenerates at full-line granularity, the same
 * precision already exposed by resolve output.
 */
function parseResolvedRange(doc: Document, range: string) {
  const match = range.match(/^L(\d+)(?:-L(\d+))?$/);
  if (!match) {
    throw new Error(`Unexpected resolved range format: ${range}`);
  }
  const startLine = Number(match[1]);
  const endLine = match[2] ? Number(match[2]) : startLine;
  return {
    startLine,
    startColumn: 1,
    endLine,
    endColumn: getLineEndColumn(doc, endLine),
  };
}
