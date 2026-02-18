/**
 * CLI commands for markdown-surgeon.
 *
 * Wires Cliffy commands to use cases, adapters, and formatters.
 * Each command: read file -> call use case -> write file (if mutation) -> format output.
 */

import { Command } from "@cliffy/command";
import { expandGlob } from "@std/fs";
import { MdError } from "../../domain/entities/document.ts";
import type { HashService } from "../../domain/ports/hash-service.ts";
import type { YamlService } from "../../domain/ports/yaml-service.ts";
import { ParseDocumentUseCase } from "../../domain/use-cases/parse-document.ts";
import { ReadSectionUseCase } from "../../domain/use-cases/read-section.ts";
import { WriteSectionUseCase } from "../../domain/use-cases/write-section.ts";
import { AppendSectionUseCase } from "../../domain/use-cases/append-section.ts";
import { RemoveSectionUseCase } from "../../domain/use-cases/remove-section.ts";
import { SearchUseCase } from "../../domain/use-cases/search.ts";
import { ManageFrontmatterUseCase } from "../../domain/use-cases/manage-frontmatter.ts";
import {
  formatMutation,
  formatOutline,
  formatRead,
  formatSearchMatches,
  formatSearchSummary,
  jsonMutation,
  jsonOutline,
  jsonRead,
  jsonSearchMatches,
  jsonSearchSummary,
} from "./formatter.ts";

// ============================================================================
// Magic expressions expansion (inlined from magic.ts)
// ============================================================================

function getLocalISOString(): string {
  const now = new Date();
  const tzOffset = -now.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(tzOffset) % 60).padStart(2, "0");

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hours}:${minutes}`;
}

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalTime(): string {
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${hour}:${minute}:${second}`;
}

function getShortDateTime(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function expandMagic(
  input: string,
  meta?: Record<string, unknown>,
  yamlService?: YamlService,
): string {
  return input.replace(/\{([^}]+)\}/g, (match, expr: string) => {
    const trimmed = expr.trim();

    if (trimmed === "datetime" || trimmed === "dt") {
      return getLocalISOString();
    }

    if (trimmed === "datetime:short" || trimmed === "dt:short") {
      return getShortDateTime();
    }

    if (trimmed === "date") {
      return getLocalDate();
    }

    if (trimmed === "time") {
      return getLocalTime();
    }

    if (trimmed.startsWith("meta:") && meta && yamlService) {
      const key = trimmed.slice(5);
      const value = yamlService.getNestedValue(meta, key);
      if (value !== undefined && value !== null) {
        return yamlService.formatValue(value);
      }
      return "";
    }

    // Unknown expression, leave as-is
    return match;
  });
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if a string looks like a valid section ID (8 hex chars) */
function isValidId(id: string): boolean {
  return /^[0-9a-f]{8}$/i.test(id);
}

function handleError(e: unknown): never {
  if (e instanceof MdError) {
    console.error(e.format());
    Deno.exit(1);
  }
  throw e;
}

async function readFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new MdError("file_not_found", `File not found: ${path}`, path);
    }
    throw new MdError("io_error", `Failed to read file: ${path}`, path);
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  try {
    await Deno.writeTextFile(path, content);
  } catch {
    throw new MdError("io_error", `Failed to write file: ${path}`, path);
  }
}

async function readStdin(): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(combined);
}

/**
 * Expand file patterns (globs or explicit paths) into list of file paths
 */
async function expandFilePatterns(patterns: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of patterns) {
    if (
      pattern.includes("*") || pattern.includes("?") || pattern.includes("[")
    ) {
      for await (
        const entry of expandGlob(pattern, {
          extended: true,
          globstar: true,
          includeDirs: false,
        })
      ) {
        if (entry.isFile && entry.name.endsWith(".md")) {
          files.push(entry.path);
        }
      }
    } else {
      try {
        const stat = await Deno.stat(pattern);
        if (stat.isFile) {
          files.push(pattern);
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          throw new MdError(
            "file_not_found",
            `File not found: ${pattern}`,
            pattern,
          );
        }
        throw e;
      }
    }
  }

  if (files.length === 0) {
    throw new MdError(
      "file_not_found",
      "No markdown files found matching patterns",
    );
  }

  return [...new Set(files)];
}

/**
 * Parse --meta key=value into tuple
 */
