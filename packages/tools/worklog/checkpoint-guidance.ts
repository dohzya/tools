export const CHECKPOINT_SYNTHESIS_CONTRACT = `
A checkpoint is cumulative and self-contained: after this checkpoint, previous traces and checkpoints could be deleted without losing the useful story of the task.

Capture enough context for a future agent to resume without rereading raw traces. Put these in the first argument, changes:
- Outcomes: what changed and what state the task reached.
- Root causes: why the problem happened or why the chosen fix was needed.
- Decisions: chosen approach, constraints, and rejected alternatives.
- Rejected alternatives: hypotheses or paths explored and ruled out.
- Validation: checks run, failures hit, fixes after failures, and final result.
- Final state: user acceptance, commit/release/status when relevant.

Put this in the second argument, learnings:
- Reusable learnings: durable patterns, gotchas, workflow rules, and codebase facts.

Do not turn learnings into an activity summary. "Tests passed" is validation; the learning is the reusable reason, constraint, or pattern discovered while getting there.

Use trace kinds as routing hints, not hard rules:
- learning: candidate for Learnings, almost always.
- finding: candidate for Changes or Learnings depending on reusability.
- state: candidate for Changes, especially validation and final state.
- info / hypothesis: candidate for Changes if impactful, or Learnings after analysis.
- action: candidate for Changes only when impactful, rarely Learnings.

As a cheap high-signal review pass, inspect \`wl traces --kind finding,learning\`
before finalizing Learnings. This does not guarantee every reusable lesson is
covered, but it catches most pre-identified candidates with little noise.

Reconcile superseded traces before routing them. A trace records what was true when it was written, not what is true now: a later trace may have narrowed it, contradicted it, or turned a plan into a rejected alternative. Read the traces in order and check each candidate against the final state of the work, not against the moment it was recorded. In particular:
- A learning stated early and disproved later is not a learning; the correction is.
- A "to do one day" that the task went on to rule out is a rejected alternative, and belongs in Changes with the reason it was ruled out.
- A commit, branch, or status named mid-task is stale once the work moves on; state where it actually landed.

Before running the command, review every candidate sentence. If it describes a thing done or final state, it belongs in Changes. If it describes a lesson learned, it belongs in Learnings. Then scan the traces for information that could be useful to other projects; when there is one, distill the reusable learning into Learnings.
`.trim();

export const CHECKPOINT_DELEGATION_GUIDANCE = `
Ordinary agents should not write manual checkpoint or done syntheses by default; agents do not write manual checkpoint or done content when delegation is available. Use only one delegated command:
- \`wl checkpoint --agent\` when you need to synthesize progress and keep the task open.
- \`wl done --agent\` when you need to synthesize and close the task. Do not run checkpoint first.

Use manual \`wl checkpoint <id> "<changes>" "<learnings>"\` or \`wl done <id> "<changes>" "<learnings>"\` only when delegation is unavailable, inappropriate, or explicitly requested.
`.trim();
