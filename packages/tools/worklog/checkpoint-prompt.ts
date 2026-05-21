// Pure function that builds the agent prompt for checkpoint synthesis.
// No I/O, no side effects — all data comes from ShowOutput.

import type { ShowOutput } from "./domain/entities/outputs.ts";

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
      ? `You are creating a final checkpoint that closes the task: a synthesis of recent work traces into a concise record of what was accomplished and what was learned.`
      : `You are creating a checkpoint: a synthesis of recent work traces into a concise record of what was accomplished and what was learned.`,
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

  // Section 3: Previous checkpoint (style reference)
  if (show.last_checkpoint) {
    sections.push(
      `## Previous checkpoint (style reference)\n\n` +
        `**Changes:** ${show.last_checkpoint.changes}\n` +
        `**Insights:** ${show.last_checkpoint.insights}`,
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

  // Section 5: Quality guidelines
  sections.push(
    `## Quality guidelines\n\n` +
      `**Changes** (1-2 sentences): Synthesize OUTCOMES, not activities. ` +
      `Do not list traces — distill what was accomplished.\n\n` +
      `- Good: "Migrated user lookup from sync to async; resolved the race ` +
      `condition that caused duplicate sessions."\n` +
      `- Bad: "Changed function signature, then updated tests, then fixed ` +
      `a bug, then ran lint."\n\n` +
      `**Insights** (1-2 sentences): Capture REUSABLE insights — decisions ` +
      `and why, gotchas discovered, patterns identified.\n\n` +
      `- Good: "JSON.parse on streamed input fails silently for incomplete ` +
      `chunks — wrap in a length guard before parsing."\n` +
      `- Bad: "Used TDD. Tests passed."`,
  );

  // Section 6: Command to execute
  const cmd = mode === "done" ? "done" : "checkpoint";
  sections.push(
    `## Command\n\n` +
      `Run this command directly without asking for confirmation:\n\n` +
      `  wl ${cmd} ${taskId} "<changes>" "<insights>"\n\n` +
      `Replace \`<changes>\` and \`<insights>\` with your synthesis.`,
  );

  return sections.join("\n\n");
}
