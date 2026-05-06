// ShellRunner port — interface for executing shell commands

/** Output of a shell command execution. */
export type ShellResult = {
  /** Standard output text. */
  readonly stdout: string;
  /** Standard error text. */
  readonly stderr: string;
  /** Process exit code. */
  readonly exitCode: number;
};

/** Port for executing shell commands. */
export interface ShellRunner {
  /**
   * Execute a shell command and return its output.
   * Does NOT throw on non-zero exit code.
   */
  run(
    command: string,
    options?: {
      env?: Readonly<Record<string, string>>;
      cwd?: string;
    },
  ): Promise<ShellResult>;
}
