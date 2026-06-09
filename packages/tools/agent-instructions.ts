export type AgentInstructionsTool = "wl" | "md" | "recap";

export type AgentInstructionsOptions = {
  mandatory?: boolean;
};

const WORKLOG_INSTRUCTIONS = `
Worklog (\`wl\`): local task log for agent work.
- Create a worktask at the start of substantive work. If already working in a task, use it or create a subtask. \`wl create [--parent <taskid>] "short task name"\`.
- Trace each significant action, problem, idea, lead, finding, and insight: \`wl trace <id> "message"\`.
- Show task context: \`wl show <id>\`; list traces: \`wl traces <id>\`.
- Consolidate traces: \`wl checkpoint <id> "changes" "learnings"\`.
- Complete a task: \`wl done <id> "changes" "learnings"\`.
- Agent-assisted completion synthesis: \`wl done --agent\`.
- Help: \`wl --help\`.
`.trim();

const MANDATORY_WORKLOG_INSTRUCTIONS = `
Worklog (\`wl\`): mandatory local task log for agent work.
- You MUST create a worktask at the start of any substantive work. If already working in a task, use it or create a subtask. \`wl create [--parent <taskid>] "short task name"\`.
- You MUST trace each significant action, problem, idea, lead, finding, and insight: \`wl trace <id> "message"\`.
- Show task context when useful: \`wl show <id>\`; list traces: \`wl traces <id>\`.
- Consolidate traces when useful: \`wl checkpoint <id> "changes" "learnings"\`.
- When the user validates completion, close the task: \`wl done <id> "changes" "learnings"\`.
- Agent-assisted completion synthesis: \`wl done --agent\`.
- Help: \`wl --help\`.
`.trim();

const MARKDOWN_SURGEON_INSTRUCTIONS = `
Markdown Surgeon (\`md\`): Markdown inspection and section-level editing.
- Outline a file: \`md outline <file>\` lists headings, section IDs, and line numbers; \`--json\` gives structured output.
- Read a section: \`md read <file> <selector>\`; \`--deep\` includes subsections.
- Replace a section: \`md write <file> <selector> [content]\`; omitted content is read from stdin.
- Append content: \`md append <file> [selector] [content]\`.
- Frontmatter: \`md meta <file> ...\` reads or updates YAML metadata.
- Selectors can be section IDs from \`md outline\` or heading selectors; heading selectors can be ambiguous.
- Help: \`md --help\`.
`.trim();

const RECAP_INSTRUCTIONS = `
Recap (\`recap\`): compact project context snapshot; it can be useful as assistant context.
- Snapshot current directory: \`recap\`.
- Snapshot another directory: \`recap -C <dir>\`.
- Structured output: \`recap --json\`.
- Project-specific context can be added via recap configuration.
- Help: \`recap --help\`.
`.trim();

export function agentInstructions(
  tool: AgentInstructionsTool,
  options: AgentInstructionsOptions = {},
): string {
  switch (tool) {
    case "wl":
      if (options.mandatory) return MANDATORY_WORKLOG_INSTRUCTIONS;
      return WORKLOG_INSTRUCTIONS;
    case "md":
      return MARKDOWN_SURGEON_INSTRUCTIONS;
    case "recap":
      return RECAP_INSTRUCTIONS;
  }
}
