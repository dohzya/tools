/**
 * Adapter: InMemoryFileSystem
 *
 * In-memory FileSystem implementation for testing.
 * All operations work on a Map<string, string> for files
 * and a Set<string> for directories.
 *
 * Dependencies: domain ports only.
 */

import type { FileSystem } from "../../domain/ports/filesystem.ts";
import { WtError } from "../../domain/entities/errors.ts";

export class InMemoryFileSystem implements FileSystem {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  // --- FileSystem interface ---

  readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Promise.reject(
        new WtError("io_error", `File not found: ${path}`),
      );
    }
    return Promise.resolve(content);
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.dirs.has(path));
  }

  ensureDir(path: string): Promise<void> {
    this.dirs.add(path);
    // Also add all parent directories
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join("/"));
    }
    return Promise.resolve();
  }

  async *readDir(path: string): AsyncIterable<string> {
    const prefix = path.endsWith("/") ? path : path + "/";
    const seen = new Set<string>();

    // Collect entries from files
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          yield name;
        }
      }
    }

    // Collect entries from dirs
    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix)) {
        const rest = dirPath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          yield name;
        }
      }
    }
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  // --- Test helpers ---

  /** Remove all files and directories from the in-memory store. */
  clear(): void {
    this.files.clear();
    this.dirs.clear();
  }

  /** Get a snapshot of all stored files. */
  getAll(): Map<string, string> {
    return new Map(this.files);
  }

  /** Set a file directly (convenience for test setup). */
  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  /** Get the number of stored files. */
  get size(): number {
    return this.files.size;
  }
}
