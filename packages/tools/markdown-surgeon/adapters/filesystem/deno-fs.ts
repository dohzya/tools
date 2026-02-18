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

export class DenoFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(path, content);
  }

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
