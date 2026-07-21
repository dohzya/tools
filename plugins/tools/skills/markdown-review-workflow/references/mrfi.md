# MRFI — Markdown Robust Fragment Identifiers

MRFI creates durable references to passages in Markdown documents that survive edits. Resolution is evidence-based: a locator carries multiple independent signals (hashes, anchors, structural path, context windows), and the resolver combines them to relocate the passage. In dz-review, MRFI backs both persistent item IDs and passage references in review threads.

## Reference Forms in Review Context

| Form                  | Meaning                                                 | Example                           |
| --------------------- | ------------------------------------------------------- | --------------------------------- |
| `^stable-id`          | Anchor in target doc (`<!-- ^stable-id -->`)            | `ref: source.md:82^install_sdk`   |
| `~GdwjSq`             | Compact dz-review item ID (generated, no `rvw_` prefix) | `ref: source.md:82~GdwjSq`        |
| `~{v0;key=value;...}` | Debug encoding (rare in reviews, valid)                 | `~{v0;r=42:1-42:68;fh=xxh64:...}` |

Anchors (`^`) are not MRFI locators; they resolve by ID lookup. Compact references (`~`) are MRFI locators encoded in Hangul or Base62.

## Passage References (`ref:` comments)

Syntax:

```markdown
<!-- ref: file.md:82~GdwjSq -->
<!-- ref: file.md:82^stable-id -->
<!-- ref%2026-06-16T17:35:35+0200: file.md:82~GdwjSq -->
```

Multiple targets separated by `;`:

```markdown
<!-- ref: source.md:82~GdwjSq; ../other.md:40^anchor -->
```

Snapshots embed source text inline using labelled delimiters:

```markdown
<!-- ref%궩거깇걸:
  source.md:82~GdwjSq {&&rFZEOtB
  Passage content here.
  rFZEOtB&&};
-->
```

CLI commands:

| Command                             | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `dz-review ref check [file...]`     | Validate refs (stale snapshots, missing targets) |
| `dz-review ref list [file...]`      | List refs and referenced passages                |
| `dz-review ref show [file...]`      | Print docs with referenced passages expanded     |
| `dz-review ref snapshots [file...]` | Print only snapshot blocks                       |

## MRFI-Backed Persistent IDs

dz-review assigns stable item IDs using MRFI references internally. IDs survive document edits (reordering, adding/removing sections). The mapping is stored in `.dz-review/reference-map.json`. The agent does not manage this directly -- it is handled by `dz-review session start` and `dz-review session done`.

## Resolution Statuses

| Status      | Meaning                                | Agent action                  |
| ----------- | -------------------------------------- | ----------------------------- |
| `exact`     | Single candidate, exact evidence match | Safe to act on                |
| `confident` | Single best candidate, clear margin    | Safe to act on                |
| `ambiguous` | Multiple candidates, cannot separate   | Re-snapshot or ask human      |
| `stale`     | Location found but content contradicts | Update reference, investigate |
| `not_found` | No candidate anywhere in document      | Investigate, regenerate       |
| `invalid`   | Locator cannot be decoded              | Fix the reference             |

When `dz-review ref check` reports issues, re-snapshot the reference or update it. Read-only operations may use any status; destructive edits require `exact` or `confident` plus a strong signal.

## Generation Profiles

| Profile   | Fields                              | Use                     |
| --------- | ----------------------------------- | ----------------------- |
| `min`     | `r`, `fh`, `hh`, `a` (when present) | Smallest useful locator |
| `default` | min + `p`, `ctx`, `doc`             | Standard balance        |
| `full`    | default + `o`, `ph`                 | Maximum resilience      |

dz-review uses these profiles when generating passage references. The `q` (quote) field is opt-in only in all profiles.

## Further Reading

Full normative spec: `docs/specs/mrfi.md`. MRFI resolution and generation are implemented by `md` (markdown-surgeon); dz-review reuses them via an adapter.
