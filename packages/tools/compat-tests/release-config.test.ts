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
