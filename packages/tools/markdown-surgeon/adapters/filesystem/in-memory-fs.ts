/**
 * Adapter: InMemoryFileSystem
 *
 * In-memory FileSystem implementation for testing.
 * All operations work on a Map<string, string>.
 *
 * Dependencies: domain ports only.
 */

import type { FileSystem } from "../../domain/ports/filesystem.ts";

export class InMemoryFileSystem implements FileSystem {
  private files = new Map<string, string>();

  // --- FileSystem interface ---

  readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Promise.reject(new Error(`ENOENT: file not found: ${path}`));
    }
    return Promise.resolve(content);
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  glob(pattern: string): Promise<string[]> {
    // Simple glob: convert pattern to a regex.
    // Supports basic *, **, and ? wildcards.
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex meta-chars (except * and ?)
      .replace(/\*\*/g, "\0GLOBSTAR\0") // placeholder for **
      .replace(/\*/g, "[^/]*") // * matches anything except /
      .replace(/\?/g, "[^/]") // ? matches single char except /
      .replace(/\0GLOBSTAR\0/g, ".*"); // ** matches anything including /

    const regex = new RegExp(`^${regexStr}$`);
    const matches = [...this.files.keys()].filter((p) => regex.test(p));
    return Promise.resolve(matches.sort());
  }

  // --- Test helpers ---

  /** Remove all files from the in-memory store */
  clear(): void {
    this.files.clear();
  }

  /** Get a snapshot of all stored files */
  getAll(): Map<string, string> {
    return new Map(this.files);
  }

  /** Set a file directly (convenience for test setup) */
  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  /** Get the number of stored files */
  get size(): number {
    return this.files.size;
  }
}
