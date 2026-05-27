/**
 * Recap CLI — command-line interface for generating context snapshots.
 *
 * @module
 */

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { stringify as stringifyYaml } from "@std/yaml";
import { createPalette } from "./domain/entities/color.ts";
import type {
  RawConfig,
  RecapConfig,
  ResolvedSection,
} from "./domain/entities/config.ts";
import {
  type LoadedConfigSource,
  loadRecapConfig,
  runRecap,
} from "./domain/use-cases/run-recap.ts";
import { resolveConfig } from "./domain/use-cases/resolve-config.ts";
import { generateConfigContent } from "./domain/use-cases/init-config.ts";
import { HARDCODED_SECTIONS } from "./domain/entities/default-config.ts";
import { DenoFileSystem } from "./adapters/filesystem/deno-fs.ts";
import { DenoEnvironment } from "./adapters/environment/deno-environment.ts";
import { DaxShellRunner } from "./adapters/shell/dax-shell-runner.ts";
import { DenoGitInfo } from "./adapters/git/deno-git-info.ts";
import { YamlConfigResolver } from "./adapters/config/yaml-config-resolver.ts";
import { formatRecapJson } from "./adapters/cli/formatter.ts";
import { join, resolve } from "node:path";
import { RecapError } from "./domain/entities/errors.ts";
import { ExplicitCast } from "../explicit-cast.ts";

const VERSION = "0.2.0";

const fs = new DenoFileSystem();
const env = new DenoEnvironment();
const shell = new DaxShellRunner();
const git = new DenoGitInfo();
const configResolver = new YamlConfigResolver();

const deps = { shell, git, env, fs, configResolver };

/**
 * Global options available to all commands via .globalOption()
 * Note: Cliffy stores `-C <dir>` (short-only option) under the empty string key "".
 */
type GlobalOptions = {
  // Cliffy stores -C (short-only) as key "" in the options object
  "": string | undefined;
  config: string | undefined;
};

/** Downcast Cliffy's local options to include inherited global options */
function asGlobal<T extends object>(options: T): T & GlobalOptions {
  return ExplicitCast.from<T>(options).dangerousCast<T & GlobalOptions>();
}

/** Extract the -C option value from global options */
function getCwdOption(options: GlobalOptions): string | undefined {
  return options[""];
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  const record = ExplicitCast.from<unknown>(value)
    .dangerousCast<Record<string, unknown>>();
  const property = record[key];
  return typeof property === "string" ? property : undefined;
}

function globalOptionsFromUnknown(options: unknown): GlobalOptions {
  return {
    "": readStringProperty(options, ""),
    config: readStringProperty(options, "config"),
  };
}

function getCliContext(options: GlobalOptions): {
  readonly cwd: string | undefined;
  readonly configPath: string | undefined;
} {
  const cwdFlag = getCwdOption(options);
  return {
    cwd: cwdFlag ? resolve(cwdFlag) : undefined,
    configPath: options.config,
  };
}

function envOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {};
  const maxCommits = env.getEnv("MAX_COMMITS");
  if (maxCommits) overrides["MAX_COMMITS"] = maxCommits;
  const maxWorktasks = env.getEnv("MAX_WORKTASKS");
  if (maxWorktasks) overrides["MAX_WORKTASKS"] = maxWorktasks;
  return overrides;
}

function addDefined(
  output: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    output[key] = value;
  }
}

function sectionToYamlObject(
  section: ResolvedSection,
): Record<string, unknown> {
  const output: Record<string, unknown> = { id: section.id };
  addDefined(output, "sh", section.sh);
  addDefined(output, "builtin", section.builtin);
  addDefined(output, "value", section.value);
  addDefined(output, "title", section.title);
  addDefined(output, "max_lines", section.max_lines);
  addDefined(output, "separator", section.separator);
  addDefined(output, "env", section.env);
  addDefined(output, "cwd", section.cwd);
  return output;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        output[key] = removeUndefined(child);
      }
    }
    return output;
  }

  return value;
}

function rawConfigToYaml(config: RawConfig): string {
  return stringifyYaml(removeUndefined(config));
}

function configToYaml(config: RecapConfig): string {
  return stringifyYaml(removeUndefined({
    sections: config.sections.map(sectionToYamlObject),
  }));
}

function defaultConfigYaml(): string {
  return stringifyYaml(removeUndefined({
    sections: HARDCODED_SECTIONS.map(sectionToYamlObject),
  }));
}

