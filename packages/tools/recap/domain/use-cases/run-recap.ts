// run-recap use case — orchestrates resolve → collect → render

import type { RawConfig, RecapConfig } from "../entities/config.ts";
import type { SectionData } from "../entities/section-data.ts";
import type { Palette } from "../entities/color.ts";
import type { ShellRunner } from "../ports/shell-runner.ts";
import type { GitInfoProvider } from "../ports/git-info.ts";
import type { Environment } from "../ports/environment.ts";
import type { FileSystem } from "../ports/filesystem.ts";
import type { ConfigResolver } from "../ports/config-resolver.ts";
import { resolveConfig } from "./resolve-config.ts";
import { collectSections } from "./collect-sections.ts";
import { renderRecap } from "./render-recap.ts";
import { RecapError } from "../entities/errors.ts";

/** Options for a full recap run. */
export type RunRecapOptions = {
  /** Explicit config path (skips auto-discovery). */
  readonly configPath?: string;
  /** Disable color output. */
  readonly noColor?: boolean;
  /** Output as JSON instead of formatted text. */
  readonly json?: boolean;
  /** Override working directory for config discovery and shell commands. */
  readonly cwd?: string;
  /** Restrict execution to these resolved section IDs, in this order. */
  readonly sectionIds?: readonly string[];
  /**
   * Whether colors are enabled for this run. Propagated down to subcommands
   * (via FORCE_COLOR / CLICOLOR_FORCE or NO_COLOR env vars) and to the git-log
   * built-in (via `git -c color.ui=always`).
   */
  readonly useColor: boolean;
};

/** Injected dependencies (ports) required by runRecap. */
export type RunRecapDependencies = {
  /** Shell command executor. */
  readonly shell: ShellRunner;
  /** Git built-in provider. */
  readonly git: GitInfoProvider;
  /** Process environment access. */
  readonly env: Environment;
  /** File system operations. */
  readonly fs: FileSystem;
  /** YAML config loader. */
  readonly configResolver: ConfigResolver;
};

/** Config file source loaded during discovery. */
export type LoadedConfigSource = {
  readonly kind: "explicit" | "global" | "local";
  readonly path: string;
  readonly config: RawConfig;
};

/** Result of loading config files before resolving refs and env overrides. */
export type LoadedRecapConfig = {
  readonly rawGlobalConfig: RawConfig | null;
  readonly rawLocalConfig: RawConfig | null;
  readonly sources: readonly LoadedConfigSource[];
};

/** Result of a full recap run, containing collected sections and rendered text. */
export type RunRecapResult = {
  /** Collected section data from all configured sections. */
  readonly sections: readonly SectionData[];
  /** Rendered text output (formatted or plain). */
  readonly text: string;
};

const CONFIG_FILENAMES = ["recap.yaml", "recap.yml"] as const;

function configCandidates(root: string): string[] {
  return CONFIG_FILENAMES.map((filename) => `${root}/.config/${filename}`);
}

async function loadFirstExistingConfig(
  kind: LoadedConfigSource["kind"],
  paths: readonly string[],
  configResolver: ConfigResolver,
): Promise<LoadedConfigSource | null> {
  for (const path of paths) {
    const config = await configResolver.loadConfig(path);
    if (config !== null) {
      return { kind, path, config };
    }
  }
  return null;
}

/**
 * Load config files using the same discovery rules as a normal recap run.
 */
export async function loadRecapConfig(
  options: Pick<RunRecapOptions, "configPath" | "cwd">,
  deps: Pick<RunRecapDependencies, "env" | "configResolver">,
): Promise<LoadedRecapConfig> {
  const cwd = options.cwd ?? deps.env.cwd();
  const home = deps.env.home();
  const sources: LoadedConfigSource[] = [];

  let rawGlobalConfig: RawConfig | null = null;
  let rawLocalConfig: RawConfig | null = null;

  if (options.configPath) {
    const config = await deps.configResolver.loadConfig(options.configPath);
    if (config !== null) {
      rawLocalConfig = config;
      sources.push({
        kind: "explicit",
        path: options.configPath,
        config,
      });
    }
  } else {
    if (home) {
      const globalSource = await loadFirstExistingConfig(
        "global",
        configCandidates(home),
        deps.configResolver,
      );
      if (globalSource !== null) {
        rawGlobalConfig = globalSource.config;
        sources.push(globalSource);
      }
    }

    const localSource = await loadFirstExistingConfig(
      "local",
      configCandidates(cwd),
      deps.configResolver,
    );
    if (localSource !== null) {
      rawLocalConfig = localSource.config;
      sources.push(localSource);
    }
  }

  return {
    rawGlobalConfig,
    rawLocalConfig,
    sources,
  };
}

function envOverridesFrom(env: Environment): Record<string, string> {
  const envOverrides: Record<string, string> = {};
  const maxCommits = env.getEnv("MAX_COMMITS");
  if (maxCommits) envOverrides["MAX_COMMITS"] = maxCommits;
  const maxWorktasks = env.getEnv("MAX_WORKTASKS");
  if (maxWorktasks) envOverrides["MAX_WORKTASKS"] = maxWorktasks;
  return envOverrides;
}

function selectSectionsById(
  config: RecapConfig,
  sectionIds: readonly string[] | undefined,
): RecapConfig {
  if (sectionIds === undefined || sectionIds.length === 0) {
    return config;
  }

  const byId = new Map(config.sections.map((section) => [section.id, section]));
  const missing = sectionIds.filter((sectionId) => !byId.has(sectionId));
  if (missing.length > 0) {
    const quoted = missing.map((sectionId) => `"${sectionId}"`).join(", ");
    const label = missing.length === 1 ? "section" : "sections";
    throw new RecapError(
      "config_validation_error",
      `${label} ${quoted} not found`,
    );
  }

  return {
    ...config,
    sections: sectionIds.map((sectionId) => {
      const section = byId.get(sectionId);
      if (section === undefined) {
        throw new RecapError(
          "config_validation_error",
          `section "${sectionId}" not found`,
        );
      }
      return section;
    }),
  };
}

/**
 * Full recap run: resolve config → collect sections → render.
 */
export async function runRecap(
  options: RunRecapOptions,
  deps: RunRecapDependencies,
  palette: Palette,
): Promise<RunRecapResult> {
  // Use explicit cwd if provided, otherwise fall back to the env cwd
  const cwd = options.cwd ?? deps.env.cwd();
  const loadedConfig = await loadRecapConfig(options, deps);

  const config: RecapConfig = resolveConfig({
    rawGlobalConfig: loadedConfig.rawGlobalConfig,
    rawLocalConfig: loadedConfig.rawLocalConfig,
    envOverrides: envOverridesFrom(deps.env),
  });

  const selectedConfig = selectSectionsById(config, options.sectionIds);

  const sections = await collectSections(selectedConfig, {
    shell: deps.shell,
    git: deps.git,
    cwd,
    useColor: options.useColor,
  });

  const text = renderRecap(sections, palette);

  return { sections, text };
}
