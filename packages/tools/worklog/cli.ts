import { Command } from "@cliffy/command";
import {
  type AddOutput,
  type AssignOutput,
  type Checkpoint,
  type DiscoveredScope,
  type Entry,
  type ImportOutput,
  type Index,
  type IndexEntry,
  type ListOutput,
  type MoveOutput,
  type RunOutput,
  type ScopeConfig,
  type ScopeConfigChild,
  type ScopeConfigParent,
  type ScopeDetailOutput,
  type ScopeEntry,
  type ScopesOutput,
  type ShowOutput,
  type StatusOutput,
  type SummaryOutput,
  TASK_STATUSES,
  type TaskMeta,
  type TaskStatus,
  type Todo,
  type TodoAddOutput,
  type TodoListOutput,
  type TodoStatus,
  type TraceOutput,
  type TracesOutput,
} from "./types.ts";
import { WtError } from "./domain/entities/errors.ts";
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
import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import { z } from "@zod/zod/mini";

// ============================================================================
// Hexagonal Architecture Imports
// ============================================================================

// Adapters
import { DenoFileSystem } from "./adapters/filesystem/deno-fs.ts";
import { DenoGitService } from "./adapters/git/deno-git.ts";
import { DenoProcessRunner } from "./adapters/process/deno-process-runner.ts";
import { Blake3HashService } from "../markdown-surgeon/adapters/services/blake3-hash.ts";
import { YamlParserService } from "../markdown-surgeon/adapters/services/yaml-parser.ts";
import { MarkdownTaskRepository } from "./adapters/repositories/markdown-task-repo.ts";
import { JsonIndexRepository } from "./adapters/repositories/json-index-repo.ts";
import { JsonScopeRepository } from "./adapters/repositories/json-scope-repo.ts";
import { MarkdownSurgeonAdapter } from "./adapters/markdown/surgeon-adapter.ts";

// Markdown-surgeon use cases (for MarkdownSurgeonAdapter)
import { ParseDocumentUseCase } from "../markdown-surgeon/domain/use-cases/parse-document.ts";
import { ReadSectionUseCase } from "../markdown-surgeon/domain/use-cases/read-section.ts";
import { ManageFrontmatterUseCase } from "../markdown-surgeon/domain/use-cases/manage-frontmatter.ts";

// Worklog use cases
import { InitUseCase } from "./domain/use-cases/task/init.ts";
import { CreateTaskUseCase } from "./domain/use-cases/task/create-task.ts";
import { ShowTaskUseCase } from "./domain/use-cases/task/show-task.ts";
import { ListTasksUseCase } from "./domain/use-cases/task/list-tasks.ts";
import { UpdateStatusUseCase } from "./domain/use-cases/task/update-status.ts";
import { UpdateMetaUseCase } from "./domain/use-cases/task/update-meta.ts";
import { UpdateTaskUseCase } from "./domain/use-cases/task/update-task.ts";
import { AddTraceUseCase } from "./domain/use-cases/trace/add-trace.ts";
import { ListTracesUseCase } from "./domain/use-cases/trace/list-traces.ts";
import { CreateCheckpointUseCase } from "./domain/use-cases/trace/checkpoint.ts";
import { AddTodoUseCase } from "./domain/use-cases/todo/add-todo.ts";
import { ListTodosUseCase } from "./domain/use-cases/todo/list-todos.ts";
import { UpdateTodoUseCase } from "./domain/use-cases/todo/update-todo.ts";
import { GetNextTodoUseCase } from "./domain/use-cases/todo/next-todo.ts";
import { ListScopesUseCase } from "./domain/use-cases/scope/list-scopes.ts";
import { AddScopeUseCase } from "./domain/use-cases/scope/add-scope.ts";
import { SyncWorktreesUseCase } from "./domain/use-cases/scope/sync-worktrees.ts";
import { RenameScopeUseCase } from "./domain/use-cases/scope/rename-scope.ts";
import { DeleteScopeUseCase } from "./domain/use-cases/scope/delete-scope.ts";
import { ExportScopeUseCase } from "./domain/use-cases/scope/export-scope.ts";
import { AssignScopeUseCase } from "./domain/use-cases/scope/assign-scope.ts";
import { ImportTasksUseCase } from "./domain/use-cases/import/import-tasks.ts";
import { ImportScopeToTagUseCase } from "./domain/use-cases/import/import-scope-to-tag.ts";
import { RunCommandUseCase } from "./domain/use-cases/run-command.ts";
import { ClaudeCommandUseCase } from "./domain/use-cases/claude-command.ts";
import { GenerateSummaryUseCase } from "./domain/use-cases/summary.ts";
import { ListTagsUseCase } from "./domain/use-cases/list-tags.ts";

// ============================================================================
// Global Options Type
// ============================================================================

/**
 * Global options available to all commands via .globalOption()
 */
interface GlobalOptions {
  cwd?: string;
  worklogDir?: string;
}

/**
 * Type helper to include global options in command options
 */
type WithGlobalOptions<T> = T & GlobalOptions;

// ============================================================================
// Version
// ============================================================================

const VERSION = "0.7.0";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WORKLOG_DIR = ".worklog";
let WORKLOG_DIR = DEFAULT_WORKLOG_DIR;
let TASKS_DIR = `${WORKLOG_DIR}/tasks`;
let INDEX_FILE = `${WORKLOG_DIR}/index.json`;
let _SCOPE_FILE = `${WORKLOG_DIR}/scope.json`;
const _CHECKPOINT_THRESHOLD = 50;

// Monorepo depth limit (configurable via env var)
const WORKLOG_DEPTH_LIMIT = (() => {
  try {
    return parseInt(Deno.env.get("WORKLOG_DEPTH_LIMIT") || "5", 10);
  } catch {
    // No --allow-env permission, use default
    return 5;
  }
})();

// Read WORKLOG_TASK_ID once at startup (safe even without --allow-env)
const ENV_TASK_ID: string | undefined = (() => {
  try {
    return Deno.env.get("WORKLOG_TASK_ID") || undefined;
  } catch {
    return undefined;
  }
})();
const HAS_ENV_TASK_ID = !!ENV_TASK_ID;

// Pre-computed section IDs for fixed section titles
let ENTRIES_ID: string | null = null;
let CHECKPOINTS_ID: string | null = null;
let TODOS_ID: string | null = null;

// ============================================================================
// Schemas
// ============================================================================

const TaskMetaSchema = z.object({
  id: z.string(),
  uid: z.string(),
  name: z.string(),
  desc: z.string(),
  status: z.enum(TASK_STATUSES),
  created_at: z.string(),
  ready_at: z.optional(z.nullable(z.string())),
  started_at: z.optional(z.nullable(z.string())),
  done_at: z.optional(z.nullable(z.string())),
  cancelled_at: z.optional(z.nullable(z.string())),
  last_checkpoint: z.nullable(z.string()),
  has_uncheckpointed_entries: z.boolean(),
  metadata: z.optional(z.record(z.string(), z.string())),
  tags: z.optional(z.array(z.string())),
});

// ============================================================================
// Dependency Injection Setup
// ============================================================================

// Core adapters
const fs = new DenoFileSystem();
const git = new DenoGitService();
const processRunner = new DenoProcessRunner();
const hashService = new Blake3HashService();
const yamlService = new YamlParserService();

// Markdown-surgeon setup
const _parseDoc = new ParseDocumentUseCase(hashService);
const _readSection = new ReadSectionUseCase();
const _manageFrontmatter = new ManageFrontmatterUseCase(yamlService);
const markdownService = new MarkdownSurgeonAdapter(hashService, yamlService);

// Repositories (will be re-instantiated when WORKLOG_DIR changes)
let taskRepo: MarkdownTaskRepository;
let indexRepo: JsonIndexRepository;
let scopeRepo: JsonScopeRepository;

// Use cases (will be re-instantiated when repositories change)
let initUseCase: InitUseCase;
let createTaskUseCase: CreateTaskUseCase;
let showTaskUseCase: ShowTaskUseCase;
let listTasksUseCase: ListTasksUseCase;
let updateStatusUseCase: UpdateStatusUseCase;
let updateMetaUseCase: UpdateMetaUseCase;
let updateTaskUseCase: UpdateTaskUseCase;
let addTraceUseCase: AddTraceUseCase;
let listTracesUseCase: ListTracesUseCase;
let createCheckpointUseCase: CreateCheckpointUseCase;
let addTodoUseCase: AddTodoUseCase;
let listTodosUseCase: ListTodosUseCase;
let updateTodoUseCase: UpdateTodoUseCase;
let getNextTodoUseCase: GetNextTodoUseCase;
let _listScopesUseCase: ListScopesUseCase;
let addScopeUseCase: AddScopeUseCase;
let _syncWorktreesUseCase: SyncWorktreesUseCase;
let renameScopeUseCase: RenameScopeUseCase;
let deleteScopeUseCase: DeleteScopeUseCase;
let exportScopeUseCase: ExportScopeUseCase;
let assignScopeUseCase: AssignScopeUseCase;
let importTasksUseCase: ImportTasksUseCase;
let importScopeToTagUseCase: ImportScopeToTagUseCase;
let runCommandUseCase: RunCommandUseCase;
let claudeCommandUseCase: ClaudeCommandUseCase;
let summaryUseCase: GenerateSummaryUseCase;
let listTagsUseCase: ListTagsUseCase;

/**
 * Initialize or reinitialize all use cases with current WORKLOG_DIR
 * Called on startup and whenever WORKLOG_DIR changes
 */
function initializeUseCases(): void {
  // Repositories
  taskRepo = new MarkdownTaskRepository(fs, markdownService, TASKS_DIR);
  indexRepo = new JsonIndexRepository(
    fs,
    markdownService,
    INDEX_FILE,
    TASKS_DIR,
  );
  scopeRepo = new JsonScopeRepository(fs, WORKLOG_DIR);

  // Warn function for use cases
  const warn = (msg: string) => console.error(msg);

  // Task use cases
  initUseCase = new InitUseCase(fs, indexRepo);
  createTaskUseCase = new CreateTaskUseCase({
    indexRepo,
    taskRepo,
    markdownService,
  });
  showTaskUseCase = new ShowTaskUseCase(indexRepo, taskRepo, scopeRepo, fs);
  listTasksUseCase = new ListTasksUseCase(indexRepo, scopeRepo, fs);
  updateStatusUseCase = new UpdateStatusUseCase(
    indexRepo,
    taskRepo,
    markdownService,
  );
  updateMetaUseCase = new UpdateMetaUseCase(
    indexRepo,
    taskRepo,
    markdownService,
  );
  updateTaskUseCase = new UpdateTaskUseCase(
    indexRepo,
    taskRepo,
    markdownService,
  );

  // Trace use cases
  addTraceUseCase = new AddTraceUseCase(
    indexRepo,
    taskRepo,
    markdownService,
    undefined, // Use default getTimestamp
    warn,
  );
  listTracesUseCase = new ListTracesUseCase(indexRepo, taskRepo);
  createCheckpointUseCase = new CreateCheckpointUseCase(
    indexRepo,
    taskRepo,
    markdownService,
  );

  // Todo use cases
  addTodoUseCase = new AddTodoUseCase(indexRepo, taskRepo, markdownService);
  listTodosUseCase = new ListTodosUseCase(indexRepo, taskRepo);
  updateTodoUseCase = new UpdateTodoUseCase(indexRepo, taskRepo);
  getNextTodoUseCase = new GetNextTodoUseCase(indexRepo, taskRepo);

  // Scope use cases
  _listScopesUseCase = new ListScopesUseCase(scopeRepo, fs, git);
  addScopeUseCase = new AddScopeUseCase(scopeRepo, fs, git);
  _syncWorktreesUseCase = new SyncWorktreesUseCase(scopeRepo, fs, git);
  renameScopeUseCase = new RenameScopeUseCase(scopeRepo, git);
  deleteScopeUseCase = new DeleteScopeUseCase(scopeRepo, fs, git);
  exportScopeUseCase = new ExportScopeUseCase(
    scopeRepo,
    fs,
    git,
    markdownService,
  );
  assignScopeUseCase = new AssignScopeUseCase(
    scopeRepo,
    fs,
    git,
    markdownService,
  );

  // Import use cases
  importTasksUseCase = new ImportTasksUseCase(
    indexRepo,
    taskRepo,
    fs,
    markdownService,
  );
  importScopeToTagUseCase = new ImportScopeToTagUseCase(
    indexRepo,
    taskRepo,
    fs,
    markdownService,
    git,
    scopeRepo,
  );

  // Run/Claude use cases (use deps objects)
  runCommandUseCase = new RunCommandUseCase({
    indexRepo,
    taskRepo,
    processRunner,
  });
  claudeCommandUseCase = new ClaudeCommandUseCase({
    indexRepo,
    processRunner,
    // deno-lint-ignore require-await
    showTaskFn: async (taskId: string) =>
      showTaskUseCase.execute({
        taskId,
        worklogDir: WORKLOG_DIR,
        gitRoot: null, // Will be determined by the use case
      }),
  });

  // Other use cases
  summaryUseCase = new GenerateSummaryUseCase(indexRepo, taskRepo);
  listTagsUseCase = new ListTagsUseCase(
    indexRepo,
    taskRepo,
    scopeRepo,
    fs,
    markdownService,
  );
}

// Initialize on startup
initializeUseCases();

// ============================================================================
// Helper functions
// ============================================================================

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

async function getTodosId(): Promise<string> {
  if (!TODOS_ID) {
    TODOS_ID = await sectionHash(1, "TODO", 0);
  }
  return TODOS_ID;
}

// ============================================================================
// Tag validation
// ============================================================================

/**
 * Validate a tag according to worklog conventions.
 *
 * Rules:
 * - No whitespace
 * - Allowed: a-z A-Z 0-9 / - _
 * - Cannot start/end with /
 * - Cannot contain //
 * - Max 100 chars
 */
function validateTag(tag: string): string | null {
  if (!tag || tag.length === 0) return "Tag cannot be empty";
  if (tag.length > 100) return "Tag too long (max 100 characters)";
  if (/\s/.test(tag)) return "Tag cannot contain whitespace";
  if (tag.startsWith("/") || tag.endsWith("/")) {
    return "Tag cannot start or end with /";
  }
  if (tag.includes("//")) return "Tag cannot contain consecutive slashes";
  if (!/^[a-zA-Z0-9/_-]+$/.test(tag)) {
    return "Tag contains invalid characters (allowed: a-z A-Z 0-9 / - _)";
  }
  return null;
}

function validateTags(tags: string[]): void {
  for (const tag of tags) {
    const error = validateTag(tag);
    if (error) {
      throw new WtError("invalid_args", `Invalid tag '${tag}': ${error}`);
    }
  }
}

