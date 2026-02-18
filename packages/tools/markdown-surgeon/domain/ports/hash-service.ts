/**
 * Port: HashService
 *
 * Abstracts section ID hashing so the domain does not depend
 * on a specific crypto implementation.
 *
 * Dependencies: entities only (none needed here).
 */

/** Hashing service for generating deterministic section identifiers */
export interface HashService {
  /**
   * Generate a deterministic 8-character hex hash for a section.
   *
   * @param level - Header level (1-6)
   * @param title - Header title text
   * @param occurrenceIndex - Zero-based index for duplicate (level, title) pairs
   * @returns 8-character lowercase hex string
   */
  hash(level: number, title: string, occurrenceIndex: number): Promise<string>;
}
