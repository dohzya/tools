import * as path from "node:path";
import * as vscode from "vscode";
import type { DzReviewEnvironment } from "../../../tools/dz-review/runtime-config";

/**
 * VSCode-backed implementation of dz-review's `DzReviewEnvironment` port.
 *
 * `getCwd()` only needs to land *inside* the same git repository the CLI is
 * run from -- `getDzReviewStateDir()` resolves the actual `.dz-review/`
 * directory by spawning `git rev-parse --show-toplevel` with this cwd, so
 * the workspace root (or, failing that, the active document's own
 * directory) is enough; we don't need to duplicate that git-root logic
 * here.
 *
 * `getEnv()` always misses: `DZ_REVIEW_STATE_DIR_ENV`/`DZ_REVIEW_IGNORE_FILE_ENV`
 * are CLI/shell-only overrides and this package's `dzMdReview.*` settings
 * (see package.json's `contributes.configuration`) don't expose an
 * equivalent -- there is nothing to map.
 */
export function createVscodeDzReviewEnvironment(): DzReviewEnvironment {
  return {
    getEnv: () => undefined,
    getCwd: resolveDzReviewCwd,
  };
}

function resolveDzReviewCwd(): string {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return workspaceRoot;
  }

  // No open workspace folder (single-file mode): fall back to the active
  // document's own directory, mirroring the assumption
  // `getReviewPanelDocumentPath` already makes elsewhere in this package.
  const documentPath = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (documentPath) {
    return path.dirname(documentPath);
  }

  return process.cwd();
}
