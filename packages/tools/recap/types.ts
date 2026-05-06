// Public types for recap package

export type {
  BuiltinKind,
  BuiltinSectionEntry,
  RawConfig,
  RawSectionEntry,
  RecapConfig,
  RefSectionEntry,
  ResolvedSection,
  SeparatorKind,
  ShSectionEntry,
  ValueSectionEntry,
} from "./domain/entities/config.ts";
export type { SectionData } from "./domain/entities/section-data.ts";
export type { Palette } from "./domain/entities/color.ts";
export { RecapError } from "./domain/entities/errors.ts";
export type { RecapErrorCode } from "./domain/entities/errors.ts";

// Use-case option/result types
export type { ResolveConfigOptions } from "./domain/use-cases/resolve-config.ts";
export type { CollectSectionsProviders } from "./domain/use-cases/collect-sections.ts";
export type {
  RunRecapDependencies,
  RunRecapOptions,
  RunRecapResult,
} from "./domain/use-cases/run-recap.ts";

// Port interfaces
export type { ShellResult, ShellRunner } from "./domain/ports/shell-runner.ts";
export type {
  GitInfoProvider,
  GitLogResult,
  GitOpsResult,
} from "./domain/ports/git-info.ts";
export type { Environment } from "./domain/ports/environment.ts";
export type { FileSystem } from "./domain/ports/filesystem.ts";
export type { ConfigResolver } from "./domain/ports/config-resolver.ts";
