// Environment port — interface for process environment access

export interface Environment {
  /** Get an environment variable value. Returns undefined if not set. */
  getEnv(name: string): string | undefined;

  /** Whether stdout is a terminal (TTY). */
  isTerminal(): boolean;

  /** Current working directory. */
  cwd(): string;

  /** Home directory. */
  home(): string | undefined;

  /** Load a dotenv file and return its key-value pairs. Returns empty record if file not found. */
  loadDotenv(path: string): Promise<Readonly<Record<string, string>>>;
}
