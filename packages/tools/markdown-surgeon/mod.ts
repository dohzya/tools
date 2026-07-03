/**
 * Markdown-surgeon — parse, query, and mutate Markdown documents by section.
 *
 * Exports the hexagonal domain (entities, use cases, ports) plus adapter
 * implementations and a backward-compatible functional API.
 *
 * @module
 */

// ============================================================================
// Domain entities
// ============================================================================

export type {
  Document,
  ErrorCode,
  MutationResult,
  SearchMatch,
  SearchSummary,
  Section,
} from "./domain/entities/document.ts";
export { MdError } from "./domain/entities/document.ts";
export type {
  ComparisonSpan,
  DebugMrfi,
  HashSignal,
  MrfiFormat,
  MrfiProfile,
  RefreshedReference,
  RefreshReferenceOutput,
  ResolveCandidate,
  ResolveResult,
  SourceRange,
  UnresolvedReference,
} from "./domain/entities/mrfi.ts";

// ============================================================================
// Domain ports (interfaces)
// ============================================================================

export type { FileSystem } from "./domain/ports/filesystem.ts";
export type { HashService } from "./domain/ports/hash-service.ts";
export type { YamlService } from "./domain/ports/yaml-service.ts";

// ============================================================================
// Use cases
// ============================================================================

export { ParseDocumentUseCase } from "./domain/use-cases/parse-document.ts";
export type { ParseDocumentInput } from "./domain/use-cases/parse-document.ts";
export { ReadSectionUseCase } from "./domain/use-cases/read-section.ts";
export type {
  ReadSectionInput,
  ReadSectionResult,
} from "./domain/use-cases/read-section.ts";
export { WriteSectionUseCase } from "./domain/use-cases/write-section.ts";
export type {
  WriteSectionInput,
  WriteSectionOutput,
} from "./domain/use-cases/write-section.ts";
export { AppendSectionUseCase } from "./domain/use-cases/append-section.ts";
export type {
  AppendSectionInput,
  AppendSectionOutput,
} from "./domain/use-cases/append-section.ts";
export { RemoveSectionUseCase } from "./domain/use-cases/remove-section.ts";
export type {
  EmptySectionInput,
  RemoveSectionInput,
  RemoveSectionOutput,
} from "./domain/use-cases/remove-section.ts";
export { SearchUseCase } from "./domain/use-cases/search.ts";
export type { SearchInput, SearchResult } from "./domain/use-cases/search.ts";
export { ManageFrontmatterUseCase } from "./domain/use-cases/manage-frontmatter.ts";
export type {
  DeleteFrontmatterInput,
  FrontmatterGetResult,
  FrontmatterMutationResult,
  GetFrontmatterInput,
  SetFrontmatterInput,
} from "./domain/use-cases/manage-frontmatter.ts";
export { ResolveReferenceUseCase } from "./domain/use-cases/resolve-reference.ts";
export type { ResolveReferenceInput } from "./domain/use-cases/resolve-reference.ts";
export {
  GenerateReferenceUseCase,
} from "./domain/use-cases/generate-reference.ts";
export type {
  GenerateReferenceInput,
  GenerateReferenceTarget,
} from "./domain/use-cases/generate-reference.ts";
export {
  TransformReferenceUseCase,
} from "./domain/use-cases/transform-reference.ts";
export type {
  TransformReferenceInput,
} from "./domain/use-cases/transform-reference.ts";
export { RefreshReferenceUseCase } from "./domain/use-cases/refresh-reference.ts";
export type { RefreshReferenceInput } from "./domain/use-cases/refresh-reference.ts";
export {
  RankReferenceCandidatesUseCase,
} from "./domain/use-cases/rank-reference-candidates.ts";
export type {
  RankReferenceCandidatesInput,
} from "./domain/use-cases/rank-reference-candidates.ts";

// ============================================================================
// Adapters
// ============================================================================

// DenoFileSystem deliberately excluded: it depends on @std/fs (expandGlob)
// which is Deno-only. Import from "./adapters/filesystem/deno-fs.ts" directly.
export { InMemoryFileSystem } from "./adapters/filesystem/in-memory-fs.ts";
export { Blake3HashService } from "./adapters/services/blake3-hash.ts";
export { YamlParserService } from "./adapters/services/yaml-parser.ts";

// ============================================================================
// CLI
// ============================================================================

export { main } from "./cli.ts";

// ============================================================================
// Backward compatibility layer - functional API wrapping use cases
// ============================================================================

