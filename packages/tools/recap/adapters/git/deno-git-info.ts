// DenoGitInfo adapter — implements git built-in providers

import type {
  GitInfoProvider,
  GitLogResult,
  GitOpsResult,
  GitStashResult,
  GitStatusEntry,
  GitStatusResult,
  GitSubdirResult,
} from "../../domain/ports/git-info.ts";

type GitResult = { success: boolean; stdout: string };
type DiffStats = { additions: number; deletions: number };

/**
 * Run git with explicit args via Deno.Command, bypassing any shell tokenizer.
 * This avoids issues with special git refspec characters like @{u}, ^, etc.
 */
async function runGit(args: string[]): Promise<GitResult> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    return { success: output.success, stdout };
  } catch {
    return { success: false, stdout: "" };
  }
}

/**
 * Check if path exists relative to a git dir.
 */
async function gitFileExists(
  gitDir: string,
  relativePath: string,
): Promise<boolean> {
  try {
    await Deno.stat(`${gitDir}/${relativePath}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file content from git dir, trimmed. Returns null if not found.
 */
async function readGitFile(
  gitDir: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const content = await Deno.readTextFile(`${gitDir}/${relativePath}`);
    return content.trim();
  } catch {
    return null;
  }
}

/**
 * Find the .git directory from cwd by walking up.
 * Returns null if not in a git repo.
 */
async function findGitDir(cwd: string): Promise<string | null> {
  const result = await runGit(["-C", cwd, "rev-parse", "--git-dir"]);
  if (!result.success) return null;
  const gitDir = result.stdout.trim();
  // git may return relative path — resolve it
  if (gitDir.startsWith("/")) return gitDir;
  return `${cwd}/${gitDir}`;
}

function parseNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function addStats(
  statsByPath: Map<string, DiffStats>,
  path: string,
  additions: number,
  deletions: number,
): void {
  const existing = statsByPath.get(path) ?? { additions: 0, deletions: 0 };
  statsByPath.set(path, {
    additions: existing.additions + additions,
    deletions: existing.deletions + deletions,
  });
}

function parseNumstat(output: string, statsByPath: Map<string, DiffStats>) {
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.split("\t");
    if (fields.length < 3) continue;
    const additions = parseNumber(fields[0]);
    const deletions = parseNumber(fields[1]);
    if (additions === null || deletions === null) continue;
    addStats(statsByPath, fields.slice(2).join("\t"), additions, deletions);
  }
}

function isOctalDigit(value: string): boolean {
  return value >= "0" && value <= "7";
}

function decodeGitQuotedPath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;

  const decoder = new TextDecoder();
  const bytes: number[] = [];
  let decoded = "";
  const flushBytes = () => {
    if (bytes.length === 0) return;
    decoded += decoder.decode(new Uint8Array(bytes));
    bytes.length = 0;
  };

  for (let index = 1; index < path.length - 1; index += 1) {
    const current = path[index] ?? "";
    if (current !== "\\") {
      flushBytes();
      decoded += current;
      continue;
    }

    const escaped = path[index + 1] ?? "";
    if (escaped === "") {
      flushBytes();
      decoded += "\\";
      continue;
    }

    if (isOctalDigit(escaped)) {
      const digits: string[] = [];
      for (
        let offset = 1;
        offset <= 3 && isOctalDigit(path[index + offset] ?? "");
        offset += 1
      ) {
        digits.push(path[index + offset] ?? "");
      }
      bytes.push(Number.parseInt(digits.join(""), 8));
      index += digits.length;
      continue;
    }

    flushBytes();
    decoded += (() => {
      switch (escaped) {
        case "a":
          return "\x07";
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "v":
          return "\v";
        default:
          return escaped;
      }
    })();
    index += 1;
  }
  flushBytes();

  return decoded;
}

async function getDiffStats(cwd: string): Promise<Map<string, DiffStats>> {
  const statsByPath = new Map<string, DiffStats>();
  const unstaged = await runGit([
    "-C",
    cwd,
    "-c",
    "core.quotePath=false",
    "diff",
    "--relative",
    "--numstat",
    "--",
  ]);
  parseNumstat(unstaged.stdout, statsByPath);
  const staged = await runGit([
    "-C",
    cwd,
    "-c",
    "core.quotePath=false",
    "diff",
    "--relative",
    "--cached",
    "--numstat",
    "--",
  ]);
  parseNumstat(staged.stdout, statsByPath);
  return statsByPath;
}

async function getUntrackedStats(
  cwd: string,
  path: string,
): Promise<DiffStats | null> {
  try {
    const file = `${cwd}/${path}`;
    const stat = await Deno.stat(file);
    if (!stat.isFile) return null;
    const content = await Deno.readTextFile(file);
    const additions = content.length === 0
      ? 0
      : content.endsWith("\n")
      ? content.split("\n").length - 1
      : content.split("\n").length;
    return { additions, deletions: 0 };
  } catch {
    return null;
  }
}

function ansi(open: string, close: string, text: string): string {
  return `\x1b[${open}m${text}\x1b[${close}m`;
}

function formatStatusChar(status: string): string {
  switch (status) {
    case "A":
      return ansi("32", "39", status);
    case "M":
      return ansi("33", "39", status);
    case "D":
      return ansi("31", "39", status);
    case "R":
    case "C":
    case "?":
      return ansi("36", "39", status);
    case "U":
      return ansi("31", "39", status);
    default:
      return status;
  }
}

function formatStatus(status: string, useColor: boolean): string {
  if (!useColor) return status;
  return Array.from(status).map(formatStatusChar).join("");
}

function formatStats(stats: DiffStats | null, useColor: boolean): string {
  if (stats === null) return "";
  const additions = `${stats.additions}+`;
  const deletions = `${stats.deletions}-`;
  if (!useColor) {
    return ` (${additions} ${deletions})`;
  }
  return ` (${ansi("32", "39", additions)} ${ansi("31", "39", deletions)})`;
}

type OutsideKind =
  | "added file"
  | "change"
  | "deleted file"
  | "unmerged file"
  | "untracked file";

const OUTSIDE_KIND_ORDER: readonly OutsideKind[] = [
  "added file",
  "change",
  "deleted file",
  "unmerged file",
  "untracked file",
];

function outsideKindFor(status: string): OutsideKind {
  if (status === "??") return "untracked file";
  if (status.includes("U") || status === "AA" || status === "DD") {
    return "unmerged file";
  }
  if (status.includes("D")) return "deleted file";
  if (status.includes("A")) return "added file";
  return "change";
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function outsideSummary(
  counts: ReadonlyMap<OutsideKind, number>,
): string | null {
  const parts = OUTSIDE_KIND_ORDER.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [`${count} ${pluralize(kind, count)}`];
  });
  if (parts.length === 0) return null;
  return `(${joinParts(parts)} outside this dir)`;
}

export class DenoGitInfo implements GitInfoProvider {
  async getGitOps(cwd: string): Promise<GitOpsResult> {
    const gitDir = await findGitDir(cwd);
    if (!gitDir) return { operation: null };

    // Check for rebase-merge (interactive rebase)
    if (await gitFileExists(gitDir, "rebase-merge")) {
      const head = await readGitFile(gitDir, "rebase-merge/head-name");
      const onto = await readGitFile(gitDir, "rebase-merge/onto");
      if (head && onto) {
        const shortOnto = onto.slice(0, 7);
        return { operation: `rebasing ${head} onto ${shortOnto}` };
      }
      return { operation: "rebase in progress" };
    }

    // Check for rebase-apply
    if (await gitFileExists(gitDir, "rebase-apply")) {
      return { operation: "rebase-apply in progress" };
    }

    // Check for merge
    if (await gitFileExists(gitDir, "MERGE_HEAD")) {
      const mergeHead = await readGitFile(gitDir, "MERGE_HEAD");
      const short = mergeHead ? mergeHead.slice(0, 7) : "unknown";
      return { operation: `merging ${short}` };
    }

    // Check for cherry-pick
    if (await gitFileExists(gitDir, "CHERRY_PICK_HEAD")) {
      return { operation: "cherry-pick in progress" };
    }

    // Check for revert
    if (await gitFileExists(gitDir, "REVERT_HEAD")) {
      return { operation: "revert in progress" };
    }

    return { operation: null };
  }

  async getGitSubdir(cwd: string): Promise<GitSubdirResult> {
    const result = await runGit(["-C", cwd, "rev-parse", "--show-prefix"]);
    if (!result.success) return { display: null };
    const prefix = result.stdout.trim();
    if (prefix === "") return { display: null };
    // Strip trailing slash, prepend "./"
    const clean = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return { display: `(in ./${clean})` };
  }

  async getGitLog(
    cwd: string,
    maxLines: number,
    useColor: boolean,
  ): Promise<GitLogResult> {
    const gitArgs = (extraArgs: string[]) => runGit(["-C", cwd, ...extraArgs]);

    // Try to resolve upstream: git rev-parse --abbrev-ref @{u}
    const upstreamResult = await gitArgs([
      "rev-parse",
      "--abbrev-ref",
      "@{u}",
    ]);

    let logBaseArgs: string[];

    if (upstreamResult.success) {
      const upstream = upstreamResult.stdout.trim();
      // Show only commits not yet on the upstream branch
      logBaseArgs = ["log", `${upstream}^..HEAD`, `-${maxLines}`];
    } else {
      // No upstream — try origin/HEAD as fallback
      const originResult = await gitArgs([
        "rev-parse",
        "--verify",
        "refs/remotes/origin/HEAD",
      ]);
      if (originResult.success) {
        const originHead = originResult.stdout.trim().slice(0, 7);
        logBaseArgs = ["log", `${originHead}^..HEAD`, `-${maxLines}`];
      } else {
        // No upstream at all — just show recent commits
        logBaseArgs = ["log", `-${maxLines}`];
      }
    }

    // `-c color.ui=always` must precede the `log` subcommand, and only on the
    // final log call — the rev-parse probes above produce no user-visible output.
    // The `%C(auto)` token wraps the hash with git's standard "auto" colorization
    // (yellow), but git only emits the ANSI when color.ui resolves to "always".
    const colorPrefix = useColor ? ["-c", "color.ui=always"] : [];
    const prettyFormat = useColor
      ? "--pretty=format:%C(auto)%h%d%Creset %s"
      : "--pretty=format:%h%d %s";
    const logResult = await gitArgs([
      ...colorPrefix,
      ...logBaseArgs,
      prettyFormat,
    ]);
    if (!logResult.success && logResult.stdout.trim() === "") {
      return { lines: [] };
    }
    const lines = logResult.stdout
      .split("\n")
      .filter((l) => l.trim().length > 0);
    return { lines };
  }

  async getGitStash(cwd: string): Promise<GitStashResult> {
    const result = await runGit(["-C", cwd, "stash", "list"]);
    if (!result.success && result.stdout.trim() === "") {
      return { lines: [] };
    }
    const count = result.stdout
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .length;
    if (count === 0) return { lines: [] };
    const noun = count === 1 ? "entry" : "entries";
    return { lines: [`(${count} stashed ${noun})`] };
  }

  async getGitStatus(
    cwd: string,
    localOnly: boolean,
    useColor: boolean,
  ): Promise<GitStatusResult> {
    const result = await runGit([
      "-C",
      cwd,
      "-c",
      "core.quotePath=false",
      "status",
      "--short",
      "--untracked-files=normal",
      "--renames",
    ]);
    if (!result.success && result.stdout.trim() === "") {
      return { lines: [] };
    }

    const lines = result.stdout
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (!localOnly) {
      const entries = lines.map((line) => ({
        path: decodeGitQuotedPath(line.slice(3)),
        line,
      }));
      return { lines, entries };
    }

    const statsByPath = await getDiffStats(cwd);
    const localLines: string[] = [];
    const entries: GitStatusEntry[] = [];
    const outsideCounts = new Map<OutsideKind, number>();

    for (const line of lines) {
      const status = line.slice(0, 2);
      const path = decodeGitQuotedPath(line.slice(3));
      if (path.startsWith("../")) {
        const kind = outsideKindFor(status);
        outsideCounts.set(kind, (outsideCounts.get(kind) ?? 0) + 1);
      } else {
        const stats = status === "??"
          ? await getUntrackedStats(cwd, path)
          : statsByPath.get(path) ?? null;
        const localLine = `${formatStatus(status, useColor)}${line.slice(2)}`;
        localLines.push(localLine);
        const statsText = formatStats(stats, useColor).trimStart();
        entries.push({
          path,
          line: localLine,
          stats: statsText.length > 0 ? statsText : undefined,
        });
      }
    }

    const summary = outsideSummary(outsideCounts);
    if (summary !== null) {
      localLines.push(summary);
    }

    return { lines: localLines, entries };
  }
}
