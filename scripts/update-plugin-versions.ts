import {
  DEFAULT_REPO_ROOT,
  updatePluginVersions,
  validatePluginVersions,
} from "./plugin-version-metadata.ts";

const version = Deno.args[0];

if (Deno.args.length !== 1 || version === undefined) {
  console.error("Usage: update-plugin-versions.ts <version>");
  Deno.exit(1);
}

try {
  await updatePluginVersions(version, DEFAULT_REPO_ROOT);
  await validatePluginVersions(DEFAULT_REPO_ROOT);
  console.log(`Plugin metadata versions updated to ${version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
