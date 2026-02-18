/**
 * Adapter: MarkdownSurgeonAdapter
 *
 * Implements the MarkdownService port using markdown-surgeon use cases.
 * Bridges the worklog domain and the markdown-surgeon library.
 *
 * Replicates the EXACT behavior of the original cli.ts functions:
 *   - parseTaskFile() -> parseTaskFile()
 *   - Task file creation format -> serializeTask()
 *   - cmdTrace entry insertion -> appendEntry()
 *   - cmdCheckpoint checkpoint insertion -> appendCheckpoint()
 *   - Frontmatter update pattern -> updateFrontmatter()
 *
 * Dependencies:
 *   - ParseDocumentUseCase (markdown-surgeon)
 *   - ReadSectionUseCase (markdown-surgeon)
 *   - ManageFrontmatterUseCase (markdown-surgeon)
 *   - HashService (markdown-surgeon port, for section ID computation)
 *   - YamlService (markdown-surgeon port, for frontmatter parsing)
 */

import type { Checkpoint } from "../../domain/entities/checkpoint.ts";
import type { Entry } from "../../domain/entities/entry.ts";
import { WtError } from "../../domain/entities/errors.ts";
import type { TaskMeta } from "../../domain/entities/task.ts";
import type { Todo, TodoStatus } from "../../domain/entities/todo.ts";
import type {
  MarkdownService,
  ParsedTaskFile,
} from "../../domain/ports/markdown-service.ts";

import type {
  Document,
  Section,
} from "../../../markdown-surgeon/domain/entities/document.ts";
import type { HashService } from "../../../markdown-surgeon/domain/ports/hash-service.ts";
import type { YamlService } from "../../../markdown-surgeon/domain/ports/yaml-service.ts";
import { ParseDocumentUseCase } from "../../../markdown-surgeon/domain/use-cases/parse-document.ts";
import { ReadSectionUseCase } from "../../../markdown-surgeon/domain/use-cases/read-section.ts";
import { ManageFrontmatterUseCase } from "../../../markdown-surgeon/domain/use-cases/manage-frontmatter.ts";

// Pre-computed section IDs cache (lazily initialized)
let cachedEntriesId: string | null = null;
let cachedCheckpointsId: string | null = null;
let cachedTodosId: string | null = null;

export class MarkdownSurgeonAdapter implements MarkdownService {
  private readonly parseDocumentUC: ParseDocumentUseCase;
  private readonly readSectionUC: ReadSectionUseCase;
  private readonly frontmatterUC: ManageFrontmatterUseCase;

  constructor(
    private readonly hashService: HashService,
    private readonly yamlService: YamlService,
  ) {
    this.parseDocumentUC = new ParseDocumentUseCase(hashService);
    this.readSectionUC = new ReadSectionUseCase();
    this.frontmatterUC = new ManageFrontmatterUseCase(yamlService);
  }

  // =========================================================================
  // Section ID helpers (matching cli.ts getEntriesId/getCheckpointsId/getTodosId)
  // =========================================================================

  private async getEntriesId(): Promise<string> {
    if (!cachedEntriesId) {
      cachedEntriesId = await this.hashService.hash(1, "Entries", 0);
    }
    return cachedEntriesId;
  }

  private async getCheckpointsId(): Promise<string> {
    if (!cachedCheckpointsId) {
      cachedCheckpointsId = await this.hashService.hash(1, "Checkpoints", 0);
    }
    return cachedCheckpointsId;
  }

  private async getTodosId(): Promise<string> {
    if (!cachedTodosId) {
      cachedTodosId = await this.hashService.hash(1, "TODO", 0);
    }
    return cachedTodosId;
  }

  // =========================================================================
  // MarkdownService.parseTaskFile
  // Exact replica of cli.ts parseTaskFile()
  // =========================================================================

