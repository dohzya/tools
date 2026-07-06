---
category: specs
themes:
  - markdown
  - references
  - mrfi
verified_at: 2026-07-06
language: en-US
---

# MRFI — Markdown Robust Fragment Identifiers

MRFI defines a durable, compact way to reference a passage inside a Markdown document, designed to keep working after the document has been edited.

This page is the spec source of truth for MRFI itself: the reference format, its evidence fields, the resolution contract, and the comparison contract. It supersedes `docs/functional/markdown-fragment-references.md`, which is retired — its CLI-facing content (witness syntax, generation/resolve commands, output rendering) now belongs to the specs of consuming tools such as `md` and `dz-review` (see [Relationship With Host Tools](#relationship-with-host-tools)).

## Scope

MRFI defines:

- the reference forms and encodings;
- the locator evidence fields and their semantics;
- the resolution contract: inputs, statuses, confidence, output model, safety rules;
- the comparison contract: comparing and ranking references without resolving them.

MRFI does not define host-tool concerns. Command-line syntax, how witness text is passed at the call site, output rendering (text layout, JSON envelope), and generation commands belong to the specs of consuming tools such as `md` and `dz-review`. Those tools must implement the contracts defined here without changing their semantics.

## Design Principles

- A reference identifies a Markdown passage after the file has changed.
- References are opaque to ordinary callers. Client code treats the value as a blob and asks the resolver for a result.
- Resolution is evidence-based: a locator carries multiple independent signals, and the resolver combines them.
- Resolvers must return confidence and ambiguity information rather than silently choosing a weak match.
- Destructive operations must never run on ambiguous or stale results.

## Reference Forms

An MRFI reference is written after a `~` sigil:

| Form         | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `~<compact>` | Compact encoding (Hangul or Base62).               |
| `~{<debug>}` | Debug encoding: human-readable `key=value` fields. |

Debug form example:

```text
~{v0;r=42:1-42:68;fh=xxh64:0f3c96aa51d2e807;hh=smh64:91a4e8f00c13aa72}
```

Anchors use a distinct sigil, `^<anchor>`, and are not MRFI locators; see [Anchors](#anchors).

## Encodings

Three encodings carry the same object model and must round-trip losslessly through it:

- **debug** — `~{v0;key=value;...}`, human-readable, for diagnostics and documentation.
- **base62** — ASCII compact representation.
- **hangul** — default compact representation, denser per visible character.

Encoding rules:

- Conversion between encodings must preserve every supported field, including [extension fields](#extension-fields).
- Hangul values must be emitted in Unicode NFC. Decoders must normalize input to NFC before decoding, because transport layers (clipboards, file systems, some macOS tooling) may re-normalize precomposed syllables to NFD and would otherwise corrupt the reference.
- Unknown field keys must be preserved verbatim, not dropped.
- Hash algorithm tags are literal only in debug form; compact encodings use per-field defaults and registered codes (see [Locator Fields](#locator-fields)). Round-tripping through debug re-materializes the explicit tag.

## Anchors

The baseline stable anchor syntax is an HTML comment in the Markdown source:

```markdown
<!-- ^install_sdk -->
```

Anchor IDs may contain ASCII letters, digits, `_`, `-`, `.`, and `:`.

Anchors should be unique within a document. If duplicate anchors exist, resolvers must report ambiguity instead of treating the first occurrence as authoritative.

Anchors serve two roles: a directly resolvable reference (`^<anchor>`), and locator evidence inside an MRFI value (field `a`).

## Locator Fields

An MRFI locator is a set of evidence fields about one passage, captured at generation time.

All hash values are self-describing: they carry an algorithm tag (e.g. `xxh64:`, `smh64:`) that determines both the algorithm and the text normalization applied before hashing. Comparing two hash values requires identical tags. Tags allow algorithms to evolve without a format version bump.

Tags are only spelled out in the debug encoding. To keep compact references small, `v0` defines a default tag per hash field; compact encodings omit the tag when the field uses its default. A non-default known tag is encoded as a registered small code (about one symbol); an unknown tag falls back to literal encoding. In the nominal case, tags therefore cost nothing in `base62`/`hangul`.

Source coordinates are one-based `line:column`, with an exclusive end column: `startLine:startColumn-endLine:endColumn`.

| Field | Name           | Value                                                                                                                     | Role                                                                                                               |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `v`   | version        | Format version (`v0`).                                                                                                    | Governs field vocabulary and encoding layout.                                                                      |
| `a`   | anchor         | ID of a stable anchor at or immediately before the passage.                                                               | Strong signal when the anchor is unique in the document.                                                           |
| `r`   | range          | Physical source range of the passage at generation time, full `line:col` precision.                                       | Fast direct lookup when edits did not move the passage much. Weak alone; positional evidence only.                 |
| `o`   | offset         | UTF-8 byte offset range of the passage at generation time (`start-end`, end exclusive).                                   | Redundant with `r`; convenience for byte-oriented tooling.                                                         |
| `p`   | path           | Structural path from the document root to the passage: ordered node steps with sibling indices (e.g. `h1[1]/h2[3]/p[2]`). | Survives line drift as long as the Markdown shape around the passage remains.                                      |
| `fh`  | fragment hash  | Exact hash of the normalized passage text.                                                                                | Strong exact recovery when the passage moved but did not change. Equality proves same _content_, not same passage. |
| `hh`  | heading hash   | Fuzzy (similarity-preserving) hash of the enclosing heading/scope text.                                                   | Graded recovery inside a similar heading or scope, tolerant to small heading edits.                                |
| `ph`  | passage hash   | Fuzzy (similarity-preserving) hash of the passage body.                                                                   | Graded recovery and similarity measurement when the passage itself was modified.                                   |
| `ctx` | context hashes | Pair `before,after`: hashes of a fixed-size text window immediately before and after the passage.                         | Local disambiguation when the fragment changes but surrounding text remains. Each side matches independently.      |
| `doc` | document hash  | Fuzzy hash of the whole document at generation time.                                                                      | Wrong-file detection; makes `r`/`o` comparable across references; low direct value for passage recovery.           |
| `q`   | quote          | Literal excerpt of the passage. When capped, keeps beginning, middle, and end, separated by `...`.                        | Human-readable evidence with the same semantics as witness text. May leak content; opt-in only.                    |

Fuzzy hashes must support a graded distance (e.g. Hamming distance for simhash-family tags), not just equality; this is what enables scoring and [comparison](#comparing-references-without-resolving).

### Extension Fields

A locator may carry any field name this spec does not define, by convention starting with `_` (e.g. `_kind`), with an opaque string value.

Implementations preserve extension fields verbatim: they ignore them for resolution and scoring, keep them on debug round-trips, and carry them through compact encodings under the same name. Nothing is silently dropped.

This lets a consumer such as `dz-review` attach its own evidence to a reference and use it in its own logic, without the core resolver knowing what the field means. Field names are not centrally allocated; two independent consumers could pick the same name for different meanings. This is an accepted tradeoff for keeping the core vocabulary application-free.

## Witness Evidence

A resolver may accept optional _witness text_ alongside a locator: text supplied by the caller at resolution time, representing the caller's previous or expected understanding of the target passage.

- Witness text and the embedded `q` field have the same evidence semantics. When both are present, the resolver uses the witness, because it may be fresher than the locator.
- Witness text may improve candidate generation and scoring, but it must not override contradictory locator evidence by itself.
- For destructive edits, witness text may only increase confidence when it agrees with at least one locator signal (`a`, `p`, `fh`, `hh`, `ph`, `ctx`, or a nearby `r`).
- Resolver outputs must not echo witness text (or other caller-supplied diagnostic input) back to the caller. The caller already has it; echoing it only inflates output size, which matters when the caller is an agent paying per token. Witness text may still appear where it is genuinely part of the resolved passage. Diagnostics may state that a witness agreed or disagreed without quoting it.

How witness text is passed (argument syntax, API parameter) is a host-tool concern.

## Resolution

Resolution takes a current document plus a locator (and optional witness), decodes the locator into evidence, generates candidate passages from the document, scores them against the evidence, and classifies the outcome.

### Statuses

| Status      | Definition                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exact`     | A single candidate agrees with exact evidence: `fh` matches, or a unique anchor matches with no contradicting content evidence. Confidence is `1.0`.                                                                                                     |
| `confident` | A single best candidate scores at or above the confident threshold, with a clear margin over the runner-up and no unresolved strong contradiction.                                                                                                       |
| `ambiguous` | Two or more candidates cannot be separated by the required margin. Includes duplicate anchors and duplicated content (`fh` matching several passages) without a discriminating signal.                                                                   |
| `stale`     | Positional and structural evidence (`r`, `o`, `p`, `a`, `ctx`) converge on a location, but content evidence contradicts it: `fh` fails and fuzzy similarity is below the confident threshold. The passage as referenced is gone from where it should be. |
| `not_found` | No candidate reaches the minimum evidence score anywhere in the document.                                                                                                                                                                                |
| `invalid`   | The locator cannot be decoded or violates the format. No resolution is attempted.                                                                                                                                                                        |

`stale` is distinct from `not_found`: `stale` says "I know where it was, and it has changed"; `not_found` says "I have no idea where it is". The distinction matters for destructive-edit safety and for user guidance (regenerate the reference vs. investigate).

### Confidence

Confidence is a public value from `0` to `1`. `exact` is always `1.0`; `not_found` and `invalid` are `0`. Thresholds (confident, minimum evidence, ambiguity margin) are implementation-defined but must be documented and stable, and confidence must be monotone: a higher value always means stronger evidence agreement.

### Output Model

Each resolution returns:

| Field         | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `ref`         | The requested reference, without witness.                                                            |
| `status`      | One of the statuses above.                                                                           |
| `confidence`  | Public confidence value.                                                                             |
| `range`       | Resolved source range, when a primary passage is available, at the same `line:col` precision as `r`. |
| `passage`     | Resolved Markdown source passage, when available.                                                    |
| `anchor`      | Matched anchor ID, when available.                                                                   |
| `diagnostics` | Human-readable evidence and conflict messages.                                                       |
| `candidates`  | Candidate list for ambiguous or diagnostic output.                                                   |

For `ambiguous`, resolvers should return candidate summaries rather than electing a primary passage.

Candidate summaries and diagnostics are part of machine-consumed output; host tools must render them so that result boundaries remain unambiguous when several references are resolved in one call.

### Safety

- Read-only operations may act on any status.
- Operations that edit or delete Markdown require `exact` or `confident` resolution, **and** at least one strong locator signal: exact hash match, unique anchor match, both context hashes matching, or witness agreement with locator evidence.
- Tools must not silently edit the best candidate of an `ambiguous` result, and must not treat `stale` as a weaker `confident`.

## Comparing References Without Resolving

Two references can be compared field by field, without the document, to estimate whether they designate the same passage. The primary use case is ranking: given a target reference and many candidate references, order the candidates from most to least likely to match, so that expensive resolutions can be attempted in the best order.

### Pairwise Comparison

`compare(A, B)` evaluates every field present in both references:

| Field      | Comparison                                                                                     | Strength                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `fh`       | Equality (same tag required).                                                                  | Near-proof of same content. Not proof of same passage if the content is duplicated.            |
| `a`        | ID equality.                                                                                   | Very strong when anchors are unique; comparison alone cannot verify uniqueness.                |
| `hh`, `ph` | Graded distance defined by the tag (e.g. Hamming for simhash).                                 | The core graded signals for ranking. `ph` compares the passage itself, `hh` its scope.         |
| `ctx`      | Per-side equality (before / after independently).                                              | Strong, especially when both sides match.                                                      |
| `p`        | Length of common structural prefix; equality of full path.                                     | Medium; sensitive to structural edits between generation times.                                |
| `doc`      | Graded distance.                                                                               | Gates positional comparison; strong _negative_ signal when very distant (different documents). |
| `r`, `o`   | Overlap / distance, **only when `doc` is compatible** (equal or above a similarity threshold). | Weak alone; meaningless across unrelated documents.                                            |
| `q`        | Text similarity.                                                                               | Same semantics as witness evidence; graded.                                                    |

Fields present in only one reference contribute nothing — neither agreement nor conflict.

### Comparison Output

A similarity score alone is misleading: two `min` references sharing only `r` can score high on almost no evidence. Comparison must therefore return two axes plus a verdict:

- **similarity** — `0` to `1`, aggregated over shared fields.
- **comparability** — how much strong evidence the two references actually share (coverage-weighted).
- **verdict** — one of:

| Verdict        | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `same`         | Exact-strong agreement: `fh` equal, or `a` equal with no conflicting content evidence. Duplication caveat applies. |
| `likely`       | High similarity with good comparability and no strong conflict.                                                    |
| `possible`     | Some agreement, but low comparability or mixed signals.                                                            |
| `unrelated`    | Strong conflicts, e.g. distant `doc` plus mismatching content evidence.                                            |
| `incomparable` | No shared comparable field of sufficient strength (e.g. only `r` without compatible `doc`).                        |

`incomparable` is a distinct outcome from `unrelated`: "I cannot tell" is not "probably different".

### Ranking

`rank(target, candidates)` compares the target against each candidate and orders them by `(verdict class, similarity)`, reporting per-candidate detail: which fields matched, conflicted, or were absent. Ties are allowed and must be reported as ties.

### Properties And Limits

- Comparison is a **prefilter, not a decision**. Even `fh` equality does not guarantee the same passage (duplicated content). All [Safety](#safety) rules apply unchanged: ranking optimizes the order of resolutions; it never replaces them.
- The similarity score is **not a metric**: it is not transitive. `A ~ B` and `B ~ C` imply nothing about `A ~ C`. Naive clustering on pairwise scores is unsound and must not be presented as grouping "the same passage".
- Comparison quality grows with the generation profile: `min` references mostly compare through `fh` (binary) and `hh` (scope-level); `default` adds `ctx`, `p`, and `doc`; `full` adds `ph`, the best graded signal on the passage body.

## Generation Profiles

Generators expose three profiles. Profiles only choose which fields are emitted; they never change the semantics of any field.

| Profile   | Fields                                                       | Intended use                                                                |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `min`     | `r`, `fh`, `hh`, plus `a` when a suitable anchor is present  | Smallest locator that is still useful after simple edits.                   |
| `default` | `min` plus `p`, `ctx`, and `doc`                             | Best current balance between recovery probability, comparability, and size. |
| `full`    | `default` plus `o`, `ph`, and any other supported safe field | Diagnostics, experiments, maximum resilience and comparison quality.        |

`q` is opt-in only, in every profile: it carries the same evidence semantics as witness text and may leak content. When requested, quote text is capped (default 80 Unicode scalar values), keeping beginning, middle, and end separated by `...`.

Per-field decision basis:

| Field | Approx. debug cost | Resolver value                                                        | Comparison value                             | Decision                                           |
| ----- | ------------------ | --------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `a`   | low                | Strong when a unique stable anchor is near the passage.               | Very strong on ID equality.                  | Include when present.                              |
| `r`   | low                | Fast direct lookup when edits did not move the passage much.          | Weak; only meaningful with compatible `doc`. | Include.                                           |
| `fh`  | medium             | Strong exact recovery when the passage moved but did not change.      | Near-proof on equality.                      | Include.                                           |
| `hh`  | medium             | Fuzzy recovery inside a similar heading or scope.                     | Graded scope similarity.                     | Include.                                           |
| `p`   | medium             | Structural fallback when line numbers drift but shape remains.        | Medium (common-prefix length).               | Include in `default`.                              |
| `ctx` | medium             | Local disambiguation when the fragment changes but surroundings hold. | Strong per-side equality.                    | Include in `default`.                              |
| `doc` | medium             | Wrong-file detection only; not passage recovery.                      | High: gates `r`/`o`, strong negative signal. | **Include in `default`** (changed; see note).      |
| `o`   | low                | Mostly redundant with `r`.                                            | Same as `r`.                                 | `full` only.                                       |
| `ph`  | medium             | Promising for modified long passages; not yet a primary signal.       | Best graded signal on the passage body.      | `full` only; first promotion candidate (see note). |
| `q`   | variable           | Same semantics as witness text.                                       | Graded text similarity.                      | Opt-in only.                                       |

Notes on the current decisions:

- `doc` was previously `full`-only based on resolver value alone. The comparison use case changes its calculus: it is the field that makes positional evidence comparable across references and cheaply rules out unrelated documents. Its promotion to `default` is proposed on that basis and must be confirmed by re-measuring default reference sizes against recovery/ranking benefit.
- `ph` is the next promotion candidate: once resolvers and comparison actually consume it, its graded passage-body similarity is likely the single most valuable ranking signal for modified passages. It stays in `full` until that is measured.
- Reference sizes must be re-benchmarked after the `doc` change. Previous measurements on a representative debug reference: `min` 64 characters, `default` 116, `full` 172.

## Relationship With Host Tools

`md` provides the Markdown-level implementation of this spec: anchor and MRFI resolution, generation, encoding conversion, and comparison. Its own spec defines the CLI surface (reference argument syntax, witness passing, output rendering, batch behavior, commands such as `outline`, `ref`, `resolve`).

`dz-review` is a review-workflow superset of `md`: it adds conversations, annotations, review statuses, snapshots, and agent actions. It must reuse the anchor and MRFI contracts defined here without introducing incompatible reference semantics. Review-specific evidence travels in [extension fields](#extension-fields).

Legacy exact section IDs remain a host-tool retrocompatibility concern: generators there must keep them visible alongside MRFI references, but they are not part of MRFI.
