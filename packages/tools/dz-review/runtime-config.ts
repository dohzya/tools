import * as path from "node:path";

export const DZ_REVIEW_STATE_DIR_ENV = "DZ_REVIEW_STATE_DIR";
export const DZ_REVIEW_IGNORE_FILE_ENV = "DZ_REVIEW_IGNORE_FILE";
export const DEFAULT_DZ_REVIEW_STATE_DIR = ".dz-review";
export const DEFAULT_DZ_REVIEW_IGNORE_FILE = ".dz-review-ignore";

interface DzReviewRuntimeConfig {
  ignoreFile?: string;
  stateDir?: string;
}

let activeConfig: DzReviewRuntimeConfig = {};

export function configureDzReviewRuntime(
  config: DzReviewRuntimeConfig,
): void {
  activeConfig = { ...config };
}

export function getDzReviewStateDir(): string {
  return normalizeConfigPathCandidate(
    activeConfig.stateDir,
    Deno.env.get(DZ_REVIEW_STATE_DIR_ENV),
    DEFAULT_DZ_REVIEW_STATE_DIR,
  );
}

export function getDzReviewSessionFile(): string {
  return path.join(getDzReviewStateDir(), "agent-session.json");
}

export function getDzReviewIgnoreFile(): string {
  return normalizeConfigPathCandidate(
    activeConfig.ignoreFile,
    Deno.env.get(DZ_REVIEW_IGNORE_FILE_ENV),
    DEFAULT_DZ_REVIEW_IGNORE_FILE,
  );
}

export function getDzReviewDefaultIgnorePatterns(): string[] {
  const stateDir = toDirectoryIgnorePattern(getDzReviewStateDir());
  const defaultStateDir = toDirectoryIgnorePattern(DEFAULT_DZ_REVIEW_STATE_DIR);
  return [...new Set([defaultStateDir, stateDir])];
}

function normalizeConfigPathCandidate(
  cliValue: string | undefined,
  envValue: string | undefined,
  defaultValue: string,
): string {
  for (const value of [cliValue, envValue, defaultValue]) {
    const normalized = value?.trim();
    if (normalized) {
      return path.normalize(normalized);
    }
  }
  return path.normalize(defaultValue);
}

function toDirectoryIgnorePattern(dir: string): string {
  const relative = path.isAbsolute(dir) ? path.relative(Deno.cwd(), dir) : dir;
  const normalized = relative.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.length > 0 ? `${normalized}/` : "./";
}
