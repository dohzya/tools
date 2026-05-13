/**
 * Palette entity — wraps a {@link Theme} with rendering functions.
 *
 * Callers compute `useColor` (TTY + NO_COLOR + FORCE_COLOR) at the CLI edge
 * and pass it here. When `useColor=false`, every function is the identity,
 * so formatters can call them blindly without branching on color support.
 *
 * Why this exists: `@std/fmt/colors` only checks `Deno.noColor` — it does NOT
 * auto-detect a piped stdout. Without our own gate, `wl | less` would emit
 * raw ANSI escapes.
 *
 * @module
 */

import { bold, rgb24 } from "@std/fmt/colors";
import type { Theme } from "./theme.ts";

/** Render functions for each {@link Theme} semantic role. */
export type Palette = {
  readonly statusDone: (s: string) => string;
  readonly statusStarted: (s: string) => string;
  readonly statusReady: (s: string) => string;
  readonly statusCreated: (s: string) => string;
  readonly statusCancelled: (s: string) => string;
  readonly id: (s: string) => string;
  readonly timestamp: (s: string) => string;
  readonly tag: (s: string) => string;
  readonly header: (s: string) => string;
  readonly heading: (s: string) => string;
};

/** Parse a `#rrggbb` hex string into a `{r, g, b}` triple for `rgb24`. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Skip the leading '#'; we control the inputs (theme constants), so no
  // validation is needed beyond what the type already implies.
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/**
 * Build a {@link Palette} from a {@link Theme}.
 *
 * @param useColor When `false`, returns identity functions (no ANSI).
 * @param theme    Source of hex values.
 */
export function createPalette(useColor: boolean, theme: Theme): Palette {
  if (!useColor) {
    const identity = (s: string): string => s;
    return {
      statusDone: identity,
      statusStarted: identity,
      statusReady: identity,
      statusCreated: identity,
      statusCancelled: identity,
      id: identity,
      timestamp: identity,
      tag: identity,
      header: identity,
      heading: identity,
    };
  }

  const wrap = (hex: string) => {
    const rgb = hexToRgb(hex);
    return (s: string) => rgb24(s, rgb);
  };

  const headingRgb = hexToRgb(theme.heading);
  return {
    statusDone: wrap(theme.statusDone),
    statusStarted: wrap(theme.statusStarted),
    statusReady: wrap(theme.statusReady),
    statusCreated: wrap(theme.statusCreated),
    statusCancelled: wrap(theme.statusCancelled),
    id: wrap(theme.id),
    timestamp: wrap(theme.timestamp),
    tag: wrap(theme.tag),
    header: wrap(theme.header),
    // The heading role is bold on top of rgb24; spec requires both.
    heading: (s: string) => bold(rgb24(s, headingRgb)),
  };
}
