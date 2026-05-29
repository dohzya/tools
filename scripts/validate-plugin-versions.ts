import {
  DEFAULT_REPO_ROOT,
  validatePluginVersions,
} from "./plugin-version-metadata.ts";

try {
  const sources = await validatePluginVersions(DEFAULT_REPO_ROOT);
  console.log(
    `Plugin metadata versions are consistent (${sources[0].version})`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
