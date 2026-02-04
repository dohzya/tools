# @dohzya/tools

Reusable TypeScript utilities for markdown manipulation.

## Installation

```typescript
// Import markdown-surgeon exports
import { findSection, parseDocument } from "@dohzya/tools/markdown-surgeon";

// Import specific modules
import { expandMagic } from "@dohzya/tools/markdown-surgeon/magic";
import { isValidId, sectionHash } from "@dohzya/tools/markdown-surgeon/hash";

// Import worklog exports
import { loadIndex, loadTask } from "@dohzya/tools/worklog";
import type { Task, TaskIndex } from "@dohzya/tools/worklog/types";

// CLI entry points
import { main as mdMain } from "@dohzya/tools/markdown-surgeon/cli";
import { main as wlMain } from "@dohzya/tools/worklog/cli";
```

## Modules

### markdown-surgeon

Surgical manipulation of Markdown files by section.

#### Parser (`@dohzya/tools/markdown-surgeon/parser`)

```typescript
import {
  findSection,
  findSectionAtLine,
  getFrontmatterContent,
  getSectionContent,
  getSectionEndLine,
  parseDocument,
  serializeDocument,
  setFrontmatter,
  startsWithHeader,
} from "@dohzya/tools/markdown-surgeon/parser";

// Parse a markdown string
const doc = await parseDocument(content);

// Find a section by ID
const section = findSection(doc, "a3f2c1d0");

// Get section content
const text = getSectionContent(doc, section, deep);
```

#### Types (`@dohzya/tools/markdown-surgeon/types`)

```typescript
import type {
  Document,
  ErrorCode,
  MutationResult,
  SearchMatch,
  SearchSummary,
  Section,
} from "@dohzya/tools/markdown-surgeon/types";

import { MdError } from "@dohzya/tools/markdown-surgeon/types";
```

#### Hash (`@dohzya/tools/markdown-surgeon/hash`)

```typescript
import { sectionHash, isValidId } from "@dohzya/tools/markdown-surgeon/hash";

// Generate section ID
const id = await sectionHash(level, title, occurrenceIndex);

// Validate ID format
if (isValidId("a3f2c1d0")) { ... }
```

#### YAML (`@dohzya/tools/markdown-surgeon/yaml`)

```typescript
import {
  deleteNestedValue,
  formatValue,
  getNestedValue,
  parseFrontmatter,
  setNestedValue,
  stringifyFrontmatter,
} from "@dohzya/tools/markdown-surgeon/yaml";

// Parse YAML frontmatter
const meta = parseFrontmatter(yamlContent);

// Access nested values
const author = getNestedValue(meta, "author.name");
```

#### Magic (`@dohzya/tools/markdown-surgeon/magic`)

```typescript
import { expandMagic } from "@dohzya/tools/markdown-surgeon/magic";

// Expand magic expressions
const expanded = expandMagic("Updated: {dt:short}", meta);
// → "Updated: 2025-01-20 14:30"
```

Supported expressions:

- `{datetime}` or `{dt}` - ISO 8601 with timezone
- `{dt:short}` - Short format (YYYY-MM-DD HH:mm)
- `{date}` - Date only (YYYY-MM-DD)
- `{time}` - Time only (HH:MM:SS)
- `{meta:key}` - Value from frontmatter

#### CLI (`@dohzya/tools/markdown-surgeon/cli`)

```typescript
import { main } from "@dohzya/tools/markdown-surgeon/cli";

// Run CLI with arguments
await main(["outline", "doc.md"]);
```

### worklog

Append-only work logging with checkpoint snapshots for tracking development progress.

#### Core API (`@dohzya/tools/worklog`)

```typescript
import {
  loadIndex,
  loadTask,
  saveIndex,
  saveTask,
} from "@dohzya/tools/worklog";

// Load the task index
const index = await loadIndex();

// Load a specific task
const task = await loadTask("260120a");

// Task contains entries and checkpoints
console.log(task.entries); // Array of timestamped entries
console.log(task.checkpoints); // Array of consolidated summaries
```

#### Types (`@dohzya/tools/worklog/types`)

```typescript
import type {
  Task,
  TaskCheckpoint,
  TaskEntry,
  TaskIndex,
  TaskStatus,
} from "@dohzya/tools/worklog/types";

// Task status: "active" | "done"
const status: TaskStatus = "active";

// Task entry with timestamp
const entry: TaskEntry = {
  timestamp: "2026-01-20T14:30:00+01:00",
  message: "Implemented feature X",
};

// Checkpoint with changes and learnings
const checkpoint: TaskCheckpoint = {
  timestamp: "2026-01-20T15:00:00+01:00",
  changes: "Added feature X with tests",
  learnings: "Pattern Y works better than Z",
};
```

#### CLI (`@dohzya/tools/worklog/cli`)

```typescript
import { main } from "@dohzya/tools/worklog/cli";

// Run CLI with arguments
await main(["add", "--desc", "Fix bug in parser"]);
await main(["trace", "260120a", "Found root cause"]);
await main([
  "checkpoint",
  "260120a",
  "Fixed parser bug",
  "Learned about edge case",
]);
```

CLI commands: `init`, `add`, `trace`, `logs`, `checkpoint`, `done`, `list`, `summary`

See the [worklog skill documentation](../../plugins/tools/skills/worklog/SKILL.md) for detailed usage.

## Publishing

```bash
cd packages/tools
deno publish
```

## License

MIT
