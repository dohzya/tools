// Agent configuration entity — defines how each AI agent is invoked.

export type AgentType = "claude" | "codex";

export interface AgentConfig {
  readonly type: AgentType;
  readonly name: string;
  buildInteractiveCmd(
    systemPrompt: string,
    extraArgs: readonly string[],
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
  ): readonly string[] {
    return ["codex", ...extraArgs, systemPrompt];
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
