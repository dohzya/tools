/**
 * Backward-compatible shim for hash.ts.
 * Delegates to Blake3HashService adapter.
 */

import { Blake3HashService } from "./adapters/services/blake3-hash.ts";

const _hashService = new Blake3HashService();

/** Generate a short hash (8 hex chars) for a section identifier */
export async function sectionHash(
  level: number,
  title: string,
  occurrenceIndex: number,
): Promise<string> {
  return await _hashService.hash(level, title, occurrenceIndex);
}

/** Check if a string looks like a valid section ID (8 hex chars) */
export function isValidId(id: string): boolean {
  return /^[0-9a-f]{8}$/i.test(id);
}
