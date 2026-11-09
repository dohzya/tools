# Standalone Mojo CLI: findings (Mojo 1.2.0, Linux x86-64, 2026-10-27)

## Verdict

Fully static / "embed runtime" output does not exist. A **relocatable bundle** (binary + 3 runtime `.so`, `RUNPATH=$ORIGIN`) works: 39/39 oracle passed from a fresh dir with the venv renamed away. Reproduce with `./bundle.sh`.

## 1. Official options (`mojo build --help`)

No static-link / embed-runtime flag. Only `-Xlinker <ARG>`, `--lld-path`, `--emit {exe,object,shared-lib,llvm,asm,...}`, `--target-triple`. The compiler hardcodes the venv `modular/lib` as RUNPATH.

## 2. Bundle

`-Xlinker -rpath='$ORIGIN'` works but the venv path stays in RUNPATH (fallback). Better: `patchelf --set-rpath '$ORIGIN' cli` (pip `patchelf`) after build. Dependencies: libKGENCompilerRTShared -> libMSupportGlobals, libAsyncRTRuntimeGlobals (all three self-locate via their own `$ORIGIN` RPATH). Libs are already stripped (`strip` changes nothing).

| file                        | bytes              |
| --------------------------- | ------------------ |
| cli                         | 268 336 (stripped) |
| libKGENCompilerRTShared.so  | 1 315 400          |
| libAsyncRTRuntimeGlobals.so | 687 096            |
| libMSupportGlobals.so       | 53 200             |
| total                       | ~2.3 MB            |

## 3. Relocatability (proved)

Copied to an empty dir, venv renamed away, `env -i PATH=<jq>:/usr/bin:/bin` (jq is needed by the oracle script only): `TOTAL: 39/39 passed`. `ldd` shows no venv path. Remaining system deps: libc, libm, libstdc++, libgcc_s. Symbol floors: glibc 2.35 (cli 2.34), GLIBCXX 3.4.30 / GCC 12 libstdc++. => Ubuntu 22.04+, Debian 12+, Fedora 36+, RHEL/Alma 10 (RHEL 9 = glibc 2.34 and GCC 11 libstdc++: NOT enough). Alpine/musl: not supported. Needs libstdc++ installed.

## 4. Numbers

- Startup `md read` (mean of 50, shell loop incl. fork): ~7.6 ms (baseline ~8 ms).
- Clean build: ~2.7 s wall (small project).

## 5. Cross-compilation / licensing

- `--target-triple aarch64-unknown-linux-gnu`: codegen runs, **link fails** (host `ld.bfd` rejects the aarch64 runtime archive: "file in wrong format"). No cross sysroot/runtime for foreign targets => build natively per platform (CI matrix: linux-x86_64, linux-aarch64, macos-arm64). The macOS flow was not tested here (pip/pixi package exists; Mach-O would need `@loader_path` / `install_name_tool` instead of patchelf; untested).
- License: wheels declare `LicenseRef-MAX-Platform-Software-License`, no license text shipped in the wheel. The MAX SDK license (modular.com/legal/max-mojo-license) allows redistribution of derivative works in object form if the terms are included and the app has "material additional functionality"; it does not explicitly name Mojo runtime libs. Treat as unconfirmed: verify with Modular before shipping the `.so` files publicly, and include the terms in the tarball.

## 6. Distribution fit

- GitHub release tarball per platform (`cli` + 3 `.so`, ~1 MB gzipped): simple, fits.
- Homebrew: formula can install the whole dir into `libexec` and symlink `bin/cli` (RUNPATH `$ORIGIN` follows the symlink target, fine). Homebrew on Linux relocates fine; avoid brew's own rpath fixups clobbering `$ORIGIN`. Requires prebuilt bottles (building from source needs the pip mojo toolchain, not brew-friendly).