/**
 * Check if a tag matches a search pattern hierarchically.
 *
 * Examples:
 *   matchesTagPattern("feat", "feat/auth") → true
 *   matchesTagPattern("feat", "feat") → true
 *   matchesTagPattern("feat", "feature") → false
 *   matchesTagPattern("feat/auth", "feat") → false
 */
function matchesTagPattern(pattern: string, tag: string): boolean {
  if (pattern === tag) return true;
  return tag.startsWith(pattern + "/");
}

/**
 * Check if any tag in array matches pattern.
 */
function hasMatchingTag(pattern: string, tags: string[]): boolean {
  return tags.some((tag) => matchesTagPattern(pattern, tag));
}

/**
 * Get effective tags for a task (task tags + inherited worktree tags).
 * Worktree tags are resolved from scope.json at query time.
 */
async function getEffectiveTags(
  taskTags: string[] | undefined,
  scopePath: string,
  gitRoot: string | null,
): Promise<string[]> {
  const tags = new Set<string>(taskTags || []);

  if (!gitRoot) return Array.from(tags);

  // Find this scope in parent's scope.json to get worktree tags
  const scopeJsonPath = join(scopePath, "scope.json");
  if (!(await exists(scopeJsonPath))) return Array.from(tags);

  const scopeConfig = JSON.parse(
    await Deno.readTextFile(scopeJsonPath),
  ) as ScopeConfig;

  // If child scope, load parent to find our tags
  if ("parent" in scopeConfig) {
    const parentPath = resolve(dirname(scopePath), scopeConfig.parent);
    const parentJsonPath = join(parentPath, "scope.json");
    if (await exists(parentJsonPath)) {
      const parentConfig = JSON.parse(
        await Deno.readTextFile(parentJsonPath),
      ) as ScopeConfigParent;
      const myEntry = parentConfig.children.find((c) =>
        resolve(parentPath, c.path) === scopePath
      );
      if (myEntry?.tags) {
        myEntry.tags.forEach((t) => tags.add(t));
      }
    }
  } // If parent scope with our path as a child entry
  else if ("children" in scopeConfig) {
    const myEntry = scopeConfig.children.find((c) =>
      resolve(scopePath, c.path) === scopePath
    );
    if (myEntry?.tags) {
      myEntry.tags.forEach((t) => tags.add(t));
    }
  }

  return Array.from(tags).sort();
}

/**
 * Find tasks matching tag pattern across all scopes.
 */
async function _findTasksByTagPattern(
  pattern: string,
  gitRoot: string | null,
  cwd: string,
): Promise<
  Array<{ id: string; task: IndexEntry; scopeId: string; scopePath: string }>
> {
  const results = [];

  const scopes = gitRoot
    ? await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT)
    : [{
      absolutePath: join(cwd, WORKLOG_DIR),
      id: ".",
      relativePath: ".",
      isParent: false,
    }];

  for (const scope of scopes) {
    const indexPath = join(scope.absolutePath, "index.json");
    if (!(await exists(indexPath))) continue;

    const index = JSON.parse(await Deno.readTextFile(indexPath)) as Index;
    for (const [id, task] of Object.entries(index.tasks)) {
      const effectiveTags = await getEffectiveTags(
        task.tags,
        scope.absolutePath,
        gitRoot,
      );
      if (hasMatchingTag(pattern, effectiveTags)) {
        results.push({
          id,
          task,
          scopeId: scope.id,
          scopePath: scope.absolutePath,
        });
      }
    }
  }

  return results;
}

/**
 * Check if current scope is a child worklog.
 */
async function isChildWorklog(scopePath: string): Promise<boolean> {
  const scopeJsonPath = join(scopePath, "scope.json");
  if (!(await exists(scopeJsonPath))) return false;

  const config = JSON.parse(
    await Deno.readTextFile(scopeJsonPath),
  ) as ScopeConfig;
  return "parent" in config;
}

/**
 * Get parent scope path from child scope.json.
 */
async function getParentScope(childPath: string): Promise<string> {
  const scopeJsonPath = join(childPath, "scope.json");
  const config = JSON.parse(
    await Deno.readTextFile(scopeJsonPath),
  ) as ScopeConfigChild;
  return resolve(dirname(childPath), config.parent);
}

// ============================================================================
// Date/Time utilities
// ============================================================================

