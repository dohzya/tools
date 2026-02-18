// Filesystem port - interface for file system operations

/**
 * Abstraction over file system operations.
 * Allows the domain to be tested without real filesystem access.
 */
export interface FileSystem {
  /** Read a file as text. Throws on not found. */
  readFile(path: string): Promise<string>;

  /** Write text content to a file. Creates parent directories if needed. */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if a file or directory exists. */
  exists(path: string): Promise<boolean>;

  /** Ensure a directory exists, creating it (and parents) if needed. */
  ensureDir(path: string): Promise<void>;

  /** List entries in a directory. Returns entry names. */
  readDir(path: string): AsyncIterable<string>;

  /** Remove a file. Does not throw if file doesn't exist. */
  remove(path: string): Promise<void>;
}
