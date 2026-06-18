// Config Zod schemas — internal use only (not exported from mod.ts)
// Used by yaml-config-resolver adapter for YAML validation.

import { z } from "@zod/zod/mini";
import type { RawConfig } from "./config.ts";

// Internal Zod schemas (never exported — avoids no-slow-types lint errors)

const separatorSchema = z.enum(["blank_line", "none", "line"]);

const shSectionSchema = z.object({
  id: z.string(),
  sh: z.string(),
  title: z.optional(z.string()),
  max_lines: z.optional(z.number()),
  separator: z.optional(separatorSchema),
  env: z.optional(z.record(z.string(), z.string())),
  cwd: z.optional(z.string()),
});

const builtinSectionSchema = z.object({
  id: z.string(),
  builtin: z.enum([
    "status",
    "git-ops",
    "git-log",
    "git-stash",
    "git-status",
    "git-status-local",
    "git-subdir",
  ]),
  title: z.optional(z.string()),
  max_lines: z.optional(z.number()),
  separator: z.optional(separatorSchema),
});

const valueSectionSchema = z.object({
  id: z.string(),
  value: z.string(),
  title: z.optional(z.string()),
  max_lines: z.optional(z.number()),
  separator: z.optional(separatorSchema),
});

const refSectionSchema = z.object({
  ref: z.string(),
  title: z.optional(z.string()),
  max_lines: z.optional(z.number()),
  separator: z.optional(separatorSchema),
  sh: z.optional(z.string()),
  builtin: z.optional(z.string()),
  value: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  cwd: z.optional(z.string()),
});

const aliasSectionSchema = z.object({
  id: z.string(),
  alias: z.string(),
  deprecated: z.optional(z.boolean()),
});

const rawSectionEntrySchema = z.union([
  shSectionSchema,
  builtinSectionSchema,
  valueSectionSchema,
  refSectionSchema,
  aliasSectionSchema,
]);

const shStatusEnricherSchema = z.object({
  id: z.string(),
  sh: z.string(),
  format: z.enum(["tsv"]),
  env: z.optional(z.record(z.string(), z.string())),
  cwd: z.optional(z.string()),
});

const builtinStatusEnricherSchema = z.object({
  id: z.string(),
  builtin: z.enum(["git-stats"]),
  format: z.enum(["tsv"]),
});

const statusEnricherSchema = z.union([
  shStatusEnricherSchema,
  builtinStatusEnricherSchema,
]);

const rawConfigSchema = z.object({
  dotenv: z.optional(z.array(z.string())),
  sections: z.optional(z.array(rawSectionEntrySchema)),
  status_enrichers: z.optional(z.array(statusEnricherSchema)),
});

type ParsedRawConfig = z.infer<typeof rawConfigSchema>;

/**
 * Structural adapter: Zod inferred type → domain RawConfig type.
 * Both are structurally identical; this avoids type assertions.
 */
function toRawConfig(parsed: ParsedRawConfig): RawConfig {
  return {
    dotenv: parsed.dotenv,
    sections: parsed.sections,
    status_enrichers: parsed.status_enrichers,
  };
}

/** Parse raw YAML data into a RawConfig (throws ZodError on validation failure). */
export function parseRawConfig(data: unknown): RawConfig {
  return toRawConfig(rawConfigSchema.parse(data));
}
