import { WtError } from "./errors.ts";

export const DEFAULT_PURGE_TTL_DAYS = 30;

/** Validates a TTL coming from `source` (CLI flag, env var or config file). */
export function parsePurgeTtlDays(value: unknown, source: string): number {
  const n = typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new WtError(
      "invalid_args",
      `${source}: purge TTL must be a positive integer (days), got ${
        JSON.stringify(value)
      }`,
    );
  }
  return n;
}

export type PurgeTtlSources = {
  readonly cli?: number;
  readonly env?: number;
  readonly local?: number;
  readonly global?: number;
};

/** Most specific source wins: CLI flag > env var > local config > global config. */
export function resolvePurgeTtlDays(sources: PurgeTtlSources): number {
  return sources.cli ?? sources.env ?? sources.local ?? sources.global ??
    DEFAULT_PURGE_TTL_DAYS;
}
