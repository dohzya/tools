#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import * as readline from "node:readline";
import { agentInstructions } from "../agent-instructions.ts";

import {
  applyReviewAnnotationAction,
  collectConversations,
  collectReviewAnnotations,
  type Conversation,
  type ConversationStatus,
  getAddedLinesByFile,
  getConversationLastMessage,
  getConversationMessages,
  getConversationStatus,
  renderReviewAnnotationForDisplay,
  type ReviewAnnotation,
  type ReviewAnnotationKind,
  reviewItemOverlapsLines,
  type ReviewMessage,
  summarizeConversation,
  summarizeReviewAnnotation,
} from "./review-core.ts";
import {
  encodeCompactTimestamp,
  encodeHangulTimestamp,
  encodeTimestamp,
  formatTimestampForDisplay,
  parseReviewTimestamp,
  type ReviewTimestamp,
  type TimestampFormat,
} from "./timestamp.ts";

interface CliOptions {
  context: DisplayContext;
  mode: "review" | "status" | "list" | "diff" | "timestamp" | "now" | "help";
  conversationOnly: boolean;
  conversationFilter: ConversationFilter;
  files: string[];
  git: boolean;
  list: boolean;
  since: ReviewTimestamp | undefined;
  statusFormat: StatusFormat;
  statusTemplate: string | undefined;
  timestampFormat: TimestampFormat;
  timestampDateInput: string | undefined;
  timestampInputMode: TimestampInputMode;
  timestampOutputFile: string | undefined;
  timestampOutputMode: TimestampOutputMode;
  timestampFormatInfo: boolean;
  colorMode: ColorMode | undefined;
}

type CliMode = CliOptions["mode"];
type TimestampInputMode = "files" | "stdin";
type TimestampOutputMode = "stdout" | "inline" | "file";
type ColorMode = "auto" | "always" | "never";
type StatusFormat = "long" | "oneline" | "short" | "recap";
type DzReviewCliErrorCode = "invalid_args" | "runtime_error";

interface CommonCliffyOptions {
  pending?: boolean;
  open?: boolean;
  wip?: boolean;
  handled?: boolean;
  resolved?: boolean;
  conversation?: boolean;
  conversations?: boolean;
  openConversations?: boolean;
  wipConversations?: boolean;
  handledConversations?: boolean;
  resolvedConversations?: boolean;
  pendingConversations?: boolean;
  ignoreClosedConversations?: boolean;
  since?: string;
  color?: string | false;
  noColor?: boolean;
}

interface ReviewCliffyOptions extends CommonCliffyOptions {
  git?: boolean;
  diff?: boolean;
  list?: boolean;
  contextBefore?: string;
  contextAfter?: string;
  diffConversations?: boolean;
  listDiffConversations?: boolean;
  context?: string;
  c?: string;
}

interface StatusCliffyOptions extends CommonCliffyOptions {
  git?: boolean;
  diff?: boolean;
  oneline?: boolean;
  short?: boolean;
  recap?: boolean;
  template?: string;
}

interface ListCliffyOptions extends CommonCliffyOptions {
  git?: boolean;
  diff?: boolean;
}

type DiffCliffyOptions = CommonCliffyOptions;

interface TimestampCliffyOptions {
  inline?: boolean;
  output?: string;
  stdout?: boolean;
  stdin?: boolean;
  compact?: boolean;
  short?: boolean;
  hangul?: boolean;
  iso?: boolean;
  formatInfo?: boolean;
  timestampFormat?: string;
}

interface NowCliffyOptions {
  compact?: boolean;
  short?: boolean;
  hangul?: boolean;
  iso?: boolean;
  timestampFormat?: string;
  date?: string;
}

class DzReviewCliError extends Error {
  constructor(
    readonly code: DzReviewCliErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DzReviewCliError";
  }
}

interface Prompt {
  question(text: string): Promise<string>;
  close(): void;
}

interface DisplayContext {
  after: number;
  before: number;
}

interface IgnoreRule {
  ignored: boolean;
  pattern: string;
  directoryOnly: boolean;
  regex: RegExp;
}

type ReviewAction =
  | "skip"
  | "delete"
  | "toggle-ok"
  | "reply"
  | "apply"
  | "cancel"
  | "next-pending"
  | "next-file"
  | "quit";

type ProcessFileResult = "continue" | "quit";
type ConversationFilter = "all" | ConversationStatus | "pending";
interface LocatedReviewItem {
  file: string;
  item: ReviewItem;
  text: string;
}

interface LastReviewTimestamp {
  source: ReviewMessage["marker"] | "other";
  timestamp: ReviewTimestamp;
}

interface TimestampFormatStats {
  compact: number;
  hangul: number;
  iso: number;
}

const ANSI = {
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
  yellow: "\x1b[33m",
};

const DEFAULT_CONTEXT: DisplayContext = { before: 2, after: 0 };
const DOMINANT_TIMESTAMP_FORMAT_RATIO = 0.9;
const STATUS_TEMPLATE_PLACEHOLDER = "%(status)";
const DISPLAY_TIMESTAMP_VALUE_PATTERN = String
  .raw`[A-Za-z0-9]{8}|[\uac00-\ub3ff]{4}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})`;
const DISPLAY_CONVERSATION_TIMESTAMP_RE = new RegExp(
  String
    .raw`(@agent|@me|@)%(${DISPLAY_TIMESTAMP_VALUE_PATTERN})(?=[ \t\r\n]|$)`,
  "g",
);
const DISPLAY_ANNOTATION_TIMESTAMP_RE = new RegExp(
  String.raw`(\{(?:\+\+|--|==|>>|~~))%(${DISPLAY_TIMESTAMP_VALUE_PATTERN})\|`,
  "g",
);
const CLI_VERSION = "0.1.0";
let activeColorMode: ColorMode | undefined;

interface GlobalArgs {
  argv: string[];
  cwd: string;
}

function parseGlobalArgs(argv: string[]): GlobalArgs {
  const remaining: string[] = [];
  let cwd = Deno.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-C" || arg === "--cwd") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a directory.`);
      }
      cwd = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }

    remaining.push(arg);
  }

  return { argv: remaining, cwd };
}

export async function main(argv: string[]): Promise<number> {
  const global = parseGlobalArgs(argv);
  const previousCwd = Deno.cwd();
  Deno.chdir(global.cwd);

  try {
    return await runCliffy(global.argv);
  } finally {
    Deno.chdir(previousCwd);
  }
}

async function runCliffy(argv: string[]): Promise<number> {
  const cli = createCli();
  if (argv.length === 0) {
    cli.showHelp();
    return 0;
  }

  await cli.parse(argv);
  return 0;
}

async function runLegacyCommand(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  activeColorMode = options.colorMode;
  const ignoreRules = readReviewIgnoreRules();

  if (options.mode === "help") {
    writeHelp();
    return 0;
  }

  if (options.mode === "timestamp") {
    if (options.timestampInputMode === "stdin") {
      writeStdinTimestamps(options.timestampFormat);
      return 0;
    }

    const { files } = resolveFilesAndDiff(options, ignoreRules);
    writeTimestamps(
      filterIgnoredFiles(files, ignoreRules),
      options.timestampFormat,
      options.timestampOutputMode,
      options.timestampOutputFile,
      options.timestampFormatInfo,
    );
    return 0;
  }

  if (options.mode === "now") {
    process.stdout.write(
      `${
        renderNowTimestamp(options.timestampDateInput, options.timestampFormat)
      }\n`,
    );
    return 0;
  }

  if (options.mode === "status") {
    const { files, addedLinesByFile } = resolveFilesAndDiff(
      options,
      ignoreRules,
    );
    writeStatus(
      filterIgnoredFiles(files, ignoreRules),
      addedLinesByFile,
      options.conversationOnly,
      options.conversationFilter,
      options.since,
      options.statusFormat,
      options.statusTemplate,
    );
    return 0;
  }

  if (options.mode === "list" || options.mode === "diff") {
    const { files, addedLinesByFile } = resolveFilesAndDiff(
      options,
      ignoreRules,
    );
    writeReviewItems(
      filterIgnoredFiles(files, ignoreRules),
      addedLinesByFile,
      options.conversationOnly,
      options.conversationFilter,
      options.context,
      options.since,
    );
    return 0;
  }

  if (!options.git) {
    await processFiles(
      filterIgnoredFiles(options.files, ignoreRules),
      undefined,
      options.conversationOnly,
      options.conversationFilter,
      options.context,
      options.list,
      options.since,
    );
    return 0;
  }

  const { files, addedLinesByFile } = resolveFilesAndDiff(
    options,
    ignoreRules,
  );

  await processFiles(
    filterIgnoredFiles(files, ignoreRules),
    addedLinesByFile,
    options.conversationOnly,
    options.conversationFilter,
    options.context,
    options.list,
    options.since,
  );
  return 0;
}

function createCli() {
  return new Command()
    .name("dz-review")
    .version(CLI_VERSION)
    .description("Markdown review syntax helper")
    .noExit()
    .throwErrors()
    .globalOption(
      "-C, --cwd <dir:string>",
      "Change directory before running the command.",
    )
    .command("review", createReviewCommand())
    .command("status", createStatusCommand())
    .command("list", createListCommand())
    .command("diff", createDiffCommand())
    .command("timestamp", createTimestampCommand())
    .command("now", createNowCommand())
    .command("stats", createStatsCommand())
    .command("agent-instructions", createAgentInstructionsCommand())
    .command("completions", new CompletionsCommand());
}

