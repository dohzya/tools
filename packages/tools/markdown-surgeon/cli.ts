import { Command } from "@cliffy/command";
import { expandGlob } from "@std/fs";
import {
  type Document,
  MdError,
  type MutationResult,
  type SearchMatch,
  type SearchSummary,
  type Section,
} from "./types.ts";
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
} from "./parser.ts";
import { isValidId } from "./hash.ts";
import {
  deleteNestedValue,
  formatValue,
  getNestedValue,
  parseFrontmatter,
  setNestedValue,
  stringifyFrontmatter,
} from "./yaml.ts";
import { expandMagic } from "./magic.ts";

// ============================================================================
// Version
// ============================================================================

const VERSION = "0.5.1";

// ============================================================================
// Output formatters (text)
// ============================================================================

function formatOutline(doc: Document): string {
  return doc.sections
    .map((s) => `${"#".repeat(s.level)} ${s.title} ^${s.id} L${s.line}`)
    .join("\n");
}

function formatRead(
  section: Section,
  content: string,
  endLine: number,
): string {
  const header = `${
    "#".repeat(section.level)
  } ${section.title} ^${section.id} L${section.line}-L${endLine}`;
  if (content.trim() === "") {
    return header;
  }
  return `${header}\n\n${content}`;
}

function formatMutation(result: MutationResult): string {
  const range = result.lineEnd
    ? `L${result.lineStart}-L${result.lineEnd}`
    : `L${result.lineStart}`;
  const delta = [];
  if (result.linesAdded > 0) delta.push(`+${result.linesAdded}`);
  if (result.linesRemoved > 0) delta.push(`-${result.linesRemoved}`);
  const deltaStr = delta.length > 0 ? ` (${delta.join(", ")})` : "";
  return `${result.action} ^${result.id} ${range}${deltaStr}`;
}

function formatSearchMatches(matches: SearchMatch[]): string {
  return matches
    .map((m) => {
      const sectionPart = m.sectionId ? `^${m.sectionId}` : "^-";
      return `${sectionPart} L${m.line} ${m.content}`;
    })
    .join("\n");
}

function formatSearchSummary(summaries: SearchSummary[]): string {
  return summaries
    .map((s) => {
      const header = `${"#".repeat(s.level)} ${s.title}`;
      const lines = s.lines.map((l) => `L${l}`).join(",");
      const matchWord = s.matchCount === 1 ? "match" : "matches";
      return `${header} ^${s.id} ${lines} (${s.matchCount} ${matchWord})`;
    })
    .join("\n");
}

// ============================================================================
// Output formatters (JSON)
// ============================================================================

function jsonOutline(doc: Document): string {
  return JSON.stringify(
    doc.sections.map((s) => ({
      id: s.id,
      level: s.level,
      title: s.title,
      line: s.line,
    })),
  );
}

function jsonRead(section: Section, content: string, endLine: number): string {
  return JSON.stringify({
    id: section.id,
    level: section.level,
    title: section.title,
    lineStart: section.line,
    lineEnd: endLine,
    content,
  });
}

function jsonMutation(result: MutationResult): string {
  return JSON.stringify(result);
}

function jsonSearchMatches(matches: SearchMatch[]): string {
  return JSON.stringify(matches);
}

function jsonSearchSummary(summaries: SearchSummary[]): string {
  return JSON.stringify(summaries);
}

// ============================================================================
// File I/O
// ============================================================================

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
    // Check if contains glob characters
    if (
      pattern.includes("*") || pattern.includes("?") || pattern.includes("[")
    ) {
      // Use Deno's expandGlob
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
      // Regular file path
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

  return [...new Set(files)]; // deduplicate
}

/**
 * Aggregate metadata values from multiple files
 * @param mode "list" = concat with duplicates, "set" = unique values only
 */
