// collect-sections use case — runs all sections concurrently, returns SectionData[]

import type { RecapConfig, ResolvedSection } from "../entities/config.ts";
import type { SectionData } from "../entities/section-data.ts";
import type { ShellRunner } from "../ports/shell-runner.ts";
import type { GitInfoProvider } from "../ports/git-info.ts";

/** External dependencies needed to execute sections during collection. */
export type CollectSectionsProviders = {
  /** Shell command executor. */
  readonly shell: ShellRunner;
  /** Git built-in provider. */
  readonly git: GitInfoProvider;
  /** Working directory for shell commands. */
  readonly cwd: string;
  /** Additional environment variables injected into every command. */
  readonly globalEnv?: Readonly<Record<string, string>>;
  /**
   * Whether color output is enabled for this run.
   * - true  → inject FORCE_COLOR=1 / CLICOLOR_FORCE=1 into every shell section
   *           and ask the git-log builtin to emit ANSI colors.
   * - false → inject NO_COLOR=1 into every shell section (and skip color flags).
   * Section-level `env:` always wins over these defaults.
   */
  readonly useColor: boolean;
};

/**
 * Build the color-forcing env injected into every shell section.
 * Two de-facto standards are emitted simultaneously:
 *   - FORCE_COLOR (Node and many JS tools)
 *   - CLICOLOR_FORCE (BSD/macOS coreutils)
 * git ignores both, so GIT_CONFIG_COUNT/KEY_0/VALUE_0 are also injected
 * to set `color.ui=always` for any `git` subcommand (requires git ≥ 2.31).
 * When colors are disabled, NO_COLOR is propagated instead — git ≥ 2.27
 * honors it natively, so no git-specific override is needed on that path.
 */
function colorEnvFor(useColor: boolean): Record<string, string> {
  return useColor
    ? {
      FORCE_COLOR: "1",
      CLICOLOR_FORCE: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "color.ui",
      GIT_CONFIG_VALUE_0: "always",
    }
    : { NO_COLOR: "1" };
}

/**
 * Interpolate ${VAR} placeholders in a string using the given env map.
 */
function interpolate(
  text: string,
  env: Readonly<Record<string, string>>,
): string {
  return text.replace(/\$\{([^}]+)\}/g, (_match, key) => {
    return env[key] ?? _match;
  });
}

/**
 * Truncate lines array to max_lines if set.
 */
function applyMaxLines(
  lines: readonly string[],
  maxLines: number | undefined,
): readonly string[] {
  if (maxLines === undefined || lines.length <= maxLines) {
    return lines;
  }
  const truncated = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;
  return [...truncated, `... (${remaining} more lines)`];
}

/**
 * Execute a single resolved section and return SectionData.
 */
async function executeSection(
  section: ResolvedSection,
  providers: CollectSectionsProviders,
  globalEnv: Readonly<Record<string, string>>,
): Promise<SectionData> {
  const separator = section.separator ?? "blank_line";

  // Precedence (lowest → highest): colorEnv → globalEnv → section.env.
  // Section-level `env:` is always allowed to override the injected defaults.
  const colorEnv = colorEnvFor(providers.useColor);

  try {
    if (section.sh !== undefined) {
      // Shell command section
      const envForCommand = {
        ...colorEnv,
        ...globalEnv,
        ...(section.env ?? {}),
      };
      const result = await providers.shell.run(section.sh, {
        env: envForCommand,
        cwd: section.cwd ?? providers.cwd,
      });

      if (result.exitCode !== 0 && result.stdout.trim() === "") {
        return {
          id: section.id,
          title: section.title,
          lines: [],
          separator,
          error: result.stderr.trim() || `exit code ${result.exitCode}`,
        };
      }

      const rawLines = result.stdout.split("\n").filter((l) => l.length > 0);
      const lines = applyMaxLines(rawLines, section.max_lines);

      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    if (section.builtin === "git-subdir") {
      const { display } = await providers.git.getGitSubdir(
        section.cwd ?? providers.cwd,
      );
      const lines = display ? [display] : [];
      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    if (section.builtin === "git-ops") {
      const { operation } = await providers.git.getGitOps(
        section.cwd ?? providers.cwd,
      );
      const lines = operation ? [operation] : [];
      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    if (section.builtin === "git-log") {
      const maxLines = section.max_lines ?? 6;
      const { lines: rawLines } = await providers.git.getGitLog(
        section.cwd ?? providers.cwd,
        maxLines,
        providers.useColor,
      );
      const lines = applyMaxLines(rawLines, section.max_lines);
      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    if (section.builtin === "git-stash") {
      const { lines: rawLines } = await providers.git.getGitStash(
        section.cwd ?? providers.cwd,
      );
      const lines = applyMaxLines(rawLines, section.max_lines);
      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    if (
      section.builtin === "git-status" ||
      section.builtin === "git-status-local"
    ) {
      const { lines: rawLines } = await providers.git.getGitStatus(
        section.cwd ?? providers.cwd,
        section.builtin === "git-status-local",
        providers.useColor,
      );
      const lines = applyMaxLines(rawLines, section.max_lines);
      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    if (section.value !== undefined) {
      // Static text with interpolation
      const text = interpolate(section.value, {
        ...globalEnv,
        ...(section.env ?? {}),
      });
      const rawLines = text.split("\n").filter((l) => l.length > 0);
      const lines = applyMaxLines(rawLines, section.max_lines);
      return {
        id: section.id,
        title: section.title,
        lines,
        separator,
      };
    }

    return {
      id: section.id,
      title: section.title,
      lines: [],
      separator,
      error: "section has no sh, builtin, or value",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: section.id,
      title: section.title,
      lines: [],
      separator,
      error: message,
    };
  }
}

/**
 * Run all sections concurrently and return their collected data.
 */
export async function collectSections(
  config: RecapConfig,
  providers: CollectSectionsProviders,
): Promise<SectionData[]> {
  const globalEnv = { ...config.envVars, ...(providers.globalEnv ?? {}) };
  const promises = config.sections.map((section) =>
    executeSection(section, providers, globalEnv)
  );
  return await Promise.all(promises);
}