function createReviewCommand() {
  return new Command()
    .alias("r")
    .description("Review annotations and conversations interactively")
    .option("--pending", "Keep open and wip conversations, plus annotations.")
    .option("--open", "Keep open conversations, plus annotations.")
    .option("--wip", "Keep wip conversations, plus annotations.")
    .option("--handled", "Keep handled conversations, plus annotations.")
    .option("--resolved", "Keep resolved conversations, plus annotations.")
    .option("--conversation", "Alias for --conversations.")
    .option("--conversations", "Keep conversation blocks only.")
    .option("--open-conversations", "Keep open conversations only.")
    .option("--wip-conversations", "Keep wip conversations only.")
    .option("--handled-conversations", "Keep handled conversations only.")
    .option("--resolved-conversations", "Keep resolved conversations only.")
    .option("--pending-conversations", "Keep open and wip conversations only.")
    .option(
      "--ignore-closed-conversations",
      "Alias for --pending-conversations.",
    )
    .option(
      "--since <timestamp:string>",
      "Keep timestamped items from this date onward.",
    )
    .option("--color <mode:string>", "Color mode: auto, always, or never.")
    .option("--no-color", "Disable colored output.")
    .option("--git", "Review only items on lines added in git diff HEAD.")
    .option("--diff", "Alias for --git.")
    .option("--list", "List matching review items without editing files.")
    .option("--diff-conversations", "Review conversations from the Git diff.")
    .option(
      "--list-diff-conversations",
      "List conversations from the Git diff.",
    )
    .option(
      "--context <beforeAfter:string>",
      "Display context as before:after.",
    )
    .option("--context-before <lines:string>", "Display lines before an item.")
    .option("--context-after <lines:string>", "Display lines after an item.")
    .option("-c <lines:string>", "Shortcut for --context lines:lines.")
    .arguments("[files...:string]")
    .action(async (options: ReviewCliffyOptions, ...files: string[]) => {
      await runLegacyCommand(buildReviewArgv(options, files));
    });
}

function createStatusCommand() {
  return new Command()
    .alias("st")
    .description("Print review status")
    .option("--pending", "Keep open and wip conversations, plus annotations.")
    .option("--open", "Keep open conversations, plus annotations.")
    .option("--wip", "Keep wip conversations, plus annotations.")
    .option("--handled", "Keep handled conversations, plus annotations.")
    .option("--resolved", "Keep resolved conversations, plus annotations.")
    .option("--conversation", "Alias for --conversations.")
    .option("--conversations", "Keep conversation blocks only.")
    .option("--open-conversations", "Keep open conversations only.")
    .option("--wip-conversations", "Keep wip conversations only.")
    .option("--handled-conversations", "Keep handled conversations only.")
    .option("--resolved-conversations", "Keep resolved conversations only.")
    .option("--pending-conversations", "Keep open and wip conversations only.")
    .option(
      "--ignore-closed-conversations",
      "Alias for --pending-conversations.",
    )
    .option(
      "--since <timestamp:string>",
      "Keep timestamped items from this date onward.",
    )
    .option("--color <mode:string>", "Color mode: auto, always, or never.")
    .option("--no-color", "Disable colored output.")
    .option("--git", "Restrict status to lines added in git diff HEAD.")
    .option("--diff", "Alias for --git.")
    .option("--oneline", "Print one aggregate summary.")
    .option("--short", "Print compact per-file stats.")
    .option("--recap", "Print file and compact status separated by a tab.")
    .option(
      "--template <template:string>",
      "Format --recap status with %(status).",
    )
    .arguments("[files...:string]")
    .action(async (options: StatusCliffyOptions, ...files: string[]) => {
      await runLegacyCommand(buildStatusArgv(options, files));
    });
}

function createListCommand() {
  return new Command()
    .alias("l")
    .alias("ls")
    .description("List matching review items without editing files")
    .option("--pending", "Keep open and wip conversations, plus annotations.")
    .option("--open", "Keep open conversations, plus annotations.")
    .option("--wip", "Keep wip conversations, plus annotations.")
    .option("--handled", "Keep handled conversations, plus annotations.")
    .option("--resolved", "Keep resolved conversations, plus annotations.")
    .option("--conversation", "Alias for --conversations.")
    .option("--conversations", "Keep conversation blocks only.")
    .option("--open-conversations", "Keep open conversations only.")
    .option("--wip-conversations", "Keep wip conversations only.")
    .option("--handled-conversations", "Keep handled conversations only.")
    .option("--resolved-conversations", "Keep resolved conversations only.")
    .option("--pending-conversations", "Keep open and wip conversations only.")
    .option(
      "--ignore-closed-conversations",
      "Alias for --pending-conversations.",
    )
    .option(
      "--since <timestamp:string>",
      "Keep timestamped items from this date onward.",
    )
    .option("--color <mode:string>", "Color mode: auto, always, or never.")
    .option("--no-color", "Disable colored output.")
    .option("--git", "Restrict list output to lines added in git diff HEAD.")
    .option("--diff", "Alias for --git.")
    .arguments("[files...:string]")
    .action(async (options: ListCliffyOptions, ...files: string[]) => {
      await runLegacyCommand(buildListArgv(options, files));
    });
}

function createDiffCommand() {
  return new Command()
    .alias("d")
    .description("List review items on lines added in the current Git diff")
    .option("--pending", "Keep open and wip conversations, plus annotations.")
    .option("--open", "Keep open conversations, plus annotations.")
    .option("--wip", "Keep wip conversations, plus annotations.")
    .option("--handled", "Keep handled conversations, plus annotations.")
    .option("--resolved", "Keep resolved conversations, plus annotations.")
    .option("--conversation", "Alias for --conversations.")
    .option("--conversations", "Keep conversation blocks only.")
    .option("--open-conversations", "Keep open conversations only.")
    .option("--wip-conversations", "Keep wip conversations only.")
    .option("--handled-conversations", "Keep handled conversations only.")
    .option("--resolved-conversations", "Keep resolved conversations only.")
    .option("--pending-conversations", "Keep open and wip conversations only.")
    .option(
      "--ignore-closed-conversations",
      "Alias for --pending-conversations.",
    )
    .option(
      "--since <timestamp:string>",
      "Keep timestamped items from this date onward.",
    )
    .option("--color <mode:string>", "Color mode: auto, always, or never.")
    .option("--no-color", "Disable colored output.")
    .arguments("[files...:string]")
    .action(async (options: DiffCliffyOptions, ...files: string[]) => {
      await runLegacyCommand(buildDiffArgv(options, files));
    });
}

function createTimestampCommand() {
  return new Command()
    .alias("ts")
    .alias("timestamps")
    .description("Add or convert review timestamps")
    .option("-i, --inline", "Rewrite source files in place.")
    .option("-o, --output <file:string>", "Write transformed output to a file.")
    .option("-s, --stdout", "Write transformed output to stdout.")
    .option("--stdin", "Read Markdown from stdin.")
    .option("--compact", "Use compact timestamps.")
    .option("-S, --short", "Use compact timestamps.")
    .option("-H, --hangul", "Use 4-character Hangul timestamps.")
    .option("-I, --iso", "Use ISO timestamps.")
    .option("--format-info", "Print detected timestamp format information.")
    .option(
      "--timestamp-format <format:string>",
      "Compatibility alias for short, hangul, or iso.",
    )
    .arguments("[files...:string]")
    .action(async (options: TimestampCliffyOptions, ...files: string[]) => {
      await runLegacyCommand(buildTimestampArgv(options, files));
    });
}

function createNowCommand() {
  return new Command()
    .description("Print a review timestamp for now or for --date")
    .option("--compact", "Use compact timestamps.")
    .option("-S, --short", "Use compact timestamps.")
    .option("-H, --hangul", "Use 4-character Hangul timestamps.")
    .option("-I, --iso", "Use ISO timestamps.")
    .option(
      "--timestamp-format <format:string>",
      "Compatibility alias for short, hangul, or iso.",
    )
    .option("-d, --date <date:string>", "Timestamp the provided date.")
    .action(async (options: NowCliffyOptions) => {
      await runLegacyCommand(buildNowArgv(options));
    });
}

function createStatsCommand() {
  return new Command()
    .description("Removed command")
    .hidden()
    .action(() => {
      throw new DzReviewCliError(
        "invalid_args",
        "dz-review stats was removed; use dz-review status --oneline.",
      );
    });
}

function createAgentInstructionsCommand() {
  return new Command()
    .description("Print AGENTS.md guidance for dz-review")
    .action(() => {
      console.log(agentInstructions("dz-review"));
    });
}

function buildReviewArgv(
  options: ReviewCliffyOptions,
  files: string[],
): string[] {
  const argv = ["review"];
  appendCommonOptions(argv, options);
  appendFlag(argv, options.git, "--git");
  appendFlag(argv, options.diff, "--git");
  appendFlag(argv, options.list, "--list");
  appendFlag(argv, options.diffConversations, "--diff-conversations");
  appendFlag(
    argv,
    options.listDiffConversations,
    "--list-diff-conversations",
  );
  appendOption(argv, "--context", options.context);
  appendOption(argv, "--context-before", options.contextBefore);
  appendOption(argv, "--context-after", options.contextAfter);
  appendOption(argv, "-c", options.c);
  argv.push(...files);
  return argv;
}

function buildStatusArgv(
  options: StatusCliffyOptions,
  files: string[],
): string[] {
  const argv = ["status"];
  appendCommonOptions(argv, options);
  appendFlag(argv, options.git, "--git");
  appendFlag(argv, options.diff, "--git");
  appendFlag(argv, options.oneline, "--oneline");
  appendFlag(argv, options.short, "--short");
  appendFlag(argv, options.recap, "--recap");
  appendOption(argv, "--template", options.template);
  argv.push(...files);
  return argv;
}

function buildListArgv(options: ListCliffyOptions, files: string[]): string[] {
  const argv = ["list"];
  appendCommonOptions(argv, options);
  appendFlag(argv, options.git, "--git");
  appendFlag(argv, options.diff, "--git");
  argv.push(...files);
  return argv;
}

function buildDiffArgv(options: DiffCliffyOptions, files: string[]): string[] {
  const argv = ["diff"];
  appendCommonOptions(argv, options);
  argv.push(...files);
  return argv;
}