import { Blake3HashService } from "./adapters/services/blake3-hash.ts";
import { YamlParserService } from "./adapters/services/yaml-parser.ts";
import { ParseDocumentUseCase } from "./domain/use-cases/parse-document.ts";
import { ManageFrontmatterUseCase } from "./domain/use-cases/manage-frontmatter.ts";
import type { Document, Section } from "./domain/entities/document.ts";

// Create singleton instances for compatibility functions
const _hashService = new Blake3HashService();
const _yamlService = new YamlParserService();
const _parseDocUseCase = new ParseDocumentUseCase(_hashService);
const _manageFrontmatterUseCase = new ManageFrontmatterUseCase(_yamlService);

/** Parse a markdown string into a Document with sections and frontmatter */
export async function parseDocument(content: string): Promise<Document> {
  return await _parseDocUseCase.execute({ content });
}

/** Parse the YAML frontmatter of a markdown string into a plain object */
export async function parseFrontmatter(
  content: string,
): Promise<Record<string, unknown>> {
  const doc = await _parseDocUseCase.execute({ content });
  const yamlContent = _manageFrontmatterUseCase.getFrontmatterContent(doc);
  return _yamlService.parse(yamlContent);
}

/** Serialize a frontmatter object back to a YAML string */
export function stringifyFrontmatter(
  frontmatter: Record<string, unknown>,
): string {
  return _yamlService.stringify(frontmatter);
}

/** Get the full text (header + body) of a section by ID */
export async function getSectionContent(
  content: string,
  id: string,
): Promise<string> {
  const doc = await _parseDocUseCase.execute({ content });
  const section = doc.sections.find((s) => s.id === id);
  if (!section) throw new Error(`Section ${id} not found`);
  return doc.lines.slice(section.line - 1, section.lineEnd).join("\n");
}

/** Find a section by its ID, returning its metadata or undefined */
export async function findSection(
  content: string,
  id: string,
): Promise<Section | undefined> {
  const doc = await _parseDocUseCase.execute({ content });
  return doc.sections.find((s) => s.id === id);
}

/** Find the section containing a given 1-indexed line number */
export async function findSectionAtLine(
  content: string,
  line: number,
): Promise<Section | undefined> {
  const doc = await _parseDocUseCase.execute({ content });
  return doc.sections.find((s) => line >= s.line && line <= s.lineEnd);
}

/** Get the 1-indexed end line of a section, or -1 if not found */
export async function getSectionEndLine(
  content: string,
  id: string,
): Promise<number> {
  const section = await findSection(content, id);
  return section?.lineEnd ?? -1;
}

/** Compute the deterministic hash ID for a section given its title and level */
export async function sectionHash(
  title: string,
  level: number,
): Promise<string> {
  return await _hashService.hash(level, title, 0);
}

/** Check whether a string is a valid section ID (lowercase hex) */
export function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

/** Retrieve a nested value from an object using dot-notation path */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  return _yamlService.getNestedValue(obj, path);
}

/** Set a nested value in an object using dot-notation path */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const result = { ...obj };
  _yamlService.setNestedValue(result, path, value);
  return result;
}

/** Delete a nested value from an object using dot-notation path */
export function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const result = { ...obj };
  _yamlService.deleteNestedValue(result, path);
  return result;
}

/** Extract raw YAML content from frontmatter (without delimiters) */
export async function getFrontmatterContent(content: string): Promise<string> {
  const doc = await _parseDocUseCase.execute({ content });
  return _manageFrontmatterUseCase.getFrontmatterContent(doc);
}

/** Replace or add YAML frontmatter in a markdown string */
export async function setFrontmatter(
  content: string,
  frontmatter: Record<string, unknown>,
): Promise<string> {
  const doc = await _parseDocUseCase.execute({ content });
  const yamlContent = _yamlService.stringify(frontmatter);
  const updatedLines = (doc.frontmatter ? [] : [""]).concat(
    ["---", ...yamlContent.split("\n"), "---"],
  );
  if (doc.frontmatter) {
    updatedLines.push(
      ...doc.lines.slice(doc.frontmatterEndLine),
    );
  } else {
    updatedLines.push(...doc.lines);
  }
  return updatedLines.join("\n");
}

/** Format a value for human-readable display */
export function formatValue(value: unknown): string {
  return _yamlService.formatValue(value);
}

/** Expand magic placeholders in content (currently a no-op) */
export function expandMagic(content: string): string {
  // Magic expansion was in magic.ts - for now return as-is
  return content;
}

/** Reconstruct a markdown string from a Document's lines */
export function serializeDocument(doc: Document): string {
  // Reconstruct document from lines
  return doc.lines.join("\n");
}

/** Check whether a string begins with a markdown header line */
export function startsWithHeader(content: string): boolean {
  return /^#+ /.test(content.trimStart());
}
