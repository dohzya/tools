// collect-sections use case — runs all sections concurrently, returns SectionData[]

import type {
  RecapConfig,
  ResolvedSection,
  StatusEnricherEntry,
} from "../entities/config.ts";
import type { SectionData } from "../entities/section-data.ts";
import type { ShellRunner } from "../ports/shell-runner.ts";
import type { GitInfoProvider, GitStatusEntry } from "../ports/git-info.ts";

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

function parseTsvEnricherOutput(stdout: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const separator = line.indexOf("\t");
    if (separator <= 0) continue;
    const path = line.slice(0, separator);
    const text = line.slice(separator + 1);
    if (text.length > 0) {
      entries.set(path, text);
    }
  }
  return entries;
}

async function collectStatusEnrichments(
  enrichers: readonly StatusEnricherEntry[],
  entries: readonly GitStatusEntry[],
  providers: CollectSectionsProviders,
  globalEnv: Readonly<Record<string, string>>,
  cwd: string,
  colorEnv: Readonly<Record<string, string>>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const wantedPaths = new Set(entries.map((entry) => entry.path));
  const enrichments = new Map<string, string[]>();

  if (wantedPaths.size === 0) {
    return enrichments;
  }

  for (const enricher of enrichers) {
    if ("builtin" in enricher) {
      if (enricher.builtin === "git-stats") {
        for (const entry of entries) {
          if (entry.stats === undefined) continue;
          const existing = enrichments.get(entry.path) ?? [];
          enrichments.set(entry.path, [...existing, entry.stats]);
        }
      }
      continue;
    }

    const result = await providers.shell.run(enricher.sh, {
      env: {
        ...colorEnv,
        ...globalEnv,
        ...(enricher.env ?? {}),
      },
      cwd: enricher.cwd ?? cwd,
    });
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      throw new Error(result.stderr.trim() || `exit code ${result.exitCode}`);
    }

    const parsed = parseTsvEnricherOutput(result.stdout);
    for (const [path, text] of parsed) {
      if (!wantedPaths.has(path)) continue;
      const existing = enrichments.get(path) ?? [];
      enrichments.set(path, [...existing, text]);
    }
  }

  return enrichments;
}

function appendStatusEnrichments(
  lines: readonly string[],
  entries: readonly GitStatusEntry[],
  enrichments: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  let entryIndex = 0;
  return lines.map((line) => {
    const entry = entries[entryIndex];
    if (entry === undefined || entry.line !== line) {
      return line;
    }
    entryIndex += 1;

    const suffixes = enrichments.get(entry.path);
    if (suffixes === undefined || suffixes.length === 0) {
      return line;
    }
    return `${line} ${suffixes.join(" ")}`;
  });
}

/**
 * Execute a single resolved section and return SectionData.
 */
async function executeSection(
  config: RecapConfig,
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
      section.builtin === "status" ||
      section.builtin === "git-status" ||
      section.builtin === "git-status-local"
    ) {
      const cwd = section.cwd ?? providers.cwd;
      const { lines: rawLines, entries = [] } = await providers.git
        .getGitStatus(
          cwd,
          section.builtin === "status" ||
            section.builtin === "git-status-local",
          providers.useColor,
        );
      const enrichments = await collectStatusEnrichments(
        config.statusEnrichers ?? [],
        entries,
        providers,
        globalEnv,
        cwd,
        colorEnv,
      );
      const enrichedLines = appendStatusEnrichments(
        rawLines,
        entries,
        enrichments,
      );
      const lines = applyMaxLines(enrichedLines, section.max_lines);
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
    executeSection(config, section, providers, globalEnv)
  );
  return await Promise.all(promises);
}
