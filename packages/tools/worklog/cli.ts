import {
  WtError,
  type Index,
  type TaskMeta,
  type Entry,
  type Checkpoint,
  type AddOutput,
  type TraceOutput,
  type LogsOutput,
  type ListOutput,
  type SummaryOutput,
  type StatusOutput,
} from "./types.ts";
import {
  parseDocument,
  findSection,
  getSectionEndLine,
  serializeDocument,
  getFrontmatterContent,
  setFrontmatter,
} from "../markdown-surgeon/parser.ts";
import { sectionHash } from "../markdown-surgeon/hash.ts";
import { parseFrontmatter, stringifyFrontmatter } from "../markdown-surgeon/yaml.ts";

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

function getShortDateTime(): string {
  const now = new Date();
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
    throw new WtError("not_initialized", "Worktrack not initialized. Run 'wt init' first.");
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
    throw new WtError("task_already_done", `Task ${meta.id} is already completed`);
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
  if (!(await exists(WORKTRACK_DIR))) {
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
              (s) => s.level === 2 && s.line > section.line && s.line <= checkpointsEnd
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
  lastCheckpointTs: string | null
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
    lines.push(`entries since checkpoint: ${output.entries_since_checkpoint.length}`);
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

function formatError(error: WtError): string {
  return `error: ${error.code}\n${error.message}`;
}

// ============================================================================
// Commands
// ============================================================================

async function cmdInit(): Promise<StatusOutput> {
  if (await exists(WORKTRACK_DIR)) {
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
  const now = getLocalISOString();

  const content = `---
id: ${id}
desc: "${desc.replace(/"/g, '\\"')}"
status: active
created: "${now}"
done_at: null
last_checkpoint: null
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

async function cmdTrace(taskId: string, message: string): Promise<TraceOutput> {
  await purge();

  const content = await loadTaskContent(taskId);
  const { meta } = await parseTaskFile(content);
  assertActive(meta);

  const doc = await parseDocument(content);
  const entriesId = await getEntriesId();
  const checkpointsId = await getCheckpointsId();

  const entriesSection = findSection(doc, entriesId);
  const checkpointsSection = findSection(doc, checkpointsId);

  if (!entriesSection) {
    throw new WtError("io_error", "Invalid task file: missing # Entries section");
  }

  // Find insertion point: before # Checkpoints if it exists
  const insertLine = checkpointsSection
    ? checkpointsSection.line - 2 // Before blank line before # Checkpoints
    : getSectionEndLine(doc, entriesSection, true);

  const nowShort = getShortDateTime();
  const entry = `\n## ${nowShort}\n${message}\n`;
  const entryLines = entry.split("\n");

  doc.lines.splice(insertLine, 0, ...entryLines);

  await saveTaskContent(taskId, serializeDocument(doc));

  // Count entries since last checkpoint
  const parsed = await parseTaskFile(serializeDocument(doc));
  const entriesSinceCheckpoint = getEntriesAfterCheckpoint(
    parsed.entries,
    meta.last_checkpoint
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
    meta.last_checkpoint
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
  learnings: string
): Promise<StatusOutput> {
  await purge();

  const content = await loadTaskContent(taskId);
  const { meta } = await parseTaskFile(content);
  assertActive(meta);

  const doc = await parseDocument(content);
  const checkpointsId = await getCheckpointsId();
  const checkpointsSection = findSection(doc, checkpointsId);

  if (!checkpointsSection) {
    throw new WtError("io_error", "Invalid task file: missing # Checkpoints section");
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
  setFrontmatter(doc, stringifyFrontmatter(frontmatter as Record<string, unknown>));

  await saveTaskContent(taskId, serializeDocument(doc));

  return { status: "checkpoint_created" };
}

async function cmdDone(
  taskId: string,
  changes: string,
  learnings: string
): Promise<StatusOutput> {
  await purge();

  // First create the final checkpoint
  await cmdCheckpoint(taskId, changes, learnings);

  // Then mark as done
  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const now = getLocalISOString();

  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.status = "done";
  frontmatter.done_at = now;
  setFrontmatter(doc, stringifyFrontmatter(frontmatter as Record<string, unknown>));

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

async function cmdList(showAll: boolean): Promise<ListOutput> {
  await purge();

  const index = await loadIndex();

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
    const include =
      info.status === "active" ||
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

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`Usage: wl <command> [options]

Commands:
  init                                  Initialize worklog in current directory
  add [--desc "description"]            Create a new task
  trace <task-id> <message>             Log an entry to a task
  logs <task-id>                        Get task context for checkpoint
  checkpoint <task-id> <changes> <learnings>   Create a checkpoint
  done <task-id> <changes> <learnings>         Complete task with final checkpoint
  list [--all]                          List tasks (--all includes completed)
  summary [--since YYYY-MM-DD]          Aggregate all tasks

Options:
  --json                                Output in JSON format`);
}

function parseArgs(args: string[]): {
  command: string;
  flags: {
    desc: string | null;
    all: boolean;
    since: string | null;
    json: boolean;
  };
  positional: string[];
} {
  const flags = {
    desc: null as string | null,
    all: false,
    since: null as string | null,
    json: false,
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
          throw new WtError("invalid_args", "Usage: wt trace <task-id> <message>");
        }
        const output = await cmdTrace(positional[0], positional[1]);
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
            "Usage: wt checkpoint <task-id> <changes> <learnings>"
          );
        }
        const output = await cmdCheckpoint(positional[0], positional[1], positional[2]);
        console.log(flags.json ? JSON.stringify(output) : formatStatus(output));
        break;
      }

      case "done": {
        if (positional.length < 3) {
          throw new WtError(
            "invalid_args",
            "Usage: wt done <task-id> <changes> <learnings>"
          );
        }
        const output = await cmdDone(positional[0], positional[1], positional[2]);
        console.log(flags.json ? JSON.stringify(output) : formatStatus(output));
        break;
      }

      case "list": {
        const output = await cmdList(flags.all);
        console.log(flags.json ? JSON.stringify(output) : formatList(output));
        break;
      }

      case "summary": {
        const output = await cmdSummary(flags.since);
        console.log(flags.json ? JSON.stringify(output) : formatSummary(output));
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