function _getLocalISOString(): string {
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

function _getShortDateTime(date?: Date): string {
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
  const index = JSON.parse(content) as Index;

  // Run migration if needed
  if (!index.version || index.version < 2) {
    await migrateIndexToV2();
    // Reload index after migration
    const newContent = await readFile(INDEX_FILE);
    return JSON.parse(newContent) as Index;
  }

  return index;
}

async function saveIndex(index: Index): Promise<void> {
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

async function migrateIndexToV2(): Promise<void> {
  // Load index directly without triggering migration
  const content = await readFile(INDEX_FILE);
  const index = JSON.parse(content) as Index;

  // Check if migration is needed
  if (index.version === 2) {
    return; // Already migrated
  }

  console.error("Migrating worklog to v2...");

  // Get all task IDs
  const taskIds = Object.keys(index.tasks);

  // Migrate each task
  for (const taskId of taskIds) {
    const indexEntry = index.tasks[taskId];

    // Load task file
    const content = await loadTaskContent(taskId);
    const doc = await parseDocument(content);
    const yamlContent = getFrontmatterContent(doc);
    const frontmatter = parseFrontmatter(yamlContent) as Record<
      string,
      unknown
    >;

    // 1. Convert active status to created (NOT started)
    if (frontmatter.status === "active") {
      frontmatter.status = "created";
      indexEntry.status = "created";
    }

    // 2. Rename 'created' to 'created_at' in frontmatter
    if (frontmatter.created) {
      frontmatter.created_at = frontmatter.created;
      delete frontmatter.created;
    }

    // 3. Initialize new timestamp fields
    frontmatter.ready_at = null;
    frontmatter.started_at = null;

    // 4. Extract name from desc (first line)
    const desc = String(frontmatter.desc || "");
    const descLines = desc.split("\n");
    const name = descLines[0].trim();
    frontmatter.name = name;
    // Keep full desc unchanged

    // 5. Update index entry
    indexEntry.name = name;
    indexEntry.status_updated_at = String(frontmatter.created_at || "");

    // Ensure index has created field (no _at suffix)
    if (!indexEntry.created && frontmatter.created_at) {
      indexEntry.created = String(frontmatter.created_at);
    }

    // Save updated task file
    setFrontmatter(doc, stringifyFrontmatter(frontmatter));
    await saveTaskContent(taskId, serializeDocument(doc));
  }

  // Set version to 2
  index.version = 2;
  await saveIndex(index);

  console.error(`Migration complete. ${taskIds.length} tasks updated.`);
}

// ============================================================================
// Task ID generation
// ============================================================================

function _incrementLetter(s: string): string {
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

function _generateTodoId(): string {
  // Generate random 7-char base62 ID for todos
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < 7; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Convert UUID to base36 (case-insensitive friendly)
function uuidToBase36(uuid: string): string {
  // Remove hyphens and convert to BigInt
  const hex = uuid.replace(/-/g, "");
  const bigInt = BigInt("0x" + hex);

  // Convert to base36
  const base36Chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  let n = bigInt;

  while (n > 0n) {
    result = base36Chars[Number(n % 36n)] + result;
    n = n / 36n;
  }

  // Pad to ensure consistent length (25 chars for 128-bit UUID)
  return result.padStart(25, "0");
}

// Resolve ID prefix to full ID
function _resolveId(prefix: string, ids: string[]): string {
  const matches = ids.filter((id) =>
    id.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (matches.length === 0) {
    throw new WtError(
      "task_not_found",
      `No ID found matching prefix: ${prefix}`,
    );
  }

  if (matches.length > 1) {
    throw new WtError(
      "invalid_args",
      `Ambiguous ID prefix '${prefix}' matches ${matches.length} IDs: ${
        matches.slice(0, 5).join(", ")
      }${matches.length > 5 ? "..." : ""}`,
    );
  }

  return matches[0];
}

// Get shortest unambiguous prefix for display
function getShortId(id: string, allIds: string[]): string {
  const minLen = 5;
  let len = minLen;

  while (len < id.length) {
    const prefix = id.slice(0, len);
    const conflicts = allIds.filter((other) =>
      other !== id && other.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (conflicts.length === 0) {
      // Add 1 char margin, but don't exceed id length
      return id.slice(0, Math.min(len + 1, id.length));
    }
    len++;
  }

  return id;
}

// Resolve task ID prefix to full ID with detailed error message
async function resolveTaskId(prefix: string): Promise<string> {
  const index = await loadIndex();
  const allIds = Object.keys(index.tasks);
  const matches = allIds.filter((id) =>
    id.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (matches.length === 0) {
    throw new WtError(
      "task_not_found",
      `No task found matching prefix: ${prefix}`,
    );
  }

  if (matches.length > 1) {
    // Build detailed error message with short IDs and descriptions
    const lines = [
      `Ambiguous task ID prefix '${prefix}' matches ${matches.length} tasks:`,
    ];
    for (const id of matches.slice(0, 10)) {
      const shortId = getShortId(id, allIds);
      const desc = index.tasks[id]?.desc || "(no description)";
      lines.push(`  ${shortId}  "${desc}"`);
    }
    if (matches.length > 10) {
      lines.push(`  ... and ${matches.length - 10} more`);
    }
    throw new WtError("invalid_args", lines.join("\n"));
  }

  return matches[0];
}

/**
 * Resolve task ID with fallback to WORKLOG_TASK_ID environment variable.
 * Throws clear error if neither is provided.
 */
async function resolveTaskIdWithEnvFallback(
  taskId?: string,
): Promise<string> {
  const id = taskId ?? ENV_TASK_ID;
  if (!id) {
    throw new WtError(
      "invalid_args",
      "taskId argument is required (or set WORKLOG_TASK_ID environment variable)",
    );
  }
  return await resolveTaskId(id);
}

/**
 * Parse a potentially scope-qualified task ID.
 * "api:def2" → { scopeHint: "api", taskPrefix: "def2" }
 * "def2"     → { scopeHint: undefined, taskPrefix: "def2" }
 * "⬆:def2"   → { scopeHint: "⬆", taskPrefix: "def2" }
 */
function parseScopedTaskId(
  input: string,
): { scopeHint: string | undefined; taskPrefix: string } {
  const colonIdx = input.indexOf(":");
  if (colonIdx > 0) {
    return {
      scopeHint: input.slice(0, colonIdx),
      taskPrefix: input.slice(colonIdx + 1),
    };
  }
  return { scopeHint: undefined, taskPrefix: input };
}

/**
 * Resolve a task ID across scopes.
 *
 * Algorithm:
 * 1. If explicit scope:prefix syntax, resolve the scope and search there.
 * 2. Try local scope first. If found → return.
 * 3. On task_not_found + gitRoot exists: search all discovered scopes.
 * 4. 0 matches → throw task_not_found
 *    1 match  → chdir to that scope and return full ID
 *    N matches → throw invalid_args with scope-qualified suggestions
 */
async function resolveTaskIdAcrossScopes(
  input: string,
  gitRoot: string | null,
): Promise<string> {
  const { scopeHint, taskPrefix } = parseScopedTaskId(input);

  // Case 1: Explicit scope:prefix
  if (scopeHint) {
    if (!gitRoot) {
      throw new WtError(
        "invalid_args",
        "Scope-qualified task IDs require a git repository",
      );
    }

    const cwd = Deno.cwd();
    let scopePath: string;

    if (scopeHint === "⬆" || scopeHint === "^") {
      // Parent scope
      const currentWorklog = join(cwd, WORKLOG_DIR);
      if (!(await isChildWorklog(currentWorklog))) {
        throw new WtError(
          "scope_not_found",
          "Current scope has no parent",
        );
      }
      scopePath = await getParentScope(currentWorklog);
    } else {
      const worklogPath = await resolveScopeIdentifier(
        scopeHint,
        gitRoot,
        cwd,
      );
      scopePath = worklogPath.slice(0, -WORKLOG_DIR.length - 1);
    }

    Deno.chdir(scopePath);
    return await resolveTaskId(taskPrefix);
  }

  // Case 2: Try local scope first
  try {
    return await resolveTaskId(input);
  } catch (e) {
    if (!(e instanceof WtError) || e.code !== "task_not_found") {
      throw e; // Re-throw ambiguous matches or other errors
    }
    // Fall through to cross-scope search
  }

  // Case 3: Search across scopes (only if gitRoot available)
  if (!gitRoot) {
    throw new WtError(
      "task_not_found",
      `No task found matching prefix: ${input}`,
    );
  }

  const currentWorklogPath = join(Deno.cwd(), WORKLOG_DIR);

  // Collect all scope worklog paths to search (deduplicated by absolute path)
  const scopesToSearch = new Map<string, { absPath: string; id: string }>();

  // Source 1: discoverScopes (finds scopes within git root)
  const discoveredScopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);
  for (const scope of discoveredScopes) {
    if (scope.absolutePath !== currentWorklogPath) {
      scopesToSearch.set(scope.absolutePath, {
        absPath: scope.absolutePath,
        id: scope.id,
      });
    }
  }

  // Source 2: scope.json children (finds worktree scopes outside git root)
  const scopeJsonPath = `${currentWorklogPath}/scope.json`;
  if (await exists(scopeJsonPath)) {
    try {
      const configContent = await readFile(scopeJsonPath);
      const config = JSON.parse(configContent) as ScopeConfig;
      if ("children" in config) {
        for (const child of config.children) {
          // Resolve child path (can be relative or absolute)
          const childWorklogPath = isAbsolute(child.path)
            ? `${child.path}/${WORKLOG_DIR}`
            : resolve(gitRoot, child.path, WORKLOG_DIR);
          if (!scopesToSearch.has(childWorklogPath)) {
            scopesToSearch.set(childWorklogPath, {
              absPath: childWorklogPath,
              id: child.id,
            });
          }
        }
      }
    } catch {
      // Ignore errors reading scope.json
    }
  }

  // Also check parent scope if current is a child
  if (await isChildWorklog(currentWorklogPath)) {
    try {
      const parentScopePath = await getParentScope(currentWorklogPath);
      if (!scopesToSearch.has(parentScopePath)) {
        scopesToSearch.set(parentScopePath, {
          absPath: parentScopePath,
          id: "⬆",
        });
      }
    } catch {
      // Ignore
    }
  }

  type ScopeMatch = {
    scopeAbsPath: string;
    scopeId: string;
    taskId: string;
  };
  const matches: ScopeMatch[] = [];

  for (const [, scope] of scopesToSearch) {
    try {
      const index = await loadIndexFrom(scope.absPath);
      const allIds = Object.keys(index.tasks);
      const prefixMatches = allIds.filter((id) =>
        id.toLowerCase().startsWith(input.toLowerCase())
      );

      for (const taskId of prefixMatches) {
        matches.push({
          scopeAbsPath: scope.absPath,
          scopeId: scope.id,
          taskId,
        });
      }
    } catch {
      continue; // Skip scopes that can't be loaded
    }
  }

  if (matches.length === 0) {
    throw new WtError(
      "task_not_found",
      `No task found matching prefix: ${input} (searched all scopes)`,
    );
  }

  if (matches.length === 1) {
    const match = matches[0];
    const scopeDir = match.scopeAbsPath.slice(0, -WORKLOG_DIR.length - 1);
    Deno.chdir(scopeDir);
    return match.taskId;
  }

  // Multiple matches: build helpful error message
  const allIds = matches.map((m) => m.taskId);
  const lines = [
    `Ambiguous task ID prefix '${input}' matches ${matches.length} tasks across scopes:`,
  ];
  for (const m of matches.slice(0, 10)) {
    const shortId = getShortId(m.taskId, allIds);
    lines.push(`  ${m.scopeId}:${shortId}`);
  }
  if (matches.length > 10) {
    lines.push(`  ... and ${matches.length - 10} more`);
  }
  throw new WtError("invalid_args", lines.join("\n"));
}

/**
 * Resolve task ID with env fallback + cross-scope resolution.
 * Used by Cliffy handlers that need both features.
 */
async function resolveTaskIdWithEnvFallbackAcrossScopes(
  taskId: string | undefined,
  gitRoot: string | null,
): Promise<string> {
  const id = taskId ?? ENV_TASK_ID;
  if (!id) {
    throw new WtError(
      "invalid_args",
      "taskId argument is required (or set WORKLOG_TASK_ID environment variable)",
    );
  }
  return await resolveTaskIdAcrossScopes(id, gitRoot);
}

// Resolve todo ID prefix to full ID with detailed error message
function _resolveTodoId(prefix: string, todos: Todo[]): string {
  const allIds = todos.map((t) => t.id);
  const matches = todos.filter((t) =>
    t.id.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (matches.length === 0) {
    throw new WtError(
      "todo_not_found",
      `No todo found matching prefix: ${prefix}`,
    );
  }

  if (matches.length > 1) {
    // Build detailed error message with short IDs and descriptions
    const lines = [
      `Ambiguous todo ID prefix '${prefix}' matches ${matches.length} todos:`,
    ];
    for (const todo of matches.slice(0, 10)) {
      const shortId = getShortId(todo.id, allIds);
      lines.push(`  ${shortId}  "${todo.text}"`);
    }
    if (matches.length > 10) {
      lines.push(`  ... and ${matches.length - 10} more`);
    }
    throw new WtError("invalid_args", lines.join("\n"));
  }

  return matches[0].id;
}

function _generateTaskIdBase62(): string {
  // Generate UUID and convert to base36 (no collision check needed with UUID)
  const uuid = crypto.randomUUID();
  return uuidToBase36(uuid);
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

interface WorktreeInfo {
  path: string;
  branch: string | null; // null for detached HEAD
  isMainWorktree: boolean;
}

async function listAllWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const process = new Deno.Command("git", {
    args: ["worktree", "list", "--porcelain"],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await process.output();

  if (code !== 0) {
    const error = new TextDecoder().decode(stderr);
    throw new WtError("io_error", `Failed to list worktrees: ${error}`);
  }

  const output = new TextDecoder().decode(stdout);
  const lines = output.trim().split("\n");

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  let isFirst = true;

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          isMainWorktree: current.isMainWorktree ?? false,
        });
      }
      current = {
        path: line.slice(9),
        isMainWorktree: isFirst,
      };
      isFirst = false;
    } else if (line.startsWith("branch ")) {
      // Extract branch name from refs/heads/xxx
      const branchRef = line.slice(7);
      current.branch = branchRef.startsWith("refs/heads/")
        ? branchRef.slice(11)
        : branchRef;
    } else if (line === "detached") {
      current.branch = null;
    }
  }

  // Push the last worktree
  if (current.path) {
    worktrees.push({
      path: current.path,
      branch: current.branch ?? null,
      isMainWorktree: current.isMainWorktree ?? false,
    });
  }

  return worktrees;
}

/**
 * Get the current git branch name
 */
async function _getCurrentBranch(cwd: string): Promise<string | null> {
  const process = new Deno.Command("git", {
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout } = await process.output();
  if (code !== 0) {
    return null;
  }

  const branch = new TextDecoder().decode(stdout).trim();
  return branch === "HEAD" ? null : branch; // HEAD means detached
}

// ============================================================================
// Git root & Scope discovery (monorepo)
// ============================================================================

async function findGitRoot(cwd: string): Promise<string | null> {
  try {
    const process = new Deno.Command("git", {
      args: ["rev-parse", "--show-toplevel"],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout } = await process.output();
    if (code !== 0) {
      return null;
    }

    const output = new TextDecoder().decode(stdout).trim();
    return output;
  } catch {
    return null;
  }
}

async function scanForWorklogs(
  dir: string,
  gitRoot: string,
  currentDepth: number,
  maxDepth: number,
): Promise<string[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const results: string[] = [];

  try {
    for await (const entry of Deno.readDir(dir)) {
      // Skip hidden dirs except .worklog
      if (entry.name.startsWith(".") && entry.name !== WORKLOG_DIR) {
        continue;
      }

      // Skip common ignore patterns
      if (["node_modules", "dist", "build", "target"].includes(entry.name)) {
        continue;
      }

      const fullPath = `${dir}/${entry.name}`;

      if (entry.name === WORKLOG_DIR && entry.isDirectory) {
        results.push(fullPath);
      } else if (entry.isDirectory) {
        const nested = await scanForWorklogs(
          fullPath,
          gitRoot,
          currentDepth + 1,
          maxDepth,
        );
        results.push(...nested);
      }
    }
  } catch {
    // Ignore permission errors
  }

  return results;
}

async function discoverScopes(
  gitRoot: string,
  depthLimit: number,
): Promise<DiscoveredScope[]> {
  const worklogPaths = await scanForWorklogs(gitRoot, gitRoot, 0, depthLimit);
  const scopes: DiscoveredScope[] = [];

  // Load custom IDs from root scope.json if it exists
  const idMap = new Map<string, string>(); // path -> custom ID
  const rootScopeJsonPath = `${gitRoot}/${WORKLOG_DIR}/scope.json`;
  if (await exists(rootScopeJsonPath)) {
    try {
      const content = await readFile(rootScopeJsonPath);
      const config = JSON.parse(content) as ScopeConfig;
      if ("children" in config) {
        for (const child of config.children) {
          idMap.set(child.path, child.id);
        }
      }
    } catch {
      // Ignore errors, will use default IDs
    }
  }

  for (const absolutePath of worklogPaths) {
    const relativePath = absolutePath.slice(gitRoot.length + 1);
    const isParent = relativePath === WORKLOG_DIR;
    const scopePath = isParent
      ? ""
      : relativePath.slice(0, -WORKLOG_DIR.length - 1); // Remove /.worklog

    // Use custom ID if available, otherwise use path
    const defaultId = scopePath || "(root)";
    const customId = idMap.get(scopePath);

    scopes.push({
      absolutePath,
      relativePath: scopePath || ".",
      id: customId ?? defaultId,
      isParent,
    });
  }

  return scopes;
}

// ============================================================================
// Scope JSON management
// ============================================================================

async function loadOrCreateScopeJson(
  worklogPath: string,
  gitRoot: string,
): Promise<ScopeConfig> {
  const scopeJsonPath = `${worklogPath}/scope.json`;

  if (await exists(scopeJsonPath)) {
    try {
      const content = await readFile(scopeJsonPath);
      return JSON.parse(content) as ScopeConfig;
    } catch {
      // Corrupted, will recreate
    }
  }

  // Create default structure
  const relativePath = worklogPath.slice(gitRoot.length + 1);
  const isRoot = relativePath === WORKLOG_DIR;

  if (isRoot) {
    return { children: [] };
  } else {
    // Find parent path
    const scopeDir = worklogPath.slice(0, -WORKLOG_DIR.length - 1);
    const relativeToGitRoot = scopeDir.slice(gitRoot.length + 1);
    const depth = relativeToGitRoot.split("/").length;
    const parentPath = "../".repeat(depth);
    return { parent: parentPath };
  }
}

async function saveScopeJson(
  worklogPath: string,
  config: ScopeConfig,
): Promise<void> {
  const scopeJsonPath = `${worklogPath}/scope.json`;
  await writeFile(scopeJsonPath, JSON.stringify(config, null, 2));
}

async function refreshScopeHierarchy(
  gitRoot: string,
  scopes: DiscoveredScope[],
): Promise<void> {
  // Build hierarchy
  const rootScope = scopes.find((s) => s.isParent);
  const childScopes = scopes.filter((s) => !s.isParent);

  // Update root scope.json
  if (rootScope) {
    // Load existing config to preserve custom IDs
    const existingConfig = await loadOrCreateScopeJson(
      rootScope.absolutePath,
      gitRoot,
    );
    const existingIds = new Map<string, string>(); // path -> id

    if ("children" in existingConfig) {
      for (const child of existingConfig.children) {
        existingIds.set(child.path, child.id);
      }
    }

    // Build new config preserving IDs when path matches
    const children: ScopeEntry[] = childScopes.map((s) => {
      const path = s.relativePath === "." ? "" : s.relativePath;
      const defaultId = s.relativePath === "." ? "(root)" : s.relativePath;

      // Check if this path existed before
      const existingId = existingIds.get(path);

      return {
        path,
        id: existingId ?? defaultId,
      };
    });

    const rootConfig: ScopeConfigParent = { children };
    await saveScopeJson(rootScope.absolutePath, rootConfig);
  }

  // Update child scope.json
  for (const childScope of childScopes) {
    const scopeDir = childScope.absolutePath.slice(0, -WORKLOG_DIR.length - 1);
    const relativeToGitRoot = scopeDir.slice(gitRoot.length + 1);
    const depth = relativeToGitRoot.split("/").filter((p) => p).length;
    const parentPath = "../".repeat(depth);

    const childConfig: ScopeConfigChild = { parent: parentPath };
    await saveScopeJson(childScope.absolutePath, childConfig);
  }
}

// ============================================================================
// Scope resolution
// ============================================================================

async function findNearestWorklog(
  cwd: string,
  stopAt: string | null,
): Promise<string | null> {
  let current = cwd;

  while (true) {
    const worklogPath = `${current}/${WORKLOG_DIR}`;
    if (await exists(worklogPath)) {
      return worklogPath;
    }

    // Stop at git root or filesystem root
    if (stopAt && current === stopAt) {
      break;
    }

    const parent = current.split("/").slice(0, -1).join("/");
    if (!parent || parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

async function resolveScopeIdentifier(
  identifier: string,
  gitRoot: string,
  cwd: string,
): Promise<string> {
  // Handle special aliases
  if (identifier === "/") {
    // Root scope
    return `${gitRoot}/${WORKLOG_DIR}`;
  }

  if (identifier === ".") {
    // Current active scope
    return await resolveActiveScope(cwd, null, gitRoot);
  }

  const scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);

  // Try exact path match first
  const byPath = scopes.find((s) => s.relativePath === identifier);
  if (byPath) {
    return byPath.absolutePath;
  }

  // Try custom ID match
  const rootConfig = await loadOrCreateScopeJson(
    `${gitRoot}/${WORKLOG_DIR}`,
    gitRoot,
  );

  if ("children" in rootConfig) {
    const matches = rootConfig.children.filter((c) => c.id === identifier);

    if (matches.length === 0) {
      throw new WtError("scope_not_found", `Scope not found: ${identifier}`);
    }

    if (matches.length > 1) {
      const paths = matches.map((m) => m.path).join(", ");
      throw new WtError(
        "scope_ambiguous",
        `Multiple scopes match '${identifier}': ${paths}. Use full path.`,
      );
    }

    const childPath = matches[0].path;
    return isAbsolute(childPath)
      ? `${childPath}/${WORKLOG_DIR}`
      : `${gitRoot}/${childPath}/${WORKLOG_DIR}`;
  }

  throw new WtError("scope_not_found", `Scope not found: ${identifier}`);
}

async function resolveActiveScope(
  cwd: string,
  flagScope: string | null,
  gitRoot: string | null,
): Promise<string> {
  // Priority 1: --scope flag
  if (flagScope && gitRoot) {
    return await resolveScopeIdentifier(flagScope, gitRoot, cwd);
  }

  // Priority 2: nearest .worklog
  const nearest = await findNearestWorklog(cwd, gitRoot);
  if (nearest) {
    return nearest;
  }

  // Priority 3: git root .worklog
  if (gitRoot) {
    const rootWorklog = `${gitRoot}/${WORKLOG_DIR}`;
    if (await exists(rootWorklog)) {
      return rootWorklog;
    }
  }

  // Priority 4: current dir .worklog (non-git mode)
  return `${cwd}/${WORKLOG_DIR}`;
}

function getRelativeScopePath(worklogPath: string, gitRoot: string): string {
  if (!worklogPath.startsWith(gitRoot)) {
    return basename(worklogPath);
  }

  const relativePath = worklogPath.slice(gitRoot.length + 1);
  if (relativePath === WORKLOG_DIR) {
    return ".";
  }
  return relativePath.slice(0, -WORKLOG_DIR.length - 1);
}

async function _getScopeId(
  worklogPath: string,
  gitRoot: string,
): Promise<string> {
  const relativePath = getRelativeScopePath(worklogPath, gitRoot);
  if (relativePath === ".") {
    return "(root)";
  }

  // Try to get custom ID from root config
  const rootConfigPath = `${gitRoot}/${WORKLOG_DIR}/scope.json`;
  if (await exists(rootConfigPath)) {
    try {
      const content = await readFile(rootConfigPath);
      const rootConfig = JSON.parse(content) as ScopeConfig;

      if ("children" in rootConfig) {
        const child = rootConfig.children.find((c) => c.path === relativePath);
        if (child) {
          return child.id;
        }
      }
    } catch {
      // Fallback to path
    }
  }

  return relativePath;
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

async function _loadTaskContentFrom(
  taskId: string,
  worklogPath: string,
): Promise<string> {
  const path = `${worklogPath}/tasks/${taskId}.md`;
  if (!(await exists(path))) {
    throw new WtError("task_not_found", `Task not found: ${taskId}`);
  }
  return await Deno.readTextFile(path);
}

async function _saveTaskContentTo(
  taskId: string,
  content: string,
  worklogPath: string,
): Promise<void> {
  await Deno.writeTextFile(`${worklogPath}/tasks/${taskId}.md`, content);
}

async function _saveIndexTo(index: Index, worklogPath: string): Promise<void> {
  const indexPath = `${worklogPath}/index.json`;
  await Deno.writeTextFile(indexPath, JSON.stringify(index, null, 2));
}

function _assertActive(meta: TaskMeta): void {
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
  const worklogExists = await exists(WORKLOG_DIR);
  const indexExists = await exists(INDEX_FILE);

  if (!worklogExists) {
    await Deno.mkdir(TASKS_DIR, { recursive: true });
    await saveIndex({ tasks: {} });
  } else if (!indexExists) {
    throw new WtError(
      "not_initialized",
      "Worklog directory exists but is not properly initialized. Please run 'wl init' or remove .worklog directory.",
    );
  }
}

// ============================================================================
// Entry/Checkpoint parsing helpers
// ============================================================================

interface ParsedTask {
  meta: TaskMeta;
  entries: Entry[];
  checkpoints: Checkpoint[];
  todos: Todo[];
}

async function parseTaskFile(content: string): Promise<ParsedTask> {
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);

  // Try strict validation first, fall back to unsafe cast for malformed data
  let meta: TaskMeta;
  try {
    meta = TaskMetaSchema.parse(parseFrontmatter(yamlContent));
  } catch {
    // Gracefully handle malformed frontmatter (e.g., in tests or corrupted files)
    meta = parseFrontmatter(yamlContent) as unknown as TaskMeta;
  }

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

    // Only consider level-2 sections with timestamp-like titles as checkpoints
    // (to avoid treating content headers like "## Résumé" as checkpoints)
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
      // (instead of using doc.sections to be resilient to headers in content)
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
        const contentEnd = learningsHeaderIdx >= 0 ? learningsHeaderIdx : cpEnd;
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
  const todosId = await getTodosId();
  const todosSection = findSection(doc, todosId);

  if (todosSection) {
    const todosEnd = getSectionEndLine(doc, todosSection, true);

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
        if (key !== "id") { // Skip [id:: ...] as it's redundant with ^id
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

function _getEntriesAfterCheckpoint(
  entries: Entry[],
  lastCheckpointTs: string | null,
): Entry[] {
  if (!lastCheckpointTs) return entries;

  const checkpointDate = parseDate(formatShort(lastCheckpointTs));
  return entries.filter((e) => parseDate(e.ts) > checkpointDate);
}

function _getLastCheckpoint(checkpoints: Checkpoint[]): Checkpoint | null {
  if (checkpoints.length === 0) return null;
  return checkpoints[checkpoints.length - 1];
}

// ============================================================================
// Output formatters (text)
// ============================================================================

function formatAdd(output: AddOutput): string {
  return output.id;
}

function formatTodoList(output: TodoListOutput): string {
  if (output.todos.length === 0) {
    return "No todos";
  }

  const statusChars: Record<TodoStatus, string> = {
    "todo": " ",
    "wip": "/",
    "blocked": ">",
    "cancelled": "-",
    "done": "x",
  };

  // Calculate short IDs for all todos and tasks
  const allTodoIds = output.todos.map((t) => t.id);
  const allTaskIds = Array.from(
    new Set(
      output.todos.map((t) => t.metadata.taskId).filter(Boolean) as string[],
    ),
  );

  // Group todos by task if taskId is present in metadata
  const byTask = new Map<string, { desc: string; todos: Todo[] }>();
  const ungrouped: Todo[] = [];

  for (const todo of output.todos) {
    const taskId = todo.metadata.taskId;
    const taskDesc = todo.metadata.taskDesc;

    if (taskId && taskDesc) {
      if (!byTask.has(taskId)) {
        byTask.set(taskId, { desc: taskDesc, todos: [] });
      }
      byTask.get(taskId)!.todos.push(todo);
    } else {
      ungrouped.push(todo);
    }
  }

  const lines: string[] = [];

  // Format grouped todos
  if (byTask.size > 0) {
    for (const [taskId, { desc, todos }] of byTask) {
      const shortTaskId = getShortId(taskId, allTaskIds);
      lines.push(`\n${shortTaskId}: ${desc}`);
      for (const todo of todos) {
        const statusChar = statusChars[todo.status];
        const shortTodoId = getShortId(todo.id, allTodoIds);
        let line = `  ${shortTodoId} [${statusChar}] ${todo.text}`;

        // Add metadata (excluding taskId and taskDesc which are already shown)
        const metadata = Object.entries(todo.metadata)
          .filter(([k]) => k !== "taskId" && k !== "taskDesc")
          .map(([k, v]) => `[${k}:: ${v}]`)
          .join(" ");

        if (metadata) {
          line += `  ${metadata}`;
        }

        lines.push(line);
      }
    }
  }

  // Format ungrouped todos
  for (const todo of ungrouped) {
    const statusChar = statusChars[todo.status];
    const shortTodoId = getShortId(todo.id, allTodoIds);
    let line = `${shortTodoId} [${statusChar}] ${todo.text}`;

    const metadata = Object.entries(todo.metadata)
      .map(([k, v]) => `[${k}:: ${v}]`)
      .join(" ");

    if (metadata) {
      line += `  ${metadata}`;
    }

    lines.push(line);
  }

  return lines.join("\n").trim();
}

function formatTodoAdd(output: TodoAddOutput): string {
  return output.id;
}

function formatTodoNext(todo: Todo | null): string {
  if (!todo) {
    return "No available todo";
  }

  const statusChars: Record<TodoStatus, string> = {
    "todo": " ",
    "wip": "/",
    "blocked": ">",
    "cancelled": "-",
    "done": "x",
  };

  const statusChar = statusChars[todo.status];
  let line = `${todo.id} [${statusChar}] ${todo.text}`;

  const metadata = Object.entries(todo.metadata)
    .map(([k, v]) => `[${k}:: ${v}]`)
    .join(" ");

  if (metadata) {
    line += `  ${metadata}`;
  }

  return line;
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

function formatMeta(output: { metadata: Record<string, string> }): string {
  if (Object.keys(output.metadata).length === 0) {
    return "(no metadata)";
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(output.metadata)) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

function formatShow(output: ShowOutput): string {
  const lines: string[] = [];

  // Header
  lines.push(`id: ${output.task}`);
  lines.push(`full id: ${output.fullId}`);
  lines.push(`name: ${output.name}`);
  lines.push(`status: ${output.status}`);
  if (output.tags && output.tags.length > 0) {
    lines.push(`tags: ${output.tags.map((t) => `#${t}`).join(" ")}`);
  }

  // History
  lines.push("history:");
  lines.push(`  created: ${output.created}`);
  if (output.ready) {
    lines.push(`  ready: ${output.ready}`);
  }
  if (output.started) {
    lines.push(`  started: ${output.started}`);
  }

  // Description (multiline with 2-space indent)
  lines.push("");
  lines.push("desc:");
  for (const line of output.desc.split("\n")) {
    lines.push(`  ${line}`);
  }

  // Last checkpoint
  if (output.last_checkpoint) {
    lines.push("");
    lines.push(`last checkpoint: ${output.last_checkpoint.ts}`);
    lines.push("  CHANGES");
    for (const line of output.last_checkpoint.changes.split("\n")) {
      lines.push(`    ${line}`);
    }
    lines.push("  LEARNINGS");
    for (const line of output.last_checkpoint.learnings.split("\n")) {
      lines.push(`    ${line}`);
    }
  }

  // Entries since checkpoint
  if (output.entries_since_checkpoint.length > 0) {
    lines.push("");
    lines.push(
      `entries since checkpoint: ${output.entries_since_checkpoint.length}`,
    );
    for (const entry of output.entries_since_checkpoint) {
      lines.push(`  ${entry.ts}`);
      for (const line of entry.msg.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }

  // Todos
  if (output.todos.length > 0) {
    lines.push("");
    lines.push(`todos: ${output.todos.length}`);

    const statusChars: Record<TodoStatus, string> = {
      "todo": " ",
      "wip": "/",
      "blocked": ">",
      "cancelled": "-",
      "done": "x",
    };

    const allTodoIds = output.todos.map((t) => t.id);

    for (const todo of output.todos) {
      const statusChar = statusChars[todo.status];
      const shortTodoId = getShortId(todo.id, allTodoIds);
      let line = `  ${shortTodoId} [${statusChar}] ${todo.text}`;

      // Add metadata
      const metadata = Object.entries(todo.metadata)
        .map(([k, v]) => `[${k}:: ${v}]`)
        .join(" ");

      if (metadata) {
        line += `  ${metadata}`;
      }

      lines.push(line);
    }
  }

  return lines.join("\n");
}

function formatTraces(output: TracesOutput): string {
  const lines: string[] = [];
  lines.push(`task: ${output.task}`);
  lines.push(`desc: ${output.desc}`);

  if (output.entries.length === 0) {
    lines.push("");
    lines.push("no traces");
  } else {
    lines.push("");
    lines.push(`traces: ${output.entries.length}`);
    for (const entry of output.entries) {
      lines.push(`  ${entry.ts}: ${entry.msg}`);
    }
  }

  return lines.join("\n");
}

function formatList(output: ListOutput, showAll = false): string {
  if (output.tasks.length === 0) {
    return showAll ? "no tasks" : "no active tasks";
  }

  // Sort tasks by creation date (newest first)
  const sortedTasks = [...output.tasks].sort((a, b) =>
    new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  // Calculate short IDs
  const allIds = sortedTasks.map((t) => t.id);

  return sortedTasks
    .map((t) => {
      const shortId = getShortId(t.id, allIds);

      // Filter scope prefix if it matches the filter pattern
      let prefix = "";
      if (
        t.scopePrefix && (!t.filterPattern || t.scopePrefix !== t.filterPattern)
      ) {
        prefix = `[${t.scopePrefix}]  `;
      }

      // Filter tags - exclude the exact match of filterPattern, but keep children
      let tagsToShow = t.tags || [];
      if (t.filterPattern && t.tags) {
        tagsToShow = t.tags.filter((tag) => {
          // Exclude exact match
          if (tag === t.filterPattern) return false;
          // Exclude if filterPattern is a child of this tag (shouldn't happen but be safe)
          if (t.filterPattern!.startsWith(tag + "/")) return false;
          // Include everything else (including children of filterPattern like foo/bar when filtering by foo)
          return true;
        });
      }

      const tagsStr = tagsToShow.length > 0
        ? tagsToShow.map((tag) => `#${tag}`).join(" ") + "  "
        : "";

      return `${prefix}${tagsStr}${shortId}  ${t.status}  "${t.name}"  ${t.created}`;
    })
    .join("\n");
}

function formatScopes(output: ScopesOutput): string {
  if (output.scopes.length === 0) {
    return "no scopes found";
  }

  const lines: string[] = ["Scopes:"];

  for (const scope of output.scopes) {
    const active = scope.isActive ? "  [active]" : "";
    const id = scope.id.padEnd(15);
    lines.push(`  ${id} ${scope.path}${active}`);
  }

  return lines.join("\n");
}

function _formatMove(output: MoveOutput): string {
  return `moved ${output.moved} task(s) to ${output.target}`;
}

function formatScopeDetail(output: ScopeDetailOutput): string {
  return `Scope: ${output.id}
Path: ${output.path}
Tasks: ${output.taskCount}`;
}

function formatAssign(output: AssignOutput): string {
  const lines: string[] = [];
  lines.push(`Assigned: ${output.assigned}`);
  lines.push(`Merged: ${output.merged}`);

  if (output.errors.length > 0) {
    lines.push("\nErrors:");
    for (const err of output.errors) {
      lines.push(`  ${err.taskId}: ${err.error}`);
    }
  }

  return lines.join("\n");
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
  return await initUseCase.execute({
    worklogDir: WORKLOG_DIR,
    tasksDir: TASKS_DIR,
  });
}

async function cmdAdd(
  name: string,
  desc?: string,
  initialStatus?: TaskStatus,
  todos: string[] = [],
  metadata?: Record<string, string>,
  tags?: string[],
  timestamp?: string,
): Promise<AddOutput> {
  await autoInit();
  await purge();

  return await createTaskUseCase.execute({
    name,
    desc,
    initialStatus,
    todos,
    metadata,
    tags,
    timestamp,
  });
}

async function cmdTrace(
  taskId: string,
  message: string,
  timestamp?: string,
  force?: boolean,
  metadata?: Record<string, string>,
): Promise<TraceOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  return await addTraceUseCase.execute({
    taskId,
    message,
    timestamp,
    force,
    metadata,
  });
}

async function cmdShow(
  taskId: string,
  activeOnly: boolean = false,
): Promise<ShowOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  const cwd = Deno.cwd();
  const gitRoot = await findGitRoot(cwd);

  return await showTaskUseCase.execute({
    taskId,
    activeOnly,
    worklogDir: WORKLOG_DIR,
    gitRoot,
  }) as ShowOutput;
}

async function cmdTraces(taskId: string): Promise<TracesOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  return await listTracesUseCase.execute({ taskId }) as TracesOutput;
}

async function cmdCheckpoint(
  taskId: string,
  changes: string,
  learnings: string,
  force?: boolean,
): Promise<StatusOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  return await createCheckpointUseCase.execute({
    taskId,
    changes,
    learnings,
    force,
  });
}

async function cmdDone(
  taskId: string,
  changes?: string,
  learnings?: string,
  force?: boolean,
  metadata?: Record<string, string>,
): Promise<StatusOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  // Check for pending todos (unless force is enabled)
  if (!force) {
    const content = await loadTaskContent(taskId);
    const { meta, todos } = await parseTaskFile(content);

    const pendingTodos = todos.filter(
      (t) => t.status !== "done" && t.status !== "cancelled",
    );

    if (pendingTodos.length > 0) {
      throw new WtError(
        "task_has_pending_todos",
        `Task has ${pendingTodos.length} pending todo(s). Use --force to complete anyway.`,
      );
    }

    // If no changes/learnings provided, check if there are uncheckpointed entries
    if (!changes && !learnings) {
      if (meta.has_uncheckpointed_entries) {
        throw new WtError(
          "no_uncheckpointed_entries",
          "Cannot mark done: uncheckpointed entries exist. Provide changes and learnings.",
        );
      }
    }
  }

  // Create final checkpoint if changes/learnings provided
  if (changes || learnings) {
    await createCheckpointUseCase.execute({
      taskId,
      changes: changes ?? "",
      learnings: learnings ?? "",
      force: true,
    });
  }

  // Add metadata if provided
  if (metadata && Object.keys(metadata).length > 0) {
    for (const [key, value] of Object.entries(metadata)) {
      await updateMetaUseCase.execute({ taskId, key, value });
    }
  }

  // Mark as done
  return await updateStatusUseCase.execute({
    taskId,
    targetStatus: "done",
    force,
  });
}

async function cmdReady(taskId: string): Promise<StatusOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  return await updateStatusUseCase.execute({
    taskId,
    targetStatus: "ready",
  });
}

async function cmdStart(taskId: string): Promise<StatusOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  return await updateStatusUseCase.execute({
    taskId,
    targetStatus: "started",
  });
}

async function cmdRun(
  cmd: string[],
  taskId?: string,
  createName?: string,
): Promise<RunOutput> {
  if (!taskId && !createName) {
    throw new WtError(
      "invalid_args",
      "Either taskId or --create must be provided",
    );
  }

  if (taskId) {
    await purge();
  }

  return await runCommandUseCase.execute({
    cmd,
    taskId,
    createName,
  });
}

async function cmdClaude(
  taskId?: string,
  claudeArgs: string[] = [],
): Promise<RunOutput> {
  await purge();

  // Resolve taskId with env fallback
  const resolvedTaskId = await resolveTaskIdWithEnvFallback(taskId);

  return await claudeCommandUseCase.execute({
    taskId: resolvedTaskId,
    claudeArgs,
  });
}

async function cmdUpdate(
  taskId: string,
  name?: string,
  desc?: string,
): Promise<StatusOutput> {
  if (!name && desc === undefined) {
    throw new WtError(
      "invalid_args",
      "Must provide at least one of --name or --desc",
    );
  }

  await purge();
  taskId = await resolveTaskId(taskId);

  return await updateTaskUseCase.execute({
    taskId,
    name,
    desc,
  });
}

async function cmdCancel(
  taskId: string,
  reason?: string,
): Promise<StatusOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  // Add reason as metadata if provided
  if (reason) {
    await updateMetaUseCase.execute({
      taskId,
      key: "cancellation_reason",
      value: reason,
    });
  }

  return await updateStatusUseCase.execute({
    taskId,
    targetStatus: "cancelled",
  });
}

async function cmdMeta(
  taskId: string,
  key?: string,
  value?: string,
  deleteKey?: string,
): Promise<{ metadata: Record<string, string> }> {
  await purge();
  taskId = await resolveTaskId(taskId);

  return await updateMetaUseCase.execute({
    taskId,
    key,
    value,
    deleteKey,
  });
}

/**
 * List all unique tags across all scopes with counts.
 */
async function cmdListTags(
  gitRoot: string | null,
  cwd: string,
): Promise<{ tags: Array<{ tag: string; count: number }> }> {
  return await listTagsUseCase.listAll({
    gitRoot,
    cwd,
    worklogDir: WORKLOG_DIR,
    depthLimit: WORKLOG_DEPTH_LIMIT,
  }) as { tags: Array<{ tag: string; count: number }> };
}

/**
 * Manage task tags: list, add, or remove.
 * - No taskId: list all tags (same as cmdListTags)
 * - taskId only: show tags for task
 * - taskId + --add/--remove: modify task tags
 */
async function cmdTags(
  taskId: string | undefined,
  addTags: string[] | undefined,
  removeTags: string[] | undefined,
  gitRoot: string | null,
  cwd: string,
): Promise<
  { tags?: string[]; allTags?: Array<{ tag: string; count: number }> }
> {
  // Case 1: No taskId → list all tags
  if (!taskId) {
    const result = await cmdListTags(gitRoot, cwd);
    return { allTags: result.tags };
  }

  // Validate add tags
  if (addTags?.length) validateTags(addTags);

  await purge();
  const resolvedId = await resolveTaskId(taskId);

  // Case 2: taskId only → show task tags
  if (!addTags?.length && !removeTags?.length) {
    const content = await loadTaskContent(resolvedId);
    const doc = await parseDocument(content);
    const yamlContent = getFrontmatterContent(doc);
    const frontmatter = parseFrontmatter(yamlContent) as Record<
      string,
      unknown
    >;

    const effectiveTags = await getEffectiveTags(
      frontmatter.tags as string[] | undefined,
      join(cwd, WORKLOG_DIR),
      gitRoot,
    );

    return { tags: effectiveTags };
  }

  // Case 3: Modify tags
  const content = await loadTaskContent(resolvedId);
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent) as Record<string, unknown>;

  const currentTags = (frontmatter.tags as string[]) || [];
  const tagSet = new Set(currentTags);

  addTags?.forEach((t) => tagSet.add(t));
  removeTags?.forEach((t) => tagSet.delete(t));

  const newTags = Array.from(tagSet).sort();
  frontmatter.tags = newTags.length > 0 ? newTags : undefined;

  // Save task
  setFrontmatter(doc, stringifyFrontmatter(frontmatter));
  await saveTaskContent(resolvedId, serializeDocument(doc));

  // Update index
  const index = await loadIndex();
  if (index.tasks[resolvedId]) {
    index.tasks[resolvedId].tags = newTags.length > 0 ? newTags : undefined;
  }
  await saveIndex(index);

  return { tags: newTags };
}

async function cmdTodoList(taskId?: string): Promise<TodoListOutput> {
  await purge();

  if (taskId) {
    taskId = await resolveTaskId(taskId);
  }

  return await listTodosUseCase.execute({ taskId }) as TodoListOutput;
}

async function cmdTodoAdd(
  taskId: string,
  text: string,
  metadata: Record<string, string> = {},
): Promise<TodoAddOutput> {
  await purge();

  taskId = await resolveTaskId(taskId);

  return await addTodoUseCase.execute({ taskId, text, metadata });
}

async function cmdTodoSet(
  todoId: string,
  updates: Record<string, string>,
): Promise<StatusOutput> {
  await purge();

  return await updateTodoUseCase.execute({ todoId, updates });
}

async function cmdTodoNext(taskId?: string): Promise<Todo | null> {
  await purge();

  if (taskId) {
    taskId = await resolveTaskId(taskId);
  }

  return await getNextTodoUseCase.execute({ taskId });
}

async function cmdList(
  showAll: boolean,
  baseDir?: string,
  scopeIdentifier?: string,
  allScopes?: boolean,
  gitRoot?: string | null,
  currentScope?: string,
  cwd?: string,
  statusFilters?: TaskStatus[],
  filterPattern?: string,
): Promise<ListOutput> {
  if (!baseDir) {
    await purge();
  }

  return await listTasksUseCase.execute({
    showAll,
    baseDir,
    scopeIdentifier,
    allScopes,
    gitRoot,
    currentScope,
    cwd,
    statusFilters,
    filterPattern,
    worklogDir: WORKLOG_DIR,
    depthLimit: WORKLOG_DEPTH_LIMIT,
  }) as ListOutput;
}

async function cmdSummary(since: string | null): Promise<SummaryOutput> {
  await purge();

  return await summaryUseCase.execute({ since }) as SummaryOutput;
}

async function cmdImport(
  sourcePath: string,
  removeSource: boolean,
): Promise<ImportOutput> {
  await autoInit();

  return await importTasksUseCase.execute({
    sourcePath,
    removeSource,
  }) as ImportOutput;
}

/**
 * Import tasks from child worklog, converting scope to tag.
 */
async function cmdImportScopeToTag(
  sourcePath: string,
  removeSource: boolean,
  customTagName: string | undefined,
  gitRoot: string | null,
): Promise<ImportOutput & { tag: string }> {
  if (customTagName) {
    validateTags([customTagName]);
  }

  return await importScopeToTagUseCase.execute({
    sourcePath,
    removeSource,
    customTagName,
    gitRoot,
    worklogDir: WORKLOG_DIR,
  }) as ImportOutput & { tag: string };
}

async function cmdScopes(refresh: boolean, cwd: string): Promise<ScopesOutput> {
  const gitRoot = await findGitRoot(cwd);

  // First, try to find a configured parent relationship
  const currentWorklog = await findNearestWorklog(cwd, null);
  if (currentWorklog) {
    const scopeJsonPath = `${currentWorklog}/scope.json`;
    if (await exists(scopeJsonPath)) {
      try {
        const content = await readFile(scopeJsonPath);
        const config = JSON.parse(content) as ScopeConfig;

        // If we have a parent configured, use parent-based listing
        if ("parent" in config && config.parent) {
          const childDir = currentWorklog.slice(0, -WORKLOG_DIR.length - 1);
          const parentDir = await Deno.realPath(`${childDir}/${config.parent}`);
          const parentWorklogPath = `${parentDir}/${WORKLOG_DIR}`;

          if (await exists(parentWorklogPath)) {
            return await listScopesFromParent(
              parentWorklogPath,
              currentWorklog,
            );
          }
        }
      } catch {
        // Corrupted or unable to resolve, fall through to git-based discovery
      }
    }
  }

  // Fall back to git-root-based discovery
  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository and no parent scope configured.",
    );
  }

  let scopes: DiscoveredScope[];

  // Check if any scope.json is missing or if refresh is requested
  const needsRefresh = refresh ||
    !(await exists(`${gitRoot}/${WORKLOG_DIR}/scope.json`));

  if (needsRefresh) {
    scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);
    await refreshScopeHierarchy(gitRoot, scopes);
  } else {
    // Load from existing scope.json
    scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);
  }

  // Determine active scope
  const activeScope = await resolveActiveScope(cwd, null, gitRoot);

  const result: ScopesOutput = {
    scopes: scopes.map((s) => ({
      id: s.id,
      path: s.relativePath === "."
        ? WORKLOG_DIR + "/"
        : s.relativePath + "/" + WORKLOG_DIR + "/",
      isActive: s.absolutePath === activeScope,
    })),
  };

  return result;
}

/**
 * List scopes based on parent's children configuration.
 * Used for non-nested parent-child relationships.
 */
async function listScopesFromParent(
  parentWorklogPath: string,
  activeWorklogPath: string,
): Promise<ScopesOutput> {
  const parentDir = parentWorklogPath.slice(0, -WORKLOG_DIR.length - 1);
  const parentScopeJsonPath = `${parentWorklogPath}/scope.json`;

  if (!(await exists(parentScopeJsonPath))) {
    return { scopes: [] };
  }

  const content = await readFile(parentScopeJsonPath);
  const config = JSON.parse(content) as ScopeConfig;

  if (!("children" in config)) {
    return { scopes: [] };
  }

  const scopes: Array<{ id: string; path: string; isActive: boolean }> = [];

  // Add parent scope
  const parentDirName = parentDir.split("/").pop() ?? "parent";
  scopes.push({
    id: parentDirName,
    path: WORKLOG_DIR + "/",
    isActive: parentWorklogPath === activeWorklogPath,
  });

  // Add children
  for (const child of config.children) {
    const childDir = await Deno.realPath(`${parentDir}/${child.path}`).catch(
      () => null,
    );
    if (!childDir) continue;

    const childWorklogPath = `${childDir}/${WORKLOG_DIR}`;
    if (!(await exists(childWorklogPath))) continue;

    scopes.push({
      id: child.id,
      path: child.path + "/" + WORKLOG_DIR + "/",
      isActive: childWorklogPath === activeWorklogPath,
    });
  }

  return { scopes };
}

async function cmdScopesList(
  cwd: string,
  refresh: boolean,
  scopeId?: string,
): Promise<ScopesOutput | ScopeDetailOutput> {
  if (scopeId) {
    // Show details of a specific scope
    const gitRoot = await findGitRoot(cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scope details require git.",
      );
    }

    const worklogPath = await resolveScopeIdentifier(scopeId, gitRoot, cwd);
    const index = await loadIndexFrom(worklogPath);
    const taskCount = Object.keys(index.tasks).length;

    // Get the actual path relative to git root
    const relativePath = worklogPath.slice(gitRoot.length + 1);
    const path = relativePath.slice(0, -WORKLOG_DIR.length - 1) || ".";

    return {
      id: scopeId,
      path,
      taskCount,
    };
  } else {
    // List all scopes (reuse existing cmdScopes logic which handles non-git case)
    return await cmdScopes(refresh, cwd);
  }
}

async function cmdScopesAdd(
  scopeId: string,
  pathFlag: string | undefined,
  worktreeFlag: boolean,
  refFlag: string | undefined,
  cwd: string,
): Promise<StatusOutput> {
  const gitRoot = await findGitRoot(cwd);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Scopes require git.",
    );
  }

  return await addScopeUseCase.execute({
    scopeId,
    path: pathFlag,
    worktree: worktreeFlag,
    gitRef: refFlag,
    cwd,
    worklogDir: WORKLOG_DIR,
    depthLimit: WORKLOG_DEPTH_LIMIT,
  });
}

/**
 * Calculate relative path from one directory to another.
 * Both paths should be absolute.
 */
function calculateRelativePath(from: string, to: string): string {
  const fromParts = from.split("/").filter((p) => p);
  const toParts = to.split("/").filter((p) => p);

  // Find common prefix length
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Number of "../" needed to go up from 'from' to common ancestor
  const upCount = fromParts.length - commonLength;

  // Path to go down from common ancestor to 'to'
  const downParts = toParts.slice(commonLength);

  // Build relative path
  const relativeParts = [...Array(upCount).fill(".."), ...downParts];

  return relativeParts.length > 0 ? relativeParts.join("/") : ".";
}

async function cmdScopesAddParent(
  parentPath: string,
  scopeId: string | undefined,
  cwd: string,
): Promise<StatusOutput> {
  // Find the child worklog (current directory's .worklog)
  const childWorklogPath = await findNearestWorklog(cwd, null);

  if (!childWorklogPath) {
    throw new WtError(
      "not_initialized",
      "No worklog found. Run 'wl init' first.",
    );
  }

  // Get the child directory (parent of .worklog)
  const childDir = childWorklogPath.slice(0, -WORKLOG_DIR.length - 1);

  // Resolve parent path (can be relative to cwd)
  const resolvedParentPath = parentPath.startsWith("/")
    ? parentPath
    : `${cwd}/${parentPath}`;

  // Normalize the path (resolve .. and .)
  const parentDir = await Deno.realPath(resolvedParentPath).catch(() => {
    throw new WtError(
      "io_error",
      `Parent path does not exist: ${parentPath}`,
    );
  });

  const parentWorklogPath = `${parentDir}/${WORKLOG_DIR}`;

  // Check if parent worklog exists
  if (!(await exists(parentWorklogPath))) {
    throw new WtError(
      "not_initialized",
      `No worklog found at parent path: ${parentPath}. Run 'wl init' there first.`,
    );
  }

  // Check if child already has a parent
  const childScopeJsonPath = `${childWorklogPath}/scope.json`;
  if (await exists(childScopeJsonPath)) {
    try {
      const content = await readFile(childScopeJsonPath);
      const config = JSON.parse(content) as ScopeConfig;
      if ("parent" in config && config.parent) {
        throw new WtError(
          "already_has_parent",
          `This scope already has a parent configured: ${config.parent}. Remove it first if you want to change parents.`,
        );
      }
    } catch (e) {
      if (e instanceof WtError) throw e;
      // Corrupted, will be overwritten
    }
  }

  // Calculate relative path from child to parent
  const relativeToParent = calculateRelativePath(childDir, parentDir);

  // Configure child's scope.json
  const childConfig: ScopeConfigChild = { parent: relativeToParent };
  await saveScopeJson(childWorklogPath, childConfig);

  // Load parent's scope.json and add this child
  const parentConfig = await loadOrCreateScopeJson(
    parentWorklogPath,
    parentDir,
  );

  if (!("children" in parentConfig)) {
    // Parent is configured as a child itself - convert to have children
    // (a scope can be both a child and a parent)
    // For now, just throw an error as this is a complex scenario
    throw new WtError(
      "invalid_state",
      "Parent is configured as a child scope itself. Nested hierarchies are not yet supported.",
    );
  }

  // Calculate relative path from parent to child
  const relativeToChild = calculateRelativePath(parentDir, childDir);

  // Determine the ID for this child
  const childId = scopeId ?? childDir.split("/").pop() ?? relativeToChild;

  // Check if child already exists in parent
  const existingChild = parentConfig.children.find(
    (c) => c.path === relativeToChild,
  );

  if (!existingChild) {
    parentConfig.children.push({
      path: relativeToChild,
      id: childId,
    });
  } else {
    // Update ID if provided
    if (scopeId) {
      existingChild.id = scopeId;
    }
  }

  await saveScopeJson(parentWorklogPath, parentConfig);

  return { status: "parent_configured" };
}

async function cmdScopesRename(
  scopeId: string,
  newId: string,
  cwd: string,
): Promise<StatusOutput> {
  const gitRoot = await findGitRoot(cwd);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Scopes require git.",
    );
  }

  return await renameScopeUseCase.execute({
    scopeId,
    newId,
    cwd,
    worklogDir: WORKLOG_DIR,
  });
}

