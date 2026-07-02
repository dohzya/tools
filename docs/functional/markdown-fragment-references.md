---
category: functional
themes:
  - markdown
  - references
  - mrfi
  - cli
verified_at: 2026-07-01
language: en-US
---

# Markdown Fragment References

Markdown Fragment References define the shared user-facing contract for robust Markdown passage lookup in `md` and `dz-review`.

This document promotes the decisions derived from the exploratory MRFI draft in [`../refs/2026-06-30-1538-spec-mrfi.md`](../refs/2026-06-30-1538-spec-mrfi.md). The draft remains reference material; this page is the functional source of truth for the first implementation in this repository.

## Goal

A reference identifies a Markdown passage after the file has changed.

References are meant to be opaque to ordinary callers. A compact MRFI value may contain physical ranges, structural paths, exact hashes, fuzzy hashes, local context, quoted text, and other locator evidence, but client code should treat the value as a blob and ask the resolver for a result.

Resolvers must return confidence and ambiguity information rather than silently choosing a weak match.

## CLI Reference Syntax

MRFI itself only defines inline `~<mrfi>` and `~{<mrfi>}` references. The shared `md` and `dz-review` CLIs additionally accept witness text on positional resolver inputs:

| Form                 | Meaning                                             |
| -------------------- | --------------------------------------------------- |
| `^<anchor>`          | Resolve a stable Markdown anchor.                   |
| `~<mrfi>`            | Resolve an opaque MRFI locator.                     |
| `~<mrfi>::<witness>` | Resolve an MRFI locator with optional witness text. |

Anchors do not accept witness text. Because `:` is a valid anchor character, `::` inside a `^<anchor>` input is treated as part of the anchor ID, not as witness syntax.

For CLI MRFI references with witness text, split the argument at the first `::`. The text after `::` is witness text and may contain additional `::` sequences. This `::witness` suffix is not part of the MRFI inline syntax.

Examples:

```bash
md resolve guide.md ^install_sdk
md resolve guide.md ~8F3az91KqP6w
md resolve guide.md '~8F3az91KqP6w::Pour installer le SDK Acme'
md resolve guide.md '~abc::old text' ~def ^stable-anchor
```

## Anchors

The baseline stable anchor syntax is an HTML comment:

```markdown
<!-- ^install_sdk -->
```

Anchor IDs may contain ASCII letters, digits, `_`, `-`, `.`, and `:`.

Anchors should be unique within a document. If duplicate anchors exist, the resolver must report ambiguity instead of treating the first occurrence as authoritative.

`md` owns this Markdown-level anchor behavior. `dz-review` must reuse the same anchor semantics when review references point at Markdown passages.

## MRFI Locators

An MRFI locator is encoded after `~`.

The visible value is opaque. The resolver decodes it into locator evidence, generates candidates from the current document, scores them, and classifies the result.

The first implementation may support a limited MRFI profile, but the user contract must already preserve these properties:

- `~<mrfi>` is a durable reference, not a display-only short ID.
- Resolution may use multiple evidence signals.
- Resolution may fail or be ambiguous.
- Destructive operations must not run on ambiguous or stale results.

## Witness Text

Witness text is optional text supplied by the caller for an MRFI lookup.

It represents the caller's previous or expected understanding of the target passage. It is not part of the inline reference itself and must not be accepted for anchors.

The MRFI `q` field and runtime `::witness` text have the same evidence semantics. `q` is embedded in the locator, while `::witness` is supplied at resolution time. When both are present, the resolver uses the runtime witness because it may be fresher than the locator. Generators should not include `q` by default.

JSON output must not echo witness text or embedded private diagnostic input unless the value is part of the resolved passage itself.

Witness text may improve candidate generation and scoring, but it must not override contradictory locator evidence by itself. For destructive edits, witness text is only allowed to increase confidence when it agrees with at least one locator signal such as anchor, structure, exact hash, fuzzy hash, context, or nearby physical range.

## Reference Generation Command

`md outline` may expose generated MRFI references for sections:

