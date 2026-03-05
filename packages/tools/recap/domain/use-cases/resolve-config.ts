// resolve-config use case — merges defaults + global + local config, resolves ref: entries

import type {
  RawConfig,
  RawSectionEntry,
  RecapConfig,
  ResolvedSection,
} from "../entities/config.ts";
import {
  isBuiltinEntry,
  isRefEntry,
  isShEntry,
  isValueEntry,
} from "../entities/config.ts";
import { HARDCODED_SECTIONS } from "../entities/default-config.ts";
import { RecapError } from "../entities/errors.ts";

// Options for resolveConfig
export type ResolveConfigOptions = {
  /** Explicit config path — skips global/local resolution */
  readonly configPath?: string;
  /** Global config path (e.g. ~/.config/recap.yaml) */
  readonly globalConfigPath?: string;
  /** Local config path (e.g. ./.config/recap.yaml) */
  readonly localConfigPath?: string;
  /** Raw config already loaded (useful for testing) */
  readonly rawGlobalConfig?: RawConfig | null;
  /** Raw config already loaded (useful for testing) */
  readonly rawLocalConfig?: RawConfig | null;
  /** Env vars already resolved (for MAX_COMMITS, MAX_WORKTASKS overrides etc.) */
  readonly envOverrides?: Readonly<Record<string, string>>;
};

/**
 * Resolve a raw section entry against a parent map.
 * A ref entry copies all fields from the parent and merges overrides.
 */
function resolveEntry(
  entry: RawSectionEntry,
  parentById: ReadonlyMap<string, ResolvedSection>,
): ResolvedSection {
  if (!isRefEntry(entry)) {
    // Direct section — convert to ResolvedSection
    if (isShEntry(entry)) {
      return {
        id: entry.id,
        sh: entry.sh,
        title: entry.title,
        max_lines: entry.max_lines,
        separator: entry.separator,
        env: entry.env,
        cwd: entry.cwd,
      };
    }
    if (isBuiltinEntry(entry)) {
      return {
        id: entry.id,
        builtin: entry.builtin,
        title: entry.title,
        max_lines: entry.max_lines,
        separator: entry.separator,
      };
    }
    if (isValueEntry(entry)) {
      return {
        id: entry.id,
        value: entry.value,
        title: entry.title,
        max_lines: entry.max_lines,
        separator: entry.separator,
      };
    }
    throw new RecapError(
      "config_validation_error",
      `Section must have one of: sh, builtin, value`,
    );
  }

  // ref: entry — look up parent
  const { ref, ...overrides } = entry;

  if (ref === "*") {
    // ref: "*" is handled at the list level, not here
    throw new RecapError(
      "config_validation_error",
      `ref: "*" cannot be used in single-entry resolution`,
    );
  }

  const parent = parentById.get(ref);
  if (!parent) {
    throw new RecapError(
      "ref_not_found",
      `ref: "${ref}" not found in parent config`,
    );
  }

  // Merge: parent fields + any overrides (sh, value, etc.)
  const merged: ResolvedSection = {
    id: parent.id,
    sh: overrides.sh ?? parent.sh,
    builtin: overrides.builtin === "git-ops" || overrides.builtin === "git-log"
      ? overrides.builtin
      : parent.builtin,
    value: overrides.value ?? parent.value,
    title: overrides.title ?? parent.title,
    max_lines: overrides.max_lines ?? parent.max_lines,
    separator: overrides.separator ?? parent.separator,
    env: overrides.env ?? parent.env,
    cwd: overrides.cwd ?? parent.cwd,
  };

  return merged;
}

/**
 * Expand a list of raw entries against a parent map.
 * ref:"*" expands to all parent sections (in order) with optional per-entry overrides.
 */
