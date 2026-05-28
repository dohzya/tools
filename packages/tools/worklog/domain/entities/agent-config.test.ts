import { assertEquals } from "@std/assert";
import {
  claudeAgentConfig,
  codexAgentConfig,
  detectAgentType,
  getAgentConfig,
} from "./agent-config.ts";

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

Deno.test("codexAgentConfig - buildInteractiveCmd puts systemPrompt last", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("sys prompt", [
    "--model",
    "o3",
  ]);
  assertEquals(cmd, ["codex", "--model", "o3", "sys prompt"]);
});

Deno.test("codexAgentConfig - buildInteractiveCmd with empty args", () => {
  const cmd = codexAgentConfig.buildInteractiveCmd("sys prompt", []);
  assertEquals(cmd, ["codex", "sys prompt"]);
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
