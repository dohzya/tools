import { z } from "zod/mini";
import {
  initSync,
  scanReviewItems as scanReviewItemsJson,
} from "../wasm/critique_wasm.js";
import wasmBytes from "../wasm/critique_wasm_bg.wasm";

const scannedItemsSchema = z.array(z.object({
  id: z.string(),
  kind: z.string(),
  state: z.string(),
  start: z.number(),
  end: z.number(),
  lineStart: z.number(),
  lineEnd: z.number(),
  timestamp: z.optional(z.string()),
}));

export type ScannedReviewItem = z.infer<typeof scannedItemsSchema>[number];

let initialized = false;

// Instantiated on first use rather than at load, so activation does not pay
// for compiling the module until a feature actually calls into it.
function ensureInitialized(): void {
  if (!initialized) {
    initSync({ module: wasmBytes });
    initialized = true;
  }
}

/** Review items of `text` (as the file `file`), offsets in UTF-16 units. */
export function scanReviewItems(
  file: string,
  text: string,
): ScannedReviewItem[] {
  ensureInitialized();
  return scannedItemsSchema.parse(JSON.parse(scanReviewItemsJson(file, text)));
}
