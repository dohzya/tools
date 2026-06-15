import { assertEquals } from "@std/assert";

Deno.test("release config pins Cliffy command for compiled wl run", async () => {
  const configUrl = new URL("../deno.json", import.meta.url);
  const config = JSON.parse(await Deno.readTextFile(configUrl));

  assertEquals(
    config.imports["@cliffy/command"],
    "jsr:@cliffy/command@1.0.0-rc.8",
  );
  assertEquals(
    config.imports["@cliffy/command/completions"],
    "jsr:@cliffy/command@1.0.0-rc.8/completions",
  );
  assertEquals(
    config.imports["@cliffy/prompt/select"],
    "jsr:@cliffy/prompt@1.0.0-rc.8/select",
  );
});

Deno.test("release workflow compiles from direct versioned JSR URLs", async () => {
  const workflowUrl = new URL(
    "../../../.github/workflows/release.yml",
    import.meta.url,
  );
  const workflow = await Deno.readTextFile(workflowUrl);

  assertEquals(
    workflow.includes(
      "https://jsr.io/@dohzya/tools/${JSR_VERSION}/worklog/cli.ts",
    ),
    true,
  );
  assertEquals(
    workflow.includes('ENTRY="jsr:@dohzya/tools@${JSR_VERSION}'),
    false,
  );
});
