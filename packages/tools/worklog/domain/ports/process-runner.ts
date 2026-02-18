// Process runner port - interface for spawning external processes

/**
 * Options for running an external process.
 */
export type ProcessOptions = {
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
};

/**
 * Result of running an external process.
 */
export type ProcessResult = {
  readonly exitCode: number;
};

/**
 * Service for running external processes (used by run/claude commands).
 */
export interface ProcessRunner {
  /** Run a command with the given arguments and options. */
  run(cmd: readonly string[], options?: ProcessOptions): Promise<ProcessResult>;
}
