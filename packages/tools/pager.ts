export interface PagerOptions {
  readonly pager?: boolean;
  readonly json?: boolean;
  readonly stdoutIsTerminal: boolean;
}

export function shouldUsePager(options: PagerOptions): boolean {
  if (options.json) {
    return false;
  }

  if (options.pager !== undefined) {
    return options.pager;
  }

  if (hasNonEmptyEnv("NO_PAGER")) {
    return false;
  }

  if (hasForcePagerEnv()) {
    return true;
  }

  return options.stdoutIsTerminal;
}

export async function pageText(text: string): Promise<void> {
  const pager = safeEnvGet("PAGER")?.trim() || "less";
  const command = pagerShellCommand(pager);
  const child = new Deno.Command(command.command, {
    args: command.args,
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const writer = child.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(text));
    await writer.close();
  } catch (error) {
    writer.releaseLock();
    try {
      child.stdin.close();
    } catch {
      // The pager may have exited early after receiving enough input.
    }
    if (!isBrokenPipe(error)) {
      throw error;
    }
  }

  const status = await child.status;
  if (!status.success) {
    throw new Error(`Pager exited with code ${status.code}`);
  }
}

function hasNonEmptyEnv(name: string): boolean {
  const value = safeEnvGet(name);
  return value !== undefined && value !== "";
}

function hasForcePagerEnv(): boolean {
  const value = safeEnvGet("FORCE_PAGER");
  return value !== undefined && value !== "" && value !== "0";
}

function safeEnvGet(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch (error) {
    if (isEnvPermissionError(error)) {
      return undefined;
    }

    throw error;
  }
}

function pagerShellCommand(
  pager: string,
): { readonly command: string; readonly args: string[] } {
  if (Deno.build.os === "windows") {
    return { command: "cmd", args: ["/d", "/s", "/c", pager] };
  }

  return { command: "sh", args: ["-c", pager] };
}

function isBrokenPipe(error: unknown): boolean {
  return error instanceof Deno.errors.BrokenPipe ||
    error instanceof Deno.errors.BadResource;
}

function isEnvPermissionError(error: unknown): boolean {
  return error instanceof Deno.errors.NotCapable ||
    error instanceof Deno.errors.PermissionDenied;
}
