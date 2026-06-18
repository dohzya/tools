---
category: refs
themes:
  - migration
  - cli
  - review-workflow
verified_at: 2026-06-18
source_ref: "imported dz-md-review-syntax snapshot on 2026-06-18"
language: en-US
---

# DZ Review Migration References

These files preserve the legacy standalone implementation so the old `dz-md-review-syntax` workspace can be deleted after integration without losing unported behavior.

They are reference snapshots, not active code:

| File                            | Source role                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `legacy-dz-review-cli.ts.txt`   | Node/TypeScript CLI entry point used as provenance for the Deno CLI port.                               |
| `legacy-review-cli.test.js.txt` | Legacy CLI behavior tests used as migration evidence for Deno tests.                                    |
| `legacy-readme.md.txt`          | Standalone README content for any remaining user-facing behavior not yet migrated into maintained docs. |

When changing CLI behavior, write Deno tests under `packages/tools/dz-review` first, then use these snapshots only as implementation evidence. Do not treat the snapshots as active source.
