# Standalone executable (bun build --compile)

Bun 1.3.14, Linux x64 (WSL2). Oracle: 39/39 for all variants.

## Best variant

`./build.sh` = `bun build --compile --minify --bytecode --no-compile-autoload-dotenv
--no-compile-autoload-bunfig src/cli.ts`. Output: `dist/md-wl` (single file).

## Measurements

| Variant             | Size (MB) | Build (s)  | `md read` mean/50 |
| ------------------- | --------- | ---------- | ----------------- |
| plain               | 94.7      | 1.6 (cold) | ~20.5 ms          |
| --minify            | 94.6      | 0.3        | ~19.1 ms          |
| --minify --bytecode | 94.9      | 0.3        | ~16.4 ms          |
| `bun src/cli.ts`    | n/a       | n/a        | ~24.7 ms          |
| `bun -e 0` (floor)  | n/a       | n/a        | ~10 ms            |

Size is dominated by the embedded Bun runtime (~94 MB); the app code is negligible. Timings are on an error path (invalid section id) of a tiny file. The environment is noisy; the bytecode gain is ~3 ms, not dramatic. `--sourcemap` adds ~60 KB.

## Truly standalone

- Binary copied alone into an empty dir, run with `env -i PATH=/usr/bin:/bin`: OK.
- `ldd`: only libc, libpthread, libdl, libm (glibc).
- Oracle re-run with node_modules, .npmrc, package.json moved away and no bun/mise in PATH: 39/39.

## Cross-compilation (all built from Linux, none run except linux-x64)

First use of each target downloads the Bun runtime into `~/.bun/install/cache` (1.5-4.5 s); no other tooling needed.

| Target             | Size (MB) |
| ------------------ | --------- |
| linux-x64          | 94.6      |
| linux-x64-baseline | 93.7      |
| linux-x64-musl     | 91.2      |
| linux-arm64        | 93.7      |
| linux-arm64-musl   | 89.3      |
| darwin-arm64       | 63.5      |
| darwin-x64         | 69.2      |
| windows-x64 (.exe) | 98.5      |

## Caveats

- `@std/yaml` via the `npm:@jsr/...` alias is bundled; `wl` commands pass.
- No runtime files needed. By default the binary autoloads `.env` and `bunfig.toml` from the cwd; build.sh disables both.
- Binary is ~95 MB (uncompressed); a tar.gz is much smaller. Stripping is not possible without breaking the embedded payload.
- macOS: Apple Silicon requires a signature. Bun ad-hoc signs darwin output; for distribution outside Homebrew, use `codesign --force --options runtime
  --timestamp --sign "Developer ID Application: ..." --entitlements ent.plist` (entitlements `com.apple.security.cs.allow-jit` and `allow-unsigned-executable-memory` are required for JSC), then notarize with `xcrun notarytool submit --wait` on a zip. Raw CLI binaries cannot be stapled; Gatekeeper checks online. Signing must be done on macOS. Files downloaded via curl are not quarantined; via browser they are.
- Homebrew: formula (or a tap) with `on_macos`/`on_linux` x `on_arm`/`on_intel` blocks pointing at per-target release tarballs (sha256 each), `def install;
  bin.install "md-wl" => "md"; end` (or build separately named binaries). No `depends_on "bun"`. Use `-musl` or `-baseline` only if older CPUs or non-glibc distros matter.
