import { CHECKPOINT_DELEGATION_GUIDANCE } from "./worklog/checkpoint-guidance.ts";

export type AgentInstructionsTool = "wl" | "md" | "recap" | "dz-review";

export type AgentInstructionsOptions = {
  mandatory?: boolean;
};

const WORKLOG_INSTRUCTIONS = `
Worklog (\`wl\`): local task log for agent work.
- Create a worktask at the start of substantive work. If already working in a task, use it or create a subtask. \`wl create [--parent <taskid>] "short task name"\`.
- Trace each significant action, problem, idea, lead, finding, and insight: \`wl trace <id> "message"\`.
- Show task context: \`wl show <id>\`; list traces: \`wl traces <id>\`.
- Agent-assisted synthesis: use only one command, \`wl checkpoint --agent\` to keep working or \`wl done --agent\` to close.
- If closing with \`wl done --agent\`, do not checkpoint first.
- If you must synthesize manually, make it self-contained: after this checkpoint, previous traces and checkpoints could be deleted.
- ${CHECKPOINT_DELEGATION_GUIDANCE.split("\n")[0]}
- Help: \`wl --help\`.
`.trim();

const MANDATORY_WORKLOG_INSTRUCTIONS = `
Worklog (\`wl\`): mandatory local task log for agent work.
- You MUST create a worktask at the start of any substantive work. If already working in a task, use it or create a subtask. \`wl create [--parent <taskid>] "short task name"\`.
- You MUST trace each significant action, problem, idea, lead, finding, and insight: \`wl trace <id> "message"\`.
- Show task context when useful: \`wl show <id>\`; list traces: \`wl traces <id>\`.
- Use agent-assisted synthesis when useful: choose \`wl checkpoint --agent\` to keep working or \`wl done --agent\` to close.
- When the user validates completion, close the task, preferably with \`wl done --agent\`.
- If closing with \`wl done --agent\`, do not checkpoint first.
- If you must synthesize manually, make it self-contained: after this checkpoint, previous traces and checkpoints could be deleted.
- ${CHECKPOINT_DELEGATION_GUIDANCE.split("\n")[0]}
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
- Show selected sections: \`recap show <section...>\`.
- Structured output: \`recap --json\`.
- Project-specific context can be added via recap configuration.
- Help: \`recap --help\`.
`.trim();

const DZ_REVIEW_INSTRUCTIONS = `
DZ Review (\`dz-review\`): Markdown review syntax scanner and helper CLI.
- Inspect review state: \`dz-review status [file...]\`.
- Before reading annotated files, make timestamps readable: \`dz-review ts -i -I <file...>\`.
- Before handing edited annotated files back, restore compact timestamps: \`dz-review ts -i -S <file...>\`.
- Use \`--open-conversations\`, \`--pending-conversations\`, or \`--resolved-conversations\` to narrow conversation status when needed.
- Reply by editing the Markdown thread: append a new \`@agent\` message and preserve unresolved history until human validation.
- Help: \`dz-review --help\`.
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
    case "dz-review":
      return DZ_REVIEW_INSTRUCTIONS;
  }
}
