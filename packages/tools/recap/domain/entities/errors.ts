// Error types for recap domain

export type RecapErrorCode =
  | "config_not_found"
  | "config_parse_error"
  | "config_validation_error"
  | "ref_not_found"
  | "section_execution_error"
  | "io_error"
  | "invalid_args";

export class RecapError extends Error {
  constructor(
    public readonly code: RecapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecapError";
  }

  toJSON(): { error: string; code: RecapErrorCode; message: string } {
    return {
      error: this.code,
      code: this.code,
      message: this.message,
    };
  }
}
