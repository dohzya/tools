/**
 * Adapter: DenoFileSystem
 *
 * Concrete FileSystem implementation backed by the Deno runtime.
 * Wraps standard Deno file operations with error handling matching
 * the original cli.ts behavior.
 *
 * Dependencies: Deno built-ins, @std/fs (ensureDir).
 */

import { ensureDir } from "@std/fs";
import type { FileSystem } from "../../domain/ports/filesystem.ts";
import { WtError } from "../../domain/entities/errors.ts";

export class DenoFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    try {
      return await Deno.readTextFile(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new WtError("io_error", `File not found: ${path}`);
      }
      throw new WtError("io_error", `Failed to read file: ${path}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await Deno.writeTextFile(path, content);
    } catch {
      throw new WtError("io_error", `Failed to write file: ${path}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return false;
      }
      throw e;
    }
  }

  async ensureDir(path: string): Promise<void> {
    await ensureDir(path);
  }

  async *readDir(path: string): AsyncIterable<string> {
    for await (const entry of Deno.readDir(path)) {
      yield entry.name;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await Deno.remove(path, { recursive: true });
    } catch {
      // Ignore if file doesn't exist - matches original deleteFile behavior
    }
  }
}
