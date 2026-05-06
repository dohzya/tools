/**
 * Adapter: YamlParserService
 *
 * Concrete YamlService implementation using @std/yaml.
 *
 * All logic is copied exactly from the original yaml.ts:
 *   - parseFrontmatter  -> parse()
 *   - stringifyFrontmatter -> stringify()
 *   - getNestedValue, setNestedValue, deleteNestedValue, formatValue
 *
 * Dependencies: @std/yaml.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { YamlService } from "../../domain/ports/yaml-service.ts";
import { ExplicitCast } from "../../../explicit-cast.ts";

/** YamlService implementation using @std/yaml */
export class YamlParserService implements YamlService {
  /** Parse a YAML string into a plain object */
  parse(yaml: string): Record<string, unknown> {
    if (!yaml.trim()) {
      return {};
    }
    try {
      const result = parseYaml(yaml);
      return ExplicitCast.from<unknown>(result).dangerousCast<
        Record<string, unknown>
      >() ?? {};
    } catch {
      return {};
    }
  }

  /** Serialize a plain object to a YAML string */
  stringify(obj: Record<string, unknown>): string {
    if (Object.keys(obj).length === 0) {
      return "";
    }
    return stringifyYaml(obj, { lineWidth: -1 }).trim();
  }

  /** Retrieve a nested value using dot-notation path */
  getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === "object") {
        current = ExplicitCast.from<object>(current).downcast<
          Record<string, unknown>
        >()[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /** Set a nested value using dot-notation path, creating intermediates */
  setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPart = parts[i + 1];
      const isNextIndex = /^\d+$/.test(nextPart);

      if (
        !(part in current) || current[part] === null ||
        typeof current[part] !== "object"
      ) {
        current[part] = isNextIndex ? [] : {};
      }
      current = ExplicitCast.from<unknown>(current[part]).dangerousCast<
        Record<string, unknown>
      >();
    }

    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
  }

  /** Delete a nested value using dot-notation path, returning true if found */
  deleteNestedValue(obj: Record<string, unknown>, path: string): boolean {
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (
        !(part in current) || current[part] === null ||
        typeof current[part] !== "object"
      ) {
        return false;
      }
      current = ExplicitCast.from<unknown>(current[part]).dangerousCast<
        Record<string, unknown>
      >();
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart in current) {
      delete current[lastPart];
      return true;
    }
    return false;
  }

  /** Format a value for human-readable display */
  formatValue(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    // For arrays and objects, return YAML
    return stringifyYaml(value, { lineWidth: -1 }).trim();
  }
}
