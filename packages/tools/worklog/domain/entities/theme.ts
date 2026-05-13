/**
 * Theme entity — semantic color tokens for CLI output.
 *
 * Themes use semantic role names (e.g. `statusDone`, `header`) rather than
 * color names so renderers depend on intent, not specific hues. This lets us
 * swap themes (Latte / Mocha / user-defined) without touching formatters.
 *
 * @module
 */

/** Semantic color tokens, as hex strings (e.g. `#40a02b`). */
export type Theme = {
  /** Color for the `done` status. */
  readonly statusDone: string;
  /** Color for the `started` status. */
  readonly statusStarted: string;
  /** Color for the `ready` status. */
  readonly statusReady: string;
  /** Color for the `created` status. */
  readonly statusCreated: string;
  /** Color for the `cancelled` status. */
  readonly statusCancelled: string;
  /** Color for short task IDs. */
  readonly id: string;
  /** Color for dates and times. */
  readonly timestamp: string;
  /** Color for tag-like tokens (`#recap`, `[lib]`). */
  readonly tag: string;
  /** Color for field labels (`task:`, `desc:`, `traces:`, etc.). */
  readonly header: string;
  /** Color for section titles (rendered bold). */
  readonly heading: string;
};

/**
 * Catppuccin Latte palette (light variant).
 *
 * Hex values follow the official Catppuccin spec (catppuccin.com/palette/latte).
 */
export const catppuccinLatte: Theme = {
  statusDone: "#40a02b", // green
  statusStarted: "#df8e1d", // yellow
  statusReady: "#179299", // teal
  statusCreated: "#1e66f5", // blue
  statusCancelled: "#8c8fa1", // overlay1 (dim grey)
  id: "#8c8fa1", // overlay1
  timestamp: "#6c6f85", // subtext0
  tag: "#8839ef", // mauve
  header: "#209fb5", // sapphire
  heading: "#1e66f5", // blue (rendered bold by the palette)
};
