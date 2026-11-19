import { z } from "zod/mini";
import {
  convertTimestamps as convertTimestampsWasm,
  encodeTimestamp as encodeTimestampWasm,
  initSync,
  parseTimestamp as parseTimestampJson,
  reviewItems as reviewItemsJson,
  stateDir as stateDirWasm,
} from "../wasm/critique_wasm.js";
import wasmBytes from "../wasm/critique_wasm_bg.wasm";

const reviewItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    shortId: z.string(),
    kind: z.enum([
      "addition",
      "deletion",
      "substitution",
      "highlight",
      "comment",
      "discussion",
      "conversation",
    ]),
    state: z.enum([
      "open",
      "wip",
      "handled",
      "resolved",
      "annotation",
      "discussion",
    ]),
    start: z.number(),
    end: z.number(),
    lineStart: z.number(),
    lineEnd: z.number(),
    summary: z.string(),
    timestamp: z.optional(z.string()),
    messages: z.optional(z.array(z.object({
      author: z.string(),
      body: z.string(),
      timestamp: z.optional(z.string()),
    }))),
  })),
  map: z.nullable(z.string()),
});

export type ReviewItems = z.infer<typeof reviewItemsSchema>;
export type ReviewItem = ReviewItems["items"][number];

/**
 * How `summary` is rendered: `display` shows the block as written, `payload`
 * what it is about (inserted text, comment, `old -> new`...); both are cut at
 * `width` UTF-16 units.
 */
export interface SummaryOptions {
  source: "display" | "payload";
  width: number;
}

let initialized = false;

// Instantiated on first use rather than at load, so activation does not pay
// for compiling the module until a feature actually calls into it.
function ensureInitialized(): void {
  if (!initialized) {
    initSync({ module: wasmBytes });
    initialized = true;
  }
}

/**
 * Review items of `text` (as the file `file`) with persistent ids, offsets in
 * UTF-16 units. `mapJson` is the current `reference-map.json` content (`null`
 * for none); `map` is the content to write back, `null` when unchanged.
 */
export function reviewItems(
  file: string,
  text: string,
  mapJson: string | null,
  summary: SummaryOptions,
): ReviewItems {
  ensureInitialized();
  return reviewItemsSchema.parse(
    JSON.parse(
      reviewItemsJson(file, text, mapJson, summary.source, summary.width),
    ),
  );
}

/**
 * State directory: the first non-blank `configured` value by priority, else
 * `.critique` under `base` (the Git root, else the cwd), as the CLI does.
 */
export function stateDir(base: string, configured: string[]): string {
  ensureInitialized();
  return stateDirWasm(base, configured);
}

const reviewTimestampSchema = z.object({
  unixSeconds: z.number(),
  offsetMinutes: z.number(),
});

/** An instant with the UTC offset (minutes east) it was written in. */
export type ReviewTimestamp = z.infer<typeof reviewTimestampSchema>;

export type TimestampFormat = "compact" | "hangul" | "iso";

/**
 * Instant of a review timestamp in any format (optional leading `%`),
 * `undefined` when unreadable.
 */
export function parseTimestamp(value: string): ReviewTimestamp | undefined {
  ensureInitialized();
  const json = parseTimestampJson(value);
  return json === undefined
    ? undefined
    : reviewTimestampSchema.parse(JSON.parse(json));
}

/**
 * `timestamp` rendered in `format` (`iso` is the display form). Throws when
 * the value is out of the format's range.
 */
export function encodeTimestamp(
  timestamp: ReviewTimestamp,
  format: TimestampFormat,
): string {
  ensureInitialized();
  return encodeTimestampWasm(
    timestamp.unixSeconds,
    timestamp.offsetMinutes,
    format,
  );
}

/**
 * `text` with its existing review timestamps (`@marker%ts`, `{++%ts|`)
 * rewritten in `format`; nothing is stamped. Throws when a value is out of the
 * format's range.
 */
export function convertTimestamps(
  text: string,
  format: TimestampFormat,
): string {
  ensureInitialized();
  return convertTimestampsWasm(text, format);
}
