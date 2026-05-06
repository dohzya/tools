/**
 * Adapter: DenoFileSystem
 *
 * Concrete FileSystem implementation backed by the Deno runtime.
 *
 * Dependencies: Deno built-ins, @std/fs (expandGlob), @std/path (dirname).
 */

import { expandGlob } from "@std/fs";
import { dirname } from "@std/path";
import type { FileSystem } from "../../domain/ports/filesystem.ts";

/** FileSystem implementation backed by the Deno runtime */
export class DenoFileSystem implements FileSystem {
  /** Read a file's entire contents as UTF-8 text */
  async readFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  /** Write UTF-8 text to a file, creating parent directories as needed */
  async writeFile(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(path, content);
  }

  /** Check whether a file exists at the given path */
  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return false;
      }
      throw err;
    }
  }

  /** Expand a glob pattern into matching file paths */
  async glob(pattern: string): Promise<string[]> {
    const paths: string[] = [];
    for await (const entry of expandGlob(pattern)) {
      if (entry.isFile) {
        paths.push(entry.path);
      }
    }
    return paths;
  }
}
