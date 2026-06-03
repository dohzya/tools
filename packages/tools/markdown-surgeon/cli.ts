/**
 * CLI entry point for markdown-surgeon.
 *
 * Thin wire/DI layer: instantiates adapters, creates commands, builds CLI.
 *
 * @module
 */

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { Blake3HashService } from "./adapters/services/blake3-hash.ts";
import { YamlParserService } from "./adapters/services/yaml-parser.ts";
import { createCommands } from "./adapters/cli/commands.ts";
import { agentInstructions } from "../agent-instructions.ts";

// ============================================================================
// Version
// ============================================================================

const VERSION = "0.8.0";

// ============================================================================
// Dependency injection
// ============================================================================

const hashService = new Blake3HashService();
const yamlService = new YamlParserService();

// ============================================================================
// Commands
// ============================================================================

const commands = createCommands({ hashService, yamlService });
const agentInstructionsCmd = new Command()
  .description("Print AGENTS.md instructions for md")
  .action(() => {
    console.log(agentInstructions("md"));
  });

// ============================================================================
// CLI tree
// ============================================================================

const cli = new Command()
  .name("md")
  .version(VERSION)
  .description("Manipulate Markdown files by section")
  .command("outline", commands.outlineCmd)
  .command("read", commands.readCmd)
  .command("write", commands.writeCmd)
  .command("append", commands.appendCmd)
  .command("empty", commands.emptyCmd)
  .command("remove", commands.removeCmd)
  .command("search", commands.searchCmd)
  .command("concat", commands.concatCmd)
  .command("meta", commands.metaCmd)
  .command("create", commands.createCmd)
  .command("agent-instructions", agentInstructionsCmd)
  .command("completions", new CompletionsCommand());

/** Run the markdown-surgeon CLI with the given arguments */
export async function main(args: string[]): Promise<void> {
  await cli.parse(args);
}

// Run if executed directly
if (import.meta.main) {
  await main(Deno.args);
}