```bash
md outline --mrfi guide.md
md outline --mrfi --format debug guide.md
md outline --mrfi --format base62 guide.md
md outline --mrfi --quote guide.md
md outline --mrfi --profile full guide.md
```

Generated output must keep the legacy exact section ID visible for retrocompatibility and add the MRFI reference as an additional selector.

By default, generated MRFI references use the Hangul compact representation. `--format debug` produces the human-readable debug representation, and `--format base62` produces the ASCII compact representation.

Generated references use the default MRFI profile unless another profile is requested. The default profile includes physical range `r`, structural path `p`, exact fragment hash `fh`, fuzzy heading hash `hh`, context hashes `ctx`, and nearby anchor `a` when present.

Generated references omit `q=` by default. The `--quote` option explicitly embeds quote evidence, capped by `--quote-max` with a default of 80 Unicode scalar values. When quote text is longer than the cap, generators keep the beginning, middle, and end, separated by `...`.

`md ref` generates an MRFI reference from an arbitrary source selection:

```bash
md ref guide.md 42:1-42:68
md ref guide.md 42:1-42:68 --format debug
md ref guide.md 42:1-42:68 --format base62
md ref guide.md 42:1-42:68 --quote
md ref guide.md 42:1-42:68 --profile min
```

Selections use one-based source coordinates and an exclusive end column: `startLine:startColumn-endLine:endColumn`.

`md ref` is also the reference-format conversion surface:

```bash
md ref '~{v0;r=42:1-42:68;hh=smh64:91a4e8f00c13aa72}' --format debug
md ref '~{v0;r=42:1-42:68;hh=smh64:91a4e8f00c13aa72}' --format base62
md ref '~{v0;r=42:1-42:68;hh=smh64:91a4e8f00c13aa72}' --format hangul
```

The compact codec must round-trip supported debug fields into the same resolver object model. The implemented compact profile covers the fields generated by `md`: `a`, `r`, `o`, `p`, `fh`, `hh`, `ph`, `ctx`, `doc`, and optional `q`.

## Generation Profiles

`md` exposes three generation profiles. Profiles only choose which fields are emitted; they do not change the semantics of any individual field.

| Profile   | Fields                                                                 | Intended use                                                |
| --------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `min`     | `r`, `fh`, `hh`, plus `a` and `q` when available or requested          | Smallest locator that is still useful after simple edits.   |
| `default` | `min` plus `p` and `ctx`                                               | Best current balance between recovery probability and size. |
| `full`    | `default` plus `o`, `ph`, `doc`, and any other supported safe evidence | Diagnostics, experiments, and future resolver improvements. |

The current default is based on measured size and resolver contribution:

| Field | Approximate debug cost | Current resolver value                                                       | Default decision      |
| ----- | ---------------------- | ---------------------------------------------------------------------------- | --------------------- |
| `a`   | low                    | Strong signal when a unique stable anchor is near the passage.               | Include when present. |
| `r`   | low                    | Fast direct lookup when edits did not move the passage much.                 | Include.              |
| `fh`  | medium                 | Strong exact recovery when the passage moved but did not change.             | Include.              |
| `hh`  | medium                 | Fuzzy recovery inside a similar heading or scope.                            | Include.              |
| `p`   | medium                 | Structural fallback when line numbers drift but Markdown shape remains.      | Include.              |
| `ctx` | medium                 | Local disambiguation when the fragment changes but surrounding text remains. | Include.              |
| `o`   | low                    | Mostly redundant with `r` for current resolution.                            | Full only.            |
| `ph`  | medium                 | Promising for modified long passages, but not yet a primary resolver signal. | Full only.            |
| `doc` | medium                 | Useful for diagnostics and wrong-file detection, not passage recovery.       | Full only.            |
| `q`   | variable               | Same evidence semantics as witness text and may leak content.                | Opt-in only.          |

On a representative debug reference, `min` was 64 characters, `default` was 116, and `full` was 172. The default profile pays roughly the same extra size over `min` as `full` pays over `default`, but its added fields are the ones with the strongest current recovery value.

## Resolve Command

`md` should expose the reference resolver directly:

```bash
md resolve <file> <ref-or-ref-with-witness>...
```