  async parseTaskFile(content: string): Promise<ParsedTaskFile> {
    const doc = await this.parseDocumentUC.execute({ content });

    // Validate that frontmatter delimiter exists (even if content is corrupted)
    if (!doc.frontmatter) {
      throw new WtError(
        "invalid_task_file",
        "Invalid task file: missing frontmatter",
      );
    }

    const yamlContent = this.frontmatterUC.getFrontmatterContent(doc);

    // Parse frontmatter into TaskMeta (parser returns {} for corrupted YAML)
    const rawMeta = this.yamlService.parse(yamlContent);
    const meta = rawMeta as unknown as TaskMeta;

    const entriesId = await this.getEntriesId();
    const checkpointsId = await this.getCheckpointsId();

    const entriesSection = this.findSection(doc, entriesId);
    const checkpointsSection = this.findSection(doc, checkpointsId);

    const entries: Entry[] = [];
    const checkpoints: Checkpoint[] = [];

    // Parse entries (## sections under # Entries)
    if (entriesSection) {
      const entriesEnd = checkpointsSection
        ? checkpointsSection.line - 1
        : this.readSectionUC.getSectionEndLine(doc, entriesSection, true);

      for (const section of doc.sections) {
        if (
          section.level === 2 &&
          section.line > entriesSection.line &&
          section.line <= entriesEnd
        ) {
          // Title is timestamp, content is under it
          const sectionEnd = this.readSectionUC.getSectionEndLine(
            doc,
            section,
            false,
          );
          const contentLines = doc.lines.slice(section.line, sectionEnd);
          const msg = contentLines.join("\n").trim();
          entries.push({ ts: section.title, msg });
        }
      }
    }

    // Parse checkpoints (## sections under # Checkpoints)
    if (checkpointsSection) {
      const checkpointsEnd = this.readSectionUC.getSectionEndLine(
        doc,
        checkpointsSection,
        true,
      );

      // Only consider level-2 sections with timestamp-like titles
      const timestampRegex = /^\d{4}-\d{2}-\d{2}/;
      const checkpointSections = doc.sections.filter(
        (s) =>
          s.level === 2 &&
          s.line > checkpointsSection.line &&
          s.line <= checkpointsEnd &&
          timestampRegex.test(s.title),
      );

      for (let i = 0; i < checkpointSections.length; i++) {
        const section = checkpointSections[i];
        const nextSection = checkpointSections[i + 1];
        const cpEnd = nextSection ? nextSection.line - 1 : checkpointsEnd;

        // Scan raw lines for ### Changes and ### Learnings headers
        let changesHeaderIdx = -1;
        let learningsHeaderIdx = -1;

        for (let lineIdx = section.line; lineIdx < cpEnd; lineIdx++) {
          const line = doc.lines[lineIdx];
          if (/^###\s+Changes\s*$/.test(line)) changesHeaderIdx = lineIdx;
          else if (/^###\s+Learnings\s*$/.test(line)) {
            learningsHeaderIdx = lineIdx;
          }
        }

        let changes = "";
        let learnings = "";

        if (changesHeaderIdx >= 0) {
          const contentEnd = learningsHeaderIdx >= 0
            ? learningsHeaderIdx
            : cpEnd;
          changes = doc.lines.slice(changesHeaderIdx + 1, contentEnd).join("\n")
            .trim();
        }

        if (learningsHeaderIdx >= 0) {
          learnings = doc.lines.slice(learningsHeaderIdx + 1, cpEnd).join("\n")
            .trim();
        }

        checkpoints.push({ ts: section.title, changes, learnings });
      }
    }

    // Parse todos (list items under # TODO)
    const todos: Todo[] = [];
    const todosId = await this.getTodosId();
    const todosSection = this.findSection(doc, todosId);

    if (todosSection) {
      const todosEnd = this.readSectionUC.getSectionEndLine(
        doc,
        todosSection,
        true,
      );

      for (let i = todosSection.line + 1; i < todosEnd; i++) {
        const line = doc.lines[i];

        // Match todo line: - [X] text  [key:: value] ... ^id
        const todoMatch = line.match(/^-\s*\[(.)\]\s*(.+)$/);
        if (!todoMatch) continue;

        const statusChar = todoMatch[1];
        const rest = todoMatch[2];

        // Extract status
        const statusMap: Record<string, TodoStatus> = {
          " ": "todo",
          "/": "wip",
          ">": "blocked",
          "-": "cancelled",
          "x": "done",
        };
        const status = statusMap[statusChar] || "todo";

        // Extract block reference ^id at the end
        const blockRefMatch = rest.match(/\^(\w+)\s*$/);
        if (!blockRefMatch) continue; // Skip if no block ref

        const id = blockRefMatch[1];
        const beforeBlockRef = rest.substring(0, blockRefMatch.index).trim();

        // Extract all metadata [key:: value]
        const metadata: Record<string, string> = {};
        let text = beforeBlockRef;
        const metadataRegex = /\[(\w+)::\s*([^\]]+)\]/g;
        let match;

        while ((match = metadataRegex.exec(beforeBlockRef)) !== null) {
          const key = match[1];
          const value = match[2].trim();
          if (key !== "id") {
            metadata[key] = value;
          }
        }

        // Remove metadata from text
        text = text.replace(/\s*\[(\w+)::\s*([^\]]+)\]/g, "").trim();

        todos.push({ id, text, status, metadata });
      }
    }

