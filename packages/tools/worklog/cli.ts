import {
  type AddOutput,
  type Checkpoint,
  type Entry,
  type ImportOutput,
  type ImportTaskResult,
  type Index,
  type ListOutput,
  type LogsOutput,
  type StatusOutput,
  type SummaryOutput,
  type TaskMeta,
  type TraceOutput,
  WtError,
} from "./types.ts";
import {
  findSection,
  getFrontmatterContent,
  getSectionEndLine,
  parseDocument,
  serializeDocument,
  setFrontmatter,
} from "../markdown-surgeon/parser.ts";
import { sectionHash } from "../markdown-surgeon/hash.ts";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../markdown-surgeon/yaml.ts";

// ============================================================================
// Version
// ============================================================================

const VERSION = "0.4.1";

// ============================================================================
// Constants
// ============================================================================

const WORKLOG_DIR = ".worklog";
const TASKS_DIR = `${WORKLOG_DIR}/tasks`;
const INDEX_FILE = `${WORKLOG_DIR}/index.json`;
const CHECKPOINT_THRESHOLD = 50;

// Pre-computed section IDs for fixed section titles
let ENTRIES_ID: string | null = null;
let CHECKPOINTS_ID: string | null = null;

async function getEntriesId(): Promise<string> {
  if (!ENTRIES_ID) {
    ENTRIES_ID = await sectionHash(1, "Entries", 0);
  }
  return ENTRIES_ID;
}

async function getCheckpointsId(): Promise<string> {
  if (!CHECKPOINTS_ID) {
    CHECKPOINTS_ID = await sectionHash(1, "Checkpoints", 0);
  }
  return CHECKPOINTS_ID;
}

// ============================================================================
// Date/Time utilities
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

function getShortDateTime(date?: Date): string {
  const now = date || new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatShort(isoTs: string): string {
  // "2025-01-16T09:15:00+01:00" → "2025-01-16 09:15"
  return isoTs.slice(0, 16).replace("T", " ");
}

function parseDate(dateStr: string): Date {
  // Handle ISO format
  if (dateStr.includes("T")) {
    return new Date(dateStr);
  }
  // Short format with time: "YYYY-MM-DD HH:mm"
  if (dateStr.includes(" ")) {
    return new Date(dateStr.replace(" ", "T") + ":00");
  }
  // Date only: "YYYY-MM-DD"
  return new Date(dateStr + "T00:00:00");
}

/**
 * Parse flexible timestamp format: [YYYY-MM-DD]THH:mm[:SS][<tz>]
 * - If date is missing, use today
 * - If seconds are missing, use :00
 * - If timezone is missing, DON'T add one (let new Date() handle it)
 */
function parseFlexibleTimestamp(input: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayDate = `${year}-${month}-${day}`;

  // Pattern: [YYYY-MM-DD]THH:mm[:SS][+/-HH:MM]
  // Examples: T11:15, 2024-12-15T11:15, T11:15:30+01:00

  let result = input;

  // If starts with T, prepend today's date
  if (result.startsWith("T")) {
    result = todayDate + result;
  }

  // Check if timezone is present
  const tzRegex = /[+-]\d{2}:\d{2}$/;
  const hasTZ = tzRegex.test(result);

  // Check if seconds are present
  const timePartMatch = result.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!timePartMatch) {
    throw new Error("Invalid time format");
  }

  const hasSeconds = timePartMatch[3] !== undefined;

  // Add seconds if missing
  if (!hasSeconds) {
    if (hasTZ) {
      // Find where timezone starts (last + or -)
      const tzStartPos = Math.max(
        result.lastIndexOf("+"),
        result.lastIndexOf("-"),
      );
      const beforeTZ = result.slice(0, tzStartPos);
      const tz = result.slice(tzStartPos);
      result = beforeTZ + ":00" + tz;
    } else {
      result = result + ":00";
    }
  }

  return result;
}

// ============================================================================
// File I/O
// ============================================================================

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return false;
    }
    throw e;
  }
}

async function readFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new WtError("io_error", `File not found: ${path}`);
    }
    throw new WtError("io_error", `Failed to read file: ${path}`);
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  try {
    await Deno.writeTextFile(path, content);
  } catch {
    throw new WtError("io_error", `Failed to write file: ${path}`);
  }
}

async function deleteFile(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // Ignore if file doesn't exist
  }
}

// ============================================================================
// Index management
// ============================================================================

async function loadIndex(): Promise<Index> {
  if (!(await exists(INDEX_FILE))) {
    throw new WtError(
      "not_initialized",
      "Worktrack not initialized. Run 'wt init' first.",
    );
  }
  const content = await readFile(INDEX_FILE);
  return JSON.parse(content) as Index;
}

async function saveIndex(index: Index): Promise<void> {
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

// ============================================================================
// Task ID generation
// ============================================================================

function incrementLetter(s: string): string {
  if (s === "z") return "aa";
  if (s.length === 1) return String.fromCharCode(s.charCodeAt(0) + 1);

  const chars = s.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === "z") {
      chars[i] = "a";
      i--;
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      break;
    }
  }
  if (i < 0) chars.unshift("a");
  return chars.join("");
}

