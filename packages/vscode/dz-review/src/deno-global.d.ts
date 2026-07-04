/**
 * Minimal ambient declaration for the `Deno` global that `runtime-config.ts`
 * references as its default (Deno-backed) environment implementation.
 *
 * This branch is never reached from the VSCode extension host: `activate()`
 * calls `configureDzReviewRuntime({ environment: createVscodeDzReviewEnvironment() })`
 * before anything can call into `runtime-config.ts`, so the default
 * (`Deno.env.get`/`Deno.cwd()`-backed) implementation is always overridden.
 * This declaration exists only so `tsc` can type-check that unreachable
 * source, matching the exact shape `runtime-config.ts` actually uses --
 * nothing more.
 */
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  cwd(): string;
};