    return { meta, entries, checkpoints, todos };
  }

  // =========================================================================
  // MarkdownService.serializeTask
  // Produces the EXACT same markdown format as cmdAdd() in cli.ts
  // =========================================================================

  serializeTask(
    meta: TaskMeta,
    entries: readonly Entry[],
    checkpoints: readonly Checkpoint[],
    todos: readonly Todo[],
  ): string {
    // Build frontmatter
    const escapedName = meta.name.replace(/"/g, '\\"');
    const escapedDesc = meta.desc.replace(/"/g, '\\"');

    let metadataYaml = "";
    if (meta.metadata && Object.keys(meta.metadata).length > 0) {
      metadataYaml = "\nmetadata:\n";
      for (const [key, value] of Object.entries(meta.metadata)) {
        const escapedValue =
          value.includes(":") || value.includes("#") || value.includes('"')
            ? `"${value.replace(/"/g, '\\"')}"`
            : value;
        metadataYaml += `  ${key}: ${escapedValue}\n`;
      }
    }

    let tagsYaml = "";
    if (meta.tags && meta.tags.length > 0) {
      tagsYaml = "\ntags:\n";
      for (const tag of meta.tags) {
        tagsYaml += `  - ${tag}\n`;
      }
    }

    // Format nullable timestamp fields
    const readyAt = meta.ready_at ? `"${meta.ready_at}"` : "null";
    const startedAt = meta.started_at ? `"${meta.started_at}"` : "null";
    const doneAt = meta.done_at ? `"${meta.done_at}"` : "null";
    const lastCheckpoint = meta.last_checkpoint
      ? `"${meta.last_checkpoint}"`
      : "null";

    let content = `---
id: ${meta.id}
uid: ${meta.uid}
name: "${escapedName}"
desc: "${escapedDesc}"
status: ${meta.status}
created_at: "${meta.created_at}"
ready_at: ${readyAt}
started_at: ${startedAt}
done_at: ${doneAt}
last_checkpoint: ${lastCheckpoint}
has_uncheckpointed_entries: ${meta.has_uncheckpointed_entries}${metadataYaml}${tagsYaml}
---

# Entries
`;

    // Add entries
    for (const entry of entries) {
      content += `\n## ${entry.ts}\n${entry.msg}\n`;
    }

    content += `\n# Checkpoints`;

    // Add checkpoints
    for (const cp of checkpoints) {
      content +=
        `\n\n## ${cp.ts}\n\n### Changes\n${cp.changes}\n\n### Learnings\n${cp.learnings}\n`;
    }

    // Add todos if any
    if (todos.length > 0) {
      content += "\n# TODO\n\n";

      const statusChars: Record<TodoStatus, string> = {
        "todo": " ",
        "wip": "/",
        "blocked": ">",
        "cancelled": "-",
        "done": "x",
      };

      for (const todo of todos) {
        const statusChar = statusChars[todo.status];
        let line = `- [${statusChar}] ${todo.text}`;

        // Add metadata
        for (const [key, value] of Object.entries(todo.metadata)) {
          line += `  [${key}:: ${value}]`;
        }

        line += ` ^${todo.id}`;
        content += `${line}\n`;
      }
    }

    content += "\n";

    return content;
  }

  // =========================================================================
  // MarkdownService.appendEntry
  // Exact replica of the entry insertion logic from cmdTrace() in cli.ts
  // =========================================================================

  async appendEntry(content: string, entry: Entry): Promise<string> {
    const doc = await this.parseDocumentUC.execute({ content });
    const entriesId = await this.getEntriesId();
    const checkpointsId = await this.getCheckpointsId();

    const entriesSection = this.findSection(doc, entriesId);
    const checkpointsSection = this.findSection(doc, checkpointsId);

    if (!entriesSection) {
      throw new Error("Invalid task file: missing # Entries section");
    }

    // Find insertion point: before # Checkpoints if it exists
    const insertLine = checkpointsSection
      ? checkpointsSection.line - 2 // Before blank line before # Checkpoints
      : this.readSectionUC.getSectionEndLine(doc, entriesSection, true);

    const entryText = `\n## ${entry.ts}\n${entry.msg}\n`;
    const entryLines = entryText.split("\n");

    // Copy to mutable array (doc.lines is readonly)
    const mutableLines = [...doc.lines];
    mutableLines.splice(insertLine, 0, ...entryLines);

    return mutableLines.join("\n");
  }

  // =========================================================================
  // MarkdownService.appendCheckpoint
  // Exact replica of the checkpoint insertion logic from cmdCheckpoint() in cli.ts
  // =========================================================================

  async appendCheckpoint(
    content: string,
    checkpoint: Checkpoint,
  ): Promise<string> {
    const doc = await this.parseDocumentUC.execute({ content });
    const checkpointsId = await this.getCheckpointsId();
    const checkpointsSection = this.findSection(doc, checkpointsId);

    if (!checkpointsSection) {
      throw new Error("Invalid task file: missing # Checkpoints section");
    }

    const checkpointsEnd = this.readSectionUC.getSectionEndLine(
      doc,
      checkpointsSection,
      true,
    );

    const cpText = `
## ${checkpoint.ts}

### Changes
${checkpoint.changes}

### Learnings
${checkpoint.learnings}
`;

    // Copy to mutable array (doc.lines is readonly)
    const mutableLines = [...doc.lines];
    mutableLines.splice(checkpointsEnd, 0, ...cpText.split("\n"));

    return mutableLines.join("\n");
  }

  // =========================================================================
  // MarkdownService.updateFrontmatter
  // Replicates the frontmatter update pattern used throughout cli.ts:
  //   getFrontmatterContent -> parseFrontmatter -> modify -> stringifyFrontmatter -> setFrontmatter
  // =========================================================================

  async updateFrontmatter(
    content: string,
    updates: Record<string, unknown>,
  ): Promise<string> {
    const doc = await this.parseDocumentUC.execute({ content });
    const yamlContent = this.frontmatterUC.getFrontmatterContent(doc);
    const frontmatter = this.yamlService.parse(yamlContent);

    // Apply updates
    for (const [key, value] of Object.entries(updates)) {
      frontmatter[key] = value;
    }

    // Rebuild frontmatter and apply to document
    const newYaml = this.yamlService.stringify(frontmatter);
    const newFrontmatter = newYaml.trim()
      ? `---\n${newYaml.trim()}\n---`
      : null;

    if (doc.frontmatter && newFrontmatter) {
      // Replace existing frontmatter lines
      const oldEndLine = doc.frontmatterEndLine;
      const newFmLines = newFrontmatter.split("\n");
      const updatedLines = [...newFmLines, ...doc.lines.slice(oldEndLine)];
      return updatedLines.join("\n");
    } else if (newFrontmatter) {
      // Add new frontmatter at the beginning
      const newFmLines = newFrontmatter.split("\n");
      return [...newFmLines, "", ...doc.lines].join("\n");
    }

    return doc.lines.join("\n");
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private findSection(doc: Document, id: string): Section | undefined {
    return this.readSectionUC.findSection(doc, id);
  }
}
