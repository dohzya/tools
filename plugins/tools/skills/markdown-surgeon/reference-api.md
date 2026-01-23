# Markdown Surgeon - API Reference

Complete reference for building tools on top of `md`.

## Installation

```bash
# CLI (requires Deno)
~/.claude/skills/markdown-surgeon/md <command> [options]

# TypeScript import
import { main } from "./src/mod.ts";
await main(["outline", "doc.md"]);
```

## CLI Commands

### outline

```bash
md outline <file> [--after ID] [--last] [--count] [--json]
```

Lists all sections with their IDs.

**Output (text):**

```
# Title ^a3f2c1d0 L1
## Section ^7b2e4a1c L5
### Subsection ^1d4f6a3b L10
```

**Output (--json):**

```json
[{"id":"a3f2c1d0","level":1,"title":"Title","line":1},...]
```

**Options:**

- `--after ID`: Only list subsections of the given section
- `--last`: Return only the last matching section
- `--count`: Return count instead of listing (text: `3`, json: `{"count":3}`)

### read

```bash
md read <file> <id> [--deep] [--json]
```

Reads section content.

**Output (text):**

```
## Section ^7b2e4a1c L5-L18

Content here...
```

**Output (--json):**

```json
{
  "id": "7b2e4a1c",
  "level": 2,
  "title": "Section",
  "lineStart": 5,
  "lineEnd": 18,
  "content": "Content here..."
}
```

**Options:**

- `--deep`: Include subsections in content

### write

```bash
md write <file> <id> [content] [--deep] [--json]
```

Replaces section content. Content can be argument, heredoc, or stdin.

**Output (text):**

```
updated ^7b2e4a1c L5-L12 (+3, -5)
```

**Output (--json):**

```json
{
  "action": "updated",
  "id": "7b2e4a1c",
  "lineStart": 5,
  "lineEnd": 12,
  "linesAdded": 3,
  "linesRemoved": 5
}
```

### append

```bash
md append <file> [id] [content] [--deep] [--before] [--json]
```

Appends content to a section. If no ID, appends to file (start with `--before`,
end otherwise).

**Output (text):**

```
appended ^7b2e4a1c L18 (+1)
created ^f1e2d3c4 L21-L23 (+3)  # if content starts with header
```

**Output (--json):**

```json
{"action":"appended","id":"7b2e4a1c","lineStart":18,"linesAdded":1,"linesRemoved":0}
{"action":"created","id":"f1e2d3c4","lineStart":21,"lineEnd":23,"linesAdded":3,"linesRemoved":0}
```

**Options:**

- `--deep`: Insert after subsections instead of before next header
- `--before`: Insert before section (or at file start if no ID)

### empty

```bash
md empty <file> <id> [--deep] [--json]
```

Clears section content, keeps header.

**Output:** Same format as write (`action: "emptied"`).

### remove

```bash
md remove <file> <id> [--json]
```

Removes section and all its subsections.

**Output:** Same format as write (`action: "removed"`).

### search

```bash
md search <file> <pattern> [--summary] [--json]
```

Searches for pattern in file.

**Output (text):**

```
^7b2e4a1c L12 TODO: fix this
^1d4f6a3b L45 TODO: add tests
```

**Output (--summary, text):**

```
## Installation ^7b2e4a1c L12 (1 match)
## Usage ^1d4f6a3b L45 (1 match)
```

**Output (--json):**

```json
[{"sectionId":"7b2e4a1c","line":12,"content":"TODO: fix this"},...]
```

**Output (--summary --json):**

```json
[{"id":"7b2e4a1c","level":2,"title":"Installation","lines":[12],"matchCount":1},...]
```

### concat

```bash
md concat <files...> [--shift[=N]]
```

Concatenates files. Outputs to stdout (use `> file.md` to save).

**Options:**

- `--shift` or `--shift=1`: Shift headers by 1 level
- `--shift=N`: Shift by N levels
- First file's frontmatter is preserved

### meta

```bash
md meta <file> [key] [--set key value] [--del key] [--h1]
```

Manipulates YAML frontmatter.

**Examples:**

```bash
md meta doc.md                  # Show all YAML
md meta doc.md title            # Get value
md meta doc.md author.name      # Nested access
md meta doc.md tags.0           # Array access
md meta doc.md --set key value  # Set (creates intermediates)
md meta doc.md --del key        # Delete
md meta doc.md --h1             # Get h1 title
```

