// Config entities — raw and resolved section types (TypeScript interfaces only)
// Zod validation schemas live in config-schema.ts (not exported from mod.ts)

// ============================================================================
// TypeScript types
// ============================================================================

/** How sections are visually separated in rendered output. */
export type SeparatorKind = "blank_line" | "none" | "line";
/** Identifier for a built-in section provider. */
export type BuiltinKind =
  | "status"
  | "git-ops"
  | "git-log"
  | "git-stash"
  | "git-status"
  | "git-status-local"
  | "git-subdir";
/** Built-in status enricher provider. */
export type StatusEnricherBuiltinKind = "git-stats";
/** Output format emitted by a status enricher command. */
export type StatusEnricherFormat = "tsv";

/** A shell command that adds per-file text to status lines. */
export type ShStatusEnricherEntry = {
  readonly id: string;
  readonly sh: string;
  readonly format: StatusEnricherFormat;
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
};

/** A built-in provider that adds per-file text to status lines. */
export type BuiltinStatusEnricherEntry = {
  readonly id: string;
  readonly builtin: StatusEnricherBuiltinKind;
  readonly format: StatusEnricherFormat;
};

/** An enricher that adds per-file text to status lines. */
export type StatusEnricherEntry =
  | ShStatusEnricherEntry
  | BuiltinStatusEnricherEntry;

/** A section id alias, usually used for backwards compatibility. */
export type SectionAliasEntry = {
  readonly id: string;
  readonly alias: string;
  readonly deprecated?: boolean;
};

/** A section entry that references another section from the parent config level. */
export type RefSectionEntry = {
  readonly ref: string;
  readonly title?: string;
  readonly max_lines?: number;
  readonly separator?: SeparatorKind;
  readonly sh?: string;
  readonly builtin?: string;
  readonly value?: string;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
};

/** A section entry that runs a shell command. */
export type ShSectionEntry = {
  readonly id: string;
  readonly sh: string;
  readonly title?: string;
  readonly max_lines?: number;
  readonly separator?: SeparatorKind;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
};

/** A section entry that uses a built-in provider. */
export type BuiltinSectionEntry = {
  readonly id: string;
  readonly builtin: BuiltinKind;
  readonly title?: string;
  readonly max_lines?: number;
  readonly separator?: SeparatorKind;
};

/** A section entry with static text (with optional ${VAR} interpolation). */
export type ValueSectionEntry = {
  readonly id: string;
  readonly value: string;
  readonly title?: string;
  readonly max_lines?: number;
  readonly separator?: SeparatorKind;
};

/** A section entry in a YAML config file (before resolution). */
export type RawSectionEntry =
  | ShSectionEntry
  | BuiltinSectionEntry
  | ValueSectionEntry
  | RefSectionEntry
  | SectionAliasEntry;

/** Raw config file shape (what comes from YAML). */
export type RawConfig = {
  readonly dotenv?: readonly string[];
  readonly sections?: readonly RawSectionEntry[];
  readonly status_enrichers?: readonly StatusEnricherEntry[];
};

/** A fully resolved section — ready for execution, no ref: allowed. */
export type ResolvedSection = {
  readonly id: string;
  readonly sh?: string;
  readonly builtin?: BuiltinKind;
  readonly value?: string;
  readonly title?: string;
  readonly max_lines?: number;
  readonly separator?: SeparatorKind;
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
};

/** Fully resolved config ready for collection. */
export type RecapConfig = {
  readonly sections: readonly ResolvedSection[];
  readonly statusEnrichers?: readonly StatusEnricherEntry[];
  readonly sectionAliases?: readonly SectionAliasEntry[];
  readonly warnings?: readonly string[];
  readonly envVars: Readonly<Record<string, string>>;
};

// ============================================================================
// Guard helpers
// ============================================================================

export function isRefEntry(entry: RawSectionEntry): entry is RefSectionEntry {
  return "ref" in entry;
}

export function isAliasEntry(
  entry: RawSectionEntry,
): entry is SectionAliasEntry {
  return "id" in entry && "alias" in entry;
}

export function isShEntry(entry: RawSectionEntry): entry is ShSectionEntry {
  return "id" in entry && "sh" in entry;
}

export function isBuiltinEntry(
  entry: RawSectionEntry,
): entry is BuiltinSectionEntry {
  return "id" in entry && "builtin" in entry;
}

export function isValueEntry(
  entry: RawSectionEntry,
): entry is ValueSectionEntry {
  return (
    "id" in entry &&
    "value" in entry &&
    !("sh" in entry) &&
    !("builtin" in entry)
  );
}
