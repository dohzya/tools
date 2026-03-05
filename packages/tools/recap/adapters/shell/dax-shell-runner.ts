// DaxShellRunner adapter — executes shell commands via @david/dax

import $ from "@david/dax";
import type {
  ShellResult,
  ShellRunner,
} from "../../domain/ports/shell-runner.ts";

export class DaxShellRunner implements ShellRunner {
  async run(
    command: string,
    options?: {
      env?: Readonly<Record<string, string>>;
      cwd?: string;
    },
  ): Promise<ShellResult> {
    try {
      // Build command with dax — handles pipes, redirects, &&, || cross-platform
      let cmd = $.raw`${command}`.noThrow();

      if (options?.env) {
        // Spread into a plain mutable record — dax does not accept Readonly<>
        cmd = cmd.env({ ...options.env });
      }

      if (options?.cwd) {
        cmd = cmd.cwd(options.cwd);
      }

      const result = await cmd.stdout("piped").stderr("piped");

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code ?? 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        stdout: "",
        stderr: message,
        exitCode: 1,
      };
    }
  }
}
