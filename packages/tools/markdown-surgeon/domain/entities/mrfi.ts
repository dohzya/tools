/**
 * Domain entities for Markdown Fragment References (MRFI).
 *
 * A MRFI is a locator/reference syntax (`~<mrfi>` compact/hangul, `~{...}`
 * debug form, or `^<anchor>`) for pointing at a Markdown passage in a way
 * that is resilient to line moves and light edits.
 *
 * All types are immutable (readonly properties).
 * This module has ZERO external dependencies.
 */

/** Debug-form MRFI fields, parsed from `~{v0;...}` or a compact envelope */
export interface DebugMrfi {
  readonly anchor?: string;
  readonly context?: {
    readonly prefix?: string;
    readonly suffix?: string;
  };
  /** Fuzzy (smh64) hash of the whole document — wrong-file detection, not passage recovery */
  readonly documentHash?: {
    readonly hash: bigint;
    readonly maxDistance?: number;
  };
  readonly exactHash?: HashSignal;
  readonly extra?: ReadonlyMap<string, string>;
  readonly headingHash?: {
    readonly hash: bigint;
    readonly maxDistance?: number;
  };
  readonly offsetRange?: {
    readonly end: number;
    readonly start: number;
  };
  readonly passageHash?: {
    readonly hash: bigint;
    readonly maxDistance?: number;
  };
  readonly quote?: string;
  readonly range?: SourceRange;
  readonly structuralPath?: string;
}

/** A 1-indexed line/column span within a document (MRFI's own range shape) */
export interface SourceRange {
  readonly endColumn: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly startLine: number;
}

/** A normalized character span used to map structural paths back to source offsets */
export interface ComparisonSpan {
  readonly sourceEnd: number;
  readonly sourceStart: number;
  readonly value: string;
}

/**
 * A hash-based locator signal: a hash prefix plus the algorithm tag it was
 * computed with. Any tag string must round-trip verbatim, per
 * docs/specs/mrfi.md's "unknown tag falls back to literal encoding" —
 * "sha256" and "xxh64" are the only ones the resolver knows how to
 * recompute, but the type itself does not enumerate them.
 */
export interface HashSignal {
  readonly algorithm: string;
  readonly prefix: string;
}

/** Output encoding for a generated or transformed MRFI reference */
export type MrfiFormat = "debug" | "base62" | "hangul";

/** Field verbosity profile applied when generating a MRFI reference */
export type MrfiProfile = "min" | "default" | "full";

/** A single alternate candidate surfaced when resolution is ambiguous */
export interface ResolveCandidate {
  /** Same `startLine:startCol-endLine:endCol` precision as ResolveResult.range */
  readonly range: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Result of resolving a `^anchor` or `~mrfi` reference against a document */
export interface ResolveResult {
  readonly ref: string;
  readonly status:
    | "exact"
    | "confident"
    | "ambiguous"
    | "stale"
    | "not_found"
    | "invalid";
  readonly confidence: number;
  /**
   * Resolved range at full `startLine:startCol-endLine:endCol` precision
   * (the same format as the `r=` field), per docs/specs/mrfi.md's Output
   * Model ("at the same `line:col` precision as `r`").
   */
  readonly range?: string;
  readonly anchor?: string;
  readonly passage?: string;
  readonly diagnostics: readonly string[];
  readonly candidates?: readonly ResolveCandidate[];
}

/** A freshly regenerated reference for a resolved range */
export interface RefreshedReference {
  readonly kind: "refreshed";
  readonly ref: string;
}

/** A reference that could not be confidently placed; the resolve outcome is surfaced instead */
export interface UnresolvedReference {
  readonly kind: "unresolved";
  readonly result: ResolveResult;
}

/** Output of refreshing a reference: either regenerated, or an unresolved outcome */
export type RefreshReferenceOutput = RefreshedReference | UnresolvedReference;
