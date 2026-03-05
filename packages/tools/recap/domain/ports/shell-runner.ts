// ShellRunner port — interface for executing shell commands

export type ShellResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

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
