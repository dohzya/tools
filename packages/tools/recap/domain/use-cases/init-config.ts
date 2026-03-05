// init-config use case — generates a default config file

import { HARDCODED_SECTIONS } from "../entities/default-config.ts";

const GLOBAL_CONFIG_COMMENT = `# recap global configuration
# See: https://github.com/dohzya/dz-tools
#
# This is your global config (~/.config/recap.yaml).
# Project-level configs (.config/recap.yaml) override this.
#
# Use ref: "*" to include all sections from the parent level.
# Use ref: "<id>" to include a specific section from the parent level.
`;

const LOCAL_CONFIG_COMMENT = `# recap project configuration
# See: https://github.com/dohzya/dz-tools
#
# Sections from the global config (~/.config/recap.yaml) or hardcoded defaults
# can be included with:
#   - ref: "*"         (all parent sections)
#   - ref: "<id>"      (specific section, with optional overrides)
#
`;

/**
 * Generate YAML content for a config file.
 *
 * Local config uses ref: "*" to inherit everything from parent.
 * Global config uses ref: per hardcoded section plus a worktasks id: definition.
 */
export function generateConfigContent(isGlobal: boolean): string {
  if (!isGlobal) {
    const comment = LOCAL_CONFIG_COMMENT;
    const sectionLines = [
      '  - ref: "*"',
      "  # - id: my-section",
      "  #   sh: echo hello",
      "  #   title: My Section",
    ];
    return `${comment}sections:\n${sectionLines.join("\n")}\n`;
  }

  // Global config: ref: per hardcoded section + worktasks id: definition
  const comment = GLOBAL_CONFIG_COMMENT;
  const sectionLines: string[] = [];

  for (const section of HARDCODED_SECTIONS) {
    sectionLines.push(`  - ref: ${section.id}`);
    // Include max_lines override when the hardcoded section has one
    if (section.max_lines !== undefined) {
      sectionLines.push(`    max_lines: ${section.max_lines}`);
    }
  }

  // Add worktasks as a new id: definition
  sectionLines.push("  - id: worktasks");
  sectionLines.push("    sh: wl list");
  sectionLines.push("    max_lines: 6");

  return `${comment}sections:\n${sectionLines.join("\n")}\n`;
}