async function aggregateMetadata(
  files: string[],
  fields: string[],
  mode: "list" | "set",
): Promise<unknown[]> {
  const allValues: unknown[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file);
      const doc = await parseDocument(content);
      const yamlContent = getFrontmatterContent(doc);
      const meta = parseFrontmatter(yamlContent);

      // Extract values for each field
      for (const field of fields) {
        const value = getNestedValue(meta, field);

        if (value === undefined || value === null) {
          continue;
        }

        // Flatten arrays, or treat single values as single-item arrays
        if (Array.isArray(value)) {
          allValues.push(...value);
        } else {
          allValues.push(value);
        }
      }
    } catch {
      // Skip files with errors, continue processing others
      continue;
    }
  }

  // Deduplicate if mode is "set"
  if (mode === "set") {
    // Use Set with JSON serialization for complex types
    const seen = new Set<string>();
    return allValues.filter((v) => {
      const key = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return allValues;
}

// ============================================================================
// Commands
// ============================================================================

async function cmdOutline(
  file: string,
  afterId: string | null,
  last: boolean,
  count: boolean,
  json: boolean,
): Promise<string> {
  const content = await readFile(file);
  const doc = await parseDocument(content);

  let sections = doc.sections;

  // Filter to subsections after a given section ID
  if (afterId) {
    if (!isValidId(afterId)) {
      throw new MdError(
        "invalid_id",
        `Invalid section ID: ${afterId}`,
        file,
        afterId,
      );
    }
    const parentSection = findSection(doc, afterId);
    if (!parentSection) {
      throw new MdError(
        "section_not_found",
        `No section with id '${afterId}' in ${file}`,
        file,
        afterId,
      );
    }

    // Get subsections: sections with level > parent and within parent's range
    const parentEndLine = getSectionEndLine(doc, parentSection, true);
    sections = doc.sections.filter(
      (s) =>
        s.line > parentSection.line && s.line <= parentEndLine &&
        s.level > parentSection.level,
    );
  }

  // Return count only
  if (count) {
    return json
      ? JSON.stringify({ count: sections.length })
      : String(sections.length);
  }

  // Return last section only
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
  const doc = await parseDocument(content);
  const section = findSection(doc, id);

  if (!section) {
    throw new MdError(
      "section_not_found",
      `No section with id '${id}' in ${file}`,
      file,
      id,
    );
  }

  const endLine = getSectionEndLine(doc, section, deep);
  const sectionContent = getSectionContent(doc, section, deep);
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
  const doc = await parseDocument(fileContent);
  const section = findSection(doc, id);

  if (!section) {
    throw new MdError(
      "section_not_found",
      `No section with id '${id}' in ${file}`,
      file,
      id,
    );
  }

  // Expand magic expressions
  const meta = parseFrontmatter(getFrontmatterContent(doc));
  const expandedContent = expandMagic(newContent, meta);

  const endLine = getSectionEndLine(doc, section, deep);
  const oldLineCount = endLine - section.line; // Lines after header

  // Prepare new content lines
  const newLines = expandedContent === "" ? [] : expandedContent.split("\n");
  // Ensure content doesn't start right after header - add blank line if needed
  if (newLines.length > 0 && newLines[0].trim() !== "") {
    newLines.unshift("");
  }

  // Replace lines: keep header (section.line - 1 in 0-indexed), replace rest
  const beforeSection = doc.lines.slice(0, section.line); // includes header
  const afterSection = doc.lines.slice(endLine);

  doc.lines = [...beforeSection, ...newLines, ...afterSection];

  await writeFile(file, serializeDocument(doc));

  const result: MutationResult = {
    action: "updated",
    id: section.id,
    lineStart: section.line,
    lineEnd: section.line + newLines.length,
    linesAdded: newLines.length,
    linesRemoved: oldLineCount,
  };

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
  const doc = await parseDocument(fileContent);

  // Expand magic expressions
  const meta = parseFrontmatter(getFrontmatterContent(doc));
  const expandedContent = expandMagic(newContent, meta);

  const newLines = expandedContent.split("\n");
  let insertLine: number;
  let section: Section | null = null;

  if (id === null) {
    // No ID: append to file start (--before) or end (default/--after)
    if (before) {
      // Insert after frontmatter if present
      insertLine = doc.frontmatterEndLine;
    } else {
      // Insert at end of file
      insertLine = doc.lines.length;
    }
  } else {
    // With ID: append relative to section
    if (!isValidId(id)) {
      throw new MdError("invalid_id", `Invalid section ID: ${id}`, file, id);
    }

    const found = findSection(doc, id);

    if (!found) {
      throw new MdError(
        "section_not_found",
        `No section with id '${id}' in ${file}`,
        file,
        id,
      );
    }
    section = found;

    if (before) {
      // Insert before the section's header
      insertLine = section.line - 1; // 0-indexed, before header
    } else {
      // Insert at end of section (or after subsections with --deep)
      const endLine = getSectionEndLine(doc, section, deep);
      insertLine = endLine; // 0-indexed position to insert
    }
  }

  // Add blank line before if inserting after content and content doesn't start with blank
  if (
    !before && insertLine > 0 && doc.lines[insertLine - 1]?.trim() !== "" &&
    newLines[0]?.trim() !== ""
  ) {
    newLines.unshift("");
  }

  // Insert the new lines
  doc.lines.splice(insertLine, 0, ...newLines);

  await writeFile(file, serializeDocument(doc));

  // Determine if we created a new section
  const headerInfo = startsWithHeader(expandedContent);
  const action = headerInfo ? "created" : "appended";

  // For created, compute the new section's ID
  let resultId = section?.id ?? "-";
  if (headerInfo) {
    // Re-parse to get the new section's ID
    const newDoc = await parseDocument(serializeDocument(doc));
    const newSection = newDoc.sections.find(
      (s) => s.line === insertLine + 1 && s.title === headerInfo.title,
    );
    if (newSection) {
      resultId = newSection.id;
    }
  }

  const result: MutationResult = {
    action,
    id: resultId,
    lineStart: insertLine + 1, // 1-indexed
    lineEnd: headerInfo ? insertLine + newLines.length : undefined,
    linesAdded: newLines.length,
    linesRemoved: 0,
  };

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
  const doc = await parseDocument(fileContent);
  const section = findSection(doc, id);

  if (!section) {
    throw new MdError(
      "section_not_found",
      `No section with id '${id}' in ${file}`,
      file,
      id,
    );
  }

  const endLine = getSectionEndLine(doc, section, deep);
  const linesRemoved = endLine - section.line;

  // Keep header, remove content
  const beforeContent = doc.lines.slice(0, section.line); // includes header
  const afterContent = doc.lines.slice(endLine);

  doc.lines = [...beforeContent, ...afterContent];

  await writeFile(file, serializeDocument(doc));

  const result: MutationResult = {
    action: "emptied",
    id: section.id,
    lineStart: section.line,
    linesAdded: 0,
    linesRemoved,
  };

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
  const doc = await parseDocument(fileContent);
  const section = findSection(doc, id);

  if (!section) {
    throw new MdError(
      "section_not_found",
      `No section with id '${id}' in ${file}`,
      file,
      id,
    );
  }

  // Remove always includes subsections (deep behavior)
  const endLine = getSectionEndLine(doc, section, true);
  const linesRemoved = endLine - section.line + 1; // +1 for header

  const beforeSection = doc.lines.slice(0, section.line - 1); // before header
  const afterSection = doc.lines.slice(endLine);

  doc.lines = [...beforeSection, ...afterSection];

  await writeFile(file, serializeDocument(doc));

  const result: MutationResult = {
    action: "removed",
    id: section.id,
    lineStart: section.line,
    linesAdded: 0,
    linesRemoved,
  };

  return json ? jsonMutation(result) : formatMutation(result);
}

async function cmdSearch(
  file: string,
  pattern: string,
  summary: boolean,
  json: boolean,
): Promise<string> {
  const content = await readFile(file);
  const doc = await parseDocument(content);

  const matches: SearchMatch[] = [];

  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    if (line.includes(pattern)) {
      const lineNum = i + 1; // 1-indexed
      const section = findSectionAtLine(doc, lineNum);
      matches.push({
        sectionId: section?.id ?? null,
        line: lineNum,
        content: line,
      });
    }
  }

  if (!summary) {
    return json ? jsonSearchMatches(matches) : formatSearchMatches(matches);
  }

  // Group by section
  const sectionMap = new Map<string, SearchSummary>();

  for (const match of matches) {
    if (!match.sectionId) continue;

    const section = findSection(doc, match.sectionId);
    if (!section) continue;

    let entry = sectionMap.get(match.sectionId);
    if (!entry) {
      entry = {
        id: section.id,
        level: section.level,
        title: section.title,
        lines: [],
        matchCount: 0,
      };
      sectionMap.set(match.sectionId, entry);
    }
    entry.lines.push(match.line);
    entry.matchCount++;
  }

  const summaries = Array.from(sectionMap.values());
  return json ? jsonSearchSummary(summaries) : formatSearchSummary(summaries);
}

async function cmdMeta(
  file: string | string[],
  key: string | null,
  value: string | null,
  del: boolean,
  getH1: boolean,
  list: string | null,
  set: string | null,
  json: boolean,
): Promise<string> {
  // Multi-file aggregation mode
  const aggregateField = list ?? set;
  if (aggregateField !== null) {
    const files = Array.isArray(file) ? file : [file];
    const fields = aggregateField.split(",").map((f) => f.trim());
    const mode = list !== null ? "list" : "set";

    // Error checks
    if (del || value !== null) {
      throw new MdError(
        "parse_error",
        "Cannot use --set/--del with --list/--set aggregation",
      );
    }

    // Expand file patterns
    const expandedFiles = await expandFilePatterns(files);

    // Aggregate metadata
    const values = await aggregateMetadata(expandedFiles, fields, mode);

    // Format output
    if (json) {
      return JSON.stringify(values);
    } else {
      return values.map((v) => formatValue(v)).join("\n");
    }
  }

  // Single-file mode (existing logic)
  if (Array.isArray(file)) {
    throw new MdError(
      "parse_error",
      "Multiple files require --list or --set flag",
    );
  }

  const fileContent = await readFile(file);
  const doc = await parseDocument(fileContent);

  // Get h1 title
  if (getH1) {
    const h1 = doc.sections.find((s) => s.level === 1);
    return h1 ? h1.title : "";
  }

  const yamlContent = getFrontmatterContent(doc);
  const meta = parseFrontmatter(yamlContent);

  // Delete mode
  if (del) {
    if (!key) {
      throw new MdError("parse_error", "Usage: md meta <file> --del <key>");
    }
    const deleted = deleteNestedValue(meta, key);
    if (!deleted) {
      throw new MdError("parse_error", `Key '${key}' not found`);
    }
    setFrontmatter(doc, stringifyFrontmatter(meta));
    await writeFile(file, serializeDocument(doc));
    return `deleted ${key}`;
  }

  // Set mode
  if (value !== null) {
    if (!key) {
      throw new MdError(
        "parse_error",
        "Usage: md meta <file> --set <key> <value>",
      );
    }
    // Expand magic expressions
    const expandedValue = expandMagic(value, meta);
    // Try to parse value as YAML (for arrays, objects, numbers, booleans)
    let parsedValue: unknown = expandedValue;
    try {
      const parsed = parseFrontmatter(expandedValue);
      // If it parsed to something other than empty object, use it
      if (typeof parsed !== "object" || Object.keys(parsed).length > 0) {
        parsedValue = parsed;
      }
    } catch {
      // Keep as string
    }
    // But if it looks like a simple string, keep it as string
    if (
      typeof parsedValue === "object" &&
      Object.keys(parsedValue as object).length === 0
    ) {
      parsedValue = expandedValue;
    }
    setNestedValue(meta, key, parsedValue);
    setFrontmatter(doc, stringifyFrontmatter(meta));
    await writeFile(file, serializeDocument(doc));
    return `set ${key}`;
  }

  // Get mode
  if (key) {
    const val = getNestedValue(meta, key);
    return formatValue(val);
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
  // Check if file exists
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
    for (const [key, value] of metaEntries) {
      const expandedValue = expandMagic(value, meta); // meta grows as we add entries
      setNestedValue(meta, key, expandedValue);
    }
    const yaml = stringifyFrontmatter(meta);
    lines.push("---", yaml, "---", "");
  }

  // Add title if provided (expand magic expressions)
  if (title) {
    const expandedTitle = expandMagic(title, meta);
    lines.push(`# ${expandedTitle}`, "");
  }

  // Add initial content if provided (expand magic expressions)
  if (content) {
    const expandedContent = expandMagic(content, meta);
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
    const doc = await parseDocument(content);

    // Keep first file's frontmatter
    if (i === 0 && doc.frontmatter) {
      firstFrontmatter = doc.frontmatter;
    }

    // Get content without frontmatter
    const startLine = doc.frontmatterEndLine;
    let fileLines = doc.lines.slice(startLine);

    // Shift headers
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

// ============================================================================
// CLI with Cliffy
// ============================================================================

function handleError(e: unknown): never {
  if (e instanceof MdError) {
    console.error(e.format());
    Deno.exit(1);
  }
  throw e;
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

const outlineCmd = new Command()
  .description("List sections in a Markdown file")
  .arguments("<file:string>")
  .option("--after <id:string>", "Show only subsections after this section ID")
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

const writeCmd = new Command()
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

const appendCmd = new Command()
  .description("Append content to a section")
  .arguments("<file:string> [idOrContent:string] [content:string]")
  .option("--deep", "Append after subsections")
  .option("--before", "Insert before section instead of after")
  .option("--json", "Output as JSON")
  .action(async (options, file, idOrContent, content) => {
    try {
      // Check if idOrContent is an ID (8 hex chars) or content
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

const emptyCmd = new Command()
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

const removeCmd = new Command()
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

const searchCmd = new Command()
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

const concatCmd = new Command()
  .description("Concatenate multiple Markdown files")
  .arguments("<files...:string>")
  .option("-s, --shift <n:number>", "Shift header levels by N", { default: 0 })
  .action(async (options, ...files) => {
    try {
      const output = await cmdConcat(files, options.shift);
      if (output) console.log(output);
    } catch (e) {
      handleError(e);
    }
  });

const metaCmd = new Command()
  .description("Manage YAML frontmatter")
  .arguments("<fileOrKey:string> [args...:string]")
  .option("--list <fields:string>", "List metadata from multiple files (concat with duplicates)")
  .option("--aggregate <fields:string>", "List unique metadata from multiple files (deduplicated)")
  .option("--set", "Set a key (single file only)")
  .option("--del", "Delete a key (single file only)")
  .option("--h1", "Get the H1 title (single file only)")
  .option("--json", "Output as JSON")
  .action(async (options, fileOrKey, ...args) => {
    try {
      let file: string | string[];
      let key: string | null = null;
      let value: string | null = null;

      if (options.list || options.aggregate) {
        // Aggregation mode: all args are files
        file = [fileOrKey, ...args];
      } else {
        // Single file mode
        file = fileOrKey;
        key = args[0] ?? null;
        value = args[1] ?? null;

        // In single-file set mode, value comes from args[1]
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
        options.json ?? false,
      );
      if (output) console.log(output);
    } catch (e) {
      handleError(e);
    }
  });

const createCmd = new Command()
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

const cli = new Command()
  .name("md")
  .version(VERSION)
  .description("Manipulate Markdown files by section")
  .command("outline", outlineCmd)
  .command("read", readCmd)
  .command("write", writeCmd)
  .command("append", appendCmd)
  .command("empty", emptyCmd)
  .command("remove", removeCmd)
  .command("search", searchCmd)
  .command("concat", concatCmd)
  .command("meta", metaCmd)
  .command("create", createCmd);

export async function main(args: string[]): Promise<void> {
  await cli.parse(args);
}

// Run if executed directly
if (import.meta.main) {
  await main(Deno.args);
}