async function generateTaskId(): Promise<string> {
  const today = new Date();
  const year = String(today.getFullYear()).slice(2);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const prefix = `${year}${month}${day}`; // YYMMDD

  const index = await loadIndex();
  const existing = Object.keys(index.tasks)
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(6)) // Extract suffix
    .sort();

  if (existing.length === 0) return `${prefix}a`;

  const last = existing[existing.length - 1];
  return `${prefix}${incrementLetter(last)}`;
}

// ============================================================================
// Worktree resolution
// ============================================================================

async function resolveWorktreePath(branch: string): Promise<string> {
  const process = new Deno.Command("git", {
    args: ["worktree", "list", "--porcelain"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await process.output();

  if (code !== 0) {
    const error = new TextDecoder().decode(stderr);
    throw new WtError(
      "io_error",
      `Failed to list worktrees: ${error}`,
    );
  }

  const output = new TextDecoder().decode(stdout);
  const lines = output.trim().split("\n");

  let currentPath: string | null = null;
  const targetBranch = `refs/heads/${branch}`;

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice(9); // Remove "worktree " prefix
    } else if (line.startsWith("branch ") && currentPath) {
      const branchRef = line.slice(7); // Remove "branch " prefix
      if (branchRef === targetBranch) {
        return `${currentPath}/.worklog`;
      }
    } else if (line === "") {
      // Empty line separates worktrees
      currentPath = null;
    }
  }

  throw new WtError(
    "worktree_not_found",
    `No worktree found for branch: ${branch}`,
  );
}

// ============================================================================
// Task file management
// ============================================================================

function taskFilePath(taskId: string): string {
  return `${TASKS_DIR}/${taskId}.md`;
}

async function loadTaskContent(taskId: string): Promise<string> {
  const path = taskFilePath(taskId);
  if (!(await exists(path))) {
    throw new WtError("task_not_found", `Task not found: ${taskId}`);
  }
  return await readFile(path);
}

async function saveTaskContent(taskId: string, content: string): Promise<void> {
  await writeFile(taskFilePath(taskId), content);
}

function assertActive(meta: TaskMeta): void {
  if (meta.status === "done") {
    throw new WtError(
      "task_already_done",
      `Task ${meta.id} is already completed`,
    );
  }
}

// ============================================================================
// Purge logic
// ============================================================================

async function purge(): Promise<void> {
  if (!(await exists(INDEX_FILE))) return;

  const index = await loadIndex();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let modified = false;

  for (const [id, info] of Object.entries(index.tasks)) {
    if (info.status === "done" && info.done_at) {
      if (new Date(info.done_at).getTime() < cutoff) {
        // Check if task has uncheckpointed entries before purging
        try {
          const content = await loadTaskContent(id);
          const { meta, entries } = await parseTaskFile(content);

          if (meta.has_uncheckpointed_entries) {
            // Don't purge - has uncheckpointed entries
            const lastEntry = entries.length > 0
              ? entries[entries.length - 1].ts
              : "unknown";
            console.error(
              `⚠ Task ${id} not purged: has uncheckpointed entries (last entry: ${lastEntry})`,
            );
            continue;
          }
        } catch (_e) {
          // If we can't read the file, skip it (it may already be deleted)
          continue;
        }

        // Safe to purge
        await deleteFile(taskFilePath(id));
        delete index.tasks[id];
        modified = true;
      }
    }
  }

  if (modified) {
    await saveIndex(index);
  }
}

// ============================================================================
// Auto-init helper
// ============================================================================

async function autoInit(): Promise<void> {
  if (!(await exists(WORKLOG_DIR))) {
    await Deno.mkdir(TASKS_DIR, { recursive: true });
    await saveIndex({ tasks: {} });
  }
}

// ============================================================================
// Entry/Checkpoint parsing helpers
// ============================================================================

interface ParsedTask {
  meta: TaskMeta;
  entries: Entry[];
  checkpoints: Checkpoint[];
}

async function parseTaskFile(content: string): Promise<ParsedTask> {
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);
  const meta = parseFrontmatter(yamlContent) as unknown as TaskMeta;

  const entriesId = await getEntriesId();
  const checkpointsId = await getCheckpointsId();

  const entriesSection = findSection(doc, entriesId);
  const checkpointsSection = findSection(doc, checkpointsId);

  const entries: Entry[] = [];
  const checkpoints: Checkpoint[] = [];

  // Parse entries (## sections under # Entries)
  if (entriesSection) {
    const entriesEnd = checkpointsSection
      ? checkpointsSection.line - 1
      : getSectionEndLine(doc, entriesSection, true);

    for (const section of doc.sections) {
      if (
        section.level === 2 &&
        section.line > entriesSection.line &&
        section.line <= entriesEnd
      ) {
        // Title is timestamp, content is under it
        const sectionEnd = getSectionEndLine(doc, section, false);
        const contentLines = doc.lines.slice(section.line, sectionEnd);
        const msg = contentLines.join("\n").trim();
        entries.push({ ts: section.title, msg });
      }
    }
  }

  // Parse checkpoints (## sections under # Checkpoints)
  if (checkpointsSection) {
    const checkpointsEnd = getSectionEndLine(doc, checkpointsSection, true);

    for (const section of doc.sections) {
      if (
        section.level === 2 &&
        section.line > checkpointsSection.line &&
        section.line <= checkpointsEnd
      ) {
        // Each checkpoint has ### Changes and ### Learnings
        let changes = "";
        let learnings = "";

        for (const subsection of doc.sections) {
          if (
            subsection.level === 3 &&
            subsection.line > section.line
          ) {
            const subEnd = getSectionEndLine(doc, subsection, false);
            // Check if this subsection is within current checkpoint
            const nextL2 = doc.sections.find(
              (s) =>
                s.level === 2 && s.line > section.line &&
                s.line <= checkpointsEnd,
            );
            const checkpointEnd = nextL2 ? nextL2.line - 1 : checkpointsEnd;

            if (subsection.line > checkpointEnd) break;

            const contentLines = doc.lines.slice(subsection.line, subEnd);
            const content = contentLines.join("\n").trim();

            if (subsection.title.toLowerCase() === "changes") {
              changes = content;
            } else if (subsection.title.toLowerCase() === "learnings") {
              learnings = content;
            }
          }
        }

        checkpoints.push({ ts: section.title, changes, learnings });
      }
    }
  }

  return { meta, entries, checkpoints };
}

