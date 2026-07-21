# MRFI -- Operational Reference

MRFI (Markdown Robust Fragment Identifiers) creates durable references to passages inside Markdown documents. References survive edits because resolution is evidence-based: a locator carries multiple independent signals (hashes, structural path, context windows) and the resolver combines them. Three encodings exist -- debug (human-readable), Hangul (compact default), and Base62.

## Reference Forms

| Form   | Syntax                            | Notes                                                                    |
| ------ | --------------------------------- | ------------------------------------------------------------------------ |
| Anchor | `^install_sdk`                    | HTML comment `<!-- ^install_sdk -->` in the source. Directly resolvable. |
| Debug  | `~{v0;r=42:1-42:68;fh=xxh64:...}` | Human-readable key=value pairs.                                          |
| Hangul | `~<hangul>`                       | Default compact encoding (NFC Unicode).                                  |
| Base62 | `~<base62>`                       | ASCII compact encoding.                                                  |

## Using MRFI With `md` Commands

### Generating references

List sections with MRFI refs:

```bash
md outline <file> --mrfi
md outline <file> --mrfi --format debug --profile full --quote
```

Generate a reference for a source range (`line:col-line:col`):

```bash
md ref <file> <startLine>:<startCol>-<endLine>:<endCol>
md ref <file> 42:1-58:72 --format debug --profile min
md ref <file> 10:1-10:80 --quote --quote-max 120
```

Options: `--format hangul|debug|base62`, `--profile min|default|full`, `--quote`, `--quote-max <chars>` (default 80).

### Transcoding

Pass a reference instead of file+range to convert between formats:

```bash
md ref '~{v0;r=42:1-42:68;fh=xxh64:0f3c}' --format base62
md ref '~<hangul>' --format debug
```

### Resolving

```bash
md resolve <file> '<ref>' ['<ref2>' ...]
md resolve <file> '<ref>' --json
```

### Using MRFI refs as selectors

MRFI references (`~...`) and anchors (`^...`) work as selectors in mutation commands:

```bash
md read   <file> '<ref>'
md write  <file> '<ref>' 'new content'
md append <file> '<ref>' 'appended text'
md empty  <file> '<ref>'
md remove <file> '<ref>'
```

Add `-x <extent>` to select a section-oriented scope (see Extent Selection below). Add `--strict` or `--force` to control the safety gate.

## Resolution Statuses

| Status      | Confidence | Agent action                                                    |
| ----------- | ---------- | --------------------------------------------------------------- |
| `exact`     | 1.0        | Safe for any operation.                                         |
| `confident` | high       | Safe for edits (strong signal present).                         |
| `ambiguous` | --         | Do NOT edit. Ask for clarification or regenerate the reference. |
| `stale`     | --         | Passage changed. Do NOT edit. Investigate or regenerate.        |
| `not_found` | 0          | Passage gone. Investigate the document.                         |
| `invalid`   | 0          | Bad reference format. Check syntax.                             |

## Safety Gate

Mutation commands (`write`, `remove`, `append`, `empty`) with MRFI selectors enforce a safety gate before acting.

| Flag       | Requirement                                                    |
| ---------- | -------------------------------------------------------------- |
| (default)  | Status `exact` or `confident`, plus at least one strong signal |
| `--strict` | Status must be `exact` only                                    |
| `--force`  | Skip safety gate entirely (dangerous)                          |

Strong signals: exact hash match (`fh`), unique anchor match (`a`), both context hashes matching (`ctx`), or witness text equal to the resolved passage.

## Extent Selection (`-x`)

Maps the resolved identity node (a heading) to a section-oriented scope.

| `-x` value | Scope                                       |
| ---------- | ------------------------------------------- |
| `sec`      | Heading + all content including subsections |
| `body`     | Like `sec` minus the heading line itself    |
| `lead`     | Content up to the next heading of any level |

Without `-x`, the operation targets the exact resolved passage range.

Extent-to-command mapping:

| extent | write          | remove         | empty          | append          |
| ------ | -------------- | -------------- | -------------- | --------------- |
| `sec`  | write(deep)    | remove()       | empty(deep)    | append(deep)    |
| `body` | write(deep)    | empty(deep)    | empty(deep)    | append(deep)    |
| `lead` | write(shallow) | empty(shallow) | empty(shallow) | append(shallow) |

`-x`, `--strict`, and `--force` error when used with non-MRFI selectors.

## Generation Profiles

| Profile   | Fields                           | Approx. debug size | Use case                   |
| --------- | -------------------------------- | ------------------ | -------------------------- |
| `min`     | `r`, `fh`, `hh`, +`a` if present | ~64 chars          | Smallest useful locator    |
| `default` | min + `p`, `ctx`, `doc`          | ~116 chars         | Balanced recovery and size |
| `full`    | default + `o`, `ph`              | ~172 chars         | Maximum resilience         |

`q` (quote) is always opt-in via `--quote`, regardless of profile.

## Normative Spec

Full specification: `docs/specs/mrfi.md` in the dz-tools repository.
