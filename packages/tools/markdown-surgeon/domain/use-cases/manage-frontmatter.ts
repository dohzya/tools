/**
 * Use Case: ManageFrontmatter
 *
 * Get, set, delete frontmatter fields.
 * Based on getFrontmatterContent(), setFrontmatter() from parser.ts
 * and cmdMeta() logic from cli.ts.
 *
 * Dependencies: YamlService (port) for YAML parsing/serialization.
 */

import type { Document } from "../entities/document.ts";
import { MdError } from "../entities/document.ts";
import type { YamlService } from "../ports/yaml-service.ts";

export interface GetFrontmatterInput {
  readonly doc: Document;
  readonly key?: string;
}

export interface SetFrontmatterInput {
  readonly doc: Document;
  readonly key: string;
  readonly value: string;
}

export interface DeleteFrontmatterInput {
  readonly doc: Document;
  readonly key: string;
}

export interface FrontmatterGetResult {
  /** The raw YAML content (without delimiters), or a specific field value */
  readonly value: unknown;
  /** Formatted string for display */
  readonly formatted: string;
}

export interface FrontmatterMutationResult {
  readonly updatedLines: readonly string[];
  readonly message: string;
}

export class ManageFrontmatterUseCase {
  constructor(private readonly yamlService: YamlService) {}

  /**
   * Get raw YAML content from frontmatter (without delimiters).
   * Equivalent to getFrontmatterContent() from parser.ts.
   */
  getFrontmatterContent(doc: Document): string {
    if (!doc.frontmatter) {
      return "";
    }
    // Remove leading and trailing ---
    const lines = doc.frontmatter.split("\n");
    // Skip first line (---) and last line (---)
    return lines.slice(1, -1).join("\n");
  }

  /**
   * Get all frontmatter or a specific field.
   */
  get(input: GetFrontmatterInput): FrontmatterGetResult {
    const { doc, key } = input;

    const yamlContent = this.getFrontmatterContent(doc);

    if (!key) {
      // Return all frontmatter
      return {
        value: yamlContent,
        formatted: yamlContent,
      };
    }

    const meta = this.yamlService.parse(yamlContent);
    const val = this.yamlService.getNestedValue(meta, key);

    return {
      value: val,
      formatted: this.yamlService.formatValue(val),
    };
  }

  /**
   * Set a frontmatter field value.
   * Returns updated lines for the document.
   */
  set(input: SetFrontmatterInput): FrontmatterMutationResult {
    const { doc, key, value } = input;

    const yamlContent = this.getFrontmatterContent(doc);
    const meta = this.yamlService.parse(yamlContent);

    // Try to parse value as YAML (for arrays, objects, numbers, booleans)
    let parsedValue: unknown = value;
    try {
      const parsed = this.yamlService.parse(value);
      // If it parsed to something other than empty object, use it
      if (typeof parsed !== "object" || Object.keys(parsed).length > 0) {
        parsedValue = parsed;
      }
    } catch {
      // Keep as string
    }
    // But if it looks like a simple string, keep it as string
    if (
      typeof parsedValue === "object" &&
      Object.keys(parsedValue as object).length === 0
    ) {
      parsedValue = value;
    }

    this.yamlService.setNestedValue(meta, key, parsedValue);
    const updatedLines = this.applyFrontmatter(
      doc,
      this.yamlService.stringify(meta),
    );

    return {
      updatedLines,
      message: `set ${key}`,
    };
  }

  /**
   * Delete a frontmatter field.
   * Returns updated lines for the document.
   */
  delete(input: DeleteFrontmatterInput): FrontmatterMutationResult {
    const { doc, key } = input;

    const yamlContent = this.getFrontmatterContent(doc);
    const meta = this.yamlService.parse(yamlContent);

    const deleted = this.yamlService.deleteNestedValue(meta, key);
    if (!deleted) {
      throw new MdError("parse_error", `Key '${key}' not found`);
    }

    const updatedLines = this.applyFrontmatter(
      doc,
      this.yamlService.stringify(meta),
    );

    return {
      updatedLines,
      message: `deleted ${key}`,
    };
  }

  /**
   * Apply frontmatter content to document lines.
   * Equivalent to setFrontmatter() from parser.ts, but returns new lines
   * instead of mutating the document.
   */
  private applyFrontmatter(
    doc: Document,
    yamlContent: string,
  ): readonly string[] {
    const newFrontmatter = yamlContent.trim()
      ? `---\n${yamlContent.trim()}\n---`
      : null;

    if (doc.frontmatter) {
      // Replace existing frontmatter
      const oldEndLine = doc.frontmatterEndLine;
      const newFmLines = newFrontmatter ? newFrontmatter.split("\n") : [];
      return [...newFmLines, ...doc.lines.slice(oldEndLine)];
    } else if (newFrontmatter) {
      // Add new frontmatter at the beginning
      const newFmLines = newFrontmatter.split("\n");
      return [...newFmLines, "", ...doc.lines];
    }

    // No change needed
    return [...doc.lines];
  }
}
