// ConfigResolver port — interface for loading and resolving config files

import type { RawConfig } from "../entities/config.ts";

export interface ConfigResolver {
  /**
   * Load and parse a YAML config file.
   * Returns null if the file does not exist.
   * Throws RecapError on parse/validation error.
   */
  loadConfig(path: string): Promise<RawConfig | null>;
}
