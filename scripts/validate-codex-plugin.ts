const repoRoot = new URL("../", import.meta.url);

function pathUrl(path: string): URL {
  return new URL(path, repoRoot);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(pathUrl(path));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function readJson(path: string) {
  return JSON.parse(await Deno.readTextFile(pathUrl(path)));
}

function requireValue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

const pluginPath = "plugins/tools/.codex-plugin/plugin.json";
const marketplacePath = ".agents/plugins/marketplace.json";

const plugin = await readJson(pluginPath);
requireValue(isRecord(plugin), `${pluginPath} must be a JSON object`);
requireValue(
  stringField(plugin, "name") === "tools",
  `${pluginPath}: name must be "tools"`,
);
requireValue(
  stringField(plugin, "skills") === "./skills/",
  `${pluginPath}: skills must be "./skills/"`,
);
requireValue(
  await exists("plugins/tools/skills"),
  `${pluginPath}: skills directory is missing`,
);

const marketplace = await readJson(marketplacePath);
requireValue(isRecord(marketplace), `${marketplacePath} must be a JSON object`);
requireValue(
  stringField(marketplace, "name") === "tools",
  `${marketplacePath}: name must be "tools"`,
);

const plugins = marketplace.plugins;
requireValue(
  Array.isArray(plugins),
  `${marketplacePath}: plugins must be an array`,
);
const toolsEntry = plugins.find((entry: unknown) =>
  isRecord(entry) && stringField(entry, "name") === "tools"
);
requireValue(
  isRecord(toolsEntry),
  `${marketplacePath}: plugins must include tools`,
);

const source = toolsEntry.source;
requireValue(
  isRecord(source),
  `${marketplacePath}: tools.source must be an object`,
);
requireValue(
  stringField(source, "path") === "./plugins/tools",
  `${marketplacePath}: tools.source.path must be "./plugins/tools"`,
);
requireValue(
  await exists("plugins/tools"),
  `${marketplacePath}: tools source path is missing`,
);

const policy = toolsEntry.policy;
requireValue(
  isRecord(policy),
  `${marketplacePath}: tools.policy must be an object`,
);
requireValue(
  stringField(policy, "installation") === "AVAILABLE",
  `${marketplacePath}: tools.policy.installation must be "AVAILABLE"`,
);
requireValue(
  stringField(policy, "authentication") === "ON_INSTALL",
  `${marketplacePath}: tools.policy.authentication must be "ON_INSTALL"`,
);
requireValue(
  stringField(toolsEntry, "category") === "Productivity",
  `${marketplacePath}: tools.category must be "Productivity"`,
);

console.log("Codex plugin metadata is valid");
