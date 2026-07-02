/**
 * Use Case: TransformReference
 *
 * Converts an existing MRFI reference between formats (debug/base62/hangul)
 * without needing the source document — reproduces `md ref <ref>` (no
 * range argument) from the CLI.
 */

import { MdError } from "../entities/document.ts";
import type { MrfiFormat } from "../entities/mrfi.ts";
import { formatMrfi, parseMrfiReference } from "./mrfi-codec.ts";

/** Input for the TransformReference use case */
export interface TransformReferenceInput {
  /** The MRFI reference to convert */
  readonly ref: string;
  /** Output encoding to convert to */
  readonly format: MrfiFormat;
}

/** Converts a MRFI reference to a different output format */
export class TransformReferenceUseCase {
  /** Convert the reference to the requested format */
  async execute(input: TransformReferenceInput): Promise<string> {
    return await transformMrfiReference(input.ref, input.format, input.ref);
  }
}

async function transformMrfiReference(
  ref: string,
  format: MrfiFormat,
  file: string,
): Promise<string> {
  const parsed = await parseMrfiReference(ref);
  if (!parsed) {
    throw new MdError(
      "invalid_id",
      `Unsupported MRFI reference for conversion: ${ref}`,
      file,
      ref,
    );
  }

  return await formatMrfi(parsed, format);
}