async function cmdScopesDelete(
  scopeId: string,
  moveTo: string | undefined,
  deleteTasks: boolean,
  cwd: string,
): Promise<StatusOutput> {
  const gitRoot = await findGitRoot(cwd);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Scopes require git.",
    );
  }

  // If moveTo is specified, need to move tasks first (delegation to assignScope)
  if (moveTo) {
    const worklogPath = await resolveScopeIdentifier(scopeId, gitRoot, cwd);
    const index = await loadIndexFrom(worklogPath);
    const taskIds = Object.keys(index.tasks);
    if (taskIds.length > 0) {
      const assignResult = await cmdScopesAssign(moveTo, taskIds, cwd);
      if (assignResult.errors.length > 0) {
        throw new WtError(
          "io_error",
          `Failed to move some tasks: ${
            assignResult.errors.map((e) => e.taskId).join(", ")
          }`,
        );
      }
    }
  }

  return await deleteScopeUseCase.execute({
    scopeId,
    deleteTasks,
    cwd,
    worklogDir: WORKLOG_DIR,
    depthLimit: WORKLOG_DEPTH_LIMIT,
  });
}

/**
 * Export tasks with specific tag to new child worklog.
 */
async function cmdScopesExport(
  tagPattern: string,
  targetPath: string,
  removeTag: boolean,
  customScopeId: string | undefined,
  gitRoot: string | null,
  cwd: string,
): Promise<{ exported: number; scopeId: string; targetPath: string }> {
  validateTags([tagPattern]);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Export requires git.",
    );
  }

  return await exportScopeUseCase.execute({
    tagPattern,
    targetPath,
    removeTag,
    customScopeId,
    gitRoot,
    cwd,
    worklogDir: WORKLOG_DIR,
    depthLimit: WORKLOG_DEPTH_LIMIT,
  });
}

