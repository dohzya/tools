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
  readonly documentHash?: HashSignal;
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

/** A hash-based locator signal (currently always SHA-256 prefix based) */
export interface HashSignal {
  readonly algorithm: "sha256";
  readonly prefix: string;
}

/** Output encoding for a generated or transformed MRFI reference */
export type MrfiFormat = "debug" | "base62" | "hangul";

/** Field verbosity profile applied when generating a MRFI reference */
export type MrfiProfile = "min" | "default" | "full";

/** A single alternate candidate surfaced when resolution is ambiguous */
export interface ResolveCandidate {
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
  readonly range?: string;
  readonly anchor?: string;
  readonly passage?: string;
  readonly diagnostics: readonly string[];
  readonly candidates?: readonly ResolveCandidate[];
}
