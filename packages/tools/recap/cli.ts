// recap CLI — context snapshot for AI assistants

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { createPalette } from "./domain/entities/color.ts";
import { runRecap } from "./domain/use-cases/run-recap.ts";
import { generateConfigContent } from "./domain/use-cases/init-config.ts";
import { DenoFileSystem } from "./adapters/filesystem/deno-fs.ts";
import { DenoEnvironment } from "./adapters/environment/deno-environment.ts";
import { DaxShellRunner } from "./adapters/shell/dax-shell-runner.ts";
import { DenoGitInfo } from "./adapters/git/deno-git-info.ts";
import { YamlConfigResolver } from "./adapters/config/yaml-config-resolver.ts";
import { formatRecapJson } from "./adapters/cli/formatter.ts";
import { join, resolve } from "@std/path";
import { RecapError } from "./domain/entities/errors.ts";
import { ExplicitCast } from "../explicit-cast.ts";

const VERSION = "0.1.0";

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
};

/** Downcast Cliffy's local options to include inherited global options */
function asGlobal<T extends object>(options: T): T & GlobalOptions {
  return ExplicitCast.from<T>(options).dangerousCast<T & GlobalOptions>();
}

/** Extract the -C option value from global options */
function getCwdOption(options: GlobalOptions): string | undefined {
  return options[""];
}

export async function main(args: string[]): Promise<void> {
  const program = new Command()
    .name("recap")
    .version(VERSION)
    .description("Context snapshot for AI assistants")
    .globalOption(
      "-C <dir:string>",
      "Run as if started in <dir> (affects config discovery and shell commands)",
    )
    .option("--no-color", "Disable ANSI color output")
    .option(
      "--config <path:string>",
      "Explicit config path (skip auto-discovery)",
    )
    .option("--json", "Output as JSON instead of formatted text")
    .action(async (options) => {
      const globalOpts = asGlobal(options);
      const cwdFlag = getCwdOption(globalOpts);
      const cwd = cwdFlag ? resolve(cwdFlag) : undefined;

      const noColor = options.color === false ||
        !!env.getEnv("NO_COLOR");
      const useColor = !noColor && env.isTerminal();
      const palette = createPalette(useColor);

      try {
        const result = await runRecap(
          {
            configPath: options.config,
            noColor,
            json: options.json,
            cwd,
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
    .command("init", "Generate a recap config file")
    .option("--global", "Generate global config (~/.config/recap.yaml)")
    .action(async (options) => {
      const globalOpts = asGlobal(options);
      const cwdFlag = getCwdOption(globalOpts);
      const cwd = cwdFlag ? resolve(cwdFlag) : undefined;

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
        configPath = join(cwd ?? env.cwd(), ".config", "recap.yaml");
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