### create

```bash
md create <file> [content] [--title T] [--meta key=value]... [--force]
```

Creates a new file.

**Options:**

- `--title T`: Add h1 title
- `--meta key=value`: Add frontmatter (repeatable)
- `--force`: Overwrite if exists
- `content`: Initial content after title

## Section ID Algorithm

```typescript
import { createHash } from "node:crypto";

function sectionHash(level: number, title: string, occurrence: number): string {
  const input = `${level}:${title.toLowerCase().trim()}:${occurrence}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}
```

- `level`: Header level (1-6)
- `title`: Header text (lowercase, trimmed)
- `occurrence`: 0-indexed for duplicate titles

## Magic Expressions

Expanded in `write`, `append`, `meta --set`, `create` content/title/meta values.

| Expression           | Output                      |
| -------------------- | --------------------------- |
| `{datetime}`         | `2025-01-16T14:30:00+01:00` |
| `{dt}`               | Same as `{datetime}`        |
| `{datetime:short}`   | `2025-01-16 14:30`          |
| `{dt:short}`         | Same as `{datetime:short}`  |
| `{date}`             | `2025-01-16`                |
| `{time}`             | `14:30:00`                  |
| `{meta:key}`         | Frontmatter value           |
| `{meta:author.name}` | Nested frontmatter          |

## TypeScript API

### Types

```typescript
interface Section {
  id: string;
  level: number;
  title: string;
  line: number; // 1-indexed
}

interface Document {
  lines: string[];
  sections: Section[];
  frontmatter: string | null;
  frontmatterEndLine: number;
}

interface MutationResult {
  action: "updated" | "appended" | "created" | "emptied" | "removed";
  id: string;
  lineStart: number;
  lineEnd?: number;
  linesAdded: number;
  linesRemoved: number;
}

interface SearchMatch {
  sectionId: string | null;
  line: number;
  content: string;
}

interface SearchSummary {
  id: string;
  level: number;
  title: string;
  lines: number[];
  matchCount: number;
}

class MdError extends Error {
  code: string; // file_not_found, section_not_found, parse_error, invalid_id, io_error
  file?: string;
  sectionId?: string;
  format(): string; // "error: <code>\n<message>"
}
```

### Core Functions

```typescript
// Parser
function parseDocument(content: string): Promise<Document>;
function findSection(doc: Document, id: string): Section | undefined;
function findSectionAtLine(doc: Document, line: number): Section | undefined;
function getSectionEndLine(
  doc: Document,
  section: Section,
  deep: boolean,
): number;
function getSectionContent(
  doc: Document,
  section: Section,
  deep: boolean,
): string;
function serializeDocument(doc: Document): string;

// YAML
function parseFrontmatter(yaml: string): Record<string, unknown>;
function stringifyFrontmatter(obj: Record<string, unknown>): string;
function getNestedValue(obj: Record<string, unknown>, path: string): unknown;
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void;
function deleteNestedValue(obj: Record<string, unknown>, path: string): boolean;

// Hash
function sectionHash(level: number, title: string, occurrence: number): string;
function isValidId(id: string): boolean;

// Magic
function expandMagic(input: string, meta?: Record<string, unknown>): string;
```

### Usage Example

```typescript
import {
  findSection,
  getSectionContent,
  parseDocument,
} from "./src/core/parser.ts";
import { expandMagic } from "./src/core/magic.ts";
import { parseFrontmatter } from "./src/core/yaml.ts";

const content = await Deno.readTextFile("doc.md");
const doc = await parseDocument(content);

// Find and read a section
const section = findSection(doc, "7b2e4a1c");
if (section) {
  const text = getSectionContent(doc, section, false);
  console.log(text);
}

// Expand magic expressions
const meta = parseFrontmatter(doc.frontmatter ?? "");
const expanded = expandMagic("Updated: {datetime}", meta);
```

## Error Handling

All errors are thrown as `MdError` instances.

```typescript
try {
  await main(["read", "doc.md", "invalid"]);
} catch (e) {
  if (e instanceof MdError) {
    console.error(e.format());
    // error: section_not_found
    // No section with id 'invalid' in doc.md
  }
}
```

Exit codes: 0 = success, 1 = error
