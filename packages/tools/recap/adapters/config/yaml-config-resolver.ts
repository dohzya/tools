// YamlConfigResolver adapter — loads and validates YAML config files

import { parse as parseYaml } from "@std/yaml";
import { parseRawConfig } from "../../domain/entities/config-schema.ts";
import type { RawConfig } from "../../domain/entities/config.ts";
import type { ConfigResolver } from "../../domain/ports/config-resolver.ts";
import { RecapError } from "../../domain/entities/errors.ts";

export class YamlConfigResolver implements ConfigResolver {
  async loadConfig(path: string): Promise<RawConfig | null> {
    let content: string;
    try {
      content = await Deno.readTextFile(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return null;
      }
      throw new RecapError("io_error", `Failed to read config: ${path}`);
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new RecapError(
        "config_parse_error",
        `Invalid YAML in ${path}: ${msg}`,
      );
    }

    // null YAML file (empty file) is treated as empty config
    if (parsed === null || parsed === undefined) {
      return { sections: [] };
    }

    try {
      return parseRawConfig(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new RecapError(
        "config_validation_error",
        `Config validation error in ${path}: ${msg}`,
      );
    }
  }
}