function buildTimestampArgv(
  options: TimestampCliffyOptions,
  files: string[],
): string[] {
  const argv = ["timestamp"];
  appendFlag(argv, options.inline, "--inline");
  appendOption(argv, "--output", options.output);
  appendFlag(argv, options.stdout, "--stdout");
  appendFlag(argv, options.stdin, "--stdin");
  appendFlag(argv, options.compact, "--compact");
  appendFlag(argv, options.short, "--short");
  appendFlag(argv, options.hangul, "-H");
  appendFlag(argv, options.iso, "--iso");
  appendFlag(argv, options.formatInfo, "--format-info");
  appendOption(argv, "--timestamp-format", options.timestampFormat);
  argv.push(...files);
  return argv;
}

function buildNowArgv(options: NowCliffyOptions): string[] {
  const argv = ["now"];
  appendFlag(argv, options.compact, "--compact");
  appendFlag(argv, options.short, "--short");
  appendFlag(argv, options.hangul, "-H");
  appendFlag(argv, options.iso, "--iso");
  appendOption(argv, "--timestamp-format", options.timestampFormat);
  appendOption(argv, "--date", options.date);
  return argv;
}

function appendCommonOptions(
  argv: string[],
  options: CommonCliffyOptions,
): void {
  appendFlag(argv, options.pending, "--pending");
  appendFlag(argv, options.open, "--open");
  appendFlag(argv, options.wip, "--wip");
  appendFlag(argv, options.handled, "--handled");
  appendFlag(argv, options.resolved, "--resolved");
  appendFlag(argv, options.conversation, "--conversation");
  appendFlag(argv, options.conversations, "--conversations");
  appendFlag(argv, options.openConversations, "--open-conversations");
  appendFlag(argv, options.wipConversations, "--wip-conversations");
  appendFlag(argv, options.handledConversations, "--handled-conversations");
  appendFlag(argv, options.resolvedConversations, "--resolved-conversations");
  appendFlag(argv, options.pendingConversations, "--pending-conversations");
  appendFlag(
    argv,
    options.ignoreClosedConversations,
    "--ignore-closed-conversations",
  );
  appendOption(argv, "--since", options.since);
  appendOption(argv, "--color", options.color);
  appendFlag(argv, options.noColor, "--no-color");
}

function appendFlag(
  argv: string[],
  enabled: boolean | undefined,
  flag: string,
): void {
  if (enabled) {
    argv.push(flag);
  }
}

