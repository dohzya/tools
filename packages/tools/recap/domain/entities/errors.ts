// Error types for recap domain

/** Machine-readable error code identifying the kind of recap failure. */
export type RecapErrorCode =
  | "config_not_found"
  | "config_parse_error"
  | "config_validation_error"
  | "ref_not_found"
  | "section_execution_error"
  | "io_error"
  | "invalid_args";

/** Typed error carrying a machine-readable code for recap failures. */
export class RecapError extends Error {
  /** Create a RecapError with the given error code and human-readable message. */
  constructor(
    public readonly code: RecapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecapError";
  }

  /** Serialize to a plain object suitable for JSON output. */
  toJSON(): { error: string; code: RecapErrorCode; message: string } {
    return {
      error: this.code,
      code: this.code,
      message: this.message,
    };
  }
}
