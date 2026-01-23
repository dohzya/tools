---
name: obsidian-journal
description: Create journal entries in Obsidian. Use when the user asks to store, save, or record information for later reference. Do NOT use when the user asks to create, write, or draft a document — that implies iterative work where the file should stay in the working directory until explicitly stored.
---

# Obsidian Journal

Create journal entries using the `mcp-obsidian:create_vault_file` tool.

## Requirements

- MCP server `mcp-obsidian` must be configured with vault access

## File Path Format

```
Journal/YYYY/YYYY-MM/YYYY-MM-DD/YYYYMMDDHHmm.md
```

Example for January 5, 2026 at 14:47:

```
Journal/2026/2026-01/2026-01-05/202601051447.md
```

## Entry Template

```markdown
---
Date: YYYY-MM-DD
Day: "[[YYYY-MM-DD|YYYY-MM-DD]]"
tags: [Journal, Claude]
---

# Title

Summary and content here...
```

## Guidelines

1. **Timestamp**: Use current date/time for the path and frontmatter
2. **Tags**: Always include `Journal` and `Claude`. Add `REX` when storing a
   REX/post-mortem. Only add other tags if explicitly provided by the user
3. **Title**: Generate a concise, descriptive title based on the content
4. **Content**: Structure as clean markdown with:
   - A generated summary when saving conversation context
   - Well-organized sections if the content is substantial
   - The actual document if asked to generate and save something specific