function getEntriesAfterCheckpoint(
  entries: Entry[],
  lastCheckpointTs: string | null,
): Entry[] {
  if (!lastCheckpointTs) return entries;

  const checkpointDate = parseDate(formatShort(lastCheckpointTs));
  return entries.filter((e) => parseDate(e.ts) > checkpointDate);
}

function getLastCheckpoint(checkpoints: Checkpoint[]): Checkpoint | null {
  if (checkpoints.length === 0) return null;
  return checkpoints[checkpoints.length - 1];
}

// ============================================================================
// Output formatters (text)
// ============================================================================

function formatAdd(output: AddOutput): string {
  return output.id;
}

function formatTrace(output: TraceOutput): string {
  if (output.status === "checkpoint_recommended") {
    return `checkpoint recommended (${output.entries_since_checkpoint} entries)`;
  }
  return "ok";
}

function formatStatus(output: StatusOutput): string {
  return output.status.replace(/_/g, " ");
}

function formatLogs(output: LogsOutput): string {
  const lines: string[] = [];
  lines.push(`task: ${output.task}`);
  lines.push(`desc: ${output.desc}`);
  lines.push(`status: ${output.status}`);

  if (output.last_checkpoint) {
    lines.push("");
    lines.push(`last checkpoint: ${output.last_checkpoint.ts}`);
    lines.push("changes:");
    for (const line of output.last_checkpoint.changes.split("\n")) {
      lines.push(`  ${line}`);
    }
    lines.push("learnings:");
    for (const line of output.last_checkpoint.learnings.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  if (output.entries_since_checkpoint.length > 0) {
    lines.push("");
    lines.push(
      `entries since checkpoint: ${output.entries_since_checkpoint.length}`,
    );
    for (const entry of output.entries_since_checkpoint) {
      lines.push(`  ${entry.ts}: ${entry.msg}`);
    }
  }

  return lines.join("\n");
}

function formatList(output: ListOutput): string {
  if (output.tasks.length === 0) {
    return "no tasks";
  }
  return output.tasks
    .map((t) => `${t.id}  ${t.status}  "${t.desc}"  ${t.created}`)
    .join("\n");
}

function formatSummary(output: SummaryOutput): string {
  if (output.tasks.length === 0) {
    return "no tasks";
  }

  const parts: string[] = [];

  for (const task of output.tasks) {
    const lines: string[] = [];
    lines.push(`# ${task.id}: ${task.desc} (${task.status})`);

    if (task.checkpoints.length > 0) {
      lines.push("");
      lines.push("## Checkpoints");
      for (const cp of task.checkpoints) {
        lines.push(`### ${cp.ts}`);
        lines.push("Changes:");
        for (const line of cp.changes.split("\n")) {
          lines.push(`  ${line}`);
        }
        lines.push("Learnings:");
        for (const line of cp.learnings.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    }

    if (task.entries.length > 0) {
      lines.push("");
      lines.push("## Entries");
      for (const entry of task.entries) {
        lines.push(`${entry.ts}: ${entry.msg}`);
      }
    }

    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n---\n\n");
}

function formatImport(output: ImportOutput): string {
  const lines: string[] = [];
  lines.push(`imported: ${output.imported}`);
  lines.push(`merged: ${output.merged}`);
  lines.push(`skipped: ${output.skipped}`);

  if (output.tasks.length > 0) {
    lines.push("");
    for (const task of output.tasks) {
      let line = `${task.id}: ${task.status}`;
      if (task.warnings && task.warnings.length > 0) {
        line += ` (${task.warnings.join(", ")})`;
      }
      lines.push(line);
    }
  }

  return lines.join("\n");
}

function formatError(error: WtError): string {
  return `error: ${error.code}\n${error.message}`;
}

// ============================================================================
// Commands
// ============================================================================

async function cmdInit(): Promise<StatusOutput> {
  if (await exists(WORKLOG_DIR)) {
    return { status: "already_initialized" };
  }
  await Deno.mkdir(TASKS_DIR, { recursive: true });
  await saveIndex({ tasks: {} });
  return { status: "initialized" };
}

async function cmdAdd(desc: string): Promise<AddOutput> {
  await autoInit();
  await purge();

  const id = await generateTaskId();
  const uid = crypto.randomUUID();
  const now = getLocalISOString();

  const content = `---
id: ${id}
uid: ${uid}
desc: "${desc.replace(/"/g, '\\"')}"
status: active
created: "${now}"
done_at: null
last_checkpoint: null
has_uncheckpointed_entries: false
---

# Entries

# Checkpoints
`;

  await saveTaskContent(id, content);

  const index = await loadIndex();
  index.tasks[id] = {
    desc,
    status: "active",
    created: now,
    done_at: null,
  };
  await saveIndex(index);

  return { id };
}

async function cmdTrace(
  taskId: string,
  message: string,
  timestamp?: string,
  force?: boolean,
): Promise<TraceOutput> {
  await purge();

  const content = await loadTaskContent(taskId);
  const { meta } = await parseTaskFile(content);

  // Only check if task is active if not forcing
  if (!force) {
    assertActive(meta);
  }

  const doc = await parseDocument(content);
  const entriesId = await getEntriesId();
  const checkpointsId = await getCheckpointsId();

  const entriesSection = findSection(doc, entriesId);
  const checkpointsSection = findSection(doc, checkpointsId);

  if (!entriesSection) {
    throw new WtError(
      "io_error",
      "Invalid task file: missing # Entries section",
    );
  }

  // Find insertion point: before # Checkpoints if it exists
  const insertLine = checkpointsSection
    ? checkpointsSection.line - 2 // Before blank line before # Checkpoints
    : getSectionEndLine(doc, entriesSection, true);

  // Use provided timestamp or current time
  let nowShort: string;
  if (timestamp) {
    try {
      const testDate = new Date(timestamp);
      if (isNaN(testDate.getTime())) {
        throw new WtError(
          "invalid_args",
          `Invalid timestamp format: ${timestamp}. Use ISO format (YYYY-MM-DDTHH:MM:SS+TZ) or short format (YYYY-MM-DD HH:MM)`,
        );
      }
      // Use formatShort to preserve timezone info from ISO string
      nowShort = formatShort(timestamp);
    } catch (e) {
      if (e instanceof WtError) throw e;
      throw new WtError(
        "invalid_args",
        `Invalid timestamp: ${timestamp}`,
      );
    }
  } else {
    nowShort = getShortDateTime();
  }
  const entry = `\n## ${nowShort}\n${message}\n`;
  const entryLines = entry.split("\n");

  doc.lines.splice(insertLine, 0, ...entryLines);

  // Update frontmatter to mark has_uncheckpointed_entries
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.has_uncheckpointed_entries = true;
  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );

  await saveTaskContent(taskId, serializeDocument(doc));

  // Count entries since last checkpoint
  const parsed = await parseTaskFile(serializeDocument(doc));
  const entriesSinceCheckpoint = getEntriesAfterCheckpoint(
    parsed.entries,
    meta.last_checkpoint,
  );

  if (entriesSinceCheckpoint.length >= CHECKPOINT_THRESHOLD) {
    return {
      status: "checkpoint_recommended",
      entries_since_checkpoint: entriesSinceCheckpoint.length,
    };
  }

  return { status: "ok" };
}

async function cmdLogs(taskId: string): Promise<LogsOutput> {
  await purge();

  const content = await loadTaskContent(taskId);
  const { meta, entries, checkpoints } = await parseTaskFile(content);

  const lastCheckpoint = getLastCheckpoint(checkpoints);
  const entriesSinceCheckpoint = getEntriesAfterCheckpoint(
    entries,
    meta.last_checkpoint,
  );

  return {
    task: taskId,
    desc: meta.desc,
    status: meta.status,
    last_checkpoint: lastCheckpoint,
    entries_since_checkpoint: entriesSinceCheckpoint,
  };
}

async function cmdCheckpoint(
  taskId: string,
  changes: string,
  learnings: string,
  force?: boolean,
): Promise<StatusOutput> {
  await purge();

  const content = await loadTaskContent(taskId);
  const { meta, entries } = await parseTaskFile(content);

  // Only check if task is active if not forcing
  if (!force) {
    assertActive(meta);
  }

  // Check if checkpoint is needed (unless forced)
  if (!force) {
    let needsCheckpoint = meta.has_uncheckpointed_entries;

    // Also check timestamps
    if (!needsCheckpoint && entries.length > 0) {
      const lastEntryTs = entries[entries.length - 1].ts;
      if (meta.last_checkpoint) {
        const lastCheckpointDate = parseDate(meta.last_checkpoint);
        const lastEntryDate = parseDate(lastEntryTs);
        needsCheckpoint = lastEntryDate > lastCheckpointDate;
      } else {
        // No checkpoint yet but has entries
        needsCheckpoint = true;
      }
    }

    if (!needsCheckpoint) {
      throw new WtError(
        "no_uncheckpointed_entries",
        "No uncheckpointed entries. Use --force to create checkpoint anyway",
      );
    }
  }

  const doc = await parseDocument(content);
  const checkpointsId = await getCheckpointsId();
  const checkpointsSection = findSection(doc, checkpointsId);

  if (!checkpointsSection) {
    throw new WtError(
      "io_error",
      "Invalid task file: missing # Checkpoints section",
    );
  }

  const checkpointsEnd = getSectionEndLine(doc, checkpointsSection, true);
  const nowShort = getShortDateTime();
  const now = getLocalISOString();

  const checkpoint = `
## ${nowShort}

### Changes
${changes}

### Learnings
${learnings}
`;

  doc.lines.splice(checkpointsEnd, 0, ...checkpoint.split("\n"));

  // Update frontmatter
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.last_checkpoint = now;
  frontmatter.has_uncheckpointed_entries = false;
  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );

  await saveTaskContent(taskId, serializeDocument(doc));

  return { status: "checkpoint_created" };
}

async function cmdDone(
  taskId: string,
  changes: string,
  learnings: string,
): Promise<StatusOutput> {
  await purge();

  // First create the final checkpoint (always force since this is the final one)
  await cmdCheckpoint(taskId, changes, learnings, true);

  // Then mark as done
  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const now = getLocalISOString();

  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.status = "done";
  frontmatter.done_at = now;
  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );

  await saveTaskContent(taskId, serializeDocument(doc));

  // Update index
  const index = await loadIndex();
  if (index.tasks[taskId]) {
    index.tasks[taskId].status = "done";
    index.tasks[taskId].done_at = now;
    await saveIndex(index);
  }

  return { status: "task_completed" };
}

async function cmdList(showAll: boolean, baseDir?: string): Promise<ListOutput> {
  // Only purge the local worklog, not remote ones
  if (!baseDir) {
    await purge();
  }

  // Load index from custom path or default
  let index: Index;
  if (baseDir) {
    const indexPath = `${baseDir}/index.json`;
    if (!(await exists(indexPath))) {
      throw new WtError(
        "not_initialized",
        `Worklog not found at: ${baseDir}`,
      );
    }
    const content = await readFile(indexPath);
    index = JSON.parse(content) as Index;
  } else {
    index = await loadIndex();
  }

  const tasks = Object.entries(index.tasks)
    .filter(([_, t]) => showAll || t.status === "active")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, t]) => ({
      id,
      desc: t.desc,
      status: t.status,
      created: formatShort(t.created),
    }));

  return { tasks };
}