The command accepts one or more references in the same invocation.

Each positional input must be one of:

- `^<anchor>`
- `~<mrfi>`
- `~<mrfi>::<witness>`

The command must reject:

- malformed references;
- empty witness text after `::`, unless a later product decision explicitly gives empty witness text meaning.

## Resolver Output

Each resolved reference returns:

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `ref`         | The requested `^<anchor>` or `~<mrfi>` without witness.                |
| `status`      | `exact`, `confident`, `ambiguous`, `stale`, `not_found`, or `invalid`. |
| `confidence`  | Public confidence value from `0` to `1`.                               |
| `range`       | Resolved source range, when a primary passage is available.            |
| `passage`     | Resolved Markdown source passage, when available.                      |
| `anchor`      | Matched anchor ID, when available.                                     |
| `diagnostics` | Human-readable evidence and conflict messages.                         |
| `candidates`  | Candidate list for ambiguous or diagnostic output.                     |

JSON output must include the resolved passage text when a primary passage is available. It must not echo witness text.

## Text Output

Text output is optimized for humans and agents reading terminal output.

The first line of each result is:

```text
<ref> <status> <confidence> [<range>] [^<anchor>]
```

Optional diagnostic lines follow the header. If a primary passage is available, it is printed after a blank line with every passage line indented by four spaces.

Batch output does not need an explicit separator. A new result starts at the next non-indented header line beginning with `~` or `^`.

Example:

```text
~8F3az91KqP6w confident 0.86 L42-L47 ^install_sdk
reasons: fuzzy heading match, context suffix match

    ## Installation rapide

    Pour installer le SDK Acme, lancez simplement la commande suivante.

^config exact 1.00 L80-L82

    ## Configuration

    Activez l'option.
```

For `ambiguous`, the resolver should prefer candidate summaries over a primary passage unless product behavior later defines a clear "best candidate" display.

## JSON Output

JSON output returns one object per input reference, even when there is only one input.

Illustrative shape:

```json
[
  {
    "ref": "~8F3az91KqP6w",
    "status": "confident",
    "confidence": 0.86,
    "range": "L42-L47",
    "anchor": "install_sdk",
    "passage": "## Installation rapide\n\nPour installer le SDK Acme.",
    "diagnostics": [
      "fuzzy heading match",
      "context suffix match"
    ]
  },
  {
    "ref": "^missing",
    "status": "not_found",
    "confidence": 0,
    "diagnostics": [
      "anchor not found"
    ]
  }
]
```

## Extension Fields

Debug references may carry any field name `md` does not recognize (by convention starting with `_`, e.g. `_kind`), with an opaque string value. `md` preserves them verbatim without interpreting them: it ignores them for resolution, keeps them on `ref --format debug` round-trips, and carries them through `base62`/`hangul` conversion under that same name (as a small compact map entry), so nothing is silently dropped.

This lets a consumer such as `dz-review` attach its own evidence (e.g. an annotation kind or source file hint) to a reference and use it in its own resolution logic, without `md` needing to know what the field means. Field names are not centrally allocated, so two independent consumers could pick the same name for different meanings; this is an accepted tradeoff for keeping `md` free of application-specific vocabulary.

## Relationship Between `md` And `dz-review`

`md` provides the Markdown-level resolver for `^<anchor>` and `~<mrfi>`.

`dz-review` is a review-workflow superset of `md`: it adds conversations, annotations, review statuses, snapshots, and agent actions, but it should not define incompatible reference semantics.

When `dz-review` needs to locate a Markdown passage, review conversation, or annotation by durable reference, it should reuse the same anchor and MRFI resolution contract. Review-specific identifiers may contain review evidence, but their user-facing `~<mrfi>` behavior should remain compatible with `md`.

## Safety

Read-only commands may report `ambiguous`, `stale`, `not_found`, or `invalid` results.

Commands that edit or delete Markdown must require `exact` or `confident` resolution. Destructive commands should additionally require at least one strong locator signal such as exact hash, unique anchor, both context hashes, or witness agreement with locator evidence.

Tools must not silently edit the best candidate of an ambiguous result.