interface SyncWorktreesOutput {
  added: string[];
  removed: string[];
  warnings: string[];
}

async function cmdScopesSyncWorktrees(
  cwd: string,
  dryRun: boolean,
): Promise<SyncWorktreesOutput> {
  const gitRoot = await findGitRoot(cwd);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Scopes require git.",
    );
  }

  const rootWorklogPath = `${gitRoot}/${WORKLOG_DIR}`;
  if (!(await exists(rootWorklogPath))) {
    throw new WtError(
      "not_initialized",
      "No worklog found at git root. Run 'wl init' first.",
    );
  }

  const rootConfig = await loadOrCreateScopeJson(rootWorklogPath, gitRoot);
  if (!("children" in rootConfig)) {
    throw new WtError(
      "invalid_state",
      "Root worklog is configured as a child scope. This is invalid.",
    );
  }

  const worktrees = await listAllWorktrees(cwd);
  const mainWorktree = worktrees.find((wt) => wt.isMainWorktree);

  const added: string[] = [];
  const removed: string[] = [];
  const warnings: string[] = [];

  // Find existing worktree scopes
  const existingWorktreeScopes = rootConfig.children.filter(
    (c) => c.type === "worktree",
  );

  // Check for stale worktree scopes (worktree no longer exists)
  for (const scope of existingWorktreeScopes) {
    const worktree = worktrees.find((wt) => wt.branch === scope.gitRef);
    if (!worktree) {
      // Worktree is gone
      warnings.push(
        `Worktree for '${scope.gitRef}' no longer exists. ` +
          `Tasks and traces in this scope have been lost. ` +
          `Consider running 'wl scopes delete ${scope.id}' before removing worktrees.`,
      );
      removed.push(scope.id);

      if (!dryRun) {
        // Remove from children list
        const index = rootConfig.children.indexOf(scope);
        if (index !== -1) {
          rootConfig.children.splice(index, 1);
        }
      }
    }
  }

  // Find worktrees that are not yet registered as scopes
  for (const worktree of worktrees) {
    // Skip main worktree and detached HEAD worktrees
    if (worktree.isMainWorktree || !worktree.branch) {
      continue;
    }

    // Check if already registered
    const existingScope = rootConfig.children.find(
      (c) => c.type === "worktree" && c.gitRef === worktree.branch,
    );

    if (!existingScope) {
      // New worktree to add
      const scopeId = worktree.branch; // Keep slashes in branch names as-is

      // Calculate path relative to main worktree or use absolute
      let effectivePath: string;
      if (mainWorktree && worktree.path.startsWith(mainWorktree.path)) {
        effectivePath = worktree.path.slice(mainWorktree.path.length + 1) ||
          ".";
      } else {
        effectivePath = worktree.path;
      }

      added.push(scopeId);

      if (!dryRun) {
        const worklogPath = `${worktree.path}/${WORKLOG_DIR}`;

        // Create worklog if it doesn't exist
        if (!(await exists(worklogPath))) {
          await Deno.mkdir(`${worklogPath}/tasks`, { recursive: true });
          await writeFile(
            `${worklogPath}/index.json`,
            JSON.stringify({ tasks: {} }, null, 2),
          );
        }

        // Configure parent path for the child
        const relPath = calculateRelativePath(worktree.path, gitRoot);
        const childConfig: ScopeConfigChild = { parent: relPath };
        await saveScopeJson(worklogPath, childConfig);

        // Add to parent's children
        rootConfig.children.push({
          path: effectivePath,
          id: scopeId,
          type: "worktree",
          gitRef: worktree.branch,
        });
      }
    }
  }

  if (!dryRun && (added.length > 0 || removed.length > 0)) {
    await saveScopeJson(rootWorklogPath, rootConfig);
  }

  return { added, removed, warnings };
}

