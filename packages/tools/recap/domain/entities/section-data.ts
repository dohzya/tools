// SectionData — output of pass 1 (collect)

import type { SeparatorKind } from "./config.ts";

/** Output of a single section after collection (pass 1). */
export type SectionData = {
  readonly id: string;
  readonly title?: string;
  readonly lines: readonly string[];
  readonly separator: SeparatorKind;
  readonly error?: string;
};