function appendOption(
  argv: string[],
  flag: string,
  value: string | false | undefined,
): void {
  if (value !== undefined && value !== false) {
    argv.push(flag, value);
  }
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      mode: "help",
      context: DEFAULT_CONTEXT,
      conversationOnly: false,
      conversationFilter: "all",
      files: [],
      git: false,
      list: false,
      since: undefined,
      statusFormat: "long",
      statusTemplate: undefined,
      timestampFormat: "compact",
      timestampDateInput: undefined,
      timestampInputMode: "files",
      timestampOutputFile: undefined,
      timestampOutputMode: "stdout",
      timestampFormatInfo: false,
      colorMode: undefined,
    };
  }

  if (argv.length === 0) {
    return {
      mode: "help",
      context: DEFAULT_CONTEXT,
      conversationOnly: false,
      conversationFilter: "all",
      files: [],
      git: false,
      list: false,
      since: undefined,
      statusFormat: "long",
      statusTemplate: undefined,
      timestampFormat: "compact",
      timestampDateInput: undefined,
      timestampInputMode: "files",
      timestampOutputFile: undefined,
      timestampOutputMode: "stdout",
      timestampFormatInfo: false,
      colorMode: undefined,
    };
  }

  const command = parseCommand(argv[0]);
  let context = { ...DEFAULT_CONTEXT };
  const mode = command.mode;
  let conversationOnly = false;
  let conversationFilter: ConversationFilter = "all";
  let git = command.git;
  let list = false;
  let statusFormat: StatusFormat = "long";
  let statusTemplate: string | undefined;
  let since: ReviewTimestamp | undefined;
  let timestampFormat: TimestampFormat = "compact";
  let timestampDateInput: string | undefined;
  let timestampInputMode: TimestampInputMode = "files";
  let timestampOutputFile: string | undefined;
  let timestampOutputMode: TimestampOutputMode = "stdout";
  let timestampFormatInfo = false;
  let colorMode: ColorMode | undefined;
  const files: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--conversation" || arg === "--conversations") {
      conversationOnly = true;
      conversationFilter = "all";
      continue;
    }

    if (arg === "--open-conversations") {
      conversationOnly = true;
      conversationFilter = "open";
      continue;
    }

    if (arg === "--wip-conversations") {
      conversationOnly = true;
      conversationFilter = "wip";
      continue;
    }

    if (arg === "--handled-conversations") {
      conversationOnly = true;
      conversationFilter = "handled";
      continue;
    }

    if (arg === "--resolved-conversations") {
      conversationOnly = true;
      conversationFilter = "resolved";
      continue;
    }

    if (
      arg === "--pending-conversations" ||
      arg === "--ignore-closed-conversations"
    ) {
      conversationOnly = true;
      conversationFilter = "pending";
      continue;
    }

    const status = parseConversationStatusFlag(arg);
    if (status) {
      conversationOnly = false;
      conversationFilter = status;
      continue;
    }

    if (arg === "--pending") {
      conversationOnly = false;
      conversationFilter = "pending";
      continue;
    }

    if (arg === "--oneline") {
      if (statusFormat !== "long") {
        throw new Error(
          "Use only one status format option: --oneline, --short, or --recap.",
        );
      }
      statusFormat = "oneline";
      continue;
    }

    if (arg === "--color") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--color requires auto, always, or never.");
      }
      colorMode = parseColorMode(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--color=")) {
      colorMode = parseColorMode(arg.slice("--color=".length));
      continue;
    }

    if (arg === "--no-color") {
      colorMode = "never";
      continue;
    }

    if (arg === "--since") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--since requires a timestamp.");
      }
      since = parseRequiredTimestamp(value, "--since");
      index += 1;
      continue;
    }

    if (arg.startsWith("--since=")) {
      since = parseRequiredTimestamp(arg.slice("--since=".length), "--since");
      continue;
    }

    if (arg === "--timestamp-format") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--timestamp-format requires short, hangul, or iso.");
      }
      timestampFormat = parseTimestampFormat(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--timestamp-format=")) {
      timestampFormat = parseTimestampFormat(
        arg.slice("--timestamp-format=".length),
      );
      continue;
    }

    if (arg === "-I" || arg === "--iso") {
      timestampFormat = "iso";
      continue;
    }

    if (arg === "-H" || arg === "--hangul") {
      timestampFormat = "hangul";
      continue;
    }

    if (arg === "--short" && mode === "status") {
      if (statusFormat !== "long") {
        throw new Error(
          "Use only one status format option: --oneline, --short, or --recap.",
        );
      }
      statusFormat = "short";
      continue;
    }

    if (arg === "--recap" && mode === "status") {
      if (statusFormat !== "long") {
        throw new Error(
          "Use only one status format option: --oneline, --short, or --recap.",
        );
      }
      statusFormat = "recap";
      continue;
    }

    if (arg === "--template") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--template requires a value containing %(status).");
      }
      statusTemplate = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--template=")) {
      statusTemplate = arg.slice("--template=".length);
      continue;
    }

    if (arg === "-S" || arg === "--short" || arg === "--compact") {
      timestampFormat = "compact";
      continue;
    }

    if (arg === "--format-info") {
      timestampFormatInfo = true;
      continue;
    }

    if (arg === "-s" || arg === "--stdout") {
      timestampOutputMode = "stdout";
      timestampOutputFile = undefined;
      continue;
    }

    if (arg === "-d" || arg === "--date") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a date.`);
      }
      timestampDateInput = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--date=")) {
      timestampDateInput = arg.slice("--date=".length);
      continue;
    }

    if (arg === "--stdin") {
      if (mode !== "timestamp") {
        throw new Error(
          "--stdin can only be used with dz-review timestamp or dz-review ts.",
        );
      }
      timestampInputMode = "stdin";
      continue;
    }

    if (arg === "-i" || arg === "--inline") {
      timestampOutputMode = "inline";
      timestampOutputFile = undefined;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires an output file.`);
      }
      timestampOutputMode = "file";
      timestampOutputFile = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      timestampOutputMode = "file";
      timestampOutputFile = arg.slice("--output=".length);
      continue;
    }

    if (arg === "--git") {
      git = true;
      continue;
    }

    if (arg === "--list") {
      list = true;
      continue;
    }

    if (arg === "--context" || arg === "-c") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value like 2 or 2:0.`);
      }
      context = parseContext(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--context=")) {
      context = parseContext(arg.slice("--context=".length));
      continue;
    }

    if (arg === "--context-before") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--context-before requires a non-negative integer.");
      }
      context = {
        ...context,
        before: parseNonNegativeInteger(value, "--context-before"),
      };
      index += 1;
      continue;
    }

    if (arg === "--context-after") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--context-after requires a non-negative integer.");
      }
      context = {
        ...context,
        after: parseNonNegativeInteger(value, "--context-after"),
      };
      index += 1;
      continue;
    }

    if (arg === "--diff-conversations") {
      git = true;
      conversationOnly = true;
      conversationFilter = "all";
      continue;
    }

    if (arg === "--list-diff-conversations") {
      git = true;
      list = true;
      conversationOnly = true;
      conversationFilter = "all";
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    files.push(arg);
  }

  if (mode === "now" && files.length > 0) {
    throw new Error(
      "dz-review now does not accept file arguments. Use -d/--date to provide a date.",
    );
  }

  if (statusTemplate !== undefined) {
    if (mode !== "status" || statusFormat !== "recap") {
      throw new Error(
        "--template can only be used with dz-review status --recap.",
      );
    }

    if (!statusTemplate.includes(STATUS_TEMPLATE_PLACEHOLDER)) {
      throw new Error("--template requires %(status).");
    }
  }

  if (mode === "timestamp" && files.length === 0 && !process.stdin.isTTY) {
    timestampInputMode = "stdin";
  }

  if (mode === "timestamp" && timestampInputMode === "stdin") {
    if (files.length > 0) {
      throw new Error(
        "dz-review ts --stdin cannot be combined with file arguments.",
      );
    }

    if (timestampOutputMode === "inline") {
      throw new Error("--inline cannot be used with stdin.");
    }

    if (timestampOutputMode === "file") {
      throw new Error("-o/--output cannot be used with stdin.");
    }
  }

  if (
    mode !== "now" &&
    !(mode === "timestamp" && timestampInputMode === "stdin") &&
    files.length === 0 && isInsideGitWorkTree()
  ) {
    git = true;
  }

  if (
    mode !== "now" &&
    !(mode === "timestamp" && timestampInputMode === "stdin") && !git &&
    files.length === 0
  ) {
    throw new Error(
      "dz-review requires at least one Markdown file, unless an explicit command runs inside a Git worktree.",
    );
  }

  return {
    mode,
    context,
    conversationOnly,
    conversationFilter,
    files,
    git,
    list,
    since,
    statusFormat,
    statusTemplate,
    timestampFormat,
    timestampDateInput,
    timestampInputMode,
    timestampOutputFile,
    timestampOutputMode,
    timestampFormatInfo,
    colorMode,
  };
}

function parseCommand(
  command: string,
): { mode: Exclude<CliMode, "help">; git: boolean } {
  switch (command) {
    case "review":
    case "r":
      return { mode: "review", git: false };
    case "stats":
      throw new Error(
        "dz-review stats was removed; use dz-review status --oneline.",
      );
    case "status":
    case "st":
      return { mode: "status", git: false };
    case "timestamp":
    case "timestamps":
    case "ts":
      return { mode: "timestamp", git: false };
    case "now":
      return { mode: "now", git: false };
    case "list":
    case "ls":
    case "l":
      return { mode: "list", git: false };
    case "diff":
    case "d":
      return { mode: "diff", git: true };
    default:
      if (command.startsWith("-")) {
        throw new DzReviewCliError(
          "invalid_args",
          `Missing command before ${command}. Use dz-review r ${command} to review the current diff.`,
        );
      }

      throw new DzReviewCliError(
        "invalid_args",
        `Unknown command: ${command}. Use dz-review r ${command} to review files.`,
      );
  }
}

async function processFiles(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  context: DisplayContext,
  list: boolean,
  since: ReviewTimestamp | undefined,
): Promise<void> {
  if (files.length === 0) {
    process.stdout.write("No review annotations found.\n");
    return;
  }

  if (list) {
    listReviewItems(
      files,
      addedLinesByFile,
      conversationOnly,
      conversationFilter,
      since,
    );
    return;
  }

  const prompt = createPrompt();
  try {
    for (const file of files) {
      const result = await processFile(
        file,
        addedLinesByFile,
        conversationOnly,
        conversationFilter,
        context,
        prompt,
        since,
      );
      if (result === "quit") {
        break;
      }
    }
  } finally {
    prompt.close();
  }
}

async function processFile(
  file: string,
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  context: DisplayContext,
  prompt: Prompt,
  since: ReviewTimestamp | undefined,
): Promise<ProcessFileResult> {
  const initialText = fs.readFileSync(file, "utf8");
  const filterLines = addedLinesByFile?.get(normalizePath(file));
  const initialItems = collectReviewItems(
    initialText,
    conversationOnly,
    conversationFilter,
  )
    .filter((item) => reviewItemMatchesSince(item, since))
    .filter((item) =>
      !addedLinesByFile ||
      (filterLines && reviewItemOverlapsLines(item, filterLines))
    );

  if (initialItems.length === 0) {
    return "continue";
  }

  let text = initialText;
  let offsetDelta = 0;
  let changed = false;

  for (let index = 0; index < initialItems.length; index += 1) {
    const original = initialItems[index];
    const item = {
      ...original,
      start: original.start + offsetDelta,
      end: original.end + offsetDelta,
      raw: text.slice(original.start + offsetDelta, original.end + offsetDelta),
    };

    showReviewItem(file, index + 1, initialItems.length, item, text, context);
    const action = item.kind === "conversation"
      ? await askConversationAction(prompt)
      : await askAnnotationAction(prompt);

    if (action === "quit") {
      if (changed) {
        fs.writeFileSync(file, text, "utf8");
      }
      return "quit";
    }

    if (action === "next-file") {
      break;
    }

    if (action === "next-pending") {
      const nextPendingIndex = findNextPendingIndex(initialItems, index);
      if (nextPendingIndex === undefined) {
        process.stdout.write("No next pending conversation.\n");
        break;
      }
      index = nextPendingIndex - 1;
      continue;
    }

    if (action === "skip") {
      continue;
    }

    const beforeLength = text.length;

    if (action === "delete") {
      text = applyReviewAnnotationAction(text, item, { kind: "delete" });
    } else if (action === "toggle-ok") {
      text = applyReviewAnnotationAction(text, item, { kind: "toggle-ok" });
    } else if (action === "apply" || action === "cancel") {
      text = applyReviewAnnotationAction(text, item, { kind: action });
    } else {
      const body = await prompt.question("Reply: ");
      if (body.trim().length === 0) {
        continue;
      }
      text = applyReviewAnnotationAction(text, item, {
        kind: "reply",
        body: body.trim(),
      });
    }

    offsetDelta += text.length - beforeLength;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, text, "utf8");
  }

  return "continue";
}

async function askConversationAction(prompt: Prompt): Promise<ReviewAction> {
  while (true) {
    const answer = (await prompt.question(actionPrompt("conversation")))
      .trim()
      .toLowerCase();

    if (answer === "" || answer === "n" || answer === "s") {
      return "skip";
    }
    if (answer === "d") {
      return "delete";
    }
    if (answer === "o") {
      return "toggle-ok";
    }
    if (answer === "r") {
      return "reply";
    }
    if (answer === "p") {
      return "next-pending";
    }
    if (answer === "f") {
      return "next-file";
    }
    if (answer === "q") {
      return "quit";
    }
    if (answer === "?") {
      process.stdout.write(
        "n next, d delete, o toggle trailing @me ok, r reply, p next pending conversation, f next file, q quit\n",
      );
    }
  }
}

async function askAnnotationAction(prompt: Prompt): Promise<ReviewAction> {
  while (true) {
    const answer = (await prompt.question(actionPrompt("annotation")))
      .trim()
      .toLowerCase();

    if (answer === "" || answer === "n" || answer === "s") {
      return "skip";
    }
    if (answer === "a") {
      return "apply";
    }
    if (answer === "x") {
      return "cancel";
    }
    if (answer === "d") {
      return "delete";
    }
    if (answer === "p") {
      return "next-pending";
    }
    if (answer === "f") {
      return "next-file";
    }
    if (answer === "q") {
      return "quit";
    }
    if (answer === "?") {
      process.stdout.write(
        "n next, a apply, x cancel, d delete raw block, p next pending conversation, f next file, q quit\n",
      );
    }
  }
}

function actionPrompt(kind: "annotation" | "conversation"): string {
  if (kind === "conversation") {
    return `${color("Action", "bold")} ${color("[n]", "cyan")}ext ${
      color("[d]", "red")
    }elete ${color("[o]", "green")}k ${color("[r]", "yellow")}eply next-[${
      color("f", "cyan")
    }]ile ${color("[q]", "red")}uit [?]: `;
  }

  return `${color("Action", "bold")} ${color("[n]", "cyan")}ext ${
    color("[a]", "green")
  }pply ${color("[x]", "yellow")}cancel ${color("[d]", "red")}elete next-[${
    color("f", "cyan")
  }]ile ${color("[q]", "red")}uit [?]: `;
}

function listReviewItems(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  since: ReviewTimestamp | undefined,
): void {
  let count = 0;

  for (const file of files) {
    const lines = addedLinesByFile?.get(normalizePath(file));
    if (addedLinesByFile && !lines) {
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    for (
      const item of collectReviewItems(
        text,
        conversationOnly,
        conversationFilter,
      )
    ) {
      if (!reviewItemMatchesSince(item, since)) {
        continue;
      }

      if (lines && !reviewItemOverlapsLines(item, lines)) {
        continue;
      }

      count += 1;
      process.stdout.write(
        formatReviewItemHeader(file, count, undefined, item),
      );
      process.stdout.write(`${summarizeReviewItem(item)}\n`);
    }
  }

  if (count === 0) {
    process.stdout.write("No review annotations found.\n");
  }
}

function writeStatus(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  since: ReviewTimestamp | undefined,
  statusFormat: StatusFormat,
  statusTemplate: string | undefined,
): void {
  if (statusFormat === "oneline") {
    const stats = collectStats(
      files,
      addedLinesByFile,
      conversationOnly,
      conversationFilter,
      since,
    );
    process.stdout.write(
      `${formatStats(stats, conversationOnly, conversationFilter)}\n`,
    );
    return;
  }

  const lines: string[] = [];

  for (const file of files) {
    const stats = collectStats(
      [file],
      addedLinesByFile,
      conversationOnly,
      conversationFilter,
      since,
    );
    if (isEmptyStats(stats)) {
      continue;
    }

    if (statusFormat === "recap") {
      const renderedStatus = formatShortStatusStats(stats);
      lines.push(
        `${normalizePath(file)}\t${
          formatStatusTemplate(statusTemplate, renderedStatus)
        }`,
      );
      continue;
    }

    const rendered = statusFormat === "short"
      ? formatShortStatusStats(stats)
      : formatStatusStats(stats, conversationOnly, conversationFilter);
    lines.push(`${color(normalizePath(file), "bold")}: ${rendered}`);
  }

  process.stdout.write(
    lines.length > 0
      ? `${lines.join("\n")}\n`
      : "No review annotations found.\n",
  );
}

function formatStatusTemplate(
  template: string | undefined,
  status: string,
): string {
  return template
    ? template.split(STATUS_TEMPLATE_PLACEHOLDER).join(status)
    : status;
}

function writeReviewItems(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  context: DisplayContext,
  since: ReviewTimestamp | undefined,
): void {
  const items = collectLocatedReviewItems(
    files,
    addedLinesByFile,
    conversationOnly,
    conversationFilter,
    since,
  );

  if (items.length === 0) {
    process.stdout.write("No review annotations found.\n");
    return;
  }

  for (let index = 0; index < items.length; index += 1) {
    const { file, item, text } = items[index];
    showReviewItem(file, index + 1, items.length, item, text, context);
  }
}

function collectLocatedReviewItems(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  since: ReviewTimestamp | undefined,
): LocatedReviewItem[] {
  const locatedItems: LocatedReviewItem[] = [];

  for (const file of files) {
    const lines = addedLinesByFile?.get(normalizePath(file));
    if (addedLinesByFile && !lines) {
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    for (
      const item of collectReviewItems(
        text,
        conversationOnly,
        conversationFilter,
      )
    ) {
      if (!reviewItemMatchesSince(item, since)) {
        continue;
      }

      if (lines && !reviewItemOverlapsLines(item, lines)) {
        continue;
      }

      locatedItems.push({ file, item, text });
    }
  }

  return locatedItems;
}

function writeStdinTimestamps(format: TimestampFormat): void {
  const text = fs.readFileSync(0, "utf8");
  const { updated } = transformTimestamps(text, new Date(), format);
  process.stdout.write(updated);
}

function writeTimestamps(
  files: string[],
  format: TimestampFormat,
  outputMode: TimestampOutputMode,
  outputFile: string | undefined,
  formatInfo: boolean,
): void {
  if (files.length === 0) {
    process.stdout.write("No review annotations found.\n");
    return;
  }

  if (formatInfo) {
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      process.stdout.write(
        `${normalizePath(file)}: ${
          formatTimestampFormatStats(collectTimestampFormatStats(text))
        }\n`,
      );
    }
    return;
  }

  if (outputMode !== "inline" && files.length !== 1) {
    throw new Error(
      "timestamp stdout and -o modes require exactly one input file. Use -i for multiple files.",
    );
  }

  if (outputMode === "file" && !outputFile) {
    throw new Error("-o requires an output file.");
  }

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const formatSummary = formatTimestampFormatStats(
      collectTimestampFormatStats(text),
    );
    const { count, updated } = transformTimestamps(
      text,
      fs.statSync(file).mtime,
      format,
    );

    if (outputMode === "stdout") {
      process.stdout.write(updated);
      continue;
    }

    if (outputMode === "file") {
      if (!outputFile) {
        throw new Error("-o requires an output file.");
      }
      fs.writeFileSync(outputFile, updated, "utf8");
      continue;
    }

    if (updated !== text) {
      fs.writeFileSync(file, updated, "utf8");
    }

    process.stdout.write(
      `${normalizePath(file)}: ${count} ${plural(count, "timestamp")} updated${
        formatSummary === "none"
          ? ""
          : `; existing format: ${formatSummary}; output format: ${format}`
      }\n`,
    );
  }
}

function collectTimestampFormatStats(text: string): TimestampFormatStats {
  const stats: TimestampFormatStats = { compact: 0, hangul: 0, iso: 0 };

  for (const match of text.matchAll(DISPLAY_CONVERSATION_TIMESTAMP_RE)) {
    incrementTimestampFormatStats(stats, match[2]);
  }

  for (const match of text.matchAll(DISPLAY_ANNOTATION_TIMESTAMP_RE)) {
    incrementTimestampFormatStats(stats, match[2]);
  }

  return stats;
}

function incrementTimestampFormatStats(
  stats: TimestampFormatStats,
  value: string,
): void {
  if (/^[A-Za-z0-9]{8}$/.test(value)) {
    stats.compact += 1;
    return;
  }

  if (/^[\uac00-\ub3ff]{4}$/u.test(value)) {
    stats.hangul += 1;
    return;
  }

  stats.iso += 1;
}

function formatTimestampFormatStats(stats: TimestampFormatStats): string {
  const total = stats.compact + stats.hangul + stats.iso;
  if (total === 0) {
    return "none";
  }

  const compactRatio = stats.compact / total;
  const hangulRatio = stats.hangul / total;
  const isoRatio = stats.iso / total;
  if (compactRatio >= DOMINANT_TIMESTAMP_FORMAT_RATIO) {
    return formatDominantTimestampFormatStats("compact", stats.compact, total);
  }

  if (hangulRatio >= DOMINANT_TIMESTAMP_FORMAT_RATIO) {
    return formatDominantTimestampFormatStats("hangul", stats.hangul, total);
  }

  if (isoRatio >= DOMINANT_TIMESTAMP_FORMAT_RATIO) {
    return formatDominantTimestampFormatStats("iso", stats.iso, total);
  }

  return "mixed";
}

function formatDominantTimestampFormatStats(
  format: TimestampFormat,
  count: number,
  total: number,
): string {
  const percentage = Math.round((count / total) * 100);
  if (percentage === 100) {
    return `${format} 100%`;
  }

  return `${format} ${percentage}% (${count}/${total} timestamps)`;
}

function transformTimestamps(
  text: string,
  fallbackDate: Date,
  format: TimestampFormat,
): { count: number; updated: string } {
  const fallbackTimestamp = encodeTimestamp(fallbackDate, format);
  let count = 0;

  const withConvertedConversationTimestamps = text.replace(
    DISPLAY_CONVERSATION_TIMESTAMP_RE,
    (match: string, marker: string, value: string) => {
      const timestamp = renderTimestampValue(value, format);
      if (!timestamp || timestamp === value) {
        return match;
      }

      count += 1;
      return `${marker}%${timestamp}`;
    },
  );

  const withConversationTimestamps = withConvertedConversationTimestamps
    .replace(
      /(^|[ \t\r\n])(@agent|@me|@)(?![%\(])(?=[ \t]*:|[ \t\r\n]|$)/g,
      (_match: string, prefix: string, marker: string) => {
        count += 1;
        return `${prefix}${marker}%${fallbackTimestamp}`;
      },
    );

  const withConvertedAnnotationTimestamps = withConversationTimestamps.replace(
    DISPLAY_ANNOTATION_TIMESTAMP_RE,
    (match: string, marker: string, value: string) => {
      const timestamp = renderTimestampValue(value, format);
      if (!timestamp || timestamp === value) {
        return match;
      }

      count += 1;
      return `${marker}%${timestamp}|`;
    },
  );

  const updated = withConvertedAnnotationTimestamps.replace(
    /\{(\+\+|--|==|>>|~~)(?!%)/g,
    (_match: string, marker: string) => {
      count += 1;
      return `{${marker}%${fallbackTimestamp}|`;
    },
  );

  return { count, updated };
}

function renderTimestampValue(
  value: string,
  format: TimestampFormat,
): string | undefined {
  const timestamp = parseReviewTimestamp(value);
  if (!timestamp) {
    return undefined;
  }

  if (format === "iso") {
    return formatTimestampForDisplay(timestamp);
  }

  if (format === "hangul") {
    return encodeHangulTimestamp(
      timestamp.unixSeconds,
      timestamp.offsetMinutes,
    );
  }

  return encodeCompactTimestamp(timestamp.unixSeconds, timestamp.offsetMinutes);
}

function renderNowTimestamp(
  input: string | undefined,
  format: TimestampFormat,
): string {
  if (!input) {
    return encodeTimestamp(new Date(), format);
  }

  const timestamp = parseReviewTimestamp(input);
  if (timestamp) {
    if (format === "iso") {
      const rendered = formatTimestampForDisplay(timestamp);
      if (!rendered) {
        throw new Error(`Invalid date: ${input}`);
      }

      return rendered;
    }

    if (format === "hangul") {
      return encodeHangulTimestamp(
        timestamp.unixSeconds,
        timestamp.offsetMinutes,
      );
    }

    return encodeCompactTimestamp(
      timestamp.unixSeconds,
      timestamp.offsetMinutes,
    );
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }

  return encodeTimestamp(date, format);
}

interface ReviewStats {
  conversations: Record<ConversationStatus, number>;
  counts: Map<ReviewAnnotation["kind"], number>;
  lastReviewTimestamp: LastReviewTimestamp | undefined;
}

function collectStats(
  files: string[],
  addedLinesByFile: Map<string, Set<number>> | undefined,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
  since: ReviewTimestamp | undefined,
): ReviewStats {
  const stats: ReviewStats = {
    conversations: {
      open: 0,
      wip: 0,
      handled: 0,
      resolved: 0,
    },
    counts: new Map(),
    lastReviewTimestamp: undefined,
  };

  for (const file of files) {
    const lines = addedLinesByFile?.get(normalizePath(file));
    if (addedLinesByFile && !lines) {
      continue;
    }

    const text = fs.readFileSync(file, "utf8");
    for (
      const item of collectReviewItems(
        text,
        conversationOnly,
        conversationFilter,
      )
    ) {
      if (!reviewItemMatchesSince(item, since)) {
        continue;
      }

      if (lines && !reviewItemOverlapsLines(item, lines)) {
        continue;
      }

      if (item.kind === "conversation") {
        stats.conversations[getConversationStatus(item)] += 1;
        updateLastReviewTimestamp(stats, item);
        continue;
      }

      if (item.kind === "discussion") {
        stats.conversations.handled += 1;
        updateLastReviewTimestamp(stats, item);
        continue;
      }

      stats.counts.set(item.kind, (stats.counts.get(item.kind) ?? 0) + 1);
      updateLastReviewTimestamp(stats, item);
    }
  }

  return stats;
}

function isEmptyStats(stats: ReviewStats): boolean {
  if (countConversations(stats) > 0) {
    return false;
  }

  for (const count of stats.counts.values()) {
    if (count > 0) {
      return false;
    }
  }

  return true;
}

function formatStats(
  stats: ReviewStats,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
): string {
  const parts: string[] = [];
  const totalConversations = countConversations(stats);

  if (
    conversationFilter === "open" || conversationFilter === "wip" ||
    conversationFilter === "handled" || conversationFilter === "resolved"
  ) {
    const count = stats.conversations[conversationFilter];
    if (conversationOnly || count > 0) {
      parts.push(
        color(
          `${count} ${plural(count, `${conversationFilter} conversation`)}`,
          conversationStatusColor(conversationFilter),
        ),
      );
    }
  } else if (conversationFilter === "pending") {
    const pendingCount = stats.conversations.open + stats.conversations.wip;
    if (conversationOnly || pendingCount > 0) {
      parts.push(
        color(
          `${pendingCount} ${plural(pendingCount, "pending conversation")} ` +
            `(${stats.conversations.open} open, ${stats.conversations.wip} wip)`,
          pendingCount > 0 ? "yellow" : "dim",
        ),
      );
    }
  } else if (totalConversations > 0 || conversationOnly) {
    const pendingCount = stats.conversations.open + stats.conversations.wip;
    parts.push(
      color(
        `${totalConversations} ${plural(totalConversations, "conversation")} ` +
          `(${stats.conversations.open} open, ${stats.conversations.wip} wip, ` +
          `${stats.conversations.handled} handled, ${stats.conversations.resolved} resolved)`,
        pendingCount > 0 ? "yellow" : "dim",
      ),
    );
  }

  const countedKinds: ReviewAnnotationKind[] = [
    "addition",
    "deletion",
    "substitution",
    "highlight",
    "comment",
  ];
  for (const kind of countedKinds) {
    const count = stats.counts.get(kind) ?? 0;
    if (count > 0) {
      parts.push(
        color(`${count} ${plural(count, kind)}`, annotationColor(kind)),
      );
    }
  }

  return parts.length > 0 ? parts.join(", ") : "0 review annotations";
}

function formatStatusStats(
  stats: ReviewStats,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
): string {
  const rendered = formatStats(stats, conversationOnly, conversationFilter);
  if (!stats.lastReviewTimestamp) {
    return rendered;
  }

  const timestamp = formatTimestampForDisplay(
    stats.lastReviewTimestamp.timestamp,
  );
  const source = formatLastReviewTimestampSource(
    stats.lastReviewTimestamp.source,
  );
  return timestamp
    ? `${rendered}; ${color("last", "dim")} ${
      color(source, lastReviewSourceColor(stats.lastReviewTimestamp.source))
    } ${color(timestamp, "dim")}`
    : rendered;
}

function formatLastReviewTimestampSource(
  source: LastReviewTimestamp["source"],
): string {
  return source === "@" ? "@me" : source;
}

function formatShortStatusStats(stats: ReviewStats): string {
  const parts: string[] = [];
  const annotationParts: string[] = [];
  const totalConversations = countConversations(stats);
  const pendingConversations = stats.conversations.open +
    stats.conversations.wip;

  if (totalConversations > 0) {
    parts.push(
      color(
        `${pendingConversations}/${totalConversations}`,
        pendingConversations > 0 ? "yellow" : "dim",
      ),
    );
  }

  const shortStatusKinds: [ReviewAnnotationKind, string][] = [
    ["addition", "+"],
    ["deletion", "-"],
    ["substitution", "~"],
    ["highlight", "="],
    ["comment", "x"],
  ];

  for (const item of shortStatusKinds) {
    const [kind, symbol] = item;
    const count = stats.counts.get(kind) ?? 0;
    if (count > 0) {
      annotationParts.push(color(`${symbol}${count}`, annotationColor(kind)));
    }
  }

  if (annotationParts.length > 0) {
    parts.push(annotationParts.join(""));
  }

  const rendered = parts.length > 0 ? parts.join(" ") : "0";
  if (!stats.lastReviewTimestamp) {
    return rendered;
  }

  const timestamp = formatShortStatusTimestamp(
    stats.lastReviewTimestamp.timestamp,
  );
  if (!timestamp) {
    return rendered;
  }

  const source = formatShortLastReviewTimestampSource(
    stats.lastReviewTimestamp.source,
  );
  return `${rendered} ${color("-", "dim")} ${
    color(source, lastReviewSourceColor(stats.lastReviewTimestamp.source))
  } ${color(timestamp, "dim")}`;
}

function formatShortLastReviewTimestampSource(
  source: LastReviewTimestamp["source"],
): string {
  switch (source) {
    case "@agent":
      return "a";
    case "@me":
    case "@":
      return "@";
    case "other":
      return "o";
  }
}

function formatShortStatusTimestamp(
  timestamp: ReviewTimestamp | undefined,
): string | undefined {
  if (!timestamp) {
    return undefined;
  }

  const localDate = new Date(Number(timestamp.unixSeconds) * 1000);
  const now = new Date();
  const time = [
    localDate.getHours(),
    localDate.getMinutes(),
    localDate.getSeconds(),
  ].map((value) => String(value).padStart(2, "0")).join(":");

  if (
    localDate.getFullYear() === now.getFullYear() &&
    localDate.getMonth() === now.getMonth() &&
    localDate.getDate() === now.getDate()
  ) {
    return time;
  }

  return `${localDate.getFullYear()}-${
    String(localDate.getMonth() + 1).padStart(2, "0")
  }-${String(localDate.getDate()).padStart(2, "0")} ${time}`;
}

function lastReviewSourceColor(
  source: LastReviewTimestamp["source"],
): keyof typeof ANSI {
  switch (source) {
    case "@agent":
      return "blue";
    case "@me":
    case "@":
      return "green";
    case "other":
      return "magenta";
  }
}

function updateLastReviewTimestamp(stats: ReviewStats, item: ReviewItem): void {
  if (item.kind === "conversation") {
    for (const message of getConversationMessages(item)) {
      updateLastReviewTimestampCandidate(
        stats,
        message.marker,
        message.timestamp,
      );
    }
    return;
  }

  updateLastReviewTimestampCandidate(stats, "other", item.timestamp);
}

function updateLastReviewTimestampCandidate(
  stats: ReviewStats,
  source: LastReviewTimestamp["source"],
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  const timestamp = parseReviewTimestamp(value);
  if (!timestamp) {
    return;
  }

  if (
    !stats.lastReviewTimestamp ||
    compareTimestamps(timestamp, stats.lastReviewTimestamp.timestamp) > 0
  ) {
    stats.lastReviewTimestamp = {
      source,
      timestamp,
    };
  }
}

function reviewItemMatchesSince(
  item: ReviewItem,
  since: ReviewTimestamp | undefined,
): boolean {
  if (!since) {
    return true;
  }

  const timestamp = getReviewItemTimestamp(item);
  return timestamp ? compareTimestamps(timestamp, since) >= 0 : false;
}

function getReviewItemTimestamp(item: ReviewItem): ReviewTimestamp | undefined {
  if (item.kind !== "conversation") {
    return item.timestamp ? parseReviewTimestamp(item.timestamp) : undefined;
  }

  const message = getConversationLastMessage(item);
  return message?.timestamp
    ? parseReviewTimestamp(message.timestamp)
    : undefined;
}

function compareTimestamps(
  left: ReviewTimestamp,
  right: ReviewTimestamp,
): number {
  if (left.unixSeconds < right.unixSeconds) {
    return -1;
  }

  if (left.unixSeconds > right.unixSeconds) {
    return 1;
  }

  return 0;
}

function countConversations(stats: ReviewStats): number {
  return stats.conversations.open +
    stats.conversations.wip +
    stats.conversations.handled +
    stats.conversations.resolved;
}

function plural(count: number, word: string): string {
  if (count === 1) {
    return word;
  }

  if (word === "highlight") {
    return "highlights";
  }

  return `${word}s`;
}

function parseContext(value: string): DisplayContext {
  const parts = value.split(":");
  if (parts.length === 1) {
    const count = parseNonNegativeInteger(parts[0], "--context");
    return {
      before: count,
      after: count,
    };
  }

  if (parts.length === 2) {
    return {
      before: parseNonNegativeInteger(parts[0], "--context"),
      after: parseNonNegativeInteger(parts[1], "--context"),
    };
  }

  throw new Error(
    "--context expects COUNT or BEFORE:AFTER, for example 2 or 2:0.",
  );
}

function parseRequiredTimestamp(
  value: string,
  option: string,
): ReviewTimestamp {
  const timestamp = parseReviewTimestamp(value);
  if (!timestamp) {
    throw new Error(
      `${option} expects an ISO, compact, or hangul review timestamp.`,
    );
  }

  return timestamp;
}

function parseTimestampFormat(value: string): TimestampFormat {
  if (value === "compact" || value === "short") {
    return "compact";
  }

  if (value === "iso") {
    return value;
  }

  if (value === "hangul") {
    return value;
  }

  throw new Error("--timestamp-format expects short, hangul, or iso.");
}

function parseColorMode(value: string): ColorMode {
  if (value === "auto" || value === "always" || value === "never") {
    return value;
  }

  throw new Error("--color expects auto, always, or never.");
}

function parseConversationStatusFlag(
  arg: string,
): ConversationStatus | undefined {
  if (arg === "--open") {
    return "open";
  }

  if (arg === "--wip") {
    return "wip";
  }

  if (arg === "--handled") {
    return "handled";
  }

  if (arg === "--resolved") {
    return "resolved";
  }

  return undefined;
}

function parseNonNegativeInteger(value: string, option: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${option} expects a non-negative integer.`);
  }

  return Number(value);
}