async function loadResolvedConfig(
  options: GlobalOptions,
): Promise<RecapConfig> {
  const context = getCliContext(options);
  const loadedConfig = await loadRecapConfig(
    {
      configPath: context.configPath,
      cwd: context.cwd,
    },
    deps,
  );
  return resolveConfig({
    rawGlobalConfig: loadedConfig.rawGlobalConfig,
    rawLocalConfig: loadedConfig.rawLocalConfig,
    envOverrides: envOverrides(),
  });
}

async function loadConfigSources(
  options: GlobalOptions,
): Promise<readonly LoadedConfigSource[]> {
  const context = getCliContext(options);
  const loadedConfig = await loadRecapConfig(
    {
      configPath: context.configPath,
      cwd: context.cwd,
    },
    deps,
  );
  return [...loadedConfig.sources].reverse();
}

function formatConfigSource(
  source: LoadedConfigSource,
  verbose: boolean,
): string {
  if (!verbose) {
    return source.path;
  }
  const yaml = rawConfigToYaml(source.config).trimEnd();
  return `${source.kind}: ${source.path}\n${yaml}`;
}

function formatConfigFilesVerbose(
  sources: readonly LoadedConfigSource[],
): string {
  const sections = sources.map((source) => formatConfigSource(source, true));
  sections.push(`default: built-in\n${defaultConfigYaml().trimEnd()}`);
  return sections.join("\n\n");
}

/** CLI entry point — parses args and runs the recap command. */
export async function main(args: string[]): Promise<void> {
  const program = new Command()
    .name("recap")
    .version(VERSION)
    .description("Context snapshot for AI assistants")
    .globalOption(
      "-C <dir:string>",
      "Run as if started in <dir> (affects config discovery and shell commands)",
    )
    .globalOption(
      "--config <path:string>",
      "Explicit config path (skip auto-discovery)",
    )
    .globalOption("--no-color", "Disable ANSI color output")
    .option("--json", "Output as JSON instead of formatted text")
    .action(async (options) => {
      const globalOpts = asGlobal(options);
      const context = getCliContext(globalOpts);

      const noColor = options.color === false ||
        !!env.getEnv("NO_COLOR");
      const useColor = !noColor && env.isTerminal();
      const palette = createPalette(useColor);

      try {
        const result = await runRecap(
          {
            configPath: context.configPath,
            noColor,
            useColor,
            json: options.json,
            cwd: context.cwd,
          },
          deps,
          palette,
        );

        if (options.json) {
          console.log(formatRecapJson([...result.sections]));
        } else {
          if (result.text.trim()) {
            console.log(result.text);
          }
        }
      } catch (e) {
        if (e instanceof RecapError) {
          console.error(`recap error: ${e.message}`);
          Deno.exit(1);
        }
        throw e;
      }
    })
    .command(
      "config",
      new Command()
        .description("Inspect recap configuration")
        .command("show", "Print the fully resolved config as YAML")
        .action(async (options) => {
          const config = await loadResolvedConfig(
            globalOptionsFromUnknown(options),
          );
          console.log(configToYaml(config).trimEnd());
        })
        .command("files", "List config files loaded by recap")
        .option("-v, --verbose", "Also print each file config")
        .action(async (options) => {
          const sources = await loadConfigSources(
            globalOptionsFromUnknown(options),
          );
          const verbose = options.verbose === true;
          const output = verbose
            ? formatConfigFilesVerbose(sources)
            : sources.map((source) => formatConfigSource(source, false)).join(
              "\n",
            );
          if (output.length > 0) {
            console.log(output);
          }
        }),
    )
    .command("init", "Generate a recap config file")
    .option("--global", "Generate global config (~/.config/recap.yaml)")
    .action(async (options) => {
      const globalOpts = asGlobal(options);
      const context = getCliContext(globalOpts);

      const isGlobal = options.global === true;
      const content = generateConfigContent(isGlobal);

      let configPath: string;
      if (isGlobal) {
        const home = env.home();
        if (!home) {
          console.error("recap error: cannot determine home directory");
          Deno.exit(1);
        }
        configPath = join(home, ".config", "recap.yaml");
      } else {
        configPath = join(context.cwd ?? env.cwd(), ".config", "recap.yaml");
      }

      // Ensure directory exists
      const dir = configPath.replace(/\/[^/]+$/, "");
      await fs.ensureDir(dir);

      // Check if file already exists
      if (await fs.exists(configPath)) {
        console.error(`recap: config already exists at ${configPath}`);
        console.error("recap: use --force to overwrite (not implemented yet)");
        Deno.exit(1);
      }

      await fs.writeFile(configPath, content);
      console.log(`recap: created ${configPath}`);
    })
    .command("completions", new CompletionsCommand());

  await program.parse(args);
}

// Run as CLI entry point
if (import.meta.main) {
  await main(Deno.args);
}
