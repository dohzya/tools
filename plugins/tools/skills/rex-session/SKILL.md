---
name: rex-session
description: Generate a structured REX (Retour d'EXpérience / Post-Mortem) from technical conversations. Use when the user explicitly requests a REX, recap, post-mortem, or learning summary of a conversation - typically after completing a technical task, debugging session, or development work. Particularly useful for long claude-code sessions that need to be condensed into actionable insights.
---

# REX Session Generator

Generate concise, actionable REX (Retour d'EXpérience) documents from technical
conversations, focusing on learnings and decision-making processes.

## Purpose

Extract and structure the essential insights from a technical conversation.

**If a `WORKLOG.md` exists in the project**, use it as a primary source
alongside the conversation — it contains the chronological trace of attempts,
errors, and iterations.

Key insights to extract:

- Problems encountered and their root causes
- Architectural and implementation choices with rationale
- Iterations and pivots with reasons
- Key learnings and best practices
- Decisions worth remembering for future work

## Output Format

Generate markdown output directly in the chat (unless the user requests
otherwise) with the following structure:

```markdown
# REX: [Brief Title]

## Context

[1-2 paragraphs: Initial objective, constraints, starting point]

## Problems & Solutions

[For each significant problem:]

- **Problem**: [Description]
- **Root cause**: [Why it didn't work]
- **Solution**: [What fixed it and why]

## Architectural Choices

[For each significant decision:]

- **Choice**: [What was decided]
- **Alternatives considered**: [What else was evaluated]
- **Rationale**: [Why this approach was selected]

## Iterations & Pivots

[For approaches that were tested but not retained:]

- **Attempt**: [What was tried]
- **Why it didn't work**: [Blocking issue]
- **Pivot**: [What was done instead]

## Key Learnings

[Bullet points of actionable insights, best practices, gotchas to remember]

## Decisions to Remember

[Important choices that will impact future work on this project]
```

## Guidelines

**Conciseness**: Keep it actionable. Skip obvious steps or standard procedures.
Focus on non-trivial insights.

**Technical depth**: Include enough detail for someone (including future you) to
understand WHY decisions were made, not just WHAT was done.

**Problem focus**: Emphasize what went wrong and why - these are the
highest-value learnings.

**Iteration clarity**: When multiple approaches were tested, explain what made
each one fail or succeed.

**Flexibility**: Adapt the structure to the conversation. Not every REX needs
all sections. Some technical deep-dives might need additional custom sections.

**Default output**: Generate directly in chat as markdown. If the user wants to
save it, they can ask to store it.