async function cmdSummary(since: string | null): Promise<SummaryOutput> {
  await purge();

  const index = await loadIndex();
  const sinceDate = since ? parseDate(since) : null;

  const result: SummaryOutput["tasks"] = [];

  for (const [id, info] of Object.entries(index.tasks)) {
    const include = info.status === "active" ||
      (sinceDate && info.done_at && parseDate(info.done_at) >= sinceDate);

    if (!include) continue;

    const content = await loadTaskContent(id);
    const { entries, checkpoints } = await parseTaskFile(content);

    let filteredEntries = entries;
    if (sinceDate) {
      filteredEntries = entries.filter((e) => parseDate(e.ts) >= sinceDate);
    }

    result.push({
      id,
      desc: info.desc,
      status: info.status,
      checkpoints,
      entries: filteredEntries,
    });
  }

  return { tasks: result };
}

async function cmdImport(
  sourcePath: string,
  removeSource: boolean,
): Promise<ImportOutput> {
  await autoInit();

  // Verify source exists
  const sourceIndexPath = `${sourcePath}/index.json`;
  if (!(await exists(sourceIndexPath))) {
    throw new WtError(
      "import_source_not_found",
      `Source worklog not found: ${sourcePath}`,
    );
  }

  const sourceIndexContent = await Deno.readTextFile(sourceIndexPath);
  const sourceIndex = JSON.parse(sourceIndexContent) as Index;
  const destIndex = await loadIndex();

  const results: ImportTaskResult[] = [];
  let imported = 0;
  let merged = 0;
  let skipped = 0;
  const tasksToRemove: string[] = [];

  for (const [sourceId, sourceInfo] of Object.entries(sourceIndex.tasks)) {
    const sourceTaskPath = `${sourcePath}/tasks/${sourceId}.md`;
    let sourceContent = await Deno.readTextFile(sourceTaskPath);
    const {
      meta: sourceMeta,
      entries: sourceEntries,
      checkpoints: sourceCheckpoints,
    } = await parseTaskFile(sourceContent);

    // Generate uid if missing (for backward compatibility)
    if (!sourceMeta.uid) {
      sourceMeta.uid = crypto.randomUUID();
      // Update source file with uid
      const doc = await parseDocument(sourceContent);
      const yamlContent = getFrontmatterContent(doc);
      const frontmatter = parseFrontmatter(yamlContent);
      frontmatter.uid = sourceMeta.uid;
      setFrontmatter(
        doc,
        stringifyFrontmatter(frontmatter as Record<string, unknown>),
      );
      const updatedContent = serializeDocument(doc);
      await Deno.writeTextFile(sourceTaskPath, updatedContent);
      // Update sourceContent with the new content that includes uid
      sourceContent = updatedContent;
    }

    // Check if this task's UID already exists
    let existingTaskId: string | undefined;
    for (const id of Object.keys(destIndex.tasks)) {
      const content = await loadTaskContent(id);
      const { meta } = await parseTaskFile(content);

      // Generate uid if missing in dest (for backward compatibility)
      if (!meta.uid) {
        meta.uid = crypto.randomUUID();
        // Update dest file with uid
        const doc = await parseDocument(content);
        const yamlContent = getFrontmatterContent(doc);
        const frontmatter = parseFrontmatter(yamlContent);
        frontmatter.uid = meta.uid;
        setFrontmatter(
          doc,
          stringifyFrontmatter(frontmatter as Record<string, unknown>),
        );
        await saveTaskContent(id, serializeDocument(doc));
      }

      if (meta.uid === sourceMeta.uid) {
        existingTaskId = id;
        break;
      }
    }

    if (existingTaskId) {
      // Same task - merge traces
      const destContent = await loadTaskContent(existingTaskId);
      const {
        meta: destMeta,
        entries: destEntries,
        checkpoints: destCheckpoints,
      } = await parseTaskFile(destContent);
      const warnings: string[] = [];

      // Merge entries
      const destTimestamps = new Set(destEntries.map((e) => e.ts));
      const entriesToAdd: Entry[] = [];

      for (const entry of sourceEntries) {
        if (destTimestamps.has(entry.ts)) {
          continue; // Already exists
        }

        // Check if entry is older than last checkpoint
        if (destMeta.last_checkpoint) {
          const entryDate = parseDate(entry.ts);
          const lastCheckpointDate = parseDate(destMeta.last_checkpoint);
          if (entryDate < lastCheckpointDate) {
            warnings.push(
              `Entry at ${entry.ts} is older than last checkpoint, skipped`,
            );
            continue;
          }
        }

        entriesToAdd.push(entry);
      }

      // Merge checkpoints (if any new ones)
      const destCheckpointTimestamps = new Set(
        destCheckpoints.map((c) => c.ts),
      );
      const checkpointsToAdd: Checkpoint[] = [];
      for (const checkpoint of sourceCheckpoints) {
        if (!destCheckpointTimestamps.has(checkpoint.ts)) {
          checkpointsToAdd.push(checkpoint);
        }
      }

      if (entriesToAdd.length > 0 || checkpointsToAdd.length > 0) {
        // Add entries and checkpoints to destination task
        const doc = await parseDocument(destContent);
        const entriesId = await getEntriesId();
        const checkpointsId = await getCheckpointsId();

        if (entriesToAdd.length > 0) {
          const entriesSection = findSection(doc, entriesId);
          if (entriesSection) {
            const entriesEnd = getSectionEndLine(doc, entriesSection, true);
            for (const entry of entriesToAdd) {
              const entryText = `\n## ${entry.ts}\n\n${entry.msg}\n`;
              doc.lines.splice(entriesEnd, 0, ...entryText.split("\n"));
            }
          }

          // Set has_uncheckpointed_entries flag
          const yamlContent = getFrontmatterContent(doc);
          const frontmatter = parseFrontmatter(yamlContent);
          frontmatter.has_uncheckpointed_entries = true;
          setFrontmatter(
            doc,
            stringifyFrontmatter(frontmatter as Record<string, unknown>),
          );
        }

        if (checkpointsToAdd.length > 0) {
          const checkpointsSection = findSection(doc, checkpointsId);
          if (checkpointsSection) {
            const checkpointsEnd = getSectionEndLine(
              doc,
              checkpointsSection,
              true,
            );
            for (const checkpoint of checkpointsToAdd) {
              const checkpointText =
                `\n## ${checkpoint.ts}\n\n### Changes\n${checkpoint.changes}\n\n### Learnings\n${checkpoint.learnings}\n`;
              doc.lines.splice(
                checkpointsEnd,
                0,
                ...checkpointText.split("\n"),
              );
            }

            // Update last_checkpoint if newer
            const yamlContent = getFrontmatterContent(doc);
            const frontmatter = parseFrontmatter(yamlContent);
            const newestCheckpoint =
              [...destCheckpoints, ...checkpointsToAdd].sort((a, b) =>
                parseDate(b.ts).getTime() - parseDate(a.ts).getTime()
              )[0];
            const newestDate = parseDate(newestCheckpoint.ts);
            frontmatter.last_checkpoint = newestDate.toISOString();
            setFrontmatter(
              doc,
              stringifyFrontmatter(frontmatter as Record<string, unknown>),
            );
          }
        }

        await saveTaskContent(existingTaskId, serializeDocument(doc));

        results.push({
          id: existingTaskId,
          status: "merged",
          warnings: warnings.length > 0 ? warnings : undefined,
        });
        merged++;

        if (warnings.length === 0) {
          tasksToRemove.push(sourceId);
        }
      } else {
        results.push({
          id: existingTaskId,
          status: "skipped",
          warnings: ["No new entries or checkpoints to merge"],
        });
        skipped++;
        tasksToRemove.push(sourceId); // Can remove since nothing to merge
      }
    } else {
      // Different task - check ID collision
      let targetId = sourceId;
      if (destIndex.tasks[sourceId]) {
        // ID collision - generate new ID
        const prefix = sourceId.slice(0, 6); // YYMMDD
        const existing = Object.keys(destIndex.tasks)
          .filter((id) => id.startsWith(prefix))
          .map((id) => id.slice(6))
          .sort();
        const last = existing[existing.length - 1];
        targetId = `${prefix}${incrementLetter(last)}`;
      }

      // Import task with (possibly renamed) ID
      let taskContent = sourceContent;
      if (targetId !== sourceId) {
        // Update ID in frontmatter
        const doc = await parseDocument(sourceContent);
        const yamlContent = getFrontmatterContent(doc);
        const frontmatter = parseFrontmatter(yamlContent);
        frontmatter.id = targetId;
        setFrontmatter(
          doc,
          stringifyFrontmatter(frontmatter as Record<string, unknown>),
        );
        taskContent = serializeDocument(doc);
      }

      await saveTaskContent(targetId, taskContent);

      destIndex.tasks[targetId] = {
        desc: sourceInfo.desc,
        status: sourceInfo.status,
        created: sourceInfo.created,
        done_at: sourceInfo.done_at,
      };

      results.push({
        id: targetId,
        status: "imported",
        warnings: targetId !== sourceId
          ? [`Renamed from ${sourceId} to ${targetId}`]
          : undefined,
      });
      imported++;
      tasksToRemove.push(sourceId);
    }
  }

  await saveIndex(destIndex);

  // Remove source tasks if requested and fully imported
  if (removeSource && tasksToRemove.length > 0) {
    for (const taskId of tasksToRemove) {
      const taskPath = `${sourcePath}/tasks/${taskId}.md`;
      await Deno.remove(taskPath);
      delete sourceIndex.tasks[taskId];
    }

    // Update source index
    await Deno.writeTextFile(
      sourceIndexPath,
      JSON.stringify(sourceIndex, null, 2),
    );

    // If no tasks left, remove the whole .worklog directory
    if (Object.keys(sourceIndex.tasks).length === 0) {
      await Deno.remove(sourcePath, { recursive: true });
    }
  }

  return {
    imported,
    merged,
    skipped,
    tasks: results,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`Usage: wl <command> [options]

Commands:
  init                                  Initialize worklog in current directory
  add [--desc "description"]            Create a new task
  trace <task-id> <message> [options]   Log an entry to a task
  logs <task-id>                        Get task context for checkpoint
  checkpoint <task-id> <changes> <learnings> [options]   Create a checkpoint
  done <task-id> <changes> <learnings>         Complete task with final checkpoint
  list [--all] [-p PATH]                List tasks (--all includes completed)
  summary [--since YYYY-MM-DD]          Aggregate all tasks
  import [-p PATH | -b BRANCH] [--rm]   Import tasks from another worktree

Options:
  --json                                Output in JSON format
  --timestamp, -t [DATE]THH:mm[:SS][TZ] Flexible timestamp (T11:15, 2024-12-15T11:15, etc.)
  --force, -f                           Force trace/checkpoint on completed tasks
  --path, -p PATH                       Path to source .worklog directory
  --branch, -b BRANCH                   Resolve worktree path from branch name
  --rm                                  Remove imported tasks from source`);
}