async function cmdScopesAssign(
  targetScopeId: string,
  taskIds: string[],
  cwd: string,
): Promise<AssignOutput> {
  const gitRoot = await findGitRoot(cwd);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Scopes require git.",
    );
  }

  return await assignScopeUseCase.execute({
    targetScopeId,
    taskIds,
    cwd,
    worklogDir: WORKLOG_DIR,
    depthLimit: WORKLOG_DEPTH_LIMIT,
  }) as AssignOutput;
}

async function _cmdMove(
  sourceIdentifier: string,
  targetPath: string,
  cwd: string,
): Promise<MoveOutput> {
  const gitRoot = await findGitRoot(cwd);

  if (!gitRoot) {
    throw new WtError(
      "not_in_git_repo",
      "Not in a git repository. Move command requires git.",
    );
  }

  // Resolve source scope
  const sourceWorklog = await resolveScopeIdentifier(
    sourceIdentifier,
    gitRoot,
    cwd,
  );

  // Compute target worklog path and directory
  const targetDir = `${gitRoot}/${targetPath}`;
  const targetWorklog = `${targetDir}/${WORKLOG_DIR}`;

  // Create target if it doesn't exist (auto-init)
  if (!(await exists(targetWorklog))) {
    await Deno.mkdir(`${targetWorklog}/tasks`, { recursive: true });
    await writeFile(
      `${targetWorklog}/index.json`,
      JSON.stringify({ tasks: {} }, null, 2),
    );
  }

  // Save current directory
  const originalCwd = Deno.cwd();

  try {
    // Change to target directory so cmdImport imports into target .worklog
    Deno.chdir(targetDir);

    // Use cmdImport to move tasks
    const importResult = await cmdImport(sourceWorklog, true);

    // Refresh scope hierarchy
    const scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);
    await refreshScopeHierarchy(gitRoot, scopes);

    return {
      moved: importResult.imported + importResult.merged,
      target: targetPath,
    };
  } finally {
    // Restore original directory
    Deno.chdir(originalCwd);
  }
}

// ============================================================================
// Helper functions for scope operations
// ============================================================================

async function loadIndexFrom(worklogPath: string): Promise<Index> {
  const indexPath = `${worklogPath}/index.json`;
  if (!(await exists(indexPath))) {
    throw new WtError("not_initialized", `No worklog at: ${worklogPath}`);
  }
  const content = await readFile(indexPath);
  return JSON.parse(content) as Index;
}

async function _findTaskInScopes(
  taskIdPrefix: string,
  scopes: DiscoveredScope[],
): Promise<{ worklog: string; taskId: string } | null> {
  // Collect all tasks from all scopes
  const allTasks: Array<{ scope: string; taskId: string }> = [];

  for (const scope of scopes) {
    const indexPath = `${scope.absolutePath}/index.json`;
    if (await exists(indexPath)) {
      try {
        const index = await loadIndexFrom(scope.absolutePath);
        for (const id of Object.keys(index.tasks)) {
          allTasks.push({ scope: scope.absolutePath, taskId: id });
        }
      } catch {
        // Skip scopes that can't be loaded
        continue;
      }
    }
  }

  // Try exact match first
  for (const task of allTasks) {
    if (task.taskId === taskIdPrefix) {
      return { worklog: task.scope, taskId: task.taskId };
    }
  }

  // Try prefix resolution across all scopes
  const allIds = allTasks.map((t) => t.taskId);
  try {
    const resolvedId = _resolveId(taskIdPrefix, allIds);
    const task = allTasks.find((t) => t.taskId === resolvedId);
    if (task) {
      return { worklog: task.scope, taskId: task.taskId };
    }
  } catch {
    // Prefix resolution failed (ambiguous or not found)
    return null;
  }

  return null;
}

// ============================================================================
// CLI with Cliffy
// ============================================================================

function handleError(e: unknown, json: boolean): never {
  if (e instanceof WtError) {
    if (json) {
      console.error(JSON.stringify(e.toJSON()));
    } else {
      console.error(formatError(e));
    }
    Deno.exit(1);
  }
  throw e;
}

/**
 * Apply -C and --worklog-dir global options.
 * Returns true if an explicit worklog dir was set (skip scope resolution).
 */
function applyDirOptions(
  cDir: string | undefined,
  worklogDir: string | undefined,
): boolean {
  // Reset to defaults (needed when main() is called multiple times, e.g. tests)
  WORKLOG_DIR = DEFAULT_WORKLOG_DIR;
  TASKS_DIR = `${DEFAULT_WORKLOG_DIR}/tasks`;
  INDEX_FILE = `${DEFAULT_WORKLOG_DIR}/index.json`;
  _SCOPE_FILE = `${DEFAULT_WORKLOG_DIR}/scope.json`;

  if (cDir) {
    Deno.chdir(resolve(Deno.cwd(), cDir));
  }

  if (worklogDir) {
    const resolved = resolve(Deno.cwd(), worklogDir);
    const parent = dirname(resolved);
    const base = basename(resolved);
    Deno.chdir(parent);
    WORKLOG_DIR = base;
    TASKS_DIR = `${base}/tasks`;
    INDEX_FILE = `${base}/index.json`;
    _SCOPE_FILE = `${base}/scope.json`;
  }

  // Reinitialize use cases with new paths
  initializeUseCases();

  return !!worklogDir;
}

/**
 * Resolve scope and change to scope directory if needed
 */
async function resolveScopeContext(
  scopeFlag: string | undefined,
  cDir?: string,
  worklogDir?: string,
): Promise<{ cwd: string; gitRoot: string | null }> {
  const explicitWorklog = applyDirOptions(cDir, worklogDir);

  if (explicitWorklog) {
    if (scopeFlag) {
      throw new WtError(
        "invalid_args",
        "Cannot use --scope with --worklog-dir",
      );
    }
    return { cwd: Deno.cwd(), gitRoot: null };
  }

  const cwd = Deno.cwd();
  const gitRoot = await findGitRoot(cwd);

  if (scopeFlag || gitRoot) {
    try {
      const activeScope = await resolveActiveScope(
        cwd,
        scopeFlag ?? null,
        gitRoot,
      );
      const scopeDir = activeScope.slice(0, -WORKLOG_DIR.length - 1);
      if (scopeDir && scopeDir !== cwd) {
        Deno.chdir(scopeDir);
      }
    } catch {
      // If scope resolution fails, continue with current directory (backward compat)
    }
  }

  return { cwd, gitRoot };
}

/**
 * Parse --meta key=value into record
 */
