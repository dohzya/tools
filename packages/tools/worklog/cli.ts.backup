import { Command } from "@cliffy/command";
import {
  type AddOutput,
  type AssignOutput,
  type Checkpoint,
  type DiscoveredScope,
  type Entry,
  type ImportOutput,
  type ImportTaskResult,
  type Index,
  type IndexEntry,
  isValidTaskStatus,
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
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "@std/path";
import { ensureDir } from "@std/fs";
import { z } from "@zod/zod/mini";

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
const CHECKPOINT_THRESHOLD = 50;

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
async function findTasksByTagPattern(
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

function generateTodoId(): string {
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
function resolveTodoId(prefix: string, todos: Todo[]): string {
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

function generateTaskIdBase62(): string {
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
async function getCurrentBranch(cwd: string): Promise<string | null> {
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

async function getScopeId(
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

async function loadTaskContentFrom(
  taskId: string,
  worklogPath: string,
): Promise<string> {
  const path = `${worklogPath}/tasks/${taskId}.md`;
  if (!(await exists(path))) {
    throw new WtError("task_not_found", `Task not found: ${taskId}`);
  }
  return await Deno.readTextFile(path);
}

async function saveTaskContentTo(
  taskId: string,
  content: string,
  worklogPath: string,
): Promise<void> {
  await Deno.writeTextFile(`${worklogPath}/tasks/${taskId}.md`, content);
}

async function saveIndexTo(index: Index, worklogPath: string): Promise<void> {
  const indexPath = `${worklogPath}/index.json`;
  await Deno.writeTextFile(indexPath, JSON.stringify(index, null, 2));
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
  if (await exists(WORKLOG_DIR)) {
    return { status: "already_initialized" };
  }
  await Deno.mkdir(TASKS_DIR, { recursive: true });
  await saveIndex({ tasks: {} });
  return { status: "initialized" };
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
  // Validate tags
  if (tags && tags.length > 0) {
    validateTags(tags);
  }

  await autoInit();
  await purge();

  const id = generateTaskIdBase62();
  const uid = crypto.randomUUID();
  const now = timestamp ?? getLocalISOString();

  const taskDesc = desc ?? "";
  const status = initialStatus ?? "created";

  // Build TODO section if todos are provided
  let todoSection = "";
  if (todos.length > 0) {
    todoSection = "\n# TODO\n\n";
    for (const todoText of todos) {
      const todoId = generateTodoId();
      todoSection += `- [ ] ${todoText}  [id:: ${todoId}] ^${todoId}\n`;
    }
  }

  // Build metadata section if provided
  let metadataYaml = "";
  if (metadata && Object.keys(metadata).length > 0) {
    metadataYaml = "\nmetadata:\n";
    for (const [key, value] of Object.entries(metadata)) {
      // Escape value if it contains special YAML characters
      const escapedValue =
        value.includes(":") || value.includes("#") || value.includes('"')
          ? `"${value.replace(/"/g, '\\"')}"`
          : value;
      metadataYaml += `  ${key}: ${escapedValue}\n`;
    }
  }

  // Build tags section if provided
  let tagsYaml = "";
  if (tags && tags.length > 0) {
    tagsYaml = "\ntags:\n";
    for (const tag of tags) {
      tagsYaml += `  - ${tag}\n`;
    }
  }

  // Set timestamps based on initial status
  let readyAt = "null";
  let startedAt = "null";
  if (status === "ready") {
    readyAt = `"${now}"`;
  } else if (status === "started") {
    startedAt = `"${now}"`;
  }

  const content = `---
id: ${id}
uid: ${uid}
name: "${name.replace(/"/g, '\\"')}"
desc: "${taskDesc.replace(/"/g, '\\"')}"
status: ${status}
created_at: "${now}"
ready_at: ${readyAt}
started_at: ${startedAt}
done_at: null
last_checkpoint: null
has_uncheckpointed_entries: false${metadataYaml}${tagsYaml}
---

# Entries

# Checkpoints${todoSection}
`;

  await saveTaskContent(id, content);

  const index = await loadIndex();
  index.tasks[id] = {
    name,
    desc: taskDesc,
    status,
    created: now,
    status_updated_at: now,
    done_at: null,
    ...(tags && tags.length > 0 && { tags }),
  };
  await saveIndex(index);

  // Calculate short ID for display
  const allIds = Object.keys(index.tasks);
  const shortId = getShortId(id, allIds);

  return { id: shortId };
}

async function cmdTrace(
  taskId: string,
  message: string,
  timestamp?: string,
  force?: boolean,
  metadata?: Record<string, string>,
): Promise<TraceOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const { meta } = await parseTaskFile(content);

  // Check status: reject done unless --force, warn if not started
  if (meta.status === "done" && !force) {
    throw new WtError(
      "task_already_done",
      `Task ${meta.id} is completed. Use --force to add post-completion traces.`,
    );
  }
  if (meta.status !== "started") {
    console.error(
      `Warning: Task is not started. Trace recorded. Run 'wl start ${taskId}' to start working.`,
    );
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

  // Update frontmatter to mark has_uncheckpointed_entries and add metadata if provided
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.has_uncheckpointed_entries = true;

  // Add metadata if provided
  if (metadata && Object.keys(metadata).length > 0) {
    if (!frontmatter.metadata) {
      frontmatter.metadata = {};
    }
    Object.assign(frontmatter.metadata as Record<string, string>, metadata);
  }

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

async function cmdShow(
  taskId: string,
  activeOnly: boolean = false,
): Promise<ShowOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const { meta, entries, checkpoints, todos } = await parseTaskFile(content);

  const lastCheckpoint = getLastCheckpoint(checkpoints);
  const entriesSinceCheckpoint = getEntriesAfterCheckpoint(
    entries,
    meta.last_checkpoint,
  );

  // Filter todos if activeOnly is true
  const filteredTodos = activeOnly
    ? todos.filter((todo) =>
      todo.status !== "done" && todo.status !== "cancelled"
    )
    : todos;

  // Compute short ID for display
  const index = await loadIndex();
  const allIds = Object.keys(index.tasks);
  const shortId = getShortId(taskId, allIds);

  // Get effective tags (task + inherited worktree tags)
  const cwd = Deno.cwd();
  const gitRoot = await findGitRoot(cwd);
  const effectiveTags = await getEffectiveTags(
    meta.tags,
    join(cwd, WORKLOG_DIR),
    gitRoot,
  );

  return {
    task: shortId,
    fullId: taskId,
    name: meta.name,
    desc: meta.desc,
    status: meta.status,
    created: formatShort(meta.created_at),
    ready: meta.ready_at ? formatShort(meta.ready_at) : null,
    started: meta.started_at ? formatShort(meta.started_at) : null,
    last_checkpoint: lastCheckpoint,
    entries_since_checkpoint: entriesSinceCheckpoint,
    todos: filteredTodos,
    tags: effectiveTags.length > 0 ? effectiveTags : undefined,
  };
}

async function cmdTraces(taskId: string): Promise<TracesOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const { meta, entries } = await parseTaskFile(content);

  return {
    task: taskId,
    desc: meta.desc,
    entries,
  };
}

async function cmdCheckpoint(
  taskId: string,
  changes: string,
  learnings: string,
  force?: boolean,
): Promise<StatusOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

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

  // Create final checkpoint only if changes/learnings provided
  if (changes || learnings) {
    await cmdCheckpoint(taskId, changes ?? "", learnings ?? "", true);
  }

  // Then mark as done
  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const now = getLocalISOString();

  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.status = "done";
  frontmatter.done_at = now;

  // Add metadata if provided
  if (metadata && Object.keys(metadata).length > 0) {
    if (!frontmatter.metadata) {
      frontmatter.metadata = {};
    }
    Object.assign(frontmatter.metadata as Record<string, string>, metadata);
  }

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

async function cmdReady(taskId: string): Promise<StatusOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);

  // Validate: allow created, started; reject done, cancelled
  if (!["created", "started"].includes(frontmatter.status as string)) {
    throw new WtError(
      "invalid_state",
      `Cannot transition from '${frontmatter.status}' to 'ready'`,
    );
  }

  const now = getLocalISOString();
  frontmatter.status = "ready";
  frontmatter.ready_at = now;

  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );
  await saveTaskContent(taskId, serializeDocument(doc));

  // Update index
  const index = await loadIndex();
  if (index.tasks[taskId]) {
    index.tasks[taskId].status = "ready";
    index.tasks[taskId].status_updated_at = now;
    await saveIndex(index);
  }

  return { status: "task_ready" };
}

async function cmdStart(taskId: string): Promise<StatusOutput> {
  await purge();
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);

  // Allow: created, ready, done; reject: cancelled
  if (frontmatter.status === "cancelled") {
    throw new WtError(
      "invalid_state",
      `Cannot transition from 'cancelled' to 'started'`,
    );
  }
  if (frontmatter.status === "started") {
    return { status: "task_already_started" };
  }

  const now = getLocalISOString();
  frontmatter.status = "started";
  frontmatter.started_at = now;

  // Clear done_at if reopening
  if (frontmatter.done_at) {
    frontmatter.done_at = null;
  }

  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );
  await saveTaskContent(taskId, serializeDocument(doc));

  // Update index
  const index = await loadIndex();
  if (index.tasks[taskId]) {
    index.tasks[taskId].status = "started";
    index.tasks[taskId].status_updated_at = now;
    delete index.tasks[taskId].done_at;
    await saveIndex(index);
  }

  return { status: "task_started" };
}

async function cmdRun(
  cmd: string[],
  taskId?: string,
  createName?: string,
): Promise<RunOutput> {
  let resolvedTaskId: string;
  let wasCreated = false;

  // Either use provided taskId or create a new task
  if (createName) {
    const createOutput = await cmdAdd(createName);
    // cmdAdd returns short ID, resolve it to full ID
    resolvedTaskId = await resolveTaskId(createOutput.id);
    wasCreated = true;
  } else if (taskId) {
    await purge();
    resolvedTaskId = await resolveTaskId(taskId);
  } else {
    throw new WtError(
      "invalid_args",
      "Either taskId or --create must be provided",
    );
  }

  // Verify task exists
  await loadTaskContent(resolvedTaskId);

  // Execute command with WORKLOG_TASK_ID set
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    env: {
      ...Deno.env.toObject(),
      WORKLOG_TASK_ID: resolvedTaskId,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const { code } = await command.output();

  return {
    taskId: resolvedTaskId,
    exitCode: code,
    created: wasCreated,
  };
}

async function cmdClaude(
  taskId?: string,
  claudeArgs: string[] = [],
): Promise<RunOutput> {
  await purge();

  // Resolve taskId with env fallback
  const resolvedTaskId = await resolveTaskIdWithEnvFallback(taskId);

  // Load task details
  const taskInfo = await cmdShow(resolvedTaskId, false);

  // Build system prompt with task context
  const recentTraces = taskInfo.entries_since_checkpoint
    .slice(-5)
    .map((e) => `  - [${e.ts}] ${e.msg}`)
    .join("\n");

  const todos = taskInfo.todos
    .filter((t) => t.status === "todo")
    .map((t) => `  - [ ] ${t.text}`)
    .join("\n");

  const systemPrompt = `
# Current Worktask Context

You are working on the following task:

**Task ID**: ${taskInfo.fullId} (short: ${taskInfo.task})
**Name**: ${taskInfo.name}
**Status**: ${taskInfo.status}
**Created**: ${taskInfo.created}
${taskInfo.started ? `**Started**: ${taskInfo.started}` : ""}

## Description
${taskInfo.desc || "(no description)"}

${recentTraces ? `## Recent Traces\n${recentTraces}` : ""}

${todos ? `## TODO\n${todos}` : ""}

---

## WORKLOG_TASK_ID

The environment variable is set to: ${resolvedTaskId}

Commands that work **without taskId** (uses WORKLOG_TASK_ID automatically):
  wl show, wl start, wl ready, wl traces, wl update, wl cancel, wl meta, wl todo next

Commands that still **require taskId as first argument** (ambiguous with other args):
  wl trace <id> "msg", wl checkpoint <id> ..., wl done <id> ...
`.trim();

  // Launch Claude with appended system prompt
  const command = new Deno.Command("claude", {
    args: ["--append-system-prompt", systemPrompt, ...claudeArgs],
    env: {
      ...Deno.env.toObject(),
      WORKLOG_TASK_ID: resolvedTaskId,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const { code } = await command.output();

  return {
    taskId: resolvedTaskId,
    exitCode: code,
    created: false,
  };
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

  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);

  if (name) frontmatter.name = name;
  if (desc !== undefined) frontmatter.desc = desc;

  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );
  await saveTaskContent(taskId, serializeDocument(doc));

  // Update index
  const index = await loadIndex();
  if (index.tasks[taskId]) {
    if (name) index.tasks[taskId].name = name;
    if (desc !== undefined) index.tasks[taskId].desc = desc;
    await saveIndex(index);
  }

  return { status: "task_updated" };
}

async function cmdCancel(
  taskId: string,
  reason?: string,
): Promise<StatusOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  // Load and update task
  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const now = getLocalISOString();

  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = parseFrontmatter(yamlContent);
  frontmatter.status = "cancelled";
  frontmatter.cancelled_at = now;

  // Add cancellation reason as metadata if provided
  if (reason) {
    if (!frontmatter.metadata) {
      frontmatter.metadata = {};
    }
    (frontmatter.metadata as Record<string, string>).cancellation_reason =
      reason;
  }

  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as Record<string, unknown>),
  );

  await saveTaskContent(taskId, serializeDocument(doc));

  // Update index
  const index = await loadIndex();
  if (index.tasks[taskId]) {
    index.tasks[taskId].status = "cancelled";
    index.tasks[taskId].cancelled_at = now;
    await saveIndex(index);
  }

  return { status: "task_cancelled" };
}

async function cmdMeta(
  taskId: string,
  key?: string,
  value?: string,
  deleteKey?: string,
): Promise<{ metadata: Record<string, string> }> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);
  const yamlContent = getFrontmatterContent(doc);
  const frontmatter = TaskMetaSchema.parse(parseFrontmatter(yamlContent));

  // Initialize metadata if not present
  if (!frontmatter.metadata) {
    frontmatter.metadata = {};
  }

  // Delete key if requested
  if (deleteKey) {
    delete frontmatter.metadata[deleteKey];
  }

  // Set/update key-value if provided
  if (key && value !== undefined) {
    // Handle special top-level fields
    if (key === "status") {
      if (!isValidTaskStatus(value)) {
        throw new WtError(
          "invalid_args",
          `Invalid status: ${value}. Must be one of: ${
            TASK_STATUSES.join(", ")
          }`,
        );
      }
      frontmatter.status = value;
      // Update timestamp fields based on status
      const now = new Date().toISOString();
      if (value === "done" && !frontmatter.done_at) {
        frontmatter.done_at = now;
      } else if (value === "cancelled" && !frontmatter.cancelled_at) {
        frontmatter.cancelled_at = now;
      } else if (value === "started" && !frontmatter.started_at) {
        frontmatter.started_at = now;
        frontmatter.done_at = null;
        frontmatter.cancelled_at = null;
      } else if (value === "ready" && !frontmatter.ready_at) {
        frontmatter.ready_at = now;
      } else if (value === "created") {
        // Reset all status timestamps
        frontmatter.ready_at = null;
        frontmatter.started_at = null;
        frontmatter.done_at = null;
        frontmatter.cancelled_at = null;
      }
    } else {
      // Regular metadata field
      frontmatter.metadata[key] = value;
    }
  }

  // Save changes
  setFrontmatter(
    doc,
    stringifyFrontmatter(frontmatter as unknown as Record<string, unknown>),
  );
  await saveTaskContent(taskId, serializeDocument(doc));

  // Update index if status was changed
  if (key === "status") {
    const index = await loadIndex();
    if (index.tasks[taskId]) {
      index.tasks[taskId].status = frontmatter.status;
      index.tasks[taskId].status_updated_at = getLocalISOString();
      if (
        ["created", "ready", "started"].includes(frontmatter.status as string)
      ) {
        delete index.tasks[taskId].done_at;
      } else if (frontmatter.status === "done" && frontmatter.done_at) {
        index.tasks[taskId].done_at = frontmatter.done_at;
      }
      await saveIndex(index);
    }
  }

  return { metadata: frontmatter.metadata };
}

/**
 * List all unique tags across all scopes with counts.
 */
async function cmdListTags(
  gitRoot: string | null,
  cwd: string,
): Promise<{ tags: Array<{ tag: string; count: number }> }> {
  const tagCounts = new Map<string, number>();

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
    for (const task of Object.values(index.tasks)) {
      if (task.tags) {
        for (const tag of task.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }
  }

  const tags = Array.from(tagCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));

  return { tags };
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
    // Resolve task ID prefix
    taskId = await resolveTaskId(taskId);

    // List todos for specific task
    const content = await loadTaskContent(taskId);
    const { todos } = await parseTaskFile(content);
    return { todos };
  } else {
    // List todos for all active tasks
    const index = await loadIndex();
    const allTodos: Todo[] = [];

    for (const [id, task] of Object.entries(index.tasks)) {
      if (task.status === "done") continue;

      try {
        const content = await loadTaskContent(id);
        const { todos, meta } = await parseTaskFile(content);

        // Add task context to each todo
        for (const todo of todos) {
          allTodos.push({
            ...todo,
            metadata: {
              ...todo.metadata,
              taskId: id,
              taskDesc: meta.desc,
            },
          });
        }
      } catch {
        // Task file might not exist, skip
        continue;
      }
    }

    return { todos: allTodos };
  }
}

async function cmdTodoAdd(
  taskId: string,
  text: string,
  metadata: Record<string, string> = {},
): Promise<TodoAddOutput> {
  await purge();

  // Resolve task ID prefix
  taskId = await resolveTaskId(taskId);

  const content = await loadTaskContent(taskId);
  const doc = await parseDocument(content);

  let todosSection = findSection(doc, await getTodosId());

  // Create # TODO section if it doesn't exist
  if (!todosSection) {
    const checkpointsId = await getCheckpointsId();
    const checkpointsSection = findSection(doc, checkpointsId);
    const insertLine = checkpointsSection
      ? checkpointsSection.line - 1
      : doc.lines.length;

    doc.lines.splice(insertLine, 0, "", "# TODO", "");
    // Re-parse to get the new section
    const reparsed = await parseDocument(serializeDocument(doc));
    Object.assign(doc, reparsed);
    todosSection = findSection(doc, await getTodosId());
  }

  const todoId = generateTodoId();
  const todosEnd = getSectionEndLine(doc, todosSection!, true);

  // Build metadata string
  let metadataStr = `  [id:: ${todoId}]`;
  for (const [key, value] of Object.entries(metadata)) {
    metadataStr += ` [${key}:: ${value}]`;
  }

  const todoLine = `- [ ] ${text}${metadataStr} ^${todoId}`;
  doc.lines.splice(todosEnd, 0, todoLine);

  await saveTaskContent(taskId, serializeDocument(doc));

  return { id: todoId, taskId };
}

async function cmdTodoSet(
  todoId: string,
  updates: Record<string, string>,
): Promise<StatusOutput> {
  await purge();

  // Collect all todos to resolve prefix
  const index = await loadIndex();
  const allTodos: Todo[] = [];
  const todoToTask = new Map<string, string>();

  for (const taskId of Object.keys(index.tasks)) {
    try {
      const content = await loadTaskContent(taskId);
      const { todos } = await parseTaskFile(content);
      for (const todo of todos) {
        allTodos.push(todo);
        todoToTask.set(todo.id, taskId);
      }
    } catch {
      // Task file might not exist, skip
      continue;
    }
  }

  // Resolve todo ID prefix
  const resolvedTodoId = resolveTodoId(todoId, allTodos);
  const foundTaskId = todoToTask.get(resolvedTodoId);

  if (!foundTaskId) {
    throw new WtError("todo_not_found", `Todo ${todoId} not found`);
  }

  const content = await loadTaskContent(foundTaskId);
  const doc = await parseDocument(content);

  // Find the todo line
  const todosSection = findSection(doc, await getTodosId());
  if (!todosSection) {
    throw new WtError("todo_not_found", `Todo section not found`);
  }

  const todosEnd = getSectionEndLine(doc, todosSection, true);

  for (let i = todosSection.line + 1; i < todosEnd; i++) {
    const line = doc.lines[i];
    if (line.includes(`^${resolvedTodoId}`)) {
      // Parse the line
      const todoMatch = line.match(/^(-\s*\[)(.)\](\s*)(.+)$/);
      if (!todoMatch) continue;

      const prefix = todoMatch[1];
      let statusChar = todoMatch[2];
      const spacing = todoMatch[3];
      let rest = todoMatch[4];

      // Apply updates
      if (updates.status) {
        const statusMap: Record<TodoStatus, string> = {
          "todo": " ",
          "wip": "/",
          "blocked": ">",
          "cancelled": "-",
          "done": "x",
        };
        statusChar = statusMap[updates.status as TodoStatus] || statusChar;
      }

      // Update metadata
      for (const [key, value] of Object.entries(updates)) {
        if (key === "status") continue;

        // Check if metadata exists
        const metaRegex = new RegExp(`\\[${key}::\\s*([^\\]]+)\\]`);
        if (metaRegex.test(rest)) {
          // Update existing
          rest = rest.replace(metaRegex, `[${key}:: ${value}]`);
        } else {
          // Add new metadata before ^id
          const blockRefMatch = rest.match(/(\s+\^[\w]+)$/);
          if (blockRefMatch) {
            rest = rest.substring(0, blockRefMatch.index) +
              ` [${key}:: ${value}]` + blockRefMatch[0];
          }
        }
      }

      doc.lines[i] = `${prefix}${statusChar}]${spacing}${rest}`;
      break;
    }
  }

  await saveTaskContent(foundTaskId, serializeDocument(doc));

  return { status: "todo_updated" };
}

async function cmdTodoNext(taskId?: string): Promise<Todo | null> {
  await purge();

  if (taskId) {
    // Resolve task ID prefix
    taskId = await resolveTaskId(taskId);

    // Get next todo for specific task
    const content = await loadTaskContent(taskId);
    const { todos } = await parseTaskFile(content);

    // Find first todo that is not done or cancelled, and not blocked (or blocked but dependency resolved)
    for (const todo of todos) {
      if (todo.status === "done" || todo.status === "cancelled") continue;
      if (todo.status === "blocked") {
        // Check if dependency is resolved
        const dependsOn = todo.metadata.dependsOn;
        if (dependsOn) {
          // For now, we'll skip blocked todos (full dependency resolution would require checking the dependency status)
          continue;
        }
      }
      return todo;
    }

    return null;
  } else {
    // Get next todo across all active tasks
    const index = await loadIndex();

    for (const taskId of Object.keys(index.tasks)) {
      if (index.tasks[taskId].status === "done") continue;

      try {
        const next = await cmdTodoNext(taskId);
        if (next) return next;
      } catch {
        continue;
      }
    }

    return null;
  }
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
  // Only purge the local worklog, not remote ones
  if (!baseDir) {
    await purge();
  }

  // Determine which statuses to show
  const defaultStatuses: TaskStatus[] = ["created", "ready", "started"];
  const allowedStatuses = statusFilters ?? defaultStatuses;
  const matchStatus = (status: string) =>
    showAll || allowedStatuses.includes(status as TaskStatus);

  const tasks: ListOutput["tasks"] = [];

  // Handle unified tag/scope filtering
  if (filterPattern && gitRoot && cwd) {
    // Try tag filtering first (more granular)
    const taggedTasks = await findTasksByTagPattern(
      filterPattern,
      gitRoot,
      cwd,
    );

    if (taggedTasks.length > 0) {
      // Found tasks with matching tags
      const filteredTasks = taggedTasks
        .filter(({ task }) => matchStatus(task.status))
        .map(({ id, task, scopeId: _scopeId }) => ({
          id,
          name: task.name ?? task.desc,
          desc: task.desc,
          status: task.status,
          created: formatShort(task.created),
          // Don't show scope prefix when filtering by tag
          scopePrefix: undefined,
          tags: task.tags,
          filterPattern, // Pass filter pattern for tag display filtering
        }));

      return { tasks: filteredTasks };
    }

    // Fall back to scope filtering if no tag matches
    try {
      const worklogPath = await resolveScopeIdentifier(
        filterPattern,
        gitRoot,
        cwd,
      );
      const indexPath = `${worklogPath}/index.json`;

      if (await exists(indexPath)) {
        const content = await readFile(indexPath);
        const index = JSON.parse(content) as Index;
        const _scopeId = await getScopeId(worklogPath, gitRoot);

        const scopeTasks = Object.entries(index.tasks)
          .filter(([_, t]) => matchStatus(t.status))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, t]) => ({
            id,
            name: t.name ?? t.desc,
            desc: t.desc,
            status: t.status,
            created: formatShort(t.created),
            // Don't show scope prefix when filtering by scope
            scopePrefix: undefined,
            tags: t.tags,
            filterPattern, // Pass filter pattern for tag display filtering
          }));

        return { tasks: scopeTasks };
      }
    } catch {
      // No scope matching either
    }

    throw new WtError(
      "task_not_found",
      `No tag or scope matching: ${filterPattern}`,
    );
  }

  // Determine which scopes to list
  if (allScopes && gitRoot) {
    // List all scopes
    const scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);

    for (const scope of scopes) {
      const indexPath = `${scope.absolutePath}/index.json`;
      if (!(await exists(indexPath))) {
        continue;
      }

      const content = await readFile(indexPath);
      const index = JSON.parse(content) as Index;
      const scopeId = await getScopeId(scope.absolutePath, gitRoot);

      const scopeTasks = Object.entries(index.tasks)
        .filter(([_, t]) => matchStatus(t.status))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, t]) => ({
          id,
          name: t.name ?? t.desc,
          desc: t.desc,
          status: t.status,
          created: formatShort(t.created),
          scopePrefix: scopeId,
          tags: t.tags,
        }));

      tasks.push(...scopeTasks);
    }
  } else if (scopeIdentifier && gitRoot && cwd) {
    // List specific scope only
    const worklogPath = await resolveScopeIdentifier(
      scopeIdentifier,
      gitRoot,
      cwd,
    );
    const indexPath = `${worklogPath}/index.json`;

    if (!(await exists(indexPath))) {
      throw new WtError(
        "not_initialized",
        `Worklog not found at: ${worklogPath}`,
      );
    }

    const content = await readFile(indexPath);
    const index = JSON.parse(content) as Index;

    const scopeTasks = Object.entries(index.tasks)
      .filter(([_, t]) => matchStatus(t.status))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, t]) => ({
        id,
        name: t.name ?? t.desc,
        desc: t.desc,
        status: t.status,
        created: formatShort(t.created),
        tags: t.tags,
      }));

    tasks.push(...scopeTasks);
  } else if (gitRoot && currentScope) {
    // Default: current scope + children (children get prefixes)
    const currentScopeId = await getScopeId(currentScope, gitRoot);

    // Check if this is a child worklog for parent tag pull
    const isChild = await isChildWorklog(currentScope);

    // Load current scope tasks (no prefix)
    const currentIndexPath = `${currentScope}/index.json`;
    if (await exists(currentIndexPath)) {
      const content = await readFile(currentIndexPath);
      const index = JSON.parse(content) as Index;

      const currentTasks = Object.entries(index.tasks)
        .filter(([_, t]) => matchStatus(t.status))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, t]) => ({
          id,
          name: t.name ?? t.desc,
          desc: t.desc,
          status: t.status,
          created: formatShort(t.created),
          tags: t.tags,
        }));

      tasks.push(...currentTasks);
    }

    // Parent tag pull: if child worklog, include parent tasks with matching tags
    if (isChild && currentScopeId && currentScopeId !== ".") {
      try {
        const parentScope = await getParentScope(currentScope);
        const parentTasks = await findTasksByTagPattern(
          currentScopeId,
          gitRoot,
          cwd || Deno.cwd(),
        );

        // Filter to only active parent tasks
        const activeParentTasks = parentTasks
          .filter(({ task, scopePath }) =>
            matchStatus(task.status) &&
            scopePath === join(parentScope, WORKLOG_DIR)
          )
          .map(({ id, task }) => ({
            id,
            name: task.name ?? task.desc,
            desc: task.desc,
            status: task.status,
            created: formatShort(task.created),
            scopePrefix: "⬆",
            tags: task.tags,
          }));

        tasks.push(...activeParentTasks);
      } catch {
        // Parent scope not found or error reading it, skip parent tag pull
      }
    }

    // Load children tasks (with prefix)
    const scopeConfigPath = `${currentScope}/scope.json`;
    if (await exists(scopeConfigPath)) {
      try {
        const configContent = await readFile(scopeConfigPath);
        const config = JSON.parse(configContent) as ScopeConfig;

        if ("children" in config) {
          for (const child of config.children) {
            const childWorklogPath = isAbsolute(child.path)
              ? `${child.path}/${WORKLOG_DIR}`
              : `${gitRoot}/${child.path}/${WORKLOG_DIR}`;
            const childIndexPath = `${childWorklogPath}/index.json`;

            if (!(await exists(childIndexPath))) {
              continue;
            }

            const content = await readFile(childIndexPath);
            const index = JSON.parse(content) as Index;

            const childTasks = Object.entries(index.tasks)
              .filter(([_, t]) => matchStatus(t.status))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, t]) => ({
                id,
                name: t.name ?? t.desc,
                desc: t.desc,
                status: t.status,
                created: formatShort(t.created),
                scopePrefix: child.id,
                tags: t.tags,
              }));

            tasks.push(...childTasks);
          }
        }
      } catch {
        // No scope.json or parse error, skip children
      }
    }
  } else {
    // Fallback: single worklog mode (backward compatibility)
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

    const singleTasks = Object.entries(index.tasks)
      .filter(([_, t]) => matchStatus(t.status))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, t]) => ({
        id,
        name: t.name ?? t.desc,
        desc: t.desc,
        status: t.status,
        created: formatShort(t.created),
        tags: t.tags,
      }));

    tasks.push(...singleTasks);
  }

  return { tasks };
}

async function cmdSummary(since: string | null): Promise<SummaryOutput> {
  await purge();

  const index = await loadIndex();
  const sinceDate = since ? parseDate(since) : null;

  const result: SummaryOutput["tasks"] = [];

  for (const [id, info] of Object.entries(index.tasks)) {
    const include = ["created", "ready", "started"].includes(info.status) ||
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
        name: sourceInfo.name,
        desc: sourceInfo.desc,
        status: sourceInfo.status,
        created: sourceInfo.created,
        status_updated_at: sourceInfo.status_updated_at,
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

/**
 * Import tasks from child worklog, converting scope to tag.
 */
async function cmdImportScopeToTag(
  sourcePath: string,
  removeSource: boolean,
  customTagName: string | undefined,
  gitRoot: string | null,
): Promise<ImportOutput & { tag: string }> {
  // Get source scope ID
  const scopeId = gitRoot
    ? await getScopeId(dirname(sourcePath), gitRoot)
    : basename(dirname(sourcePath));
  const tagName = customTagName || scopeId;

  validateTags([tagName]);

  // Import tasks using existing cmdImport
  const importResult = await cmdImport(sourcePath, removeSource);

  // Add tag to all imported tasks (not merged ones, as they already exist)
  const targetIndex = await loadIndex();

  for (const taskResult of importResult.tasks) {
    if (taskResult.status !== "imported") continue; // Skip merged/skipped

    const taskId = taskResult.id;
    const content = await loadTaskContent(taskId);
    const doc = await parseDocument(content);
    const yamlContent = getFrontmatterContent(doc);
    const frontmatter = parseFrontmatter(yamlContent) as Record<
      string,
      unknown
    >;

    const currentTags = (frontmatter.tags as string[]) || [];
    const tagSet = new Set(currentTags);
    tagSet.add(tagName);
    const newTags = Array.from(tagSet).sort();

    frontmatter.tags = newTags;
    setFrontmatter(doc, stringifyFrontmatter(frontmatter));
    await saveTaskContent(taskId, serializeDocument(doc));

    // Update index
    if (targetIndex.tasks[taskId]) {
      targetIndex.tasks[taskId].tags = newTags;
    }
  }

  await saveIndex(targetIndex);

  return { ...importResult, tag: tagName };
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

  // Validate mutually exclusive flags
  if (pathFlag && worktreeFlag) {
    throw new WtError(
      "invalid_args",
      "Cannot use --path and --worktree together. Choose one.",
    );
  }

  let targetDir: string;
  let effectivePath: string;
  let gitRef: string | undefined;
  let scopeType: "path" | "worktree" = "path";

  if (worktreeFlag) {
    // Worktree mode
    scopeType = "worktree";
    gitRef = refFlag ?? scopeId;

    // Try to find the worktree path
    const worktrees = await listAllWorktrees(cwd);
    const worktree = worktrees.find((wt) => wt.branch === gitRef);

    if (worktree) {
      targetDir = worktree.path;
    } else {
      // Maybe we're inside the worktree already - check current branch
      const currentBranch = await getCurrentBranch(cwd);
      if (currentBranch === gitRef) {
        // We're in the worktree, use cwd's git root
        targetDir = gitRoot;
      } else {
        throw new WtError(
          "worktree_not_found",
          `No worktree found for ref: ${gitRef}. Create the worktree first with 'git worktree add'.`,
        );
      }
    }

    // For worktrees, use relative path from main repo root if inside, otherwise absolute
    const mainWorktree = worktrees.find((wt) => wt.isMainWorktree);
    if (mainWorktree && targetDir.startsWith(mainWorktree.path)) {
      effectivePath = targetDir.slice(mainWorktree.path.length + 1) || ".";
    } else {
      // Worktree is outside the main repo - use absolute path
      effectivePath = targetDir;
    }
  } else {
    // Path mode (default)
    effectivePath = pathFlag ?? scopeId;

    // Resolve relative to git root
    if (effectivePath.startsWith("/")) {
      targetDir = effectivePath;
    } else {
      targetDir = `${gitRoot}/${effectivePath}`;
    }
  }

  const worklogPath = `${targetDir}/${WORKLOG_DIR}`;

  // Check if worklog already exists
  if (await exists(worklogPath)) {
    // Child worklog exists - check if it already has a parent
    const scopeJsonPath = `${worklogPath}/scope.json`;
    if (await exists(scopeJsonPath)) {
      try {
        const content = await readFile(scopeJsonPath);
        const config = JSON.parse(content) as ScopeConfig;
        if ("parent" in config && config.parent) {
          throw new WtError(
            "already_has_parent",
            `Scope at ${effectivePath} already has a parent configured. Use 'scopes add-parent' to change it.`,
          );
        }
      } catch (e) {
        if (e instanceof WtError) throw e;
        // Corrupted or missing scope.json, proceed to configure
      }
    }

    // Configure parent for existing worklog
    const scopeDir = worklogPath.slice(0, -WORKLOG_DIR.length - 1);
    const relativeToGitRoot = scopeDir.slice(gitRoot.length + 1);
    const depth = relativeToGitRoot.split("/").filter((p) => p).length;
    const parentPath = "../".repeat(depth);
    const childConfig: ScopeConfigChild = { parent: parentPath };
    await saveScopeJson(worklogPath, childConfig);
  } else {
    // Create new worklog directory structure
    await Deno.mkdir(`${worklogPath}/tasks`, { recursive: true });
    await writeFile(
      `${worklogPath}/index.json`,
      JSON.stringify({ tasks: {} }, null, 2),
    );

    // Configure parent path
    const scopeDir = worklogPath.slice(0, -WORKLOG_DIR.length - 1);
    const relativeToGitRoot = scopeDir.slice(gitRoot.length + 1);
    const depth = relativeToGitRoot.split("/").filter((p) => p).length;
    const parentPath = "../".repeat(depth);
    const childConfig: ScopeConfigChild = { parent: parentPath };
    await saveScopeJson(worklogPath, childConfig);
  }

  // Update parent scope.json to add this child
  const rootWorklogPath = `${gitRoot}/${WORKLOG_DIR}`;
  const rootConfig = await loadOrCreateScopeJson(rootWorklogPath, gitRoot);

  if ("children" in rootConfig) {
    // Check if child already exists
    const existingChild = rootConfig.children.find(
      (c) => c.path === effectivePath,
    );
    if (!existingChild) {
      const newEntry: ScopeEntry = {
        path: effectivePath,
        id: scopeId,
      };
      if (scopeType === "worktree") {
        newEntry.type = "worktree";
        newEntry.gitRef = gitRef;
      }
      rootConfig.children.push(newEntry);
    } else {
      // Update existing entry
      existingChild.id = scopeId;
      if (scopeType === "worktree") {
        existingChild.type = "worktree";
        existingChild.gitRef = gitRef;
      }
    }
  } else {
    // Root is configured as a child? This shouldn't happen for git root
    throw new WtError(
      "invalid_state",
      "Root worklog is configured as a child scope. This is invalid.",
    );
  }

  await saveScopeJson(rootWorklogPath, rootConfig);

  return { status: "scope_created" };
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

  // Load root scope.json
  const rootConfig = await loadOrCreateScopeJson(
    `${gitRoot}/${WORKLOG_DIR}`,
    gitRoot,
  );

  if (!("children" in rootConfig)) {
    throw new WtError(
      "scope_not_found",
      "Root configuration corrupted or no child scopes found.",
    );
  }

  // Find the child with matching scopeId (by ID or path)
  const child = rootConfig.children.find((c) =>
    c.id === scopeId || c.path === scopeId
  );

  if (!child) {
    throw new WtError("scope_not_found", `Scope not found: ${scopeId}`);
  }

  // Update the ID
  child.id = newId;

  // Save updated config
  await saveScopeJson(`${gitRoot}/${WORKLOG_DIR}`, rootConfig);

  return { status: "scope_renamed" };
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

  // Resolve scope to delete
  const worklogPath = await resolveScopeIdentifier(scopeId, gitRoot, cwd);

  // Load index to check for tasks
  const index = await loadIndexFrom(worklogPath);
  const taskIds = Object.keys(index.tasks);
  const taskCount = taskIds.length;

  // Handle tasks if they exist
  if (taskCount > 0) {
    if (moveTo) {
      // Move all tasks to target scope before deleting
      const assignResult = await cmdScopesAssign(moveTo, taskIds, cwd);
      // Check if all tasks were moved successfully
      if (assignResult.errors.length > 0) {
        throw new WtError(
          "io_error",
          `Failed to move some tasks: ${
            assignResult.errors.map((e) => e.taskId).join(", ")
          }`,
        );
      }
    } else if (!deleteTasks) {
      throw new WtError(
        "scope_has_tasks",
        `Scope has ${taskCount} task(s). Use --move-to <scope-id> or --delete-tasks`,
      );
    }
    // else: deleteTasks=true, proceed with deletion
  }

  // Delete .worklog directory
  await Deno.remove(worklogPath, { recursive: true });

  // Refresh hierarchy to update parent scope.json
  const scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);
  await refreshScopeHierarchy(gitRoot, scopes);

  return { status: "scope_deleted" };
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

  const scopeId = customScopeId || tagPattern;

  // Find all tasks matching tag
  const matchingTasks = await findTasksByTagPattern(tagPattern, gitRoot, cwd);

  if (matchingTasks.length === 0) {
    throw new WtError("task_not_found", `No tasks with tag: ${tagPattern}`);
  }

  // Resolve target path
  const absoluteTargetPath = isAbsolute(targetPath)
    ? targetPath
    : join(cwd, targetPath);
  const targetWorklogPath = join(absoluteTargetPath, WORKLOG_DIR);

  // Check if target exists
  if (await exists(targetWorklogPath)) {
    const targetIndexPath = join(targetWorklogPath, "index.json");
    if (await exists(targetIndexPath)) {
      const targetIndex = JSON.parse(
        await Deno.readTextFile(targetIndexPath),
      ) as Index;
      if (Object.keys(targetIndex.tasks).length > 0) {
        throw new WtError(
          "invalid_state",
          `Target worklog has ${
            Object.keys(targetIndex.tasks).length
          } tasks. Choose different path.`,
        );
      }
    }
  }

  // Create target worklog directory
  await ensureDir(join(targetWorklogPath, "tasks"));

  // Initialize target index
  const targetIndex: Index = { version: 2, tasks: {} };

  // Copy tasks
  for (const { id, task, scopePath } of matchingTasks) {
    const sourceWorklogPath = scopePath;

    const content = await loadTaskContentFrom(id, sourceWorklogPath);
    const doc = await parseDocument(content);
    const yamlContent = getFrontmatterContent(doc);
    const frontmatter = parseFrontmatter(yamlContent) as Record<
      string,
      unknown
    >;

    // Adjust tags: remove exported tag or tag prefix
    const currentTags = (frontmatter.tags as string[]) || [];
    const newTags = removeTag
      ? currentTags
        .filter((t) => !matchesTagPattern(tagPattern, t))
        .map((t) =>
          t.startsWith(tagPattern + "/") ? t.slice(tagPattern.length + 1) : t
        )
      : currentTags;

    frontmatter.tags = newTags.length > 0 ? newTags : undefined;
    setFrontmatter(doc, stringifyFrontmatter(frontmatter));

    // Save to target
    await saveTaskContentTo(id, serializeDocument(doc), targetWorklogPath);

    // Add to target index
    targetIndex.tasks[id] = {
      ...task,
      tags: newTags.length > 0 ? newTags : undefined,
    };

    // Remove from source
    await Deno.remove(join(sourceWorklogPath, "tasks", `${id}.md`));
    const sourceIndex = await loadIndexFrom(sourceWorklogPath);
    delete sourceIndex.tasks[id];
    await saveIndexTo(sourceIndex, sourceWorklogPath);
  }

  // Save target index
  await saveIndexTo(targetIndex, targetWorklogPath);

  // Create scope.json in target (child)
  const targetScopeConfig: ScopeConfigChild = {
    parent: relative(absoluteTargetPath, gitRoot),
  };
  await Deno.writeTextFile(
    join(targetWorklogPath, "scope.json"),
    JSON.stringify(targetScopeConfig, null, 2),
  );

  // Update parent scope.json
  const parentWorklogPath = join(gitRoot, WORKLOG_DIR);
  const parentScopeJsonPath = join(parentWorklogPath, "scope.json");

  let parentConfig: ScopeConfigParent;
  if (await exists(parentScopeJsonPath)) {
    parentConfig = JSON.parse(
      await Deno.readTextFile(parentScopeJsonPath),
    ) as ScopeConfigParent;
    if (!("children" in parentConfig)) {
      throw new WtError(
        "invalid_state",
        "Parent scope.json is not a parent config",
      );
    }
  } else {
    parentConfig = { children: [] };
  }

  // Add child entry
  const relativePath = relative(gitRoot, absoluteTargetPath);
  parentConfig.children.push({
    path: relativePath,
    id: scopeId,
    type: "path",
  });

  await Deno.writeTextFile(
    parentScopeJsonPath,
    JSON.stringify(parentConfig, null, 2),
  );

  return {
    exported: matchingTasks.length,
    scopeId,
    targetPath: absoluteTargetPath,
  };
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

  // Resolve target scope
  const targetWorklog = await resolveScopeIdentifier(
    targetScopeId,
    gitRoot,
    cwd,
  );
  const scopes = await discoverScopes(gitRoot, WORKLOG_DEPTH_LIMIT);

  let assigned = 0;
  let merged = 0;
  const errors: Array<{ taskId: string; error: string }> = [];

  for (const taskIdPrefix of taskIds) {
    try {
      // Find task in any scope
      const found = await findTaskInScopes(taskIdPrefix, scopes);

      if (!found) {
        errors.push({
          taskId: taskIdPrefix,
          error: "Task not found in any scope",
        });
        continue;
      }

      const { worklog: sourceWorklog, taskId } = found;

      // If already in target scope, skip
      if (sourceWorklog === targetWorklog) {
        continue;
      }

      // Load task from source
      const sourceTaskPath = `${sourceWorklog}/tasks/${taskId}.md`;
      const taskContent = await Deno.readTextFile(sourceTaskPath);
      const { meta: sourceMeta } = await parseTaskFile(taskContent);

      // Load target index
      const targetIndexPath = `${targetWorklog}/index.json`;
      const targetIndex = await loadIndexFrom(targetWorklog);

      // Check if task with same UID exists in target
      let existingTaskId: string | undefined;
      for (const id of Object.keys(targetIndex.tasks)) {
        const destTaskPath = `${targetWorklog}/tasks/${id}.md`;
        const destContent = await Deno.readTextFile(destTaskPath);
        const { meta: destMeta } = await parseTaskFile(destContent);

        if (destMeta.uid === sourceMeta.uid) {
          existingTaskId = id;
          break;
        }
      }

      if (existingTaskId) {
        // Task already exists by UID - would need merge logic here
        // For now, we'll skip merging and just count it
        merged++;

        // Remove from source anyway
        await Deno.remove(sourceTaskPath);
        const sourceIndex = await loadIndexFrom(sourceWorklog);
        delete sourceIndex.tasks[taskId];
        await writeFile(
          `${sourceWorklog}/index.json`,
          JSON.stringify(sourceIndex, null, 2),
        );
      } else {
        // Import as new task
        const targetTaskPath = `${targetWorklog}/tasks/${taskId}.md`;
        await Deno.writeTextFile(targetTaskPath, taskContent);

        targetIndex.tasks[taskId] = {
          name: sourceMeta.name,
          desc: sourceMeta.desc,
          status: sourceMeta.status,
          created: sourceMeta.created_at,
          status_updated_at: sourceMeta.created_at,
          done_at: sourceMeta.done_at,
        };

        // Save target index
        await writeFile(
          targetIndexPath,
          JSON.stringify(targetIndex, null, 2),
        );

        assigned++;

        // Remove from source
        await Deno.remove(sourceTaskPath);
        const sourceIndex = await loadIndexFrom(sourceWorklog);
        delete sourceIndex.tasks[taskId];
        await writeFile(
          `${sourceWorklog}/index.json`,
          JSON.stringify(sourceIndex, null, 2),
        );
      }
    } catch (error) {
      errors.push({
        taskId: taskIdPrefix,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { assigned, merged, errors };
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

async function findTaskInScopes(
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
    return true; // explicit worklog dir → skip scope resolution
  }

  return false;
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
