import {
  readPluginVersionSources,
  updatePluginVersions,
  validatePluginVersions,
} from "./plugin-version-metadata.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function directoryUrl(path: string): URL {
  const suffix = path.endsWith("/") ? "" : "/";
  return new URL(`file://${path}${suffix}`);
}

async function writeJson(
  repoRoot: URL,
  path: string,
  value: unknown,
): Promise<void> {
  await Deno.writeTextFile(
    new URL(path, repoRoot),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function createFixture(
  versions: {
    claudePlugin?: string;
    codexPlugin?: string;
    marketplaceMetadata?: string;
    marketplacePlugin?: string;
  } = {},
): Promise<URL> {
  const repoRoot = directoryUrl(await Deno.makeTempDir());
  await Deno.mkdir(new URL("plugins/tools/.claude-plugin/", repoRoot), {
    recursive: true,
  });
  await Deno.mkdir(new URL("plugins/tools/.codex-plugin/", repoRoot), {
    recursive: true,
  });
  await Deno.mkdir(new URL(".claude-plugin/", repoRoot), { recursive: true });

  await writeJson(repoRoot, "plugins/tools/.claude-plugin/plugin.json", {
    name: "tools",
    version: versions.claudePlugin ?? "0.15.0",
    skills: ["./skills/worklog"],
  });
  await writeJson(repoRoot, "plugins/tools/.codex-plugin/plugin.json", {
    name: "tools",
    version: versions.codexPlugin ?? "0.15.0",
    skills: "./skills/",
  });
  await writeJson(repoRoot, ".claude-plugin/marketplace.json", {
    name: "tools",
    metadata: {
      description: "Markdown manipulation and productivity skills",
      version: versions.marketplaceMetadata ?? "0.15.0",
    },
    plugins: [
      {
        name: "tools",
        source: "./plugins/tools",
        version: versions.marketplacePlugin ?? "0.15.0",
      },
    ],
  });

  return repoRoot;
}

Deno.test("updatePluginVersions updates every plugin metadata version field", async () => {
  const repoRoot = await createFixture();

  await updatePluginVersions("0.16.0", repoRoot);

  const sources = await readPluginVersionSources(repoRoot);
  assert(sources.length === 4, "expected all version sources");
  for (const source of sources) {
    assert(
      source.version === "0.16.0",
      `${source.path} ${source.field} was not updated`,
    );
  }
});

Deno.test("updatePluginVersions leaves same-version files untouched", async () => {
  const repoRoot = await createFixture();
  const codexPluginPath = "plugins/tools/.codex-plugin/plugin.json";
  const compactCodexPlugin = `{
  "name": "tools",
  "version": "0.15.0",
  "interface": {
    "capabilities": ["Write"]
  }
}
`;
  await Deno.writeTextFile(
    new URL(codexPluginPath, repoRoot),
    compactCodexPlugin,
  );

  await updatePluginVersions("0.15.0", repoRoot);

  const updatedCodexPlugin = await Deno.readTextFile(
    new URL(codexPluginPath, repoRoot),
  );
  assert(
    updatedCodexPlugin === compactCodexPlugin,
    "same-version update should not rewrite JSON formatting",
  );
});

Deno.test("validatePluginVersions rejects drift between metadata files", async () => {
  const repoRoot = await createFixture({
    claudePlugin: "0.16.0",
    codexPlugin: "0.15.0",
    marketplaceMetadata: "0.16.0",
    marketplacePlugin: "0.16.0",
  });

  let rejected = false;
  try {
    await validatePluginVersions(repoRoot);
  } catch (error) {
    rejected = true;
    if (!(error instanceof Error)) {
      throw new Error("expected Error rejection");
    }
    assert(
      error.message.includes("plugins/tools/.codex-plugin/plugin.json"),
      "expected codex plugin drift in error message",
    );
  }

  assert(rejected, "expected validation to reject mismatched versions");
});
