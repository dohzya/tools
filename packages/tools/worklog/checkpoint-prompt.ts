// Pure function that builds the agent prompt for checkpoint synthesis.
// No I/O, no side effects — all data comes from ShowOutput.

import type { ShowOutput } from "./domain/entities/outputs.ts";
import { CHECKPOINT_SYNTHESIS_CONTRACT } from "./checkpoint-guidance.ts";

export type CheckpointPromptMode = "checkpoint" | "done";

export function buildCheckpointPrompt(
  taskId: string,
  show: ShowOutput,
  mode: CheckpointPromptMode = "checkpoint",
): string {
  const sections: string[] = [];

  // Opening directive
  sections.push(
    mode === "done"
      ? `You are the dedicated synthesis agent creating a final checkpoint that closes the task.`
      : `You are the dedicated synthesis agent creating a checkpoint.`,
  );

  // Section 1: Task identity
  sections.push(
    `# Task: ${show.name}\n\n${show.desc}`,
  );

  // Section 2: Traces since last checkpoint
  if (show.entries_since_checkpoint.length > 0) {
    const entries = show.entries_since_checkpoint
      .map((e) => `- [${e.ts}] ${e.msg}`)
      .join("\n");
    sections.push(
      `## Traces since last checkpoint\n\n${entries}`,
    );
  } else {
    sections.push(
      `## Traces since last checkpoint\n\nNo traces recorded.`,
    );
  }

  // Section 3: Previous checkpoint
  if (show.last_checkpoint) {
    sections.push(
      `## Previous checkpoint\n\n` +
        `**Changes:** ${show.last_checkpoint.changes}\n` +
        `**Learnings:** ${show.last_checkpoint.learnings}`,
    );
  }

  // Section 4: Active TODOs
  const activeTodos = show.todos.filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  );
  if (activeTodos.length > 0) {
    const todoLines = activeTodos
      .map((t) => `- [${t.status}] ${t.text}`)
      .join("\n");
    sections.push(
      `## Active TODOs\n\n${todoLines}`,
    );
  }

  // Section 5: Synthesis contract
  sections.push(
    `## Checkpoint synthesis contract\n\n${CHECKPOINT_SYNTHESIS_CONTRACT}`,
  );

  sections.push(
    `## Agent delegation rule\n\n` +
      `Ordinary agents should not write manual ${mode} syntheses by ` +
      `default; agents do not write manual ${mode} content when delegation ` +
      `is available. Prefer \`wl ${mode} --agent\` for this synthesis.\n\n` +
      `For an ordinary agent, this is the preferred handoff path.\n\n` +
      `Use manual \`wl ${mode} <id> "<changes>" "<learnings>"\` only when ` +
      `delegation is unavailable, inappropriate, or explicitly requested.\n\n` +
      `This prompt is already running inside the delegated synthesis path. ` +
      `Do not call \`wl ${mode} --agent\` again; produce the synthesis now ` +
      `and run the direct command below.`,
  );

  // Section 6: Quality guidelines
  sections.push(
    `## Output quality\n\n` +
      `**Changes**: Write a compact but self-contained narrative of outcomes, ` +
      `important pivots, and final state. Include validation when it proves ` +
      `the outcome.\n\n` +
      `**Learnings**: Capture reusable learnings, not a work log. Preserve ` +
      `root causes, decisions and why, rejected alternatives, gotchas, ` +
      `workflow rules, and codebase facts.\n\n` +
      `Good learning: "Deno tests for worklog must run from packages/tools ` +
      `because that directory owns deno.json dependency resolution."\n` +
      `Bad learning: "Used TDD and tests passed."`,
  );

  // Section 7: Command to execute
  const cmd = mode === "done" ? "done" : "checkpoint";
  sections.push(
    `## Command\n\n` +
      `Run this command directly without asking for confirmation:\n\n` +
      `  wl ${cmd} ${taskId} "<changes>" "<learnings>"\n\n` +
      `Replace \`<changes>\` and \`<learnings>\` with your synthesis.`,
  );

  return sections.join("\n\n");
}
