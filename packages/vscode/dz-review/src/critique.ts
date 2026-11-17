import { z } from "zod/mini";
import {
  initSync,
  reviewItems as reviewItemsJson,
} from "../wasm/critique_wasm.js";
import wasmBytes from "../wasm/critique_wasm_bg.wasm";

const reviewItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    shortId: z.string(),
    kind: z.string(),
    state: z.string(),
    start: z.number(),
    end: z.number(),
    lineStart: z.number(),
    lineEnd: z.number(),
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
): ReviewItems {
  ensureInitialized();
  return reviewItemsSchema.parse(
    JSON.parse(reviewItemsJson(file, text, mapJson)),
  );
}