function showReviewItem(
  file: string,
  index: number,
  total: number,
  item: ReviewItem,
  text: string,
  context: DisplayContext,
): void {
  process.stdout.write(formatReviewItemHeader(file, index, total, item));
  process.stdout.write(`${formatSourceContext(text, item, context)}\n`);
  process.stdout.write(`${formatReviewItemBody(item)}\n`);
}

function formatReviewItemHeader(
  file: string,
  index: number,
  total: number | undefined,
  item: ReviewItem,
): string {
  const progress = total === undefined ? `#${index}` : `${index}/${total}`;
  const width = Math.max(48, process.stdout.isTTY ? 72 : 48);
  const line = "─".repeat(width);
  const location = `${file}:${item.lineStart}-${item.lineEnd}`;
  const kind = item.kind === "conversation"
    ? `${getConversationStatus(item)} conversation`
    : item.kind;
  const kindColor = item.kind === "conversation"
    ? conversationStatusColor(getConversationStatus(item))
    : "magenta";

  return [
    "",
    color(line, "dim"),
    `${color(progress, "bold")} ${color(kind, kindColor)} ${
      color(location, "dim")
    }`,
  ].join("\n") + "\n";
}

function formatSourceContext(
  text: string,
  item: ReviewItem,
  context: DisplayContext,
): string {
  const lines = text.split("\n").map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line
  );
  const startLine = Math.max(1, item.lineStart - context.before);
  const endLine = Math.min(lines.length, item.lineEnd + context.after);
  const numberWidth = String(endLine).length;
  const rendered: string[] = [];

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const isTarget = item.lineStart <= lineNumber && lineNumber <= item.lineEnd;
    const marker = isTarget ? ">" : " ";
    const number = String(lineNumber).padStart(numberWidth, " ");
    const source = isTarget
      ? formatSourceContextLine(lines[lineNumber - 1], item)
      : lines[lineNumber - 1];
    const line = `${marker}${number} │ ${source}`;
    rendered.push(isTarget ? color(line, "bold") : color(line, "dim"));
  }

  return rendered.join("\n");
}

