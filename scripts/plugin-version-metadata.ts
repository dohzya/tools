export const DEFAULT_REPO_ROOT = new URL("../", import.meta.url);

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export interface VersionSource {
  readonly path: string;
  readonly field: string;
  readonly version: string;
}

function pathUrl(repoRoot: URL, path: string): URL {
  return new URL(path, repoRoot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  requireValue(isRecord(value), `${context} must be a JSON object`);
  return value;
}

function requireStringField(
  record: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = record[field];
  requireValue(
    typeof value === "string",
    `${context}.${field} must be a string`,
  );
  return value;
}

async function readJson(repoRoot: URL, path: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(pathUrl(repoRoot, path)));
}

async function readJsonRecord(
  repoRoot: URL,
  path: string,
): Promise<Record<string, unknown>> {
  return requireRecord(await readJson(repoRoot, path), path);
}

async function writeJsonRecord(
  repoRoot: URL,
  path: string,
  record: Record<string, unknown>,
): Promise<void> {
  await Deno.writeTextFile(
    pathUrl(repoRoot, path),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

function toolsMarketplaceEntry(
  marketplace: Record<string, unknown>,
): Record<string, unknown> {
  const plugins = marketplace.plugins;
  requireValue(
    Array.isArray(plugins),
    ".claude-plugin/marketplace.json.plugins must be an array",
  );

  const entry = plugins.find((plugin: unknown) =>
    isRecord(plugin) && plugin.name === "tools"
  );
  requireValue(
    isRecord(entry),
    '.claude-plugin/marketplace.json.plugins must include a "tools" entry',
  );
  return entry;
}

function validateVersionFormat(version: string): void {
  requireValue(
    VERSION_PATTERN.test(version),
    `version must be in format X.Y.Z (got ${version})`,
  );
}

export async function readPluginVersionSources(
  repoRoot: URL = DEFAULT_REPO_ROOT,
): Promise<VersionSource[]> {
  const claudePluginPath = "plugins/tools/.claude-plugin/plugin.json";
  const codexPluginPath = "plugins/tools/.codex-plugin/plugin.json";
  const claudeMarketplacePath = ".claude-plugin/marketplace.json";

  const claudePlugin = await readJsonRecord(repoRoot, claudePluginPath);
  const codexPlugin = await readJsonRecord(repoRoot, codexPluginPath);
  const claudeMarketplace = await readJsonRecord(
    repoRoot,
    claudeMarketplacePath,
  );
  const claudeMarketplaceMetadata = requireRecord(
    claudeMarketplace.metadata,
    `${claudeMarketplacePath}.metadata`,
  );
  const claudeMarketplacePlugin = toolsMarketplaceEntry(claudeMarketplace);

  return [
    {
      path: claudePluginPath,
      field: "version",
      version: requireStringField(claudePlugin, "version", claudePluginPath),
    },
    {
      path: codexPluginPath,
      field: "version",
      version: requireStringField(codexPlugin, "version", codexPluginPath),
    },
    {
      path: claudeMarketplacePath,
      field: "metadata.version",
      version: requireStringField(
        claudeMarketplaceMetadata,
        "version",
        `${claudeMarketplacePath}.metadata`,
      ),
    },
    {
      path: claudeMarketplacePath,
      field: 'plugins[name="tools"].version',
      version: requireStringField(
        claudeMarketplacePlugin,
        "version",
        `${claudeMarketplacePath}.plugins[name="tools"]`,
      ),
    },
  ];
}

export async function validatePluginVersions(
  repoRoot: URL = DEFAULT_REPO_ROOT,
): Promise<VersionSource[]> {
  const sources = await readPluginVersionSources(repoRoot);
  const expected = sources[0]?.version;
  requireValue(expected !== undefined, "No plugin version metadata found");

  const errors: string[] = [];
  for (const source of sources) {
    if (!VERSION_PATTERN.test(source.version)) {
      errors.push(
        `${source.path} ${source.field} is not X.Y.Z: ${source.version}`,
      );
    }
    if (source.version !== expected) {
      errors.push(
        `${source.path} ${source.field} is ${source.version}; expected ${expected}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Plugin metadata versions are inconsistent:\n${
        errors.map((error) => `- ${error}`).join("\n")
      }`,
    );
  }

  return sources;
}

export async function updatePluginVersions(
  version: string,
  repoRoot: URL = DEFAULT_REPO_ROOT,
): Promise<void> {
  validateVersionFormat(version);

  const claudePluginPath = "plugins/tools/.claude-plugin/plugin.json";
  const codexPluginPath = "plugins/tools/.codex-plugin/plugin.json";
  const claudeMarketplacePath = ".claude-plugin/marketplace.json";

  const claudePlugin = await readJsonRecord(repoRoot, claudePluginPath);
  if (
    requireStringField(claudePlugin, "version", claudePluginPath) !== version
  ) {
    claudePlugin.version = version;
    await writeJsonRecord(repoRoot, claudePluginPath, claudePlugin);
  }

  const codexPlugin = await readJsonRecord(repoRoot, codexPluginPath);
  if (requireStringField(codexPlugin, "version", codexPluginPath) !== version) {
    codexPlugin.version = version;
    await writeJsonRecord(repoRoot, codexPluginPath, codexPlugin);
  }

  const claudeMarketplace = await readJsonRecord(
    repoRoot,
    claudeMarketplacePath,
  );
  const metadata = requireRecord(
    claudeMarketplace.metadata,
    `${claudeMarketplacePath}.metadata`,
  );
  const toolsEntry = toolsMarketplaceEntry(claudeMarketplace);
  const metadataVersion = requireStringField(
    metadata,
    "version",
    `${claudeMarketplacePath}.metadata`,
  );
  const toolsEntryVersion = requireStringField(
    toolsEntry,
    "version",
    `${claudeMarketplacePath}.plugins[name="tools"]`,
  );

  if (metadataVersion !== version || toolsEntryVersion !== version) {
    metadata.version = version;
    toolsEntry.version = version;
    await writeJsonRecord(repoRoot, claudeMarketplacePath, claudeMarketplace);
  }
}
