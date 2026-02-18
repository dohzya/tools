/**
 * Backward-compatible shim for yaml.ts.
 * Delegates to YamlParserService adapter.
 */

import { YamlParserService } from "./adapters/services/yaml-parser.ts";

const _yamlService = new YamlParserService();

/**
 * Parse YAML frontmatter string (without delimiters) into object
 */
export function parseFrontmatter(yaml: string): Record<string, unknown> {
  return _yamlService.parse(yaml);
}

/**
 * Stringify object to YAML (without delimiters)
 */
export function stringifyFrontmatter(obj: Record<string, unknown>): string {
  return _yamlService.stringify(obj);
}

/**
 * Get a nested value from an object using dot notation
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  return _yamlService.getNestedValue(obj, path);
}

/**
 * Set a nested value in an object using dot notation
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  _yamlService.setNestedValue(obj, path, value);
}

/**
 * Delete a nested value from an object using dot notation
 */
export function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string,
): boolean {
  return _yamlService.deleteNestedValue(obj, path);
}

/**
 * Format a value for output (minimal, no fluff)
 */
export function formatValue(value: unknown): string {
  return _yamlService.formatValue(value);
}