function parseMetaOption(value: string): [string, string] {
  const eqIdx = value.indexOf("=");
  if (eqIdx <= 0) {
    throw new Error(`Invalid --meta format: ${value}. Expected key=value`);
  }
  return [value.slice(0, eqIdx), value.slice(eqIdx + 1)];
}

// ============================================================================
// Dependencies container
// ============================================================================

export interface CommandDeps {
  hashService: HashService;
  yamlService: YamlService;
}

// ============================================================================
// Command factories
// ============================================================================

export function createCommands(deps: CommandDeps) {
  const { hashService, yamlService } = deps;

  // Instantiate use cases
  const parseDocument = new ParseDocumentUseCase(hashService);
  const readSection = new ReadSectionUseCase();
  const writeSection = new WriteSectionUseCase();
  const appendSection = new AppendSectionUseCase(hashService);
  const removeSection = new RemoveSectionUseCase();
  const searchUseCase = new SearchUseCase();
  const manageFrontmatter = new ManageFrontmatterUseCase(yamlService);

  // ========================================================================
  // Command implementations
  // ========================================================================

  async function cmdOutline(
    file: string,
    afterId: string | null,
    last: boolean,
    count: boolean,
    json: boolean,
  ): Promise<string> {
    const content = await readFile(file);
    const doc = await parseDocument.execute({ content });

    let sections = [...doc.sections];

    if (afterId) {
      if (!isValidId(afterId)) {
        throw new MdError(
          "invalid_id",
          `Invalid section ID: ${afterId}`,
          file,
          afterId,
        );
      }
      const parentSection = readSection.findSection(doc, afterId);
      if (!parentSection) {
        throw new MdError(
          "section_not_found",
          `No section with id '${afterId}' in ${file}`,
          file,
          afterId,
        );
      }

      const parentEndLine = readSection.getSectionEndLine(
        doc,
        parentSection,
        true,
      );
      sections = doc.sections.filter(
        (s) =>
          s.line > parentSection.line && s.line <= parentEndLine &&
          s.level > parentSection.level,
      );
    }

    if (count) {
      return json
        ? JSON.stringify({ count: sections.length })
        : String(sections.length);
    }

    if (last) {
      if (sections.length === 0) {
        return json ? "null" : "";
      }
      const lastSection = sections[sections.length - 1];
      if (json) {
        return JSON.stringify({
          id: lastSection.id,
          level: lastSection.level,
          title: lastSection.title,
          line: lastSection.line,
        });
      }
      return `${
        "#".repeat(lastSection.level)
      } ${lastSection.title} ^${lastSection.id} L${lastSection.line}`;
    }

    return json
      ? jsonOutline({ ...doc, sections })
      : formatOutline({ ...doc, sections });
  }

  async function cmdRead(
    file: string,
    id: string,
    deep: boolean,
    json: boolean,
  ): Promise<string> {
    if (!isValidId(id)) {
      throw new MdError("invalid_id", `Invalid section ID: ${id}`, file, id);
    }

    const content = await readFile(file);
    const doc = await parseDocument.execute({ content });

    const section = readSection.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `No section with id '${id}' in ${file}`,
        file,
        id,
      );
    }

    const endLine = readSection.getSectionEndLine(doc, section, deep);
    const sectionContent = doc.lines.slice(section.line, endLine).join("\n");
    return json
      ? jsonRead(section, sectionContent, endLine)
      : formatRead(section, sectionContent, endLine);
  }

  async function cmdWrite(
    file: string,
    id: string,
    newContent: string,
    deep: boolean,
    json: boolean,
  ): Promise<string> {
    if (!isValidId(id)) {
      throw new MdError("invalid_id", `Invalid section ID: ${id}`, file, id);
    }

    const fileContent = await readFile(file);
    const doc = await parseDocument.execute({ content: fileContent });

    // Expand magic expressions
    const fmContent = manageFrontmatter.getFrontmatterContent(doc);
    const meta = yamlService.parse(fmContent);
    const expandedContent = expandMagic(newContent, meta, yamlService);

    const { result, updatedLines } = writeSection.execute({
      doc,
      id,
      content: expandedContent,
      deep,
    });

    await writeFile(file, updatedLines.join("\n"));

    return json ? jsonMutation(result) : formatMutation(result);
  }

  async function cmdAppend(
    file: string,
    id: string | null,
    newContent: string,
    deep: boolean,
    before: boolean,
    json: boolean,
  ): Promise<string> {
    const fileContent = await readFile(file);
    const doc = await parseDocument.execute({ content: fileContent });

    // Expand magic expressions
    const fmContent = manageFrontmatter.getFrontmatterContent(doc);
    const meta = yamlService.parse(fmContent);
    const expandedContent = expandMagic(newContent, meta, yamlService);

    const { result, updatedLines } = await appendSection.execute({
      doc,
      id,
      content: expandedContent,
      deep,
      before,
    });

    await writeFile(file, updatedLines.join("\n"));

    return json ? jsonMutation(result) : formatMutation(result);
  }

  async function cmdEmpty(
    file: string,
    id: string,
    deep: boolean,
    json: boolean,
  ): Promise<string> {
    if (!isValidId(id)) {
      throw new MdError("invalid_id", `Invalid section ID: ${id}`, file, id);
    }

    const fileContent = await readFile(file);
    const doc = await parseDocument.execute({ content: fileContent });

    const section = readSection.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `No section with id '${id}' in ${file}`,
        file,
        id,
      );
    }

    const { result, updatedLines } = removeSection.empty({ doc, id, deep });

    await writeFile(file, updatedLines.join("\n"));

    return json ? jsonMutation(result) : formatMutation(result);
  }

  async function cmdRemove(
    file: string,
    id: string,
    json: boolean,
  ): Promise<string> {
    if (!isValidId(id)) {
      throw new MdError("invalid_id", `Invalid section ID: ${id}`, file, id);
    }

    const fileContent = await readFile(file);
    const doc = await parseDocument.execute({ content: fileContent });

    const section = readSection.findSection(doc, id);
    if (!section) {
      throw new MdError(
        "section_not_found",
        `No section with id '${id}' in ${file}`,
        file,
        id,
      );
    }

    const { result, updatedLines } = removeSection.remove({ doc, id });

    await writeFile(file, updatedLines.join("\n"));

    return json ? jsonMutation(result) : formatMutation(result);
  }

  async function cmdSearch(
    file: string,
    pattern: string,
    summary: boolean,
    json: boolean,
  ): Promise<string> {
    const content = await readFile(file);
    const doc = await parseDocument.execute({ content });

    const { matches, summaries } = searchUseCase.execute({ doc, pattern });

    if (!summary) {
      return json ? jsonSearchMatches(matches) : formatSearchMatches(matches);
    }

    return json ? jsonSearchSummary(summaries) : formatSearchSummary(summaries);
  }

  async function cmdMeta(
    file: string | string[],
    key: string | null,
    value: string | null,
    del: boolean,
    getH1: boolean,
    list: string | null,
    aggregate: string | null,
    count: string | null,
    json: boolean,
  ): Promise<string> {
    // --list mode: concat with duplicates
    if (list !== null) {
      const files = Array.isArray(file) ? file : [file];
      const fields = list.split(",").map((f) => f.trim());

      if (del || value !== null) {
        throw new MdError(
          "parse_error",
          "Cannot use --set/--del with --list",
        );
      }

      const expandedFiles = await expandFilePatterns(files);
      const allValues: unknown[] = [];

      for (const f of expandedFiles) {
        try {
          const content = await readFile(f);
          const doc = await parseDocument.execute({ content });
          const yamlContent = manageFrontmatter.getFrontmatterContent(doc);
          const meta = yamlService.parse(yamlContent);

          for (const field of fields) {
            const val = yamlService.getNestedValue(meta, field);
            if (val === undefined || val === null) continue;
            if (Array.isArray(val)) {
              allValues.push(...val);
            } else {
              allValues.push(val);
            }
          }
        } catch {
          continue;
        }
      }

      if (json) {
        return JSON.stringify(allValues);
      } else {
        return allValues.map((v) => yamlService.formatValue(v)).join("\n");
      }
    }

    // --aggregate mode: unique values with counts
    if (aggregate !== null) {
      const files = Array.isArray(file) ? file : [file];
      const fields = aggregate.split(",").map((f) => f.trim());

      if (del || value !== null) {
        throw new MdError(
          "parse_error",
          "Cannot use --set/--del with --aggregate",
        );
      }

      const expandedFiles = await expandFilePatterns(files);
      const fieldCounts = new Map<string, Map<string, number>>();
      for (const field of fields) {
        fieldCounts.set(field, new Map<string, number>());
      }

      for (const f of expandedFiles) {
        try {
          const content = await readFile(f);
          const doc = await parseDocument.execute({ content });
          const yamlContent = manageFrontmatter.getFrontmatterContent(doc);
          const meta = yamlService.parse(yamlContent);

          for (const field of fields) {
            const val = yamlService.getNestedValue(meta, field);
            if (val === undefined || val === null) continue;

            const counts = fieldCounts.get(field)!;
            const values = Array.isArray(val) ? val : [val];

            for (const v of values) {
              const k = typeof v === "object" ? JSON.stringify(v) : String(v);
              counts.set(k, (counts.get(k) ?? 0) + 1);
            }
          }
        } catch {
          continue;
        }
      }

      if (json) {
        const result: Record<string, Record<string, number>> = {};
        for (const [field, counts] of fieldCounts.entries()) {
          result[field] = Object.fromEntries(counts.entries());
        }
        return JSON.stringify(fields.length === 1 ? result[fields[0]] : result);
      } else {
        const lines: string[] = [];
        for (const field of fields) {
          const counts = fieldCounts.get(field)!;
          if (fields.length > 1) {
            lines.push(`${field}:`);
          }
          const sorted = Array.from(counts.entries()).sort(
            (a, b) => b[1] - a[1],
          );
          for (const [v, c] of sorted) {
            const prefix = fields.length > 1 ? "  " : "";
            lines.push(`${prefix}${c} ${v}`);
          }
        }
        return lines.join("\n");
      }
    }

    // --count mode: total counts only
    if (count !== null) {
      const files = Array.isArray(file) ? file : [file];
      const fields = count.split(",").map((f) => f.trim());

      if (del || value !== null) {
        throw new MdError(
          "parse_error",
          "Cannot use --set/--del with --count",
        );
      }

      const expandedFiles = await expandFilePatterns(files);
      const fieldCounts = new Map<string, Map<string, number>>();
      for (const field of fields) {
        fieldCounts.set(field, new Map<string, number>());
      }

      for (const f of expandedFiles) {
        try {
          const content = await readFile(f);
          const doc = await parseDocument.execute({ content });
          const yamlContent = manageFrontmatter.getFrontmatterContent(doc);
          const meta = yamlService.parse(yamlContent);

          for (const field of fields) {
            const val = yamlService.getNestedValue(meta, field);
            if (val === undefined || val === null) continue;

            const counts = fieldCounts.get(field)!;
            const values = Array.isArray(val) ? val : [val];

            for (const v of values) {
              const k = typeof v === "object" ? JSON.stringify(v) : String(v);
              counts.set(k, (counts.get(k) ?? 0) + 1);
            }
          }
        } catch {
          continue;
        }
      }

      if (json) {
        const totals: Record<string, number> = {};
        for (const [field, counts] of fieldCounts.entries()) {
          totals[field] = Array.from(counts.values()).reduce(
            (sum, c) => sum + c,
            0,
          );
        }
        return JSON.stringify(fields.length === 1 ? totals[fields[0]] : totals);
      } else {
        const lines: string[] = [];
        for (const field of fields) {
          const counts = fieldCounts.get(field)!;
          const total = Array.from(counts.values()).reduce(
            (sum, c) => sum + c,
            0,
          );
          if (fields.length > 1) {
            lines.push(`${field}: ${total}`);
          } else {
            lines.push(String(total));
          }
        }
        return lines.join("\n");
      }
    }

    // Single-file mode
    if (Array.isArray(file)) {
      throw new MdError(
        "parse_error",
        "Multiple files require --list, --aggregate, or --count flag",
      );
    }

    const fileContent = await readFile(file);
    const doc = await parseDocument.execute({ content: fileContent });

    // Get h1 title
    if (getH1) {
      const h1 = doc.sections.find((s) => s.level === 1);
      return h1 ? h1.title : "";
    }

    const yamlContent = manageFrontmatter.getFrontmatterContent(doc);
    const meta = yamlService.parse(yamlContent);

    // Delete mode
    if (del) {
      if (!key) {
        throw new MdError("parse_error", "Usage: md meta <file> --del <key>");
      }
      const { updatedLines, message } = manageFrontmatter.delete({
        doc,
        key,
      });
      await writeFile(file, updatedLines.join("\n"));
      return message;
    }

    // Set mode
    if (value !== null) {
      if (!key) {
        throw new MdError(
          "parse_error",
          "Usage: md meta <file> --set <key> <value>",
        );
      }
      const expandedValue = expandMagic(value, meta, yamlService);
      const { updatedLines, message } = manageFrontmatter.set({
        doc,
        key,
        value: expandedValue,
      });
      await writeFile(file, updatedLines.join("\n"));
      return message;
    }

    // Get mode
    if (key) {
      const val = yamlService.getNestedValue(meta, key);
      return yamlService.formatValue(val);
    }

    // Show all
    return yamlContent;
  }

  async function cmdCreate(
    file: string,
    title: string | null,
    metaEntries: Array<[string, string]>,
    force: boolean,
    content: string | null,
  ): Promise<string> {
    let fileExists = false;
    try {
      await Deno.stat(file);
      fileExists = true;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw new MdError("io_error", `Failed to check file: ${file}`, file);
      }
    }

    if (fileExists && !force) {
      throw new MdError(
        "io_error",
        `File already exists: ${file}. Use --force to overwrite.`,
        file,
      );
    }

    const lines: string[] = [];

    // Build frontmatter if any meta entries (expand magic expressions)
    const meta: Record<string, unknown> = {};
    if (metaEntries.length > 0) {
      for (const [k, v] of metaEntries) {
        const expandedValue = expandMagic(v, meta, yamlService);
        yamlService.setNestedValue(meta, k, expandedValue);
      }
      const yaml = yamlService.stringify(meta);
      lines.push("---", yaml, "---", "");
    }

    // Add title if provided (expand magic expressions)
    if (title) {
      const expandedTitle = expandMagic(title, meta, yamlService);
      lines.push(`# ${expandedTitle}`, "");
    }

    // Add initial content if provided (expand magic expressions)
    if (content) {
      const expandedContent = expandMagic(content, meta, yamlService);
      lines.push(expandedContent);
    }

    await writeFile(file, lines.join("\n"));
    return `created ${file}`;
  }

  async function cmdConcat(files: string[], shift: number): Promise<string> {
    const outputs: string[] = [];
    let firstFrontmatter: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const content = await readFile(files[i]);
      const doc = await parseDocument.execute({ content });

      if (i === 0 && doc.frontmatter) {
        firstFrontmatter = doc.frontmatter;
      }

      const startLine = doc.frontmatterEndLine;
      let fileLines = doc.lines.slice(startLine);

      if (shift > 0) {
        fileLines = fileLines.map((line) => {
          const match = line.match(/^(#{1,6})\s+(.+)$/);
          if (match) {
            const newLevel = Math.min(6, match[1].length + shift);
            return "#".repeat(newLevel) + " " + match[2];
          }
          return line;
        });
      }

      outputs.push(fileLines.join("\n"));
    }

    let result = outputs.join("\n\n");
    if (firstFrontmatter) {
      result = firstFrontmatter + "\n\n" + result;
    }

    return result;
  }

  // ========================================================================
  // Cliffy command objects
  // ========================================================================

  const outlineCmd = new Command()
    .description("List sections in a Markdown file")
    .arguments("<file:string>")
    .option(
      "--after <id:string>",
      "Show only subsections after this section ID",
    )
    .option("--last", "Show only the last subsection")
    .option("--count", "Show count only")
    .option("--json", "Output as JSON")
    .action(async (options, file) => {
      try {
        const output = await cmdOutline(
          file,
          options.after ?? null,
          options.last ?? false,
          options.count ?? false,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const readCmd = new Command()
    .description("Read section content")
    .arguments("<file:string> <id:string>")
    .option("--deep", "Include subsections")
    .option("--json", "Output as JSON")
    .action(async (options, file, id) => {
      try {
        const output = await cmdRead(
          file,
          id,
          options.deep ?? false,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const writeCmdObj = new Command()
    .description("Update section content")
    .arguments("<file:string> <id:string> [content:string]")
    .option("--deep", "Replace including subsections")
    .option("--json", "Output as JSON")
    .action(async (options, file, id, content) => {
      try {
        const actualContent = content ?? await readStdin();
        const output = await cmdWrite(
          file,
          id,
          actualContent,
          options.deep ?? false,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const appendCmdObj = new Command()
    .description("Append content to a section")
    .arguments("<file:string> [idOrContent:string] [content:string]")
    .option("--deep", "Append after subsections")
    .option("--before", "Insert before section instead of after")
    .option("--json", "Output as JSON")
    .action(async (options, file, idOrContent, content) => {
      try {
        const hasId = idOrContent !== undefined && isValidId(idOrContent);
        const id = hasId ? idOrContent : null;
        const actualContent = hasId
          ? (content ?? await readStdin())
          : (idOrContent ?? await readStdin());
        const output = await cmdAppend(
          file,
          id,
          actualContent,
          options.deep ?? false,
          options.before ?? false,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const emptyCmdObj = new Command()
    .description("Empty a section (keep header)")
    .arguments("<file:string> <id:string>")
    .option("--deep", "Also empty subsections")
    .option("--json", "Output as JSON")
    .action(async (options, file, id) => {
      try {
        const output = await cmdEmpty(
          file,
          id,
          options.deep ?? false,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const removeCmdObj = new Command()
    .description("Remove a section and its subsections")
    .arguments("<file:string> <id:string>")
    .option("--json", "Output as JSON")
    .action(async (options, file, id) => {
      try {
        const output = await cmdRemove(file, id, options.json ?? false);
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const searchCmdObj = new Command()
    .description("Search for a pattern in a file")
    .arguments("<file:string> <pattern:string>")
    .option("--summary", "Group results by section")
    .option("--json", "Output as JSON")
    .action(async (options, file, pattern) => {
      try {
        const output = await cmdSearch(
          file,
          pattern,
          options.summary ?? false,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const concatCmdObj = new Command()
    .description("Concatenate multiple Markdown files")
    .arguments("<files...:string>")
    .option("-s, --shift <n:number>", "Shift header levels by N", {
      default: 0,
    })
    .action(async (options, ...files) => {
      try {
        const output = await cmdConcat(files, options.shift);
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const metaCmdObj = new Command()
    .description("Manage YAML frontmatter")
    .arguments("<fileOrKey:string> [args...:string]")
    .option(
      "--list <fields:string>",
      "List metadata from multiple files (concat with duplicates)",
    )
    .option(
      "--aggregate <fields:string>",
      "Show unique metadata values with counts from multiple files",
    )
    .option(
      "--count <fields:string>",
      "Show total count only from multiple files",
    )
    .option("--set", "Set a key (single file only)")
    .option("--del", "Delete a key (single file only)")
    .option("--h1", "Get the H1 title (single file only)")
    .option("--json", "Output as JSON")
    .action(async (options, fileOrKey, ...args) => {
      try {
        let file: string | string[];
        let key: string | null = null;
        let value: string | null = null;

        if (options.list || options.aggregate || options.count) {
          file = [fileOrKey, ...args];
        } else {
          file = fileOrKey;
          key = args[0] ?? null;
          value = args[1] ?? null;

          if (options.set && key !== null) {
            value = value ?? null;
          }
        }

        const output = await cmdMeta(
          file,
          key,
          options.set ? (value ?? null) : value,
          options.del ?? false,
          options.h1 ?? false,
          options.list ?? null,
          options.aggregate ?? null,
          options.count ?? null,
          options.json ?? false,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  const createCmdObj = new Command()
    .description("Create a new Markdown file")
    .arguments("<file:string> [content:string]")
    .option("--title <title:string>", "Set the H1 title")
    .option("--meta <kv:string>", "Set frontmatter key=value (repeatable)", {
      collect: true,
    })
    .option("--force", "Overwrite existing file")
    .action(async (options, file, content) => {
      try {
        const metaEntries: Array<[string, string]> = (options.meta ?? []).map(
          parseMetaOption,
        );
        const output = await cmdCreate(
          file,
          options.title ?? null,
          metaEntries,
          options.force ?? false,
          content ?? null,
        );
        if (output) console.log(output);
      } catch (e) {
        handleError(e);
      }
    });

  return {
    outlineCmd,
    readCmd,
    writeCmd: writeCmdObj,
    appendCmd: appendCmdObj,
    emptyCmd: emptyCmdObj,
    removeCmd: removeCmdObj,
    searchCmd: searchCmdObj,
    concatCmd: concatCmdObj,
    metaCmd: metaCmdObj,
    createCmd: createCmdObj,
  };
}
