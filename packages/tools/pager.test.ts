import { assertEquals } from "@std/assert";
import { shouldUsePager } from "./pager.ts";

Deno.test("shouldUsePager - follows CLI env and TTY precedence", () => {
  const previousNoPager = Deno.env.get("NO_PAGER");
  const previousForcePager = Deno.env.get("FORCE_PAGER");

  try {
    Deno.env.delete("NO_PAGER");
    Deno.env.delete("FORCE_PAGER");
    assertEquals(shouldUsePager({ stdoutIsTerminal: true }), true);
    assertEquals(shouldUsePager({ stdoutIsTerminal: false }), false);

    Deno.env.set("NO_PAGER", "1");
    assertEquals(shouldUsePager({ stdoutIsTerminal: true }), false);
    assertEquals(
      shouldUsePager({ pager: true, stdoutIsTerminal: false }),
      true,
    );

    Deno.env.delete("NO_PAGER");
    Deno.env.set("FORCE_PAGER", "1");
    assertEquals(shouldUsePager({ stdoutIsTerminal: false }), true);
    assertEquals(
      shouldUsePager({ pager: false, stdoutIsTerminal: true }),
      false,
    );
    assertEquals(
      shouldUsePager({ json: true, stdoutIsTerminal: true }),
      false,
    );
  } finally {
    restoreEnv("NO_PAGER", previousNoPager);
    restoreEnv("FORCE_PAGER", previousForcePager);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
    return;
  }

  Deno.env.set(name, value);
}
