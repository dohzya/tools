/**
 * Port: FileSystem
 *
 * Abstracts file system operations so the domain does not depend
 * on Deno, Node, or any concrete runtime.
 *
 * Dependencies: entities only (none needed here).
 */

/** File system abstraction for reading, writing, and discovering files */
export interface FileSystem {
  /** Read the entire contents of a file as UTF-8 text */
  readFile(path: string): Promise<string>;

  /** Write UTF-8 text content to a file (creates or overwrites) */
  writeFile(path: string, content: string): Promise<void>;

  /** Check whether a file exists at the given path */
  exists(path: string): Promise<boolean>;

  /** Expand a glob pattern into a list of matching file paths */
  glob(pattern: string): Promise<string[]>;
}
