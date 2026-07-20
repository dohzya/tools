import * as path from "node:path";

function isFileRelativePrefix(targetPath: string): boolean {
  return targetPath.startsWith("./") || targetPath.startsWith("../");
}

export function resolveReferenceTargetFile(
  sourceFile: string,
  targetPath: string,
  gitRoot: string | undefined,
): string {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  if (isFileRelativePrefix(targetPath)) {
    return path.resolve(path.dirname(sourceFile), targetPath);
  }

  if (gitRoot !== undefined) {
    return path.resolve(gitRoot, targetPath);
  }

  return path.resolve(path.dirname(sourceFile), targetPath);
}
