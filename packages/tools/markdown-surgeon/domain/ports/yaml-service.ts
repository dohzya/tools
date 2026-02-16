/**
 * Port: YamlService
 *
 * Abstracts YAML parsing/serialization and nested-value operations
 * so the domain does not depend on a specific YAML library.
 *
 * Dependencies: entities only (none needed here).
 */

/** YAML parsing, serialization, and nested-value manipulation */
export interface YamlService {
  /** Parse a YAML string (frontmatter content without delimiters) into an object */
  parse(yaml: string): Record<string, unknown>;

  /** Serialize an object to a YAML string (without frontmatter delimiters) */
  stringify(obj: Record<string, unknown>): string;

  /**
   * Get a nested value from an object using dot notation.
   * e.g., "author.name" or "tags.0"
   */
  getNestedValue(obj: unknown, path: string): unknown;

  /**
   * Set a nested value in an object using dot notation.
   * Creates intermediate objects/arrays as needed.
   */
  setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void;

  /**
   * Delete a nested value from an object using dot notation.
   * Returns true if the value was found and deleted, false otherwise.
   */
  deleteNestedValue(obj: Record<string, unknown>, path: string): boolean;

  /**
   * Format a value for human-readable output.
   * Strings are returned as-is, numbers/booleans are stringified,
   * arrays/objects are serialized as YAML.
   */
  formatValue(value: unknown): string;
}
