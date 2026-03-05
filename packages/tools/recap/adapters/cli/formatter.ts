// CLI formatter — converts SectionData[] to colored string output

import type { SectionData } from "../../domain/entities/section-data.ts";
import type { Palette } from "../../domain/entities/color.ts";
import { renderRecap } from "../../domain/use-cases/render-recap.ts";

/**
 * Format sections as colored text string.
 */
export function formatRecap(sections: SectionData[], palette: Palette): string {
  return renderRecap(sections, palette);
}

/**
 * Format sections as JSON array (for --json flag).
 */
export function formatRecapJson(sections: SectionData[]): string {
  return JSON.stringify(sections, null, 2);
}
