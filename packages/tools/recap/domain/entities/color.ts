// Color palette — wraps @std/fmt/colors with on/off switch

import { bold, cyan, dim, green, red } from "@std/fmt/colors";

export type Palette = {
  /** Section title color */
  readonly title: (s: string) => string;
  /** Section separator line */
  readonly separator: (s: string) => string;
  /** Error text color */
  readonly error: (s: string) => string;
  /** Bold text */
  readonly bold: (s: string) => string;
  /** Dimmed text (e.g. timestamps) */
  readonly dim: (s: string) => string;
  /** Success / normal output */
  readonly normal: (s: string) => string;
};

/** Returns a palette with ANSI colors. When useColor=false, all functions are identity. */
export function createPalette(useColor: boolean): Palette {
  if (!useColor) {
    const identity = (s: string): string => s;
    return {
      title: identity,
      separator: identity,
      error: identity,
      bold: identity,
      dim: identity,
      normal: identity,
    };
  }

  return {
    title: (s: string) => bold(cyan(s)),
    separator: (s: string) => dim(s),
    error: (s: string) => red(s),
    bold: (s: string) => bold(s),
    dim: (s: string) => dim(s),
    normal: (s: string) => green(s),
  };
}
