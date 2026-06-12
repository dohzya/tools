---
name: agent-context-writing
description: Write or review durable content intended for AI agents to consume, including AGENTS.md, CLAUDE.md, skills, reusable agent prompts, handoff notes, memory notes, and other agent-facing guidance. Use when the task is to add, refine, compress, or audit instructions or context for a future agent reader; do not use for one-off prompt drafting unless the prompt will become reusable agent guidance.
---

# Agent Context Writing

Write agent-facing content as dense, source-aware context for a future agent.

## Core Rule

Do not preserve reasoning that the next agent can cheaply reproduce. Preserve only inputs, verified context, expensive conclusions, and short rationale that prevents relitigating non-obvious constraints or failed alternatives.

## What To Include

- The clear, concise form of the instruction or fact the user provided.
- Context verified from project files, tool output, logs, tickets, web sources, prior traces, or other primary evidence.
- Hard-won inferences when they came from non-trivial investigation, repeated failures, or an explicit insight that future agents would not easily rediscover.
- Short rationale for a non-obvious constraint or failed alternative when omitting it would cause future agents to reopen the same question.
- Constraints that change behavior: scope boundaries, source-of-truth rules, validation requirements, naming rules, and known failure modes.

## What To Exclude

- Examples that merely restate the rule, unless they are normative tests, counterexamples, exact user wording, or carry a non-obvious edge case.
- Obvious consequences a competent agent can infer from the shorter instruction.
- Generic agent best practices already covered by normal agent behavior.
- Speculative edge cases, motivational framing, or explanatory padding.
- Corollaries invented during drafting unless they are backed by source evidence or a hard-won inference.

## Writing Workflow

1. Extract the seed instruction without embellishing it.
2. Gather only task-relevant context from the target artifact and source material.
3. Classify each candidate sentence as `user-provided`, `verified-context`, `hard-won-inference`, `obvious-derived`, or `padding`.
4. Keep `user-provided` and `verified-context` content by default.
5. Keep `hard-won-inference` content only when it would save meaningful rediscovery work; phrase it as a heuristic if it is not source-backed fact.
6. Keep concise rationale only when it explains a non-obvious rule, rejected path, or source-of-truth choice.
7. Delete `obvious-derived` and `padding`.
8. Run a compression pass before finishing.

## Sentence Gate

For every candidate sentence, ask:

- What is its source: user, project evidence, external source, prior trace, or inference?
- Would a competent future agent infer this from the shorter instruction?
- Does it reduce future ambiguity enough to justify its token cost?

If the answer to the second question is yes and the answer to the third is no, omit the sentence.

## Source Handling

- Keep source-backed facts distinguishable from inferences.
- Do not upgrade a user preference into a universal rule unless the target artifact has that scope.
- When adding context from files or tools, include only the durable conclusion, not the investigation transcript.
- When evidence is stale, narrow, or environment-specific, say so briefly.

## Final Pass

Before handing off, remove:

- duplicate guidance already present nearby;
- examples whose lesson is already stated directly and that are not normative tests, counterexamples, exact user wording, or edge-case carriers;
- lists of consequences that follow mechanically from one rule;
- words that describe the content instead of constraining future behavior.