function expandEntries(
  entries: readonly RawSectionEntry[],
  parentById: ReadonlyMap<string, ResolvedSection>,
  parentOrder: readonly ResolvedSection[],
): ResolvedSection[] {
  const result: ResolvedSection[] = [];

  for (const entry of entries) {
    if (isRefEntry(entry) && entry.ref === "*") {
      // Expand all parent sections, applying any overrides from this ref entry
      const { ref: _ref, ...overrides } = entry;
      for (const parentSection of parentOrder) {
        const merged: ResolvedSection = {
          id: parentSection.id,
          sh: overrides.sh ?? parentSection.sh,
          builtin:
            overrides.builtin === "git-ops" || overrides.builtin === "git-log"
              ? overrides.builtin
              : parentSection.builtin,
          value: overrides.value ?? parentSection.value,
          title: overrides.title ?? parentSection.title,
          max_lines: overrides.max_lines ?? parentSection.max_lines,
          separator: overrides.separator ?? parentSection.separator,
          env: overrides.env ?? parentSection.env,
          cwd: overrides.cwd ?? parentSection.cwd,
        };
        result.push(merged);
      }
    } else {
      result.push(resolveEntry(entry, parentById));
    }
  }

  return result;
}

/**
 * Build a lookup map from id to ResolvedSection.
 */
function buildParentMap(
  sections: readonly ResolvedSection[],
): ReadonlyMap<string, ResolvedSection> {
  const map = new Map<string, ResolvedSection>();
  for (const section of sections) {
    map.set(section.id, section);
  }
  return map;
}

/**
 * Apply MAX_COMMITS and MAX_WORKTASKS environment overrides to sections.
 */
function applyEnvOverrides(
  sections: readonly ResolvedSection[],
  envOverrides: Readonly<Record<string, string>>,
): ResolvedSection[] {
  const maxCommits = envOverrides["MAX_COMMITS"];
  const maxWorktasks = envOverrides["MAX_WORKTASKS"];

  return sections.map((section) => {
    if (section.id === "git-log" && maxCommits !== undefined) {
      const n = parseInt(maxCommits, 10);
      if (!isNaN(n)) {
        return { ...section, max_lines: n };
      }
    }
    if (section.id === "worktasks" && maxWorktasks !== undefined) {
      const n = parseInt(maxWorktasks, 10);
      if (!isNaN(n)) {
        return { ...section, max_lines: n };
      }
    }
    return section;
  });
}

/**
 * Merge env vars from raw configs (dotenv entries are resolved by the caller).
 */
function mergeEnvVars(
  globalConfig: RawConfig | null,
  localConfig: RawConfig | null,
): Record<string, string> {
  // dotenv paths are resolved by adapters — here we only merge explicit env vars
  // The actual dotenv loading happens in the adapter layer.
  // We return an empty record; adapters populate it.
  void globalConfig;
  void localConfig;
  return {};
}

/**
 * Resolve the full config from:
 * 1. Hardcoded defaults
 * 2. Global config (ref: resolves against hardcoded)
 * 3. Local config (ref: resolves against global+hardcoded)
 *
 * Returns a RecapConfig ready for collection.
 */
export function resolveConfig(options: ResolveConfigOptions): RecapConfig {
  const {
    rawGlobalConfig,
    rawLocalConfig,
    envOverrides = {},
  } = options;

  // Layer 1: hardcoded defaults
  let currentSections: ResolvedSection[] = [...HARDCODED_SECTIONS];

  // Layer 2: global config
  if (rawGlobalConfig?.sections) {
    const parentMap = buildParentMap(currentSections);
    currentSections = expandEntries(
      rawGlobalConfig.sections,
      parentMap,
      currentSections,
    );
  }

  // Layer 3: local config
  if (rawLocalConfig?.sections) {
    const parentMap = buildParentMap(currentSections);
    currentSections = expandEntries(
      rawLocalConfig.sections,
      parentMap,
      currentSections,
    );
  }

  // Apply env overrides
  currentSections = applyEnvOverrides(currentSections, envOverrides);

  const envVars = mergeEnvVars(rawGlobalConfig ?? null, rawLocalConfig ?? null);

  return {
    sections: currentSections,
    envVars,
  };
}

// Export for testing
export { expandEntries, resolveEntry };
