// Hardcoded default sections — the baseline configuration baked into the binary

import type { RecapConfig, ResolvedSection } from "./config.ts";

export const HARDCODED_SECTIONS: readonly ResolvedSection[] = [
  {
    id: "git-branch-track",
    sh: "git status --short --branch --ahead-behind | head -1 | cut -c4-",
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
    id: "git-status",
    sh: "git status --short --untracked-files=normal --renames",
  },
];

/** Default config with no additional env vars */
export const DEFAULT_CONFIG: RecapConfig = {
  sections: HARDCODED_SECTIONS,
  envVars: {},
};