function formatSourceContextLine(line: string, item: ReviewItem): string {
  if (item.kind === "conversation") {
    return line.replace(
      DISPLAY_CONVERSATION_TIMESTAMP_RE,
      (_match, marker: string, value: string) => {
        const timestamp = formatTimestampForDisplay(
          parseReviewTimestamp(value),
        );
        return timestamp ? `${marker} ${timestamp}` : `${marker}%${value}`;
      },
    );
  }

  return line.replace(
    DISPLAY_ANNOTATION_TIMESTAMP_RE,
    (_match, marker: string, value: string) => {
      const timestamp = formatTimestampForDisplay(parseReviewTimestamp(value));
      return timestamp ? `${marker}%${timestamp}|` : `${marker}%${value}|`;
    },
  ).replace(
    renderReviewAnnotationForDisplay(item),
    formatReviewAnnotationBody(item),
  );
}

function getWorktreeDiff(files: string[]): string {
  const args = [
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-color",
    "--unified=0",
    "--no-ext-diff",
    "HEAD",
    "--",
    ...files,
  ];
  const result = childProcess.spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || "git diff failed");
  }

  return result.stdout;
}

function isInsideGitWorkTree(): boolean {
  const result = childProcess.spawnSync("git", [
    "rev-parse",
    "--is-inside-work-tree",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.trim() === "true";
}

function readReviewIgnoreRules(): IgnoreRule[] {
  const ignoreFile = path.join(process.cwd(), ".dz-review-ignore");
  if (!fs.existsSync(ignoreFile)) {
    return [];
  }

  return fs.readFileSync(ignoreFile, "utf8")
    .split(/\r?\n/)
    .map(compileIgnoreRule)
    .filter((rule: IgnoreRule | undefined): rule is IgnoreRule =>
      rule !== undefined
    );
}

function compileIgnoreRule(line: string): IgnoreRule | undefined {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) {
    return undefined;
  }

  let ignored = true;
  if (pattern.startsWith("!")) {
    ignored = false;
    pattern = pattern.slice(1).trim();
  }

  if (!pattern) {
    return undefined;
  }

  pattern = pattern.replace(/\\/g, "/");
  if (pattern.startsWith("./")) {
    pattern = pattern.slice(2);
  }

  const anchored = pattern.startsWith("/");
  const directoryOnly = pattern.endsWith("/");
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) {
    return undefined;
  }

  const hasSlash = pattern.includes("/");
  const body = globToRegExp(pattern);
  const source = directoryOnly
    ? (anchored || hasSlash ? `^${body}(?:/|$)` : `(?:^|/)${body}(?:/|$)`)
    : (anchored || hasSlash ? `^${body}$` : `(?:^|/)${body}(?:$|/)`);

  return {
    ignored,
    pattern,
    directoryOnly,
    regex: new RegExp(source),
  };
}

