/**
 * Persistent review item ids: an id is minted once and stored durably in
 * `.dz-review/reference-map.json`, mapping `id -> { file, range, mrfi }`.
 *
 * This replaces stable-review-id.ts's pure recompute-from-content scheme
 * for callers that need an id to stay stable across edits to an
 * annotation's own text: today's scheme rehashes `file + kind + anchor`
 * from scratch every time, so any edit to the anchor text (a typo fix, or
 * any edit at all for an untimestamped annotation) silently produces a
 * different id.
 *
 * `assignPersistentReviewItemIds` looks up (or mints) an id per item in
 * three passes, cheapest first:
 *
 * 1. Fast path: does an existing mapping entry for this file have the
 *    exact same `{lineStart, lineEnd}` as the item? If so, it's the same
 *    item -- adopt its id without resolving anything. This is a plain
 *    dictionary lookup, not a content-hash comparison: persisted entries
 *    don't carry the original raw anchor text (only `{file, range,
 *    mrfi}`), so there is no key to recompute and compare against. Range
 *    equality is the cheapest signal that is still sound: unless lines
 *    were inserted/removed above the item, its range does not move.
 * 2. Fallback: for mapping entries scoped to this file that didn't
 *    fast-match, resolve their stored `mrfi` against the current document
 *    (ranking candidates through RankReferenceCandidatesUseCase first,
 *    which here degrades to the candidates' stored order -- `item.raw` is
 *    free witness text, not an MRFI reference, so it never parses as a
 *    `rank(target, candidates)` target) and adopt the first
 *    `exact`/`confident` resolution whose range overlaps the item's
 *    current lines. The adopted entry's `{range, mrfi}` is regenerated for
 *    the resolved range and stored in place.
 * 3. New: mint a fresh id (reusing stable-review-id.ts's hash+encode
 *    pipeline as the id's seed value only -- once minted, this id is
 *    opaque and never recomputed for comparison again) and record a new
 *    mapping entry.
 *
 * Wired into agent-core.ts/cli.ts's four id-assignment call sites
 * (collectAgentReviewState, collectLocatedReviewItems,
 * collectAgentGuardrailFailures, targetReviewIdExists); stable-review-id.ts
 * and ref-core.ts remain in place and untouched.
 */

import { z } from "@zod/zod/mini";
import * as fs from "node:fs";
import * as path from "node:path";
import { Blake3HashService } from "../markdown-surgeon/adapters/services/blake3-hash.ts";
import { ParseDocumentUseCase } from "../markdown-surgeon/domain/use-cases/parse-document.ts";
import { RankReferenceCandidatesUseCase } from "../markdown-surgeon/domain/use-cases/rank-reference-candidates.ts";
import { MrfiAdapter } from "./adapters/markdown/mrfi-adapter.ts";
import type {
  Document,
  MrfiFormat,
  MrfiProfile,
  ReferenceLocatorService,
  SourceRange,
} from "./domain/ports/reference-locator.ts";
import { getDzReviewReferenceMapFile } from "./runtime-config.ts";
import {
  assignStableReviewItemIds,
  type StableReviewItemInput,
} from "./stable-review-id.ts";

export const REFERENCE_MAP_VERSION = 1;

/** A durable line-range locator for one previously assigned review item id */
export interface ReferenceMapEntry {
  readonly file: string;
  readonly range: { readonly startLine: number; readonly endLine: number };
  readonly mrfi: string;
}

/** The persisted `.dz-review/reference-map.json` shape: id -> locator entry */
export interface ReferenceMap {
  readonly version: number;
  readonly entries: Readonly<Record<string, ReferenceMapEntry>>;
}

const ReferenceMapEntrySchema = z.object({
  file: z.string(),
  range: z.object({
    startLine: z.number(),
    endLine: z.number(),
  }),
  mrfi: z.string(),
});

const ReferenceMapSchema = z.object({
  version: z.number(),
  entries: z.record(z.string(), ReferenceMapEntrySchema),
});

