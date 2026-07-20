import * as path from "node:path";
import * as childProcess from "node:child_process";

export const DZ_REVIEW_STATE_DIR_ENV = "DZ_REVIEW_STATE_DIR";
export const DZ_REVIEW_IGNORE_FILE_ENV = "DZ_REVIEW_IGNORE_FILE";
export const DEFAULT_DZ_REVIEW_STATE_DIR = ".dz-review";
export const DEFAULT_DZ_REVIEW_IGNORE_FILE = ".dz-review-ignore";

/**
 * Port over the raw `Deno.env.get`/`Deno.cwd()` primitives this module
 * needs. Lets a non-Deno host (e.g. the VSCode extension, which has no
 * `Deno` global) supply its own implementation via `configureDzReviewRuntime`
 * instead of this file touching `Deno.*` directly.
 */
export interface DzReviewEnvironment {
  getEnv(key: string): string | undefined;
  getCwd(): string;
}

const defaultEnvironment: DzReviewEnvironment = {
  getEnv: (key) => Deno.env.get(key),
  getCwd: () => Deno.cwd(),
};

interface DzReviewRuntimeConfig {
  ignoreFile?: string;
  stateDir?: string;
  environment?: DzReviewEnvironment;
}

let activeConfig: DzReviewRuntimeConfig = {};

export function configureDzReviewRuntime(
  config: DzReviewRuntimeConfig,
): void {
  activeConfig = { ...config };
}

function getEnvironment(): DzReviewEnvironment {
  return activeConfig.environment ?? defaultEnvironment;
}

export function getDzReviewStateDir(): string {
  const environment = getEnvironment();
  const configured = normalizeConfiguredPathCandidate(
    activeConfig.stateDir,
    environment.getEnv(DZ_REVIEW_STATE_DIR_ENV),
  );
  if (configured) {
    return configured;
  }

  const gitRoot = findGitRoot();
  if (gitRoot && path.resolve(gitRoot) !== path.resolve(environment.getCwd())) {
    return path.join(gitRoot, DEFAULT_DZ_REVIEW_STATE_DIR);
  }

  return path.normalize(DEFAULT_DZ_REVIEW_STATE_DIR);
}

export function getDzReviewSessionFile(): string {
  return path.join(getDzReviewStateDir(), "agent-session.json");
}

export function getDzReviewReferenceMapFile(): string {
  return path.join(getDzReviewStateDir(), "reference-map.json");
}

export function getDzReviewIgnoreFile(): string {
  return normalizeConfigPathCandidate(
    activeConfig.ignoreFile,
    getEnvironment().getEnv(DZ_REVIEW_IGNORE_FILE_ENV),
    DEFAULT_DZ_REVIEW_IGNORE_FILE,
  );
}

function normalizeConfiguredPathCandidate(
  cliValue: string | undefined,
  envValue: string | undefined,
): string | undefined {
  for (const value of [cliValue, envValue]) {
    const normalized = value?.trim();
    if (normalized) {
      return path.normalize(normalized);
    }
  }
  return undefined;
}

export function findGitRoot(): string | undefined {
  const result = childProcess.spawnSync("git", [
    "rev-parse",
    "--show-toplevel",
  ], {
    cwd: getEnvironment().getCwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return undefined;
  }

  const root = result.stdout.trim();
  return root.length > 0 ? root : undefined;
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
  const relative = path.isAbsolute(dir)
    ? path.relative(getEnvironment().getCwd(), dir)
    : dir;
  const normalized = relative.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.length > 0 ? `${normalized}/` : "./";
}
