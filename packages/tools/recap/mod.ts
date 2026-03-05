// recap module — public API

export * from "./types.ts";
export { resolveConfig } from "./domain/use-cases/resolve-config.ts";
export { collectSections } from "./domain/use-cases/collect-sections.ts";
export { renderRecap } from "./domain/use-cases/render-recap.ts";
export { runRecap } from "./domain/use-cases/run-recap.ts";
export { generateConfigContent } from "./domain/use-cases/init-config.ts";
export { createPalette } from "./domain/entities/color.ts";
export { HARDCODED_SECTIONS } from "./domain/entities/default-config.ts";
