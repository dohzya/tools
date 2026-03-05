// collect-sections use case — runs all sections concurrently, returns SectionData[]

import type { RecapConfig, ResolvedSection } from "../entities/config.ts";
import type { SectionData } from "../entities/section-data.ts";
import type { ShellRunner } from "../ports/shell-runner.ts";
import type { GitInfoProvider } from "../ports/git-info.ts";

export type CollectSectionsProviders = {
  readonly shell: ShellRunner;
  readonly git: GitInfoProvider;
  readonly cwd: string;
  readonly globalEnv?: Readonly<Record<string, string>>;
};

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

  try {
    if (section.sh !== undefined) {
      // Shell command section
      const envForCommand = { ...globalEnv, ...(section.env ?? {}) };
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
