// Main module exports for markdown-surgeon

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
export { ReadSectionUseCase } from "./domain/use-cases/read-section.ts";
export { WriteSectionUseCase } from "./domain/use-cases/write-section.ts";
export { AppendSectionUseCase } from "./domain/use-cases/append-section.ts";
export { RemoveSectionUseCase } from "./domain/use-cases/remove-section.ts";
export { SearchUseCase } from "./domain/use-cases/search.ts";
export { ManageFrontmatterUseCase } from "./domain/use-cases/manage-frontmatter.ts";

// ============================================================================
// Adapters
// ============================================================================

export { DenoFileSystem } from "./adapters/filesystem/deno-fs.ts";
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

// Export compatibility functions
export async function parseDocument(content: string): Promise<Document> {
  return await _parseDocUseCase.execute({ content });
}

export async function parseFrontmatter(
  content: string,
): Promise<Record<string, unknown>> {
  const doc = await _parseDocUseCase.execute({ content });
  const yamlContent = _manageFrontmatterUseCase.getFrontmatterContent(doc);
  return _yamlService.parse(yamlContent);
}

export function stringifyFrontmatter(
  frontmatter: Record<string, unknown>,
): string {
  return _yamlService.stringify(frontmatter);
}

export async function getSectionContent(
  content: string,
  id: string,
): Promise<string> {
  const doc = await _parseDocUseCase.execute({ content });
  const section = doc.sections.find((s) => s.id === id);
  if (!section) throw new Error(`Section ${id} not found`);
  return doc.lines.slice(section.line - 1, section.lineEnd).join("\n");
}

export async function findSection(
  content: string,
  id: string,
): Promise<Section | undefined> {
  const doc = await _parseDocUseCase.execute({ content });
  return doc.sections.find((s) => s.id === id);
}

export async function findSectionAtLine(
  content: string,
  line: number,
): Promise<Section | undefined> {
  const doc = await _parseDocUseCase.execute({ content });
  return doc.sections.find((s) => line >= s.line && line <= s.lineEnd);
}

export async function getSectionEndLine(
  content: string,
  id: string,
): Promise<number> {
  const section = await findSection(content, id);
  return section?.lineEnd ?? -1;
}

export async function sectionHash(
  title: string,
  level: number,
): Promise<string> {
  return await _hashService.hash(level, title, 0);
}

export function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

// Magic/YAML helpers - these were utility functions, implement as needed
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  return _yamlService.getNestedValue(obj, path);
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const result = { ...obj };
  _yamlService.setNestedValue(result, path, value);
  return result;
}

export function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const result = { ...obj };
  _yamlService.deleteNestedValue(result, path);
  return result;
}

export async function getFrontmatterContent(content: string): Promise<string> {
  const doc = await _parseDocUseCase.execute({ content });
  return _manageFrontmatterUseCase.getFrontmatterContent(doc);
}

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

export function formatValue(value: unknown): string {
  return _yamlService.formatValue(value);
}

export function expandMagic(content: string): string {
  // Magic expansion was in magic.ts - for now return as-is
  return content;
}

export function serializeDocument(doc: Document): string {
  // Reconstruct document from lines
  return doc.lines.join("\n");
}

export function startsWithHeader(content: string): boolean {
  return /^#+ /.test(content.trimStart());
}