function parseArgs(args: string[]): {
  command: string;
  flags: {
    desc: string | null;
    all: boolean;
    since: string | null;
    timestamp: string | null;
    force: boolean;
    json: boolean;
    path: string | null;
    branch: string | null;
    rm: boolean;
  };
  positional: string[];
} {
  const flags = {
    desc: null as string | null,
    all: false,
    since: null as string | null,
    timestamp: null as string | null,
    force: false,
    json: false,
    path: null as string | null,
    branch: null as string | null,
    rm: false,
  };
  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--desc" && i + 1 < args.length) {
      flags.desc = args[++i];
    } else if (arg.startsWith("--desc=")) {
      flags.desc = arg.slice(7);
    } else if (arg === "--all") {
      flags.all = true;
    } else if (arg === "--since" && i + 1 < args.length) {
      flags.since = args[++i];
    } else if (arg.startsWith("--since=")) {
      flags.since = arg.slice(8);
    } else if ((arg === "--timestamp" || arg === "-t") && i + 1 < args.length) {
      flags.timestamp = args[++i];
    } else if (arg.startsWith("--timestamp=")) {
      flags.timestamp = arg.slice(12);
    } else if (arg === "--force" || arg === "-f") {
      flags.force = true;
    } else if ((arg === "--path" || arg === "-p") && i + 1 < args.length) {
      flags.path = args[++i];
    } else if (arg.startsWith("--path=")) {
      flags.path = arg.slice(7);
    } else if ((arg === "--branch" || arg === "-b") && i + 1 < args.length) {
      flags.branch = args[++i];
    } else if (arg.startsWith("--branch=")) {
      flags.branch = arg.slice(9);
    } else if (arg === "--rm") {
      flags.rm = true;
    } else if (arg === "--json" || arg === "--format=json") {
      flags.json = true;
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

export async function main(args: string[]): Promise<void> {
  // Handle version flag
  if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
    console.log(VERSION);
    Deno.exit(0);
  }

  if (args.length === 0) {
    printUsage();
    Deno.exit(0);
  }

  const { command, flags, positional } = parseArgs(args);

  try {
    switch (command) {
      case "init": {
        const output = await cmdInit();
        console.log(flags.json ? JSON.stringify(output) : formatStatus(output));
        break;
      }

      case "add": {
        const desc = flags.desc ?? positional[0] ?? "";
        const output = await cmdAdd(desc);
        console.log(flags.json ? JSON.stringify(output) : formatAdd(output));
        break;
      }

      case "trace": {
        if (positional.length < 2) {
          throw new WtError(
            "invalid_args",
            "Usage: wt trace <task-id> <message> [--timestamp TS]",
          );
        }

        // Parse flexible timestamp format if provided
        let timestampValue: string | undefined;
        if (flags.timestamp) {
          try {
            timestampValue = parseFlexibleTimestamp(flags.timestamp);
          } catch (_e) {
            throw new WtError(
              "invalid_args",
              `Invalid timestamp format: ${flags.timestamp}. Use format [YYYY-MM-DD]THH:mm[:SS][<tz>]`,
            );
          }
        }

        const output = await cmdTrace(
          positional[0],
          positional[1],
          timestampValue,
          flags.force,
        );
        console.log(flags.json ? JSON.stringify(output) : formatTrace(output));
        break;
      }

      case "logs": {
        if (positional.length < 1) {
          throw new WtError("invalid_args", "Usage: wt logs <task-id>");
        }
        const output = await cmdLogs(positional[0]);
        console.log(flags.json ? JSON.stringify(output) : formatLogs(output));
        break;
      }

      case "checkpoint": {
        if (positional.length < 3) {
          throw new WtError(
            "invalid_args",
            "Usage: wt checkpoint <task-id> <changes> <learnings>",
          );
        }
        const output = await cmdCheckpoint(
          positional[0],
          positional[1],
          positional[2],
          flags.force,
        );
        console.log(flags.json ? JSON.stringify(output) : formatStatus(output));
        break;
      }

      case "done": {
        if (positional.length < 3) {
          throw new WtError(
            "invalid_args",
            "Usage: wt done <task-id> <changes> <learnings>",
          );
        }
        const output = await cmdDone(
          positional[0],
          positional[1],
          positional[2],
        );
        console.log(flags.json ? JSON.stringify(output) : formatStatus(output));
        break;
      }

      case "list": {
        const output = await cmdList(flags.all, flags.path ?? undefined);
        console.log(flags.json ? JSON.stringify(output) : formatList(output));
        break;
      }

      case "summary": {
        const output = await cmdSummary(flags.since);
        console.log(
          flags.json ? JSON.stringify(output) : formatSummary(output),
        );
        break;
      }

      case "import": {
        let sourcePath: string;

        if (flags.path && flags.branch) {
          throw new WtError(
            "invalid_args",
            "Cannot specify both --path and --branch",
          );
        }

        if (!flags.path && !flags.branch) {
          throw new WtError(
            "invalid_args",
            "Must specify either --path or --branch",
          );
        }

        if (flags.branch) {
          sourcePath = await resolveWorktreePath(flags.branch);
        } else {
          sourcePath = flags.path!;
        }

        const output = await cmdImport(sourcePath, flags.rm);
        console.log(flags.json ? JSON.stringify(output) : formatImport(output));
        break;
      }

      default:
        printUsage();
        Deno.exit(1);
    }
  } catch (e) {
    if (e instanceof WtError) {
      if (flags.json) {
        console.error(JSON.stringify(e.toJSON()));
      } else {
        console.error(formatError(e));
      }
      Deno.exit(1);
    }
    throw e;
  }
}

// Run if executed directly
if (import.meta.main) {
  await main(Deno.args);
}
