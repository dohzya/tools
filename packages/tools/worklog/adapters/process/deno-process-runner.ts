/**
 * Adapter: DenoProcessRunner
 *
 * Concrete ProcessRunner implementation using Deno.Command.
 * Used by run/claude commands to execute subprocesses.
 *
 * Matches the original cli.ts behavior:
 *   - cmdRun: Deno.Command with stdin/stdout/stderr inherited
 *   - cmdClaude: Deno.Command with args and env
 *
 * Dependencies: Deno.Command.
 */

import type {
  ProcessOptions,
  ProcessResult,
  ProcessRunner,
} from "../../domain/ports/process-runner.ts";

export class DenoProcessRunner implements ProcessRunner {
  async run(
    cmd: readonly string[],
    options?: ProcessOptions,
  ): Promise<ProcessResult> {
    const [executable, ...args] = cmd;

    const command = new Deno.Command(executable, {
      args,
      env: options?.env
        ? { ...Deno.env.toObject(), ...options.env }
        : undefined,
      cwd: options?.cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const { code } = await command.output();

    return { exitCode: code };
  }
}
