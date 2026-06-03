// Hardcoded default sections — the baseline configuration baked into the binary

import type { RecapConfig, ResolvedSection } from "./config.ts";

/** Built-in default sections baked into the binary (git branch, ops, log, status). */
export const HARDCODED_SECTIONS: readonly ResolvedSection[] = [
  {
    id: "git-branch-track",
    sh: "git status --short --branch --ahead-behind | head -1 | cut -c4-",
  },
  {
    id: "git-subdir",
    builtin: "git-subdir",
    separator: "none",
  },
  {
    id: "git-ops",
    builtin: "git-ops",
  },
  {
    id: "git-log",
    builtin: "git-log",
    max_lines: 6,
  },
  {
    id: "git-stash",
    builtin: "git-stash",
  },
  {
    id: "git-status",
    builtin: "git-status-local",
  },
];

/** Default config with no additional env vars */
export const DEFAULT_CONFIG: RecapConfig = {
  sections: HARDCODED_SECTIONS,
  envVars: {},
};
