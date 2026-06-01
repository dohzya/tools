import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  claudeAgentConfig,
  codexAgentConfig,
  detectAgentType,
  getAgentConfig,
} from "./agent-config.ts";
import { loadCodexDeveloperInstructions } from "./codex-config.ts";

// --- detectAgentType ---

Deno.test("detectAgentType - returns claude when CLAUDECODE is set", () => {
  const env = new Map([["CLAUDECODE", "1"]]);
  assertEquals(detectAgentType(env), "claude");
});

Deno.test("detectAgentType - returns codex when AGENT=codex", () => {
  const env = new Map([["AGENT", "codex"]]);
  assertEquals(detectAgentType(env), "codex");
});

Deno.test("detectAgentType - returns null when no agent env is set", () => {
  const env = new Map<string, string>();
  assertEquals(detectAgentType(env), null);
});

Deno.test("detectAgentType - returns null when CLAUDECODE is empty string", () => {
  const env = new Map([["CLAUDECODE", ""]]);
  assertEquals(detectAgentType(env), null);
});

Deno.test("detectAgentType - returns null when CLAUDECODE is undefined", () => {
  const env = { get: (_key: string) => undefined };
  assertEquals(detectAgentType(env), null);
});

Deno.test("detectAgentType - claude takes precedence over codex", () => {
  const env = new Map([["CLAUDECODE", "1"], ["AGENT", "codex"]]);
  assertEquals(detectAgentType(env), "claude");
});

Deno.test("detectAgentType - ignores AGENT values other than codex", () => {
  const env = new Map([["AGENT", "other"]]);
  assertEquals(detectAgentType(env), null);
});

// --- claudeAgentConfig ---

Deno.test("claudeAgentConfig - type and name", () => {
  assertEquals(claudeAgentConfig.type, "claude");
  assertEquals(claudeAgentConfig.name, "Claude");
});

Deno.test("claudeAgentConfig - buildInteractiveCmd", () => {
  const cmd = claudeAgentConfig.buildInteractiveCmd("sys prompt", [
    "--model",
    "opus",
  ]);
  assertEquals(cmd, [
    "claude",
    "--append-system-prompt",
    "sys prompt",
    "--model",
    "opus",
  ]);
});

Deno.test("claudeAgentConfig - buildInteractiveCmd with empty args", () => {
  const cmd = claudeAgentConfig.buildInteractiveCmd("sys prompt", []);
  assertEquals(cmd, ["claude", "--append-system-prompt", "sys prompt"]);
});

Deno.test("claudeAgentConfig - buildSynthesisCmd", () => {
  const cmd = claudeAgentConfig.buildSynthesisCmd("sys prompt", "synth prompt");
  assertEquals(cmd, [
    "claude",
    "--append-system-prompt",
    "sys prompt",
    "-p",
    "synth prompt",
  ]);
});

// --- codexAgentConfig ---

Deno.test("codexAgentConfig - type and name", () => {
  assertEquals(codexAgentConfig.type, "codex");
  assertEquals(codexAgentConfig.name, "Codex");
});

Deno.test("codexAgentConfig - buildInteractiveCmd injects developer instructions without positional prompt", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("sys prompt", [
    "--model",
    "o3",
  ]);
  assertEquals(cmd, [
    "codex",
    "--model",
    "o3",
    "-c",
    'developer_instructions="sys prompt"',
  ]);
});

Deno.test("codexAgentConfig - buildInteractiveCmd with empty args uses config override only", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("sys prompt", []);
  assertEquals(cmd, ["codex", "-c", 'developer_instructions="sys prompt"']);
});

Deno.test("codexAgentConfig - buildInteractiveCmd concatenates existing developer instructions", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("wl context", [], {
    existingDeveloperInstructions: "user instructions",
  });

  assertEquals(cmd.length, 3);
  assertEquals(cmd[0], "codex");
  assertEquals(cmd[1], "-c");
  assertStringIncludes(cmd[2], "user instructions");
  assertStringIncludes(cmd[2], "wl context");
});

Deno.test("codexAgentConfig - buildInteractiveCmd merges CLI developer_instructions override", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("wl context", [
    "-c",
    'developer_instructions="cli instructions"',
    "-c",
    'model="gpt-5"',
  ], {
    existingDeveloperInstructions: "file instructions",
  });

  assertEquals(cmd, [
    "codex",
    "-c",
    'model="gpt-5"',
    "-c",
    'developer_instructions="cli instructions\\n\\n---\\n\\nwl context"',
  ]);
});

Deno.test("codexAgentConfig - buildInteractiveCmd handles --config=developer_instructions override", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("wl context", [
    "--config=developer_instructions='literal instructions'",
  ]);

  assertEquals(cmd, [
    "codex",
    "-c",
    'developer_instructions="literal instructions\\n\\n---\\n\\nwl context"',
  ]);
});

Deno.test("codexAgentConfig - buildSynthesisCmd allows unattended execution", () => {
  const cmd = codexAgentConfig.buildSynthesisCmd("ignored-sp", "synth prompt");
  assertEquals(cmd, [
    "codex",
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "synth prompt",
  ]);
});

// --- getAgentConfig ---

Deno.test("getAgentConfig - returns claude config", () => {
  assertEquals(getAgentConfig("claude"), claudeAgentConfig);
});

Deno.test("getAgentConfig - returns codex config", () => {
  assertEquals(getAgentConfig("codex"), codexAgentConfig);
});

// --- Codex config loading ---

Deno.test("loadCodexDeveloperInstructions - reads base config", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${root}/config.toml`,
    'developer_instructions = "base instructions" # keep my tone\n',
  );

  const instructions = await loadCodexDeveloperInstructions([], {
    env: new Map([["CODEX_HOME", root]]),
    readTextFile: (path) => Deno.readTextFile(path),
  });

  assertEquals(instructions, "base instructions");
});

Deno.test("loadCodexDeveloperInstructions - profile overrides base config", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${root}/config.toml`,
    'developer_instructions = "base instructions"\n',
  );
  await Deno.writeTextFile(
    `${root}/work.config.toml`,
    'developer_instructions = "profile instructions"\n',
  );

  const instructions = await loadCodexDeveloperInstructions([
    "--profile",
    "work",
  ], {
    env: new Map([["CODEX_HOME", root]]),
    readTextFile: (path) => Deno.readTextFile(path),
  });

  assertEquals(instructions, "profile instructions");
});

Deno.test("loadCodexDeveloperInstructions - returns undefined when config is absent", async () => {
  const root = await Deno.makeTempDir();

  const instructions = await loadCodexDeveloperInstructions([], {
    env: new Map([["CODEX_HOME", root]]),
    readTextFile: (path) => Deno.readTextFile(path),
  });

  assertEquals(instructions, undefined);
});
