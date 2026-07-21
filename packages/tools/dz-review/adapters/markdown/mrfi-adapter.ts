/**
 * Adapter: MrfiAdapter
 *
 * Implements the ReferenceLocatorService port using markdown-surgeon's MRFI
 * use cases directly: GenerateReferenceUseCase, ResolveReferenceUseCase,
 * RefreshReferenceUseCase.
 *
 * Unlike worklog's MarkdownSurgeonAdapter (which needs HashService/
 * YamlService injected for document parsing + frontmatter handling), these
 * MRFI use cases only need a BlockTreeParser — MRFI's own hashing
 * (smh64 / SHA-256 fragment signals) runs directly through
 * `crypto.subtle`, not an injected HashService.
 */

import type {
  Document,
  GenerateReferenceOptions,
  MrfiFormat,
  MrfiProfile,
  ReferenceLocatorService,
  RefreshReferenceOutput,
  ResolveResult,
  SourceRange,
} from "../../domain/ports/reference-locator.ts";
import { GenerateReferenceUseCase } from "../../../markdown-surgeon/domain/use-cases/generate-reference.ts";
import { ResolveReferenceUseCase } from "../../../markdown-surgeon/domain/use-cases/resolve-reference.ts";
import { RefreshReferenceUseCase } from "../../../markdown-surgeon/domain/use-cases/refresh-reference.ts";
import { CommonmarkBlockTreeParser } from "../../../markdown-surgeon/adapters/services/commonmark-block-tree-parser.ts";

export class MrfiAdapter implements ReferenceLocatorService {
  private readonly blockTreeParser = new CommonmarkBlockTreeParser();
  private readonly generateReferenceUC = new GenerateReferenceUseCase(
    this.blockTreeParser,
  );
  private readonly resolveReferenceUC = new ResolveReferenceUseCase(
    this.blockTreeParser,
  );
  private readonly refreshReferenceUC = new RefreshReferenceUseCase(
    this.blockTreeParser,
  );

  async generateReference(
    doc: Document,
    range: SourceRange,
    options: GenerateReferenceOptions,
  ): Promise<string> {
    return await this.generateReferenceUC.execute({
      doc,
      target: { kind: "range", range },
      ...options,
    });
  }

  async resolveReference(
    doc: Document,
    ref: string,
    witness?: string,
  ): Promise<ResolveResult> {
    return await this.resolveReferenceUC.execute({ doc, ref, witness });
  }

  async refreshReference(
    doc: Document,
    ref: string,
    format: MrfiFormat,
    profile: MrfiProfile,
  ): Promise<RefreshReferenceOutput> {
    return await this.refreshReferenceUC.execute({ doc, ref, format, profile });
  }
}
