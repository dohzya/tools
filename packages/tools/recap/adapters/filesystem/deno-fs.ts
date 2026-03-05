// DenoFileSystem adapter — concrete FileSystem backed by Deno runtime

import { ensureDir } from "@std/fs";
import type { FileSystem } from "../../domain/ports/filesystem.ts";
import { RecapError } from "../../domain/entities/errors.ts";

export class DenoFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    try {
      return await Deno.readTextFile(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new RecapError("io_error", `File not found: ${path}`);
      }
      throw new RecapError("io_error", `Failed to read file: ${path}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await Deno.writeTextFile(path, content);
    } catch {
      throw new RecapError("io_error", `Failed to write file: ${path}`);
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
}
