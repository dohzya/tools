// render-recap use case — converts SectionData[] to a formatted string

import type { SectionData } from "../entities/section-data.ts";
import type { Palette } from "../entities/color.ts";

const SEPARATOR_LINE = "─".repeat(40);

/**
 * Render a list of collected sections into a string using the given color palette.
 * Handles titles, separators, and error messages.
 */
export function renderRecap(sections: SectionData[], palette: Palette): string {
  const parts: string[] = [];

  for (const section of sections) {
    const hasContent = section.lines.length > 0 || section.error !== undefined;

    if (!hasContent) {
      continue;
    }

    const sectionParts: string[] = [];

    // Title
    if (section.title) {
      sectionParts.push(palette.title(section.title));
    }

    // Error
    if (section.error) {
      sectionParts.push(
        palette.error(`[${section.id}] error: ${section.error}`),
      );
    } else {
      // Content lines
      for (const line of section.lines) {
        sectionParts.push(line);
      }
    }

    const sectionText = sectionParts.join("\n");

    // Separator before this section (applied BEFORE the section text)
    if (parts.length > 0) {
      switch (section.separator) {
        case "blank_line":
          parts.push("");
          break;
        case "line":
          parts.push(palette.separator(SEPARATOR_LINE));
          break;
        case "none":
        default:
          break;
      }
    }

    parts.push(sectionText);
  }

  return parts.join("\n");
}