function globToRegExp(pattern: string): string {
  let regex = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      if (pattern[index + 2] === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += escapeRegExp(char);
  }

  return regex;
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function filterIgnoredFiles(
  files: string[],
  ignoreRules: IgnoreRule[],
): string[] {
  if (ignoreRules.length === 0) {
    return files;
  }

  return files.filter((file) => !isIgnoredByReview(file, ignoreRules));
}

function isIgnoredByReview(file: string, ignoreRules: IgnoreRule[]): boolean {
  const normalized = normalizePath(file);
  let ignored = false;

  for (const rule of ignoreRules) {
    if (rule.regex.test(normalized)) {
      ignored = rule.ignored;
    }
  }

  return ignored;
}

function findFilesIncludedByReviewIgnore(ignoreRules: IgnoreRule[]): string[] {
  const files = new Set<string>();

  for (const rule of ignoreRules) {
    if (rule.ignored) {
      continue;
    }

    collectFilesMatchingReviewIgnoreRule(
      getReviewIgnoreRuleScanRoot(rule),
      rule,
      files,
    );
  }

  return [...files].sort();
}

function collectFilesMatchingReviewIgnoreRule(
  file: string,
  rule: IgnoreRule,
  files: Set<string>,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isFile()) {
    const normalized = normalizePath(file);
    if (rule.regex.test(normalized)) {
      files.add(normalized);
    }
    return;
  }

  if (!stat.isDirectory() || path.basename(file) === ".git") {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(file, { withFileTypes: true });
  } catch {
    return;
  }

  for (
    const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  ) {
    collectFilesMatchingReviewIgnoreRule(
      path.join(file, entry.name),
      rule,
      files,
    );
  }
}

function getReviewIgnoreRuleScanRoot(rule: IgnoreRule): string {
  if (!hasGlob(rule.pattern) && !rule.directoryOnly) {
    return rule.pattern;
  }

  const segments = rule.pattern.split("/");
  const staticSegments: string[] = [];
  for (const segment of segments) {
    if (hasGlob(segment)) {
      break;
    }
    staticSegments.push(segment);
  }

  return staticSegments.length > 0 ? staticSegments.join("/") : ".";
}

function hasGlob(pattern: string): boolean {
  return /[*?\[]/.test(pattern);
}

interface ConversationReviewItem extends Conversation {
  kind: "conversation";
}

type ReviewItem = ReviewAnnotation | ConversationReviewItem;

function isConversationReviewItem(
  item: ReviewItem,
): item is ConversationReviewItem {
  return item.kind === "conversation" && "roles" in item;
}

function collectReviewItems(
  text: string,
  conversationOnly: boolean,
  conversationFilter: ConversationFilter,
): ReviewItem[] {
  const keepReviewItem = (item: ReviewItem) => {
    if (conversationFilter === "all") {
      return true;
    }

    if (conversationFilter === "open") {
      return getReviewItemStatus(item) === "open";
    }

    if (conversationFilter === "wip") {
      return getReviewItemStatus(item) === "wip";
    }

    if (conversationFilter === "handled") {
      return getReviewItemStatus(item) === "handled";
    }

    if (conversationFilter === "resolved") {
      return getReviewItemStatus(item) === "resolved";
    }

    if (conversationFilter === "pending") {
      const status = getReviewItemStatus(item);
      return status === "open" || status === "wip";
    }

    return true;
  };

  const conversations: ConversationReviewItem[] = collectConversations(text)
    .map((conversation) => ({
      ...conversation,
      kind: "conversation",
    }));

  const discussionAnnotations = collectReviewAnnotations(text).filter((item) =>
    item.kind === "discussion"
  );

  if (!conversationOnly) {
    return collectReviewAnnotations(text).filter(keepReviewItem);
  }

  return [...conversations, ...discussionAnnotations].filter(keepReviewItem);
}

function getReviewItemStatus(item: ReviewItem): ConversationStatus {
  return isConversationReviewItem(item)
    ? getConversationStatus(item)
    : "handled";
}

function findNextPendingIndex(
  items: ReviewItem[],
  currentIndex: number,
): number | undefined {
  for (let index = currentIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!isConversationReviewItem(item)) {
      continue;
    }

    const status = getConversationStatus(item);
    if (status === "open" || status === "wip") {
      return index;
    }
  }

  return undefined;
}

function resolveFilesAndDiff(
  options: CliOptions,
  ignoreRules: IgnoreRule[],
): {
  addedLinesByFile: Map<string, Set<number>> | undefined;
  files: string[];
} {
  if (!options.git) {
    return {
      addedLinesByFile: undefined,
      files: options.files,
    };
  }

  const diff = getWorktreeDiff(options.files);
  const addedLinesByFile = getAddedLinesByFile(diff);
  const files = options.files.length > 0
    ? options.files
    : [...addedLinesByFile.keys()];

  if (options.files.length === 0) {
    for (const file of findFilesIncludedByReviewIgnore(ignoreRules)) {
      const normalized = normalizePath(file);
      if (addedLinesByFile.has(normalized)) {
        continue;
      }

      files.push(file);
      addedLinesByFile.set(normalized, collectAllLineNumbers(file));
    }
  }

  return {
    addedLinesByFile,
    files,
  };
}

function collectAllLineNumbers(file: string): Set<number> {
  const text = fs.readFileSync(file, "utf8");
  const lines = new Set<number>();
  const count = text.split(/\r\n|\r|\n/).length;
  for (let line = 1; line <= count; line += 1) {
    lines.add(line);
  }
  return lines;
}

