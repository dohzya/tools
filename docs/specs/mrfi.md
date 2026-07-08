---
category: specs
themes:
  - markdown
  - references
  - mrfi
verified_at: "2026-07-09"
language: en-US
---

# MRFI — Markdown Robust Fragment Identifiers

MRFI defines a durable, compact way to reference a passage inside a Markdown document, designed to keep working after the document has been edited.

This page is the spec source of truth for MRFI itself: the reference format, its evidence fields, the resolution contract, and the comparison contract. It supersedes `docs/functional/markdown-fragment-references.md`, which is retired — its CLI-facing content (witness syntax, generation/resolve commands, output rendering) now belongs to the specs of consuming tools such as `md` and `dz-review` (see [Relationship With Host Tools](#relationship-with-host-tools)).

## Scope

MRFI defines:

- the reference forms and encodings;
- the locator evidence fields and their semantics;
- the extent selection rules that turn a reference into a scope reference;
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
- Unknown field keys must be preserved verbatim, not dropped. Preservation is a transport property only; whether a resolver may _act_ on a locator carrying unknown keys is stricter (see [Must-Understand Fields](#must-understand-fields)).
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

| Field | Name            | Value                                                                                                                     | Role                                                                                                                                                                                     |
| ----- | --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`   | version         | Format version (`v0`).                                                                                                    | Governs field vocabulary and encoding layout.                                                                                                                                            |
| `a`   | anchor          | ID of a stable anchor at or immediately before the passage.                                                               | Strong signal when the anchor is unique in the document.                                                                                                                                 |
| `r`   | range           | Physical source range of the passage at generation time, full `line:col` precision.                                       | Fast direct lookup when edits did not move the passage much. Weak alone; positional evidence only.                                                                                       |
| `o`   | offset          | UTF-8 byte offset range of the passage at generation time (`start-end`, end exclusive).                                   | Redundant with `r`; convenience for byte-oriented tooling.                                                                                                                               |
| `p`   | path            | Structural path from the document root to the passage: ordered node steps with sibling indices (e.g. `h1[1]/h2[3]/p[2]`). | Survives line drift as long as the Markdown shape around the passage remains.                                                                                                            |
| `fh`  | fragment hash   | Exact hash of the normalized passage text.                                                                                | Strong exact recovery when the passage moved but did not change. Equality proves same _content_, not same passage.                                                                       |
| `hh`  | heading hash    | Fuzzy (similarity-preserving) hash of the enclosing heading/scope text.                                                   | Graded recovery inside a similar heading or scope, tolerant to small heading edits.                                                                                                      |
| `ph`  | passage hash    | Fuzzy (similarity-preserving) hash of the passage body.                                                                   | Graded recovery and similarity measurement when the passage itself was modified.                                                                                                         |
| `ctx` | context hashes  | Pair `before,after`: hashes of a fixed-size text window immediately before and after the passage.                         | Local disambiguation when the fragment changes but surrounding text remains. Each side matches independently.                                                                            |
| `doc` | document hash   | Fuzzy hash of the whole document at generation time.                                                                      | Wrong-file detection; makes `r`/`o` comparable across references; low direct value for passage recovery.                                                                                 |
| `q`   | quote           | Literal excerpt of the passage. When capped, keeps beginning, middle, and end, separated by `...`.                        | Human-readable evidence with the same semantics as witness text. May leak content; opt-in only.                                                                                          |
| `x`   | extent selector | One of `sec`, `body`, `lead` (registered small codes in compact encodings).                                               | Turns the reference into a [scope reference](#extent-selection): evidence designates an identity node, the resolved extent is computed structurally at resolution time. Must-understand. |

Fuzzy hashes must support a graded distance (e.g. Hamming distance for simhash-family tags), not just equality; this is what enables scoring and [comparison](#comparing-references-without-resolving).

### Extension Fields

A locator may carry any field name this spec does not define, by convention starting with `_` (e.g. `_kind`), with an opaque string value.

Implementations preserve extension fields verbatim: they ignore them for resolution and scoring, keep them on debug round-trips, and carry them through compact encodings under the same name. Nothing is silently dropped.

This lets a consumer such as `dz-review` attach its own evidence to a reference and use it in its own logic, without the core resolver knowing what the field means. Field names are not centrally allocated; two independent consumers could pick the same name for different meanings. This is an accepted tradeoff for keeping the core vocabulary application-free.

## Extent Selection

By default, an MRFI reference designates exactly the passage captured at generation time: the evidence fields describe that passage, and the resolved extent is that passage, recovered wherever it now lives.

The `x` field turns a reference into a **scope reference**. A scope reference separates two things that plain references conflate:

- the **identity node** — the single block all evidence fields describe. `r`, `fh`, `ctx`, `q`, etc. are captured on it at generation time, and resolution recovers it exactly as it would a plain reference.
- the **resolved extent** — computed from the resolved identity node by applying the selection rule to the **current** document structure.

The extent is never stored. Content added, removed, or reordered inside the scope — including at its very beginning or very end — belongs to the extent by construction, because the extent is recomputed at every resolution.

### Selection Rules

For every `x` value defined in `v0`, the identity node must be a single ATX or setext heading that is a direct child of the document root. Headings nested inside containers (block quotes, list items) are ordinary content: they can neither serve as identity nodes nor terminate an extent. A heading-looking line inside a fenced code block is not a heading. Generators must refuse to emit a scope reference on any other node kind.

Let `H` be the resolved identity heading and `L` its level (1–6) **in the current document**. If the heading's level changed since generation, the current level governs: the reference follows the document's present structure, not its remembered one.

| `x`    | Extent                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sec`  | `H` itself, plus every root-level block after `H`, up to but excluding the first subsequent root-level heading of level ≤ `L`, or to the end of the document. Sub-sections (headings of level > `L` and their content) are included. |
| `body` | Same as `sec`, minus the `H` block itself.                                                                                                                                                                                           |
| `lead` | Every root-level block after `H`, up to but excluding the first subsequent root-level heading of **any** level, or to the end of the document.                                                                                       |

`lead ⊆ body ⊆ sec` always holds. Only root-level headings terminate an extent; thematic breaks and every other block kind never do.

Boundary precision:

- The resolved `range` starts at the first character of the first included block and ends at the end of the last included block. Blank lines before the first block and after the last block are excluded from the range; blank lines between included blocks are included.
- `body` and `lead` may be empty: a heading immediately followed by a terminating heading or by the end of the document. An empty extent is a valid result, not a failure: `range` is the zero-length position at the start of the line following the `H` block (`start == end`), and `passage` is the empty string. This position is exactly where content belonging to the scope would be inserted.

### Interaction With Evidence And Statuses

- All evidence fields describe the identity node, never the extent. For a scope reference, `fh` hashes the heading text, `ph` fuzzy-hashes the same heading text (short input: expect coarse granularity), `r` is the heading's source range, `ctx` is the window around the heading, `q` quotes the heading. `hh` keeps its usual meaning — the _enclosing_ heading — which for a root-level identity heading is its parent heading, or absent.
- For a scope reference, `ctx.after` covers the beginning of the scope's own content — precisely the text this reference form allows to change. It is therefore structurally weaker than usual: expected to degrade over the document's life, gracefully (graded, per-side evidence), but scoring should not be surprised by its failure. If measurements show it pollutes scope-reference scoring, the candidate fix is an asymmetric `ctx` (before side only) when `x` is present; this is not adopted until measured.
- Candidate generation for a scope reference only considers root-level heading nodes. If the evidence converges on a location whose node is no longer such a heading (e.g. the heading was demoted to plain text), the result is `stale`.
- Changed, added, or removed content _inside_ the scope is the nominal case, not `stale`. For scope references, `stale` applies to the identity node only.
- `v0` deliberately captures no hash of the extent. "Has the section content changed since generation" is a consumer concern; such evidence travels in an [extension field](#extension-fields) until measured valuable enough to promote.
- `x` is orthogonal to [generation profiles](#generation-profiles): it expresses caller intent and is never added or removed by a profile.

### Must-Understand Fields

`x` changes what the resolved extent _means_. A resolver that ignored it would resolve the heading alone and present it as the passage — a wrong extent, and a dangerous one for destructive operations.

`v0` therefore closes its field vocabulary: at resolution and comparison time, any field key that is neither defined by this spec nor an extension field (leading `_`) makes the locator `invalid`. Encoding, decoding, and re-encoding still preserve unknown keys verbatim (see [Encodings](#encodings)): preservation is a transport property, acceptance is a resolution property. Every future core field is thereby must-understand by construction; a field that must be safely ignorable belongs in the extension namespace.

## Witness Evidence

A resolver may accept optional _witness text_ alongside a locator: text supplied by the caller at resolution time, representing the caller's previous or expected understanding of the target passage.

- Witness text and the embedded `q` field have the same evidence semantics. When both are present, the resolver uses the witness, because it may be fresher than the locator.
- Witness text may improve candidate generation and scoring, but it must not override contradictory locator evidence by itself.
- For destructive edits, witness text may only increase confidence when it agrees with at least one locator signal (`a`, `p`, `fh`, `hh`, `ph`, `ctx`, or a nearby `r`).
- Resolver outputs must not echo witness text (or other caller-supplied diagnostic input) back to the caller. The caller already has it; echoing it only inflates output size, which matters when the caller is an agent paying per token. Witness text may still appear where it is genuinely part of the resolved passage. Diagnostics may state that a witness agreed or disagreed without quoting it.

How witness text is passed (argument syntax, API parameter) is a host-tool concern.

## Resolution

Resolution takes a current document plus a locator (and optional witness), decodes the locator into evidence, generates candidate passages from the document, scores them against the evidence, and classifies the outcome.

### Evidence Roles

Locator fields play two distinct roles during resolution:

- **Candidate generation** — evidence that can, by itself, propose passages from the current document: `r`/`o` (direct position), `a` (anchor occurrences), `fh` (exact-content scan), `ctx` (window-hash scan), `p` (structural walk), `hh` (per-section fuzzy match; sections are enumerable).
- **Candidate scoring** — evidence evaluated _against_ an already-proposed candidate to confirm it, contradict it, or separate it from rivals: every generating field also scores, and `ph`, `doc`, `q`, and witness text score without generating.

`ph` is scoring-only in `v0`: a fuzzy hash of an arbitrary span cannot enumerate candidates at acceptable cost. Its scoring role is threefold:

1. **Confirmation.** When positional or structural evidence converges on a candidate whose `fh` fails, a `ph` distance within its match threshold is positive content evidence that the passage was _modified in place_ rather than replaced. Resolvers must treat this as agreement (the result may be `confident`, not `stale`) and may raise confidence accordingly. When both are present, `ph` outranks `hh` as content evidence about the passage: `hh` describes the surrounding scope, `ph` the passage itself.
2. **Contradiction.** A `ph` distance beyond its match threshold on such a candidate is a content contradiction, with the same effect as an `fh`, `ctx`, or `hh` contradiction: it pushes the candidate toward `stale` and triggers the fallback evidence in turn.
3. **Disambiguation.** When any branch yields several candidates that tie on their own evidence (context ties, fuzzy heading candidates within the ambiguity margin), the resolver must score each candidate's passage body against `ph`; if `ph` separates them by the required margin, it may elect a single best candidate instead of reporting `ambiguous`. Per-candidate `ph` distance appears in candidate reasons.

Like every fuzzy field, `ph` uses the graded distance defined by its tag, with an implementation-defined, documented, stable match threshold (see [Confidence](#confidence)). A future bounded candidate generator for `ph` (e.g. block-level spans only) would require a spec update; nothing in `v0` permits fuzzy scanning of arbitrary spans.

### Statuses

| Status      | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exact`     | A single candidate agrees with exact evidence: `fh` matches, or a unique anchor matches with no contradicting content evidence. Confidence is `1.0`.                                                                                                                                                                                                                                                                                                                      |
| `confident` | A single best candidate scores at or above the confident threshold, with a clear margin over the runner-up and no unresolved strong contradiction.                                                                                                                                                                                                                                                                                                                        |
| `ambiguous` | Two or more candidates cannot be separated by the required margin. Includes duplicate anchors and duplicated content (`fh` matching several passages) without a discriminating signal.                                                                                                                                                                                                                                                                                    |
| `stale`     | Positional and structural evidence (`r`, `o`, `p`, `a`, `ctx`) converge on a location, but content evidence contradicts it: `fh` fails **and every present fuzzy content signal (`ph` on the passage body, `hh` on the enclosing scope) is below its match threshold**. The passage as referenced is gone from where it should be. Conversely, an in-threshold `ph` on the converged location means the passage was modified in place and is _not_ `stale` on that basis. |
| `not_found` | No candidate reaches the minimum evidence score anywhere in the document.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `invalid`   | The locator cannot be decoded or violates the format. No resolution is attempted.                                                                                                                                                                                                                                                                                                                                                                                         |

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
- For scope references, the strong-signal requirement applies to the identity node; the destructive operation then acts on the computed extent. The extent being larger than the identity node is by design and requires no additional evidence.
- `ph` agreement is graded evidence, never a strong locator signal: a fuzzy passage-body match must not, by itself, satisfy the strong-signal requirement for destructive operations. (It may still contribute to reaching `confident` status.)

## Comparing References Without Resolving

Two references can be compared field by field, without the document, to estimate whether they designate the same passage. The primary use case is ranking: given a target reference and many candidate references, order the candidates from most to least likely to match, so that expensive resolutions can be attempted in the best order.

### Pairwise Comparison

`compare(A, B)` evaluates every field present in both references:

| Field      | Comparison                                                                                     | Strength                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `fh`       | Equality (same tag required).                                                                  | Near-proof of same content. Not proof of same passage if the content is duplicated.                                                          |
| `a`        | ID equality.                                                                                   | Very strong when anchors are unique; comparison alone cannot verify uniqueness.                                                              |
| `hh`, `ph` | Graded distance defined by the tag (e.g. Hamming for simhash).                                 | The core graded signals for ranking. `ph` compares the passage itself, `hh` its scope.                                                       |
| `ctx`      | Per-side equality (before / after independently).                                              | Strong, especially when both sides match.                                                                                                    |
| `p`        | Length of common structural prefix; equality of full path.                                     | Medium; sensitive to structural edits between generation times.                                                                              |
| `doc`      | Graded distance.                                                                               | Gates positional comparison; strong _negative_ signal when very distant (different documents).                                               |
| `r`, `o`   | Overlap / distance, **only when `doc` is compatible** (equal or above a similarity threshold). | Weak alone; meaningless across unrelated documents.                                                                                          |
| `q`        | Text similarity.                                                                               | Same semantics as witness evidence; graded.                                                                                                  |
| `x`        | Value equality, where absence counts as the plain-extent default.                              | Not evidence about location: a mismatch means the two references designate different extents even when their identity evidence fully agrees. |

Fields present in only one reference contribute nothing — neither agreement nor conflict. `x` is the one exception: its absence is a value (plain extent), not missing evidence, so it always participates in the comparison.

An `x` mismatch caps the verdict at `possible`. When identity evidence otherwise agrees strongly, per-candidate detail should state it explicitly (same identity node, different extent): such pairs are related for a human, but must not rank as `same` or `likely`.

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

| Field | Approx. debug cost | Resolver value                                                                                                                                                            | Comparison value                             | Decision                                           |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `a`   | low                | Strong when a unique stable anchor is near the passage.                                                                                                                   | Very strong on ID equality.                  | Include when present.                              |
| `r`   | low                | Fast direct lookup when edits did not move the passage much.                                                                                                              | Weak; only meaningful with compatible `doc`. | Include.                                           |
| `fh`  | medium             | Strong exact recovery when the passage moved but did not change.                                                                                                          | Near-proof on equality.                      | Include.                                           |
| `hh`  | medium             | Fuzzy recovery inside a similar heading or scope.                                                                                                                         | Graded scope similarity.                     | Include.                                           |
| `p`   | medium             | Structural fallback when line numbers drift but shape remains.                                                                                                            | Medium (common-prefix length).               | Include in `default`.                              |
| `ctx` | medium             | Local disambiguation when the fragment changes but surroundings hold.                                                                                                     | Strong per-side equality.                    | Include in `default`.                              |
| `doc` | medium             | Wrong-file detection only; not passage recovery.                                                                                                                          | High: gates `r`/`o`, strong negative signal. | **Include in `default`** (changed; see note).      |
| `o`   | low                | Mostly redundant with `r`.                                                                                                                                                | Same as `r`.                                 | `full` only.                                       |
| `ph`  | medium             | Graded scoring signal on the passage body: confirms modified-in-place passages, contradicts stale locations, tie-breaks ambiguous candidates. Never generates candidates. | Best graded signal on the passage body.      | `full` only; first promotion candidate (see note). |
| `q`   | variable           | Same semantics as witness text.                                                                                                                                           | Graded text similarity.                      | Opt-in only.                                       |

Notes on the current decisions:

- `doc` was previously `full`-only based on resolver value alone. The comparison use case changes its calculus: it is the field that makes positional evidence comparable across references and cheaply rules out unrelated documents. Its promotion to `default` is proposed on that basis and must be confirmed by re-measuring default reference sizes against recovery/ranking benefit.
- `ph` is the next promotion candidate. Its resolution role is now specified (scoring-only: see [Evidence Roles](#evidence-roles)) and comparison already consumes it; promotion to `default` awaits measurement of recovery and ranking benefit against the size cost. A possible later step — a bounded `ph` candidate generator — is a separate decision requiring its own spec change.
- Reference sizes must be re-benchmarked after the `doc` change. Previous measurements on a representative debug reference: `min` 64 characters, `default` 116, `full` 172.

## Relationship With Host Tools

`md` provides the Markdown-level implementation of this spec: anchor and MRFI resolution, generation, encoding conversion, and comparison. Its own spec defines the CLI surface (reference argument syntax, witness passing, output rendering, batch behavior, commands such as `outline`, `ref`, `resolve`).

`dz-review` is a review-workflow superset of `md`: it adds conversations, annotations, review statuses, snapshots, and agent actions. It must reuse the anchor and MRFI contracts defined here without introducing incompatible reference semantics. Review-specific evidence travels in [extension fields](#extension-fields).

Legacy exact section IDs remain a host-tool retrocompatibility concern: generators there must keep them visible alongside MRFI references, but they are not part of MRFI.
