// DenoEnvironment adapter — concrete Environment backed by Deno runtime

import type { Environment } from "../../domain/ports/environment.ts";

export class DenoEnvironment implements Environment {
  getEnv(name: string): string | undefined {
    return Deno.env.get(name);
  }

  isTerminal(): boolean {
    return Deno.stdout.isTerminal();
  }

  cwd(): string {
    return Deno.cwd();
  }

  home(): string | undefined {
    return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  }

  async loadDotenv(path: string): Promise<Readonly<Record<string, string>>> {
    try {
      const content = await Deno.readTextFile(path);
      const vars: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key) vars[key] = value;
      }
      return vars;
    } catch {
      return {};
    }
  }
}
