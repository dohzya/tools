export const DESCRIPTION_SEPARATOR = "\n\n---\n\n";

export function normalizeDescParts(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((part) => String(part)).filter((part) => part !== "");
  }
  const text = String(value);
  return text === "" ? [] : [text];
}

export function renderDesc(parts: readonly string[]): string {
  return parts.join(DESCRIPTION_SEPARATOR);
}

export function appendDescParts(
  current: readonly string[],
  additions: readonly string[],
): string[] {
  return [...current, ...additions.filter((part) => part !== "")];
}