function parseMetaOption(
  values: string[] | undefined,
): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined;
  const meta: Record<string, string> = {};
  for (const kv of values) {
    const eqIndex = kv.indexOf("=");
    if (eqIndex > 0) {
      meta[kv.slice(0, eqIndex)] = kv.slice(eqIndex + 1);
    }
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

// ============================================================================
// Cliffy Commands - Todo subcommands
// ============================================================================

const todoListCmd = new Command()
  .description("List todos (all active tasks or specific task)")
  .arguments("[taskId:string]")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      // Pre-resolve across scopes when taskId is provided
      let resolvedTaskId = taskId;
      if (taskId) {
        resolvedTaskId = await resolveTaskIdAcrossScopes(
          taskId,
          options.scope ? null : gitRoot,
        );
      }
      const output = await cmdTodoList(resolvedTaskId);
      console.log(
        options.json ? JSON.stringify(output) : formatTodoList(output),
      );
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const todoAddCmd = new Command()
  .description("Add a todo to a task")
  .arguments("<taskId:string> <text...:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId, ...textParts) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const text = textParts.join(" ");
      const output = await cmdTodoAdd(resolvedTaskId, text);
      console.log(
        options.json ? JSON.stringify(output) : formatTodoAdd(output),
      );
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const todoSetCmd = new Command()
  .description("Update todo (e.g., status=done)")
  .arguments("<args...:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, ...args) => {
    try {
      await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      // Parse key=value pairs and todo-id
      const updates: Record<string, string> = {};
      let todoId = "";
      for (const arg of args) {
        const eqIndex = arg.indexOf("=");
        if (eqIndex > 0) {
          updates[arg.substring(0, eqIndex)] = arg.substring(eqIndex + 1);
        } else {
          todoId = arg;
        }
      }
      if (!todoId) {
        throw new WtError(
          "invalid_args",
          "Missing todo-id in: wl todo set key=value <todo-id>",
        );
      }
      const output = await cmdTodoSet(todoId, updates);
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const todoNextCmd = new Command()
  .description("Show next available todo")
  .arguments(HAS_ENV_TASK_ID ? "[taskId:string]" : "<taskId:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const todo = await cmdTodoNext(resolvedTaskId);
      console.log(options.json ? JSON.stringify(todo) : formatTodoNext(todo));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const todoCmd = new Command()
  .description("Todo management")
  .action(function () {
    this.showHelp();
  })
  .command("list", todoListCmd)
  .command("add", todoAddCmd)
  .command("set", todoSetCmd)
  .command("next", todoNextCmd);

// ============================================================================
// Cliffy Commands - Scopes subcommands
// ============================================================================

const scopesListCmd = new Command()
  .description("List all scopes or show scope details")
  .arguments("[scopeId:string]")
  .option("--json", "Output as JSON")
  .option("--refresh", "Force rescan of scopes")
  .action(async (options, scopeId) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesList(
        cwd,
        options.refresh ?? false,
        scopeId,
      );
      if ("taskCount" in output) {
        console.log(
          options.json ? JSON.stringify(output) : formatScopeDetail(output),
        );
      } else {
        console.log(
          options.json ? JSON.stringify(output) : formatScopes(output),
        );
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesAddCmd = new Command()
  .description("Add scope (creates or links existing .worklog)")
  .arguments("<scopeId:string> [path:string]")
  .option("--json", "Output as JSON")
  .option("-p, --path <path:string>", "Path to scope directory")
  .option("--worktree", "Treat scope as git worktree")
  .option("--ref <ref:string>", "Git ref for worktree")
  .action(async (options, scopeId, pathArg) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const effectivePath = options.path ?? pathArg;
      if (effectivePath && options.worktree) {
        throw new WtError(
          "invalid_args",
          "Cannot use path and --worktree together. Choose one.",
        );
      }
      const output = await cmdScopesAdd(
        scopeId,
        effectivePath,
        options.worktree ?? false,
        options.ref,
        cwd,
      );
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesAddParentCmd = new Command()
  .description("Configure parent for current scope")
  .arguments("<path:string>")
  .option("--json", "Output as JSON")
  .option("--id <id:string>", "Scope ID for this scope")
  .action(async (options, parentPath) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesAddParent(parentPath, options.id, cwd);
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesRenameCmd = new Command()
  .description("Rename scope ID")
  .arguments("<scopeId:string> <newId:string>")
  .option("--json", "Output as JSON")
  .action(async (options, scopeId, newId) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesRename(scopeId, newId, cwd);
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesDeleteCmd = new Command()
  .description("Delete scope")
  .arguments("<scopeId:string>")
  .option("--json", "Output as JSON")
  .option(
    "--move-to <scope:string>",
    "Move tasks to another scope before delete",
  )
  .option("--delete-tasks", "Force delete with tasks")
  .action(async (options, scopeId) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesDelete(
        scopeId,
        options.moveTo,
        options.deleteTasks ?? false,
        cwd,
      );
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesAssignCmd = new Command()
  .description("Assign task(s) to scope")
  .arguments("<scopeId:string> <taskIds...:string>")
  .option("--json", "Output as JSON")
  .action(async (options, scopeId, ...taskIds) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesAssign(scopeId, taskIds, cwd);
      console.log(options.json ? JSON.stringify(output) : formatAssign(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesExportCmd = new Command()
  .description("Export tasks with tag to new child worklog")
  .arguments("<tag:string> <target-path:string>")
  .option("--json", "Output as JSON")
  .option("--keep-tag", "Keep tag on exported tasks")
  .option("--scope-id <id:string>", "Custom scope ID (defaults to tag)")
  .action(async (options, tag, targetPath) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const gitRoot = await findGitRoot(cwd);
      const output = await cmdScopesExport(
        tag,
        targetPath,
        !options.keepTag, // removeTag = !keepTag
        options.scopeId,
        gitRoot,
        cwd,
      );
      if (options.json) {
        console.log(JSON.stringify(output));
      } else {
        console.log(
          `Exported ${output.exported} tasks to ${output.targetPath}`,
        );
        console.log(`Scope ID: ${output.scopeId}`);
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesSyncWorktreesCmd = new Command()
  .description("Sync worktree scopes (add missing, remove stale)")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Preview changes without applying")
  .action(async (options) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesSyncWorktrees(cwd, options.dryRun ?? false);
      if (options.json) {
        console.log(JSON.stringify(output));
      } else {
        for (const warning of output.warnings) {
          console.error(`Warning: ${warning}`);
        }
        if (output.added.length > 0) {
          console.log(`Added: ${output.added.join(", ")}`);
        }
        if (output.removed.length > 0) {
          console.log(`Removed: ${output.removed.join(", ")}`);
        }
        if (
          output.added.length === 0 && output.removed.length === 0 &&
          output.warnings.length === 0
        ) {
          console.log("All worktrees are in sync.");
        }
        if (options.dryRun) {
          console.log("(dry-run mode, no changes made)");
        }
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const scopesCmd = new Command()
  .description("Scope management")
  .option("--json", "Output as JSON")
  .option("--refresh", "Force rescan of scopes")
  .action(async function (options) {
    // Default action: list scopes
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const cwd = Deno.cwd();
      const output = await cmdScopesList(cwd, false, undefined);
      if ("taskCount" in output) {
        console.log(
          options.json ? JSON.stringify(output) : formatScopeDetail(output),
        );
      } else {
        console.log(
          options.json ? JSON.stringify(output) : formatScopes(output),
        );
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  })
  .command("list", scopesListCmd)
  .command("add", scopesAddCmd)
  .command("add-parent", scopesAddParentCmd)
  .command("rename", scopesRenameCmd)
  .command("delete", scopesDeleteCmd)
  .command("assign", scopesAssignCmd)
  .command("export", scopesExportCmd)
  .command("sync-worktrees", scopesSyncWorktreesCmd);

// ============================================================================
// Cliffy Commands - Main commands
// ============================================================================

const initCmd = new Command()
  .description("Initialize worklog in current directory")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const output = await cmdInit();
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const taskCreateCmd = new Command()
  .description(
    "Create a new task (returns ID for use in trace/checkpoint/done)\n" +
      "Always create a worktask before starting work",
  )
  .arguments("<desc:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option(
    "-t, --timestamp <ts:string>",
    "Flexible timestamp (T11:15, 2024-12-15T11:15, etc.)",
  )
  .option("--todo <text:string>", "Add a todo item (repeatable)", {
    collect: true,
  })
  .option("--meta <kv:string>", "Set metadata key=value (repeatable)", {
    collect: true,
  })
  .option("--tag <tag:string>", "Add tag (repeatable)", {
    collect: true,
  })
  .action(async (options, desc) => {
    try {
      await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const todos = options.todo ?? [];
      const tags = options.tag ?? [];
      let timestampValue: string | undefined;
      if (options.timestamp) {
        try {
          timestampValue = parseFlexibleTimestamp(options.timestamp);
          // Ensure timezone is present, add local timezone if missing
          const tzRegex = /[+-]\d{2}:\d{2}$/;
          if (!tzRegex.test(timestampValue)) {
            const now = new Date();
            const tzOffset = -now.getTimezoneOffset();
            const sign = tzOffset >= 0 ? "+" : "-";
            const hours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(
              2,
              "0",
            );
            const minutes = String(Math.abs(tzOffset) % 60).padStart(2, "0");
            timestampValue += `${sign}${hours}:${minutes}`;
          }
        } catch {
          throw new WtError(
            "invalid_args",
            `Invalid timestamp format: ${options.timestamp}. Use format [YYYY-MM-DD]THH:mm[:SS][<tz>]`,
          );
        }
      }
      const metadata = parseMetaOption(options.meta);
      // For backward compat, `wl task create` creates started tasks
      const name = desc.split("\n")[0].trim();
      const output = await cmdAdd(
        name,
        desc,
        "started",
        todos,
        metadata,
        tags,
        timestampValue,
      );
      console.log(options.json ? JSON.stringify(output) : formatAdd(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const createCmd = new Command()
  .description(
    "Create a new task with lifecycle states\n" +
      "Default state is 'created' (not started yet)",
  )
  .arguments("<name:string> [desc:string]")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--ready", "Create task in 'ready' state")
  .option("--started", "Create task in 'started' state")
  .option(
    "-t, --timestamp <ts:string>",
    "Flexible timestamp (T11:15, 2024-12-15T11:15, etc.)",
  )
  .option("--todo <text:string>", "Add a todo item (repeatable)", {
    collect: true,
  })
  .option("--meta <kv:string>", "Set metadata key=value (repeatable)", {
    collect: true,
  })
  .option("--tag <tag:string>", "Add tag (repeatable)", {
    collect: true,
  })
  .action(async (options, name, desc) => {
    try {
      await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      // Validate: can't have both --ready and --started
      if (options.ready && options.started) {
        throw new WtError(
          "invalid_args",
          "Cannot specify both --ready and --started flags",
        );
      }

      // Determine initial status
      let initialStatus: TaskStatus = "created";
      if (options.ready) {
        initialStatus = "ready";
      } else if (options.started) {
        initialStatus = "started";
      }

      const todos = options.todo ?? [];
      const tags = options.tag ?? [];
      let timestampValue: string | undefined;
      if (options.timestamp) {
        try {
          timestampValue = parseFlexibleTimestamp(options.timestamp);
          // Ensure timezone is present, add local timezone if missing
          const tzRegex = /[+-]\d{2}:\d{2}$/;
          if (!tzRegex.test(timestampValue)) {
            const now = new Date();
            const tzOffset = -now.getTimezoneOffset();
            const sign = tzOffset >= 0 ? "+" : "-";
            const hours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(
              2,
              "0",
            );
            const minutes = String(Math.abs(tzOffset) % 60).padStart(2, "0");
            timestampValue += `${sign}${hours}:${minutes}`;
          }
        } catch {
          throw new WtError(
            "invalid_args",
            `Invalid timestamp format: ${options.timestamp}. Use format [YYYY-MM-DD]THH:mm[:SS][<tz>]`,
          );
        }
      }
      const metadata = parseMetaOption(options.meta);
      const output = await cmdAdd(
        name,
        desc,
        initialStatus,
        todos,
        metadata,
        tags,
        timestampValue,
      );
      console.log(options.json ? JSON.stringify(output) : formatAdd(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const taskCmd = new Command()
  .description("Task management")
  .action(function () {
    this.showHelp();
  })
  .command("create", taskCreateCmd);

const traceCmd = new Command()
  .description("Log an entry (include causes for failures, pistes for pivots)")
  .arguments("<taskId:string> <message:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option(
    "-t, --timestamp <ts:string>",
    "Flexible timestamp (T11:15, 2024-12-15T11:15, etc.)",
  )
  .option("-f, --force", "Force trace on completed tasks")
  .option("--meta <kv:string>", "Set metadata key=value (repeatable)", {
    collect: true,
  })
  .action(async (options, taskId, message) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      let timestampValue: string | undefined;
      if (options.timestamp) {
        try {
          timestampValue = parseFlexibleTimestamp(options.timestamp);
        } catch {
          throw new WtError(
            "invalid_args",
            `Invalid timestamp format: ${options.timestamp}. Use format [YYYY-MM-DD]THH:mm[:SS][<tz>]`,
          );
        }
      }
      const metadata = parseMetaOption(options.meta);
      const output = await cmdTrace(
        resolvedTaskId,
        message,
        timestampValue,
        options.force ?? false,
        metadata,
      );
      console.log(options.json ? JSON.stringify(output) : formatTrace(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const showCmd = new Command()
  .description(
    "Show task context (alias for 'logs')\n" +
      "Use before creating checkpoints to review traces",
  )
  .arguments(HAS_ENV_TASK_ID ? "[taskId:string]" : "<taskId:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--active", "Show only active todos (exclude done/cancelled)")
  .action(async (options, taskId?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const output = await cmdShow(resolvedTaskId, options.active ?? false);
      console.log(options.json ? JSON.stringify(output) : formatShow(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const tracesCmd = new Command()
  .description("List all traces for a task")
  .arguments(HAS_ENV_TASK_ID ? "[taskId:string]" : "<taskId:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const output = await cmdTraces(resolvedTaskId);
      console.log(options.json ? JSON.stringify(output) : formatTraces(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const checkpointCmd = new Command()
  .description("Consolidate recent traces into synthesis (not just a list)")
  .arguments("<taskId:string> <changes:string> <learnings:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("-f, --force", "Force checkpoint on completed tasks")
  .option("-t, --timestamp <ts:string>", "Timestamp (currently ignored)")
  .action(async (options, taskId, changes, learnings) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const output = await cmdCheckpoint(
        resolvedTaskId,
        changes,
        learnings,
        options.force ?? false,
      );
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const doneCmd = new Command()
  .description(
    "Final consolidation: synthesize ALL traces (changes) + REX (learnings)\n" +
      "⚠️  ALWAYS run 'wl show <id>' first to review traces & check TODOs!",
  )
  .arguments("<taskId:string> [changes:string] [learnings:string]")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("-f, --force", "Force completion")
  .option("-t, --timestamp <ts:string>", "Timestamp (currently ignored)")
  .option("--meta <kv:string>", "Set metadata key=value (repeatable)", {
    collect: true,
  })
  .action(async (options, taskId, changes, learnings) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const metadata = parseMetaOption(options.meta);
      const output = await cmdDone(
        resolvedTaskId,
        changes,
        learnings,
        options.force ?? false,
        metadata,
      );
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const readyCmd = new Command()
  .description("Mark task as ready to work on")
  .arguments(HAS_ENV_TASK_ID ? "[taskId:string]" : "<taskId:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const output = await cmdReady(resolvedTaskId);
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const startCmd = new Command()
  .description("Start working on a task")
  .arguments(HAS_ENV_TASK_ID ? "[taskId:string]" : "<taskId:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const output = await cmdStart(resolvedTaskId);
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const runCmd = new Command()
  .description(
    "Execute a command with WORKLOG_TASK_ID set in environment\n\n" +
      "Examples:\n" +
      "  wl run <taskId> npm test\n" +
      '  wl run --create "task name" npm test',
  )
  .arguments("<args...:string>")
  .stopEarly()
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--create <name:string>", "Create task on-the-fly with given name")
  .action(async (options, ...args: string[]) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      let taskId: string | undefined;
      let cmd: string[];

      if (options.create) {
        // wl run --create "name" <cmd...>
        cmd = args;
      } else {
        // wl run <taskId> <cmd...>
        if (args.length < 2) {
          throw new WtError(
            "invalid_args",
            "Usage: wl run <taskId> <cmd...> OR wl run --create <name> <cmd...>",
          );
        }
        // Pre-resolve across scopes before passing to cmdRun
        const resolved = await resolveTaskIdAcrossScopes(
          args[0],
          options.scope ? null : gitRoot,
        );
        taskId = resolved;
        cmd = args.slice(1);
      }

      if (cmd.length === 0) {
        throw new WtError("invalid_args", "No command provided to execute");
      }

      const output = await cmdRun(cmd, taskId, options.create);
      if (options.json) {
        console.log(JSON.stringify(output));
      } else {
        const taskPrefix = output.created ? "Created and ran" : "Ran";
        console.log(
          `${taskPrefix} task ${output.taskId} (exit code: ${output.exitCode})`,
        );
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const claudeCmd = new Command()
  .description(
    "Launch Claude with task context injected via system prompt\n\n" +
      "Examples:\n" +
      "  wl claude              # Launch Claude with current task (from WORKLOG_TASK_ID)\n" +
      "  wl claude <taskId>     # Launch Claude with specific task\n" +
      "  wl claude <taskId> -c  # Pass Claude args when taskId provided\n\n" +
      "For complex args, use 'wl run':\n" +
      "  wl run <taskId> claude -c --model opus",
  )
  .arguments("[taskId:string] [args...:string]")
  .stopEarly()
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId?: string, ...args: string[]) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      // If first arg looks like a taskId (not starting with -), use it as taskId
      // Otherwise, treat it as a Claude arg
      let actualTaskId: string | undefined = taskId;
      let claudeArgs: string[] = args;

      if (taskId && taskId.startsWith("-")) {
        // taskId is actually a Claude arg
        actualTaskId = undefined;
        claudeArgs = [taskId, ...args];
      }

      // Pre-resolve across scopes before passing to cmdClaude
      if (actualTaskId) {
        actualTaskId = await resolveTaskIdAcrossScopes(
          actualTaskId,
          options.scope ? null : gitRoot,
        );
      }

      const output = await cmdClaude(actualTaskId, claudeArgs);
      if (options.json) {
        console.log(JSON.stringify(output));
      } else if (output.exitCode !== 0) {
        console.log(`Claude exited with code ${output.exitCode}`);
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const updateCmd = new Command()
  .description("Update task name or description")
  .arguments(HAS_ENV_TASK_ID ? "[taskId:string]" : "<taskId:string>")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--name <name:string>", "New name for the task")
  .option("--desc <desc:string>", "New description for the task")
  .action(async (options, taskId?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
        taskId,
        options.scope ? null : gitRoot,
      );
      const output = await cmdUpdate(
        resolvedTaskId,
        options.name,
        options.desc,
      );
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const cancelCmd = new Command()
  .description("Cancel/abandon a task (marks as cancelled)")
  .arguments(
    HAS_ENV_TASK_ID
      ? "[taskId:string] [reason:string]"
      : "<taskId:string> [reason:string]",
  )
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .action(async (options, taskId?: string, reason?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      // Smart argument resolution:
      // If only one arg provided AND WORKLOG_TASK_ID exists, it's the reason
      let resolvedTaskId: string;
      let resolvedReason: string | undefined;

      if (!reason && taskId && HAS_ENV_TASK_ID) {
        // Single arg with env var: arg is reason, taskId from env
        resolvedReason = taskId;
        resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
          undefined,
          options.scope ? null : gitRoot,
        );
      } else {
        // Normal case: first arg is taskId, second is reason
        resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
          taskId,
          options.scope ? null : gitRoot,
        );
        resolvedReason = reason;
      }

      const output = await cmdCancel(resolvedTaskId, resolvedReason);
      console.log(options.json ? JSON.stringify(output) : formatStatus(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const metaCmd = new Command()
  .description(
    "Get or set task metadata (e.g., 'wl meta status active' to reopen current task)",
  )
  .arguments(
    HAS_ENV_TASK_ID
      ? "[taskId:string] [key:string] [value:string]"
      : "<taskId:string> [key:string] [value:string]",
  )
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--delete <key:string>", "Delete a metadata key")
  .action(async (options, taskId?: string, key?: string, value?: string) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      // Smart argument resolution:
      // If WORKLOG_TASK_ID exists and args provided, shift interpretation
      let resolvedTaskId: string;
      let resolvedKey: string | undefined;
      let resolvedValue: string | undefined;

      const hasEnvTaskId = HAS_ENV_TASK_ID;

      if (hasEnvTaskId && taskId && !value) {
        // With env var: taskId→key, key→value
        resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
          undefined,
          options.scope ? null : gitRoot,
        );
        resolvedKey = taskId;
        resolvedValue = key;
      } else {
        // Normal case: taskId is taskId, key is key, value is value
        resolvedTaskId = await resolveTaskIdWithEnvFallbackAcrossScopes(
          taskId,
          options.scope ? null : gitRoot,
        );
        resolvedKey = key;
        resolvedValue = value;
      }

      const output = await cmdMeta(
        resolvedTaskId,
        resolvedKey,
        resolvedValue,
        options.delete,
      );
      console.log(options.json ? JSON.stringify(output) : formatMeta(output));
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const tagsCmd = new Command()
  .description("Manage task tags")
  .arguments("[taskId:string]")
  .option("--json", "Output as JSON")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--add <tag:string>", "Add tag (repeatable)", { collect: true })
  .option("--remove <tag:string>", "Remove tag (repeatable)", { collect: true })
  .action(async (options, taskId) => {
    try {
      const { gitRoot } = await resolveScopeContext(
        options.scope,
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      // Pre-resolve across scopes when taskId is provided
      let resolvedTaskId = taskId;
      if (taskId) {
        resolvedTaskId = await resolveTaskIdAcrossScopes(
          taskId,
          options.scope ? null : gitRoot,
        );
      }

      const cwd = Deno.cwd();
      const effectiveGitRoot = gitRoot ?? await findGitRoot(cwd);

      const output = await cmdTags(
        resolvedTaskId,
        options.add,
        options.remove,
        effectiveGitRoot,
        cwd,
      );

      if (options.json) {
        console.log(JSON.stringify(output));
      } else if (output.allTags) {
        // List all tags
        if (output.allTags.length === 0) {
          console.log("No tags found");
        } else {
          console.log("Available tags:");
          for (const { tag, count } of output.allTags) {
            console.log(
              `  ${tag} (${count} ${count === 1 ? "task" : "tasks"})`,
            );
          }
        }
      } else if (output.tags) {
        // Show task tags or modification result
        if (output.tags.length === 0) {
          console.log("(no tags)");
        } else {
          console.log(output.tags.map((t) => `#${t}`).join(" "));
        }
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const listCmd = new Command()
  .description("List tasks (optionally filter by tag or scope pattern)")
  .arguments("[pattern:string]")
  .option("--json", "Output as JSON")
  .option("--all", "Include completed tasks")
  .option("--created", "Show only created tasks")
  .option("--ready", "Show only ready tasks")
  .option("--started", "Show only started tasks")
  .option("--done", "Show only done tasks")
  .option("--cancelled", "Show only cancelled tasks")
  .option("-p, --path <path:string>", "Path to .worklog directory")
  .option("--scope <scope:string>", "Target specific scope")
  .option("--all-scopes", "Show all scopes")
  .action(async (options, pattern) => {
    try {
      // Build status filter from flags
      const statusFilters: TaskStatus[] = [];
      if (options.created) statusFilters.push("created");
      if (options.ready) statusFilters.push("ready");
      if (options.started) statusFilters.push("started");
      if (options.done) statusFilters.push("done");
      if (options.cancelled) statusFilters.push("cancelled");

      const explicitWorklog = applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );

      if (explicitWorklog) {
        if (options.scope) {
          throw new WtError(
            "invalid_args",
            "Cannot use --scope with --worklog-dir",
          );
        }
        if (options.allScopes) {
          throw new WtError(
            "invalid_args",
            "Cannot use --all-scopes with --worklog-dir",
          );
        }
        if (options.path) {
          throw new WtError(
            "invalid_args",
            "Cannot use --path with --worklog-dir",
          );
        }
        const output = await cmdList(
          options.all ?? false,
          WORKLOG_DIR,
          undefined,
          false,
          null,
          undefined,
          Deno.cwd(),
          statusFilters.length > 0 ? statusFilters : undefined,
          pattern,
        );
        console.log(
          options.json
            ? JSON.stringify(output)
            : formatList(output, options.all),
        );
        return;
      }

      const cwd = Deno.cwd();
      const gitRoot = await findGitRoot(cwd);
      let currentScope: string | undefined;
      if (!options.scope && !options.allScopes && gitRoot) {
        try {
          currentScope = await resolveActiveScope(cwd, null, gitRoot);
        } catch {
          // No scope found
        }
      }
      const output = await cmdList(
        options.all ?? false,
        options.path,
        options.scope,
        options.allScopes ?? false,
        gitRoot,
        currentScope,
        cwd,
        statusFilters.length > 0 ? statusFilters : undefined,
        pattern,
      );
      console.log(
        options.json ? JSON.stringify(output) : formatList(output, options.all),
      );
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const summaryCmd = new Command()
  .description("Aggregate all tasks")
  .option("--json", "Output as JSON")
  .option("--since <date:string>", "Filter by date (YYYY-MM-DD)")
  .action(async (options) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      const output = await cmdSummary(options.since ?? null);
      console.log(
        options.json ? JSON.stringify(output) : formatSummary(output),
      );
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

const importCmd = new Command()
  .description("Import tasks from another worktree")
  .option("--json", "Output as JSON")
  .option("-p, --path <path:string>", "Path to source .worklog directory")
  .option(
    "-b, --branch <branch:string>",
    "Resolve worktree path from branch name",
  )
  .option("--rm", "Remove imported tasks from source")
  .option("--scope-to-tag", "Convert source scope to tag")
  .option("--tag-name <name:string>", "Custom tag name (with --scope-to-tag)")
  .action(async (options) => {
    try {
      applyDirOptions(
        (options as WithGlobalOptions<typeof options>).cwd,
        (options as WithGlobalOptions<typeof options>).worklogDir,
      );
      if (options.path && options.branch) {
        throw new WtError(
          "invalid_args",
          "Cannot specify both --path and --branch",
        );
      }
      if (!options.path && !options.branch) {
        throw new WtError(
          "invalid_args",
          "Must specify either --path or --branch",
        );
      }
      if (options.tagName && !options.scopeToTag) {
        throw new WtError(
          "invalid_args",
          "--tag-name requires --scope-to-tag",
        );
      }

      let sourcePath: string;
      if (options.branch) {
        sourcePath = await resolveWorktreePath(options.branch);
      } else {
        sourcePath = options.path!;
      }

      if (options.scopeToTag) {
        const cwd = Deno.cwd();
        const gitRoot = await findGitRoot(cwd);
        const output = await cmdImportScopeToTag(
          sourcePath,
          options.rm ?? false,
          options.tagName,
          gitRoot,
        );
        if (options.json) {
          console.log(JSON.stringify(output));
        } else {
          console.log(formatImport(output));
          console.log(`\nImported with tag: #${output.tag}`);
        }
      } else {
        const output = await cmdImport(sourcePath, options.rm ?? false);
        console.log(
          options.json ? JSON.stringify(output) : formatImport(output),
        );
      }
    } catch (e) {
      handleError(e, options.json ?? false);
    }
  });

// ============================================================================
// Main CLI
// ============================================================================

const cli = new Command()
  .name("wl")
  .version(VERSION)
  .description(
    "Worklog - Track work progress with traces and checkpoints\n\n" +
      "Core workflow:\n" +
      '  1. wl task create "task"      # Create worktask (returns ID)\n' +
      '  2. wl trace <id> "msg"        # Log with causes/pistes + timestamps\n' +
      "  3. wl checkpoint <id> ...      # Consolidate traces into narrative\n" +
      "  4. wl done <id> ...            # Final REX (after git commit!)\n\n" +
      "Key principles:\n" +
      "  - Always work within a worktask (create with 'wl task create' first)\n" +
      "  - Traces need context: causes (why failed) + pistes (what next)\n" +
      "  - Checkpoints consolidate traces (not conclusions)\n" +
      "  - Done = final consolidation + REX with critical distance\n" +
      '  - Use -t for batch tracing: wl trace <id> -t T14:30 "msg"\n\n' +
      "See 'wl <command> --help' for details",
  )
  .globalOption(
    "-C, --cwd <dir:string>",
    "Change to directory before doing anything",
  )
  .globalOption(
    "--worklog-dir <path:string>",
    "Path to .worklog directory (relative to -C if set)",
  )
  .command("init", initCmd)
  .command("create", createCmd)
  .command("ready", readyCmd)
  .command("start", startCmd)
  .command("run", runCmd)
  .command("claude", claudeCmd)
  .command("update", updateCmd)
  .command("task", taskCmd)
  .command("trace", traceCmd)
  .command("traces", tracesCmd)
  .command("show", showCmd)
  .command("checkpoint", checkpointCmd)
  .command("done", doneCmd)
  .command("cancel", cancelCmd)
  .command("meta", metaCmd)
  .command("tags", tagsCmd)
  .command("list", listCmd)
  .command("summary", summaryCmd)
  .command("import", importCmd)
  .command("todo", todoCmd)
  .command("scopes", scopesCmd);

export async function main(args: string[]): Promise<void> {
  // Show help when no arguments provided
  if (args.length === 0) {
    cli.showHelp();
    return;
  }
  await cli.parse(args);
}

// Run if executed directly
if (import.meta.main) {
  await main(Deno.args);
}
