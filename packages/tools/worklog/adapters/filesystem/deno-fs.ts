/**
 * Adapter: DenoFileSystem
 *
 * Concrete FileSystem implementation backed by the Deno runtime.
 * Wraps standard Deno file operations with error handling matching
 * the original cli.ts behavior.
 *
 * Dependencies: Deno built-ins, node:fs/promises (mkdir).
 */

import { mkdir } from "node:fs/promises";
import type { FileSystem } from "../../domain/ports/filesystem.ts";
import { WtError } from "../../domain/entities/errors.ts";

export class DenoFileSystem implements FileSystem {
  private readonly lockRetryMs = 25;
  private readonly lockTimeoutMs = 10_000;

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
    await mkdir(path, { recursive: true });
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

  async withFileLock<T>(
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const deadline = Date.now() + this.lockTimeoutMs;
    let lockFile: Deno.FsFile;
    while (true) {
      try {
        lockFile = await Deno.open(path, { createNew: true, write: true });
        await lockFile.write(
          new TextEncoder().encode(`${Deno.pid} ${new Date().toISOString()}\n`),
        );
        break;
      } catch (e) {
        if (e instanceof Deno.errors.AlreadyExists) {
          if (Date.now() >= deadline) {
            throw new WtError(
              "io_error",
              `Timed out waiting for lock: ${path}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs));
          continue;
        }
        throw new WtError("io_error", `Failed to lock file: ${path}`);
      }
    }

    try {
      return await operation();
    } finally {
      lockFile.close();
      await Deno.remove(path).catch(() => {});
    }
  }
}
