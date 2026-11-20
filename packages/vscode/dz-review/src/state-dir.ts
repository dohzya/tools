import * as childProcess from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import * as critique from "./critique";

const REFERENCE_MAP_FILE = "reference-map.json";

/**
 * `reference-map.json` path, in the state directory the CLI would use from
 * the workspace: the `dzMdReview.stateDir` setting, else `CRITIQUE_STATE_DIR`
 * (as the extension host received it), else the default.
 */
export function referenceMapFile(): string {
  const cwd = resolveCwd();
  const setting = vscode.workspace.getConfiguration("dzMdReview").get<string>(
    "stateDir",
  );
  const dir = critique.stateDir(findGitRoot(cwd) ?? cwd, [
    typeof setting === "string" ? setting : "",
    process.env.CRITIQUE_STATE_DIR ?? "",
  ]);
  // The CLI resolves a relative directory against its cwd.
  return path.join(path.resolve(cwd, dir), REFERENCE_MAP_FILE);
}

function findGitRoot(cwd: string): string | undefined {
  const result = childProcess.spawnSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd, encoding: "utf8" },
  );
  const root = result.status === 0 ? result.stdout.trim() : "";
  return root.length > 0 ? root : undefined;
}

function resolveCwd(): string {
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