function summarizeReviewItem(item: ReviewItem): string {
  if (isConversationReviewItem(item)) {
    return summarizeConversation(item);
  }

  return summarizeReviewAnnotation(item);
}

function formatReviewItemBody(item: ReviewItem): string {
  if (item.kind !== "conversation") {
    return formatReviewAnnotationBody(item);
  }

  return formatConversationBody(item.raw);
}

function formatReviewAnnotationBody(item: ReviewItem): string {
  if (item.kind === "conversation") {
    return formatConversationBody(item.raw);
  }

  return formatReviewAnnotationText(
    renderReviewAnnotationForDisplay(item),
    item.kind,
  );
}

function formatReviewAnnotationText(
  text: string,
  kind: Exclude<ReviewItem["kind"], "conversation">,
): string {
  const timestamp = `(%(?:${DISPLAY_TIMESTAMP_VALUE_PATTERN})\\|)?`;

  switch (kind) {
    case "addition":
      return formatSimpleReviewAnnotation(
        text,
        String.raw`\{\+\+`,
        timestamp,
        String.raw`\+\+\}`,
        "green",
      );
    case "deletion":
      return formatSimpleReviewAnnotation(
        text,
        String.raw`\{--`,
        timestamp,
        String.raw`--\}`,
        "red",
      );
    case "highlight":
      return formatSimpleReviewAnnotation(
        text,
        String.raw`\{==`,
        timestamp,
        String.raw`==\}`,
        "cyan",
      );
    case "comment":
      return formatSimpleReviewAnnotation(
        text,
        String.raw`\{>>`,
        timestamp,
        String.raw`<<\}`,
        "cyan",
      );
    case "discussion":
      return formatSimpleReviewAnnotation(
        text,
        String.raw`\{\?\?`,
        "",
        String.raw`\?\?\}`,
        "cyan",
      );
    case "substitution": {
      const match = text.match(
        new RegExp(
          String.raw`^(\{~~)${timestamp}([\s\S]*?)(~>)([\s\S]*)(~~\})$`,
        ),
      );
      if (!match) {
        return color(text, annotationColor(kind));
      }

      return [
        color(match[1], "dim"),
        match[2] ? color(match[2], "dim") : "",
        color(match[3], "red"),
        color(match[4], "dim"),
        color(match[5], "green"),
        color(match[6], "dim"),
      ].join("");
    }
  }
}

function formatSimpleReviewAnnotation(
  text: string,
  openPattern: string,
  timestampPattern: string,
  closePattern: string,
  contentColor: keyof typeof ANSI,
): string {
  const match = text.match(
    new RegExp(
      String
        .raw`^(${openPattern})${timestampPattern}([\s\S]*)(${closePattern})$`,
    ),
  );
  if (!match) {
    return text;
  }

  const timestamp = timestampPattern.length > 0 ? match[2] : "";
  const content = timestampPattern.length > 0 ? match[3] : match[2];
  const close = timestampPattern.length > 0 ? match[4] : match[3];

  return [
    color(match[1], "dim"),
    timestamp ? color(timestamp, "dim") : "",
    color(content, contentColor),
    color(close, "dim"),
  ].join("");
}

function formatConversationBody(raw: string): string {
  const markers = getConversationMarkers(raw);
  const messages = getConversationMessages({ raw });

  return [
    color(markers.open, "dim"),
    ...messages.map(formatConversationMessage),
    color(markers.close, "dim"),
  ].join("\n");
}

function formatConversationMessage(message: ReviewMessage): string {
  const markerColor = message.marker === "@agent" ? "blue" : "green";
  const timestamp = message.timestamp
    ? formatTimestampForDisplay(parseReviewTimestamp(message.timestamp))
    : undefined;
  const parts = [
    color(message.marker, markerColor),
    ...(timestamp ? [color(timestamp, "dim")] : []),
    message.body,
  ].filter((part) => part.length > 0);

  return parts.join(" ");
}

function getConversationMarkers(raw: string): { open: string; close: string } {
  return raw.startsWith("<!--")
    ? { open: "<!--", close: "-->" }
    : { open: "{??", close: "??}" };
}

function annotationColor(kind: ReviewItem["kind"]): keyof typeof ANSI {
  switch (kind) {
    case "addition":
      return "green";
    case "deletion":
      return "red";
    case "substitution":
      return "yellow";
    case "highlight":
    case "comment":
    case "discussion":
      return "cyan";
    case "conversation":
      return "reset";
  }
}

function conversationStatusColor(
  status: ConversationStatus,
): keyof typeof ANSI {
  switch (status) {
    case "open":
      return "blue";
    case "wip":
      return "yellow";
    case "handled":
    case "resolved":
      return "dim";
  }
}

function color(text: string, colorName: keyof typeof ANSI): string {
  if (!shouldUseColor() || colorName === "reset") {
    return text;
  }

  return `${ANSI[colorName]}${text}${ANSI.reset}`;
}

function shouldUseColor(): boolean {
  if (activeColorMode !== undefined) {
    return activeColorMode === "always" ||
      (activeColorMode === "auto" && process.stdout.isTTY === true);
  }

  if (hasNoColorEnv()) {
    return false;
  }

  if (hasForceColorEnv()) {
    return true;
  }

  return process.stdout.isTTY === true;
}

function hasNoColorEnv(): boolean {
  return process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
}

function hasForceColorEnv(): boolean {
  const value = process.env.FORCE_COLOR;
  return value !== undefined && value !== "" && value !== "0";
}

function createPrompt(): Prompt {
  if (!process.stdin.isTTY) {
    const answers = fs.readFileSync(0, "utf8").split(/\r?\n/);
    let index = 0;

    return {
      question(text: string) {
        process.stdout.write(text);
        const answer = answers[index] ?? "";
        index += 1;
        return Promise.resolve(answer);
      },
      close() {},
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    question(text: string) {
      return new Promise((resolve) => rl.question(text, resolve));
    },
    close() {
      rl.close();
    },
  };
}

function normalizePath(file: string): string {
  return path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, "/");
}

function writeHelp(): void {
  process.stdout.write(`dz-review - Markdown review syntax helper

Usage:
  dz-review [options] <command> [args...]
  dz-review <command> --help

Commands:
  review, r                     Review annotations and conversations interactively.
  status, st                    Print review status. Defaults to one line per file.
  list, l, ls                   List matching review items without editing files.
  diff, d                       List review items on lines added in the current Git diff.
  timestamp, ts, timestamps     Add or convert review timestamps.
  now                           Print a review timestamp for now or for --date.
  agent-instructions            Print AGENTS.md guidance for dz-review.
  completions                   Print shell completion script.

Global Options:
  -C, --cwd <dir>               Change directory before running the command.
  -h, --help                    Show this help.

Common Options:
  --pending                     Keep open and wip conversations, plus annotations.
  --open, --wip                 Keep conversations with a specific status.
  --handled, --resolved         Keep conversations with a specific status.
  --pending-conversations       Keep only open and wip conversations.
  --since <timestamp>           Keep only timestamped items from this date onward.
  --color <mode>                auto, always, or never.
  --no-color                    Disable colored output.

Status Options:
  --oneline                     Print one aggregate summary.
  --short                       Print compact per-file stats.
  --recap                       Print <file><TAB><short-status> for recap.
  --template <template>         Format --recap status with %(status).

Review Options:
  --git                         Review only items on lines added in git diff HEAD.
  --context <before:after>      Display context lines around each item.
  -c <lines>                    Shortcut for --context <lines>:<lines>.
  --conversations               Review conversation blocks only.

Timestamp Options:
  -i, --inline                  Rewrite source files in place.
  -o, --output <file>           Write transformed output to a file.
  -s, --stdout                  Write transformed output to stdout.
  --stdin                       Read Markdown from stdin.
  -S, --short                   Use compact timestamps.
  -H, --hangul                  Use 4-character Hangul timestamps.
  -I, --iso                     Use ISO timestamps.
  --timestamp-format <format>   Use short, hangul, or iso timestamps.
  --format-info                 Print detected timestamp format information.
  -d, --date <date>             Timestamp the provided date for now.

Interactive Actions:
  n                             Next item.
  a / x                         Apply or cancel a review annotation.
  d                             Delete the current annotation or conversation.
  o                             Toggle a trailing @me ok reply.
  r                             Append an @me reply to a conversation.
  p / f / q                     Next pending conversation, next file, quit.

Examples:
  dz-review status
  dz-review status --short
  dz-review status --recap --template "[%(status)]"
  dz-review review docs/spec.md
  dz-review diff --pending
  dz-review timestamp -i docs/spec.md
  dz-review -C ../project status --oneline

Notes:
  Without files, explicit commands use the current Git diff when possible.
  Paths matching .dz-review-ignore are skipped.
  Conversation statuses are open, wip, handled, and resolved.
`);
}

function formatCliError(error: unknown): string {
  const cliError = toCliError(error);
  const header = `error: ${cliError.code}`;
  const renderedHeader = shouldUseErrorColor()
    ? `${ANSI.red}${header}${ANSI.reset}`
    : header;
  return `${renderedHeader}\n${cliError.message}\n`;
}

function toCliError(error: unknown): DzReviewCliError {
  if (error instanceof DzReviewCliError) {
    return error;
  }

  if (error instanceof Error) {
    return new DzReviewCliError("invalid_args", error.message);
  }

  return new DzReviewCliError("runtime_error", String(error));
}

function shouldUseErrorColor(): boolean {
  const forceColor = Deno.env.get("FORCE_COLOR");
  if (forceColor && forceColor !== "0") {
    return true;
  }

  if (Deno.env.has("NO_COLOR")) {
    return false;
  }

  return Boolean(process.stderr.isTTY);
}

if (import.meta.main) {
  main(Deno.args).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(formatCliError(error));
      process.exitCode = 1;
    },
  );
}
