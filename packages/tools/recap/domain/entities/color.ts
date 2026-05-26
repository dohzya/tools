// Color palette — wraps ANSI styles with an on/off switch.

/** Set of color/formatting functions for rendering recap output. */
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

function ansi(open: string, close: string, s: string): string {
  return `\x1b[${open}m${s}\x1b[${close}m`;
}

function bold(s: string): string {
  return ansi("1", "22", s);
}

function cyan(s: string): string {
  return ansi("36", "39", s);
}

function dim(s: string): string {
  return ansi("2", "22", s);
}

function green(s: string): string {
  return ansi("32", "39", s);
}

function red(s: string): string {
  return ansi("31", "39", s);
}

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
    bold,
    dim,
    normal: (s: string) => green(s),
  };
}
