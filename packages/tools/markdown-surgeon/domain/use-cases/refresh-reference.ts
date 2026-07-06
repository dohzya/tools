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
import { parseMrfiRange } from "./mrfi-codec.ts";

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
      const range = parseMrfiRange(result.range);
      if (!range) {
        throw new Error(`Unexpected resolved range format: ${result.range}`);
      }
      const refreshed = await this.generateReference.execute({
        doc,
        target: { kind: "range", range },
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
