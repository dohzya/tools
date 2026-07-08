import type { Document, MutationResult } from "../entities/document.ts";
import type { SourceRange } from "../entities/mrfi.ts";

export interface MutateRangeInput {
  readonly doc: Document;
  readonly range: SourceRange;
  readonly action: "write" | "remove" | "append";
  readonly content?: string;
  readonly before?: boolean;
}

export interface MutateRangeOutput {
  readonly result: MutationResult;
  readonly updatedLines: readonly string[];
}

export class MutateRangeUseCase {
  execute(input: MutateRangeInput): MutateRangeOutput {
    const { doc, range, action, content, before } = input;
    const startIndex = range.startLine - 1;
    const endIndex = range.endLine;

    switch (action) {
      case "write": {
        const newLines = content ? content.split("\n") : [];
        const updated = [
          ...doc.lines.slice(0, startIndex),
          ...newLines,
          ...doc.lines.slice(endIndex),
        ];
        return {
          result: {
            action: "updated",
            id: "-",
            lineStart: range.startLine,
            lineEnd: range.startLine + newLines.length,
            linesAdded: newLines.length,
            linesRemoved: endIndex - startIndex,
          },
          updatedLines: updated,
        };
      }
      case "remove": {
        const updated = [
          ...doc.lines.slice(0, startIndex),
          ...doc.lines.slice(endIndex),
        ];
        return {
          result: {
            action: "removed",
            id: "-",
            lineStart: range.startLine,
            linesAdded: 0,
            linesRemoved: endIndex - startIndex,
          },
          updatedLines: updated,
        };
      }
      case "append": {
        const newLines = content ? content.split("\n") : [];
        const insertAt = before ? startIndex : endIndex;
        const updated = [...doc.lines];
        updated.splice(insertAt, 0, ...newLines);
        return {
          result: {
            action: "appended",
            id: "-",
            lineStart: insertAt + 1,
            linesAdded: newLines.length,
            linesRemoved: 0,
          },
          updatedLines: updated,
        };
      }
    }
  }
}
