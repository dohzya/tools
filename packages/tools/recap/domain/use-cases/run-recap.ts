// run-recap use case — orchestrates resolve → collect → render

import type { RecapConfig } from "../entities/config.ts";
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

export type RunRecapOptions = {
  /** Explicit config path (skips auto-discovery) */
  readonly configPath?: string;
  /** Disable color output */
  readonly noColor?: boolean;
  /** Output as JSON instead of formatted text */
  readonly json?: boolean;
  /** Override working directory for config discovery and shell commands */
  readonly cwd?: string;
};

export type RunRecapDependencies = {
  readonly shell: ShellRunner;
  readonly git: GitInfoProvider;
  readonly env: Environment;
  readonly fs: FileSystem;
  readonly configResolver: ConfigResolver;
};

export type RunRecapResult = {
  readonly sections: readonly SectionData[];
  readonly text: string;
};

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
  const home = deps.env.home();

  // Determine config paths
  let rawGlobalConfig = null;
  let rawLocalConfig = null;

  if (options.configPath) {
    // Explicit config path — treat as local
    rawLocalConfig = await deps.configResolver.loadConfig(options.configPath);
  } else {
    // Auto-discovery
    if (home) {
      const globalPath = `${home}/.config/recap.yaml`;
      rawGlobalConfig = await deps.configResolver.loadConfig(globalPath);
    }
    const localPath = `${cwd}/.config/recap.yaml`;
    rawLocalConfig = await deps.configResolver.loadConfig(localPath);
  }

  // Resolve env overrides
  const envOverrides: Record<string, string> = {};
  const maxCommits = deps.env.getEnv("MAX_COMMITS");
  if (maxCommits) envOverrides["MAX_COMMITS"] = maxCommits;
  const maxWorktasks = deps.env.getEnv("MAX_WORKTASKS");
  if (maxWorktasks) envOverrides["MAX_WORKTASKS"] = maxWorktasks;

  const config: RecapConfig = resolveConfig({
    rawGlobalConfig,
    rawLocalConfig,
    envOverrides,
  });

  const sections = await collectSections(config, {
    shell: deps.shell,
    git: deps.git,
    cwd,
  });

  const text = renderRecap(sections, palette);

  return { sections, text };
}
