// Agent configuration entity — defines how each AI agent is invoked.

export type AgentType = "claude" | "codex";

export interface AgentLaunchOptions {
  readonly existingDeveloperInstructions?: string;
}

export interface AgentConfig {
  readonly type: AgentType;
  readonly name: string;
  buildInteractiveCmd(
    systemPrompt: string,
    extraArgs: readonly string[],
    options?: AgentLaunchOptions,
  ): readonly string[];
  buildSynthesisCmd(
    systemPrompt: string,
    synthesisPrompt: string,
  ): readonly string[];
}

/** Claude subcommands that reject --append-system-prompt */
export const CLAUDE_SUBCOMMANDS: ReadonlySet<string> = new Set(["agents"]);

export const claudeAgentConfig: AgentConfig = {
  type: "claude",
  name: "Claude",
  buildInteractiveCmd(
    systemPrompt: string,
    extraArgs: readonly string[],
    _options?: AgentLaunchOptions,
  ): readonly string[] {
    if (extraArgs.length > 0 && CLAUDE_SUBCOMMANDS.has(extraArgs[0])) {
      return ["claude", ...extraArgs];
    }
    return ["claude", "--append-system-prompt", systemPrompt, ...extraArgs];
  },
  buildSynthesisCmd(
    systemPrompt: string,
    synthesisPrompt: string,
  ): readonly string[] {
    return [
      "claude",
      "--append-system-prompt",
      systemPrompt,
      "-p",
      synthesisPrompt,
    ];
  },
};

export const codexAgentConfig: AgentConfig = {
  type: "codex",
  name: "Codex",
  buildInteractiveCmd(
    systemPrompt: string,
    extraArgs: readonly string[],
    options?: AgentLaunchOptions,
  ): readonly string[] {
    const parsedArgs = extractCodexDeveloperInstructions(extraArgs);
    const existingDeveloperInstructions =
      parsedArgs.developerInstructionsOverride ??
        options?.existingDeveloperInstructions;
    const developerInstructions = existingDeveloperInstructions
      ? `${existingDeveloperInstructions}\n\n---\n\n${systemPrompt}`
      : systemPrompt;

    return [
      "codex",
      ...parsedArgs.args,
      "-c",
      `developer_instructions=${toTomlString(developerInstructions)}`,
    ];
  },
  buildSynthesisCmd(
    _systemPrompt: string,
    synthesisPrompt: string,
  ): readonly string[] {
    return [
      "codex",
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      synthesisPrompt,
    ];
  },
};

function extractCodexDeveloperInstructions(
  args: readonly string[],
): {
  readonly args: readonly string[];
  readonly developerInstructionsOverride?: string;
} {
  const keptArgs: string[] = [];
  let developerInstructionsOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-c" || arg === "--config") {
      const configValue = args[i + 1];
      if (configValue !== undefined) {
        const parsed = parseDeveloperInstructionsConfig(configValue);
        if (parsed !== undefined) {
          developerInstructionsOverride = parsed;
          i++;
          continue;
        }
        keptArgs.push(arg, configValue);
        i++;
        continue;
      }
    }

    if (arg.startsWith("--config=")) {
      const configValue = arg.slice("--config=".length);
      const parsed = parseDeveloperInstructionsConfig(configValue);
      if (parsed !== undefined) {
        developerInstructionsOverride = parsed;
        continue;
      }
    }

    if (arg.startsWith("-c") && arg.length > 2) {
      const configValue = arg.slice(2);
      const parsed = parseDeveloperInstructionsConfig(configValue);
      if (parsed !== undefined) {
        developerInstructionsOverride = parsed;
        continue;
      }
    }

    keptArgs.push(arg);
  }

  return { args: keptArgs, developerInstructionsOverride };
}

function parseDeveloperInstructionsConfig(
  configValue: string,
): string | undefined {
  const separatorIndex = configValue.indexOf("=");
  if (separatorIndex === -1) return undefined;

  const key = configValue.slice(0, separatorIndex).trim();
  if (key !== "developer_instructions") return undefined;

  return parseTomlString(configValue.slice(separatorIndex + 1).trim());
}

function parseTomlString(value: string): string {
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

const agentConfigs: Readonly<Record<AgentType, AgentConfig>> = {
  claude: claudeAgentConfig,
  codex: codexAgentConfig,
};

export function getAgentConfig(type: AgentType): AgentConfig {
  return agentConfigs[type];
}

/**
 * Detect which agent is running based on environment variables.
 * Claude sets CLAUDECODE=1; Codex sets AGENT=codex.
 * Returns null when running in a plain terminal.
 */
export function detectAgentType(
  env: { get(key: string): string | undefined },
): AgentType | null {
  if (env.get("CLAUDECODE")) return "claude";
  if (env.get("AGENT") === "codex") return "codex";
  return null;
}
