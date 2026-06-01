import { join } from "node:path";

export interface CodexConfigLoadDeps {
  readonly env: { get(key: string): string | undefined };
  readonly readTextFile: (path: string) => Promise<string>;
}

export async function loadCodexDeveloperInstructions(
  args: readonly string[],
  deps: CodexConfigLoadDeps,
): Promise<string | undefined> {
  const codexHome = getCodexHome(deps.env);
  if (!codexHome) return undefined;

  const baseInstructions = await readDeveloperInstructions(
    join(codexHome, "config.toml"),
    deps,
  );
  const profile = getCodexProfile(args);
  if (!profile) return baseInstructions;

  return await readDeveloperInstructions(
    join(codexHome, `${profile}.config.toml`),
    deps,
  ) ?? baseInstructions;
}

function getCodexHome(
  env: { get(key: string): string | undefined },
): string | undefined {
  const codexHome = env.get("CODEX_HOME");
  if (codexHome) return codexHome;

  const home = env.get("HOME");
  if (!home) return undefined;

  return join(home, ".codex");
}

function getCodexProfile(args: readonly string[]): string | undefined {
  let profile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" || arg === "--profile") {
      const next = args[i + 1];
      if (next !== undefined) {
        profile = next;
        i++;
      }
      continue;
    }

    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg.startsWith("-p") && arg.length > 2) {
      profile = arg.slice(2);
    }
  }

  return profile;
}

async function readDeveloperInstructions(
  path: string,
  deps: CodexConfigLoadDeps,
): Promise<string | undefined> {
  try {
    return parseDeveloperInstructions(await deps.readTextFile(path));
  } catch {
    return undefined;
  }
}

function parseDeveloperInstructions(config: string): string | undefined {
  const lines = config.split(/\r?\n/);
  let inTopLevel = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      inTopLevel = false;
      continue;
    }

    if (!inTopLevel) continue;

    const match = /^developer_instructions\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const value = match[1];
    if (value.startsWith('"""') || value.startsWith("'''")) {
      return parseMultilineString(value, lines.slice(i + 1));
    }

    return parseSingleLineString(value);
  }

  return undefined;
}

function parseMultilineString(
  firstLineValue: string,
  followingLines: readonly string[],
): string {
  const delimiter = firstLineValue.startsWith('"""') ? '"""' : "'''";
  const start = firstLineValue.slice(delimiter.length);
  const parts: string[] = [];

  const sameLineEnd = start.indexOf(delimiter);
  if (sameLineEnd !== -1) {
    return start.slice(0, sameLineEnd);
  }

  parts.push(start);
  for (const line of followingLines) {
    const endIndex = line.indexOf(delimiter);
    if (endIndex !== -1) {
      parts.push(line.slice(0, endIndex));
      break;
    }
    parts.push(line);
  }

  const content = parts.join("\n");
  return content.startsWith("\n") ? content.slice(1) : content;
}

function parseSingleLineString(value: string): string {
  const trimmed = value.trim();
  const valueWithoutComment = stripInlineComment(trimmed).trim();

  if (
    valueWithoutComment.startsWith("'") && valueWithoutComment.endsWith("'")
  ) {
    return valueWithoutComment.slice(1, -1);
  }

  if (
    valueWithoutComment.startsWith('"') && valueWithoutComment.endsWith('"')
  ) {
    try {
      return JSON.parse(valueWithoutComment);
    } catch {
      return valueWithoutComment.slice(1, -1);
    }
  }

  return valueWithoutComment;
}

function stripInlineComment(value: string): string {
  let inBasicString = false;
  let inLiteralString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (inBasicString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inBasicString = false;
      continue;
    }

    if (inLiteralString) {
      if (char === "'") inLiteralString = false;
      continue;
    }

    if (char === '"') {
      inBasicString = true;
      continue;
    }

    if (char === "'") {
      inLiteralString = true;
      continue;
    }

    if (char === "#") return value.slice(0, i);
  }

  return value;
}
