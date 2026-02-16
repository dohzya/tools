/**
 * Adapter: Blake3HashService
 *
 * Concrete HashService implementation using the Web Crypto API (SHA-256).
 *
 * The algorithm is copied exactly from the original hash.ts:
 *   1. Build input string: `${level}:${title.toLowerCase().trim()}:${occurrenceIndex}`
 *   2. SHA-256 digest via crypto.subtle
 *   3. Return first 8 hex characters
 *
 * NOTE: Despite the file name (kept for historical reasons), this uses
 * SHA-256, not BLAKE3 -- matching the original implementation exactly.
 *
 * Dependencies: Web Crypto API (available in Deno and modern browsers).
 */

import type { HashService } from "../../domain/ports/hash-service.ts";

export class Blake3HashService implements HashService {
  async hash(
    level: number,
    title: string,
    occurrenceIndex: number,
  ): Promise<string> {
    const input = `${level}:${title.toLowerCase().trim()}:${occurrenceIndex}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex.slice(0, 8);
  }
}