/** Read the reference map, treating a missing file as an empty map */
export function readReferenceMap(): ReferenceMap {
  const file = getDzReviewReferenceMapFile();
  if (!fs.existsSync(file)) {
    return { version: REFERENCE_MAP_VERSION, entries: {} };
  }

  return ReferenceMapSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Write the reference map, creating `.dz-review/` if needed */
export function writeReferenceMap(map: ReferenceMap): void {
  const file = getDzReviewReferenceMapFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

/** Input shape for a persistent review item id assignment */
export interface PersistentReviewItemInput extends StableReviewItemInput {
  readonly lineStart: number;
  readonly lineEnd: number;
}

/** An item paired with its persistently assigned id */
export interface PersistentReviewItem<T extends PersistentReviewItemInput> {
  readonly id: string;
  readonly item: T;
}

export interface AssignPersistentReviewItemIdsOptions {
  /** Overrides the default MrfiAdapter -- mainly for tests */
  readonly locator?: ReferenceLocatorService;
  /** Output encoding for newly generated/refreshed references */
  readonly format?: MrfiFormat;
  /** Field verbosity profile for newly generated/refreshed references */
  readonly profile?: MrfiProfile;
}

const defaultLocator = new MrfiAdapter();
const parseDocumentUseCase = new ParseDocumentUseCase(new Blake3HashService());
const rankReferenceCandidatesUseCase = new RankReferenceCandidatesUseCase();

const DEFAULT_FORMAT: MrfiFormat = "debug";
const DEFAULT_PROFILE: MrfiProfile = "default";

/**
 * Assign a persistent id to each item, reading and updating
 * `.dz-review/reference-map.json` as needed. All items must belong to
 * `file`; `content` is the file's current full text (parsed once and
 * reused across all fallback/new resolutions in this call).
 */
export async function assignPersistentReviewItemIds<
  T extends PersistentReviewItemInput,
>(
  file: string,
  content: string,
  items: readonly T[],
  options: AssignPersistentReviewItemIdsOptions = {},
): Promise<PersistentReviewItem<T>[]> {
  if (items.length === 0) {
    return [];
  }

  const locator = options.locator ?? defaultLocator;
  const format = options.format ?? DEFAULT_FORMAT;
  const profile = options.profile ?? DEFAULT_PROFILE;
  const normalizedFile = normalizeReferenceMapFile(file);

  const map = readReferenceMap();
  const entries: Record<string, ReferenceMapEntry> = { ...map.entries };
  const entryIdsForFile = Object.keys(entries).filter((id) =>
    normalizeReferenceMapFile(entries[id].file) === normalizedFile
  );

  const results: (PersistentReviewItem<T> | undefined)[] = new Array(
    items.length,
  ).fill(undefined);
  const consumedIds = new Set<string>();

  // Pass 1: fast path -- exact {lineStart, lineEnd} match against a
  // stored entry's range. See module doc comment for why this replaces a
  // content-hash lookup.
  for (const [index, item] of items.entries()) {
    const matchId = entryIdsForFile.find((id) =>
      !consumedIds.has(id) &&
      entries[id].range.startLine === item.lineStart &&
      entries[id].range.endLine === item.lineEnd
    );
    if (matchId !== undefined) {
      consumedIds.add(matchId);
      results[index] = { id: matchId, item };
    }
  }

  const unresolvedIndexes = items
    .map((_, index) => index)
    .filter((index) => results[index] === undefined);

  if (unresolvedIndexes.length === 0) {
    // Everything fast-matched: no document parsing, no port calls, no
    // rewrite of an unchanged mapping file.
    return finalizeResults(results);
  }

  const doc = await parseDocumentUseCase.execute({ content });

  // Pass 2: fallback -- resolve remaining stored entries for this file
  // against the current document; adopt the first exact/confident
  // resolution whose range overlaps the item's current lines, then
  // refresh that entry in place.
  for (const index of unresolvedIndexes) {
    const item = items[index];
    const candidateIds = entryIdsForFile.filter((id) => !consumedIds.has(id));
    if (candidateIds.length === 0) {
      continue;
    }

    const candidateIdByMrfi = new Map(
      candidateIds.map((id) => [entries[id].mrfi, id]),
    );
    // `item.raw` is free witness text, not an MRFI reference: it never
    // parses as a target, so every candidate compares as `invalid` and the
    // ranking degrades to the candidates' original (stable) order -- same
    // behavior as the identity-stub this replaced. Ranking pays off once a
    // caller has an actual target reference to compare against, per
    // docs/specs/mrfi.md's `rank(target, candidates)`.
    const ranked = await rankReferenceCandidatesUseCase.execute({
      target: item.raw,
      candidates: candidateIds.map((id) => entries[id].mrfi),
    });

    for (const { ref: mrfi } of ranked) {
      const id = candidateIdByMrfi.get(mrfi);
      if (id === undefined || consumedIds.has(id)) {
        continue;
      }

      const resolved = await locator.resolveReference(doc, mrfi);
      if (
        (resolved.status !== "exact" && resolved.status !== "confident") ||
        resolved.range === undefined
      ) {
        continue;
      }

      const resolvedRange = parseResolvedLineRange(resolved.range);
      if (!rangesOverlap(resolvedRange, item)) {
        continue;
      }

      consumedIds.add(id);
      results[index] = { id, item };

      // Regenerate directly from the range we already resolved above,
      // instead of calling refreshReference (which would resolve again
      // internally) -- avoids a redundant second resolution pass.
      const refreshedMrfi = await locator.generateReference(
        doc,
        fullLineSourceRange(
          doc,
          resolvedRange.startLine,
          resolvedRange.endLine,
        ),
        { format, profile, quote: false, quoteMax: 80 },
      );
      entries[id] = {
        file: normalizedFile,
        range: resolvedRange,
        mrfi: refreshedMrfi,
      };
      break;
    }
  }

  // Pass 3: mint fresh ids for anything still unresolved, in one batch so
  // stable-review-id.ts's own same-key disambiguation (occurrence suffix
  // for items sharing file+kind+anchor) still applies across items minted
  // together in this call.
  const stillUnresolvedIndexes = unresolvedIndexes.filter((index) =>
    results[index] === undefined
  );
  if (stillUnresolvedIndexes.length > 0) {
    const newItems = stillUnresolvedIndexes.map((index) => items[index]);
    const seeded = assignStableReviewItemIds(file, newItems);

    for (const [position, index] of stillUnresolvedIndexes.entries()) {
      const item = items[index];
      const id = seeded[position].id;
      const range = { startLine: item.lineStart, endLine: item.lineEnd };
      const mrfi = await locator.generateReference(
        doc,
        fullLineSourceRange(doc, item.lineStart, item.lineEnd),
        { format, profile, quote: false, quoteMax: 80 },
      );

      results[index] = { id, item };
      entries[id] = { file: normalizedFile, range, mrfi };
    }
  }

  writeReferenceMap({ version: map.version, entries });
  return finalizeResults(results);
}

function finalizeResults<T extends PersistentReviewItemInput>(
  results: readonly (PersistentReviewItem<T> | undefined)[],
): PersistentReviewItem<T>[] {
  return results.map((result) => {
    if (result === undefined) {
      throw new Error(
        "internal error: assignPersistentReviewItemIds left an item unresolved",
      );
    }
    return result;
  });
}

/**
 * ResolveResult.range carries full `startLine:startCol-endLine:endCol`
 * precision (docs/specs/mrfi.md's Output Model); this consumer only needs
 * the line boundaries, so the columns are parsed and discarded.
 */
function parseResolvedLineRange(
  range: string,
): { startLine: number; endLine: number } {
  const match = range.match(/^(\d+):\d+-(\d+):\d+$/);
  if (!match) {
    throw new Error(`Unexpected resolved range format: ${range}`);
  }
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  return { startLine, endLine };
}

function fullLineSourceRange(
  doc: Document,
  startLine: number,
  endLine: number,
): SourceRange {
  return {
    startLine,
    startColumn: 1,
    endLine,
    endColumn: (doc.lines[endLine - 1]?.length ?? 0) + 1,
  };
}

function rangesOverlap(
  a: { startLine: number; endLine: number },
  b: { lineStart: number; lineEnd: number },
): boolean {
  return a.startLine <= b.lineEnd && a.endLine >= b.lineStart;
}

function normalizeReferenceMapFile(file: string): string {
  return file.replace(/\\/g, "/");
}
