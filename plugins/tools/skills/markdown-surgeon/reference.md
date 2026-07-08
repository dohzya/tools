# Markdown Surgeon - Quick Reference

## Edge cases

| Situation              | Behavior                                              |
| ---------------------- | ----------------------------------------------------- |
| Empty file             | `outline` outputs nothing                             |
| No headers             | Content not accessible by ID                          |
| Header without content | `read` shows header line only                         |
| Empty stdin for write  | Equivalent to `empty`                                 |
| `append` without ID    | `--before` = after frontmatter, default = end of file |

## `--deep` behavior

| Command  | Without `--deep`     | With `--deep`        |
| -------- | -------------------- | -------------------- |
| `read`   | Until next header    | Includes subsections |
| `write`  | Preserve subsections | Replace subsections  |
| `append` | Before next header   | After subsections    |
| `empty`  | Clear own content    | Remove subsections   |

## MRFI ref support (write/remove/append/empty)

Selectors starting with `~` (MRFI) or `^` (anchor) are resolved as MRFI references instead of section IDs. A safety gate requires status `exact` or `confident` plus at least one strong locator signal (exact hash, unique anchor, both context hashes, or witness agreement).

### Extent (`-x`/`--extent`)

Maps the resolved identity node to a section-oriented operation:

| extent | write          | remove         | empty          | append          |
| ------ | -------------- | -------------- | -------------- | --------------- |
| `sec`  | write(deep)    | remove()       | empty(deep)    | append(deep)    |
| `body` | write(deep)    | empty(deep)    | empty(deep)    | append(deep)    |
| `lead` | write(shallow) | empty(shallow) | empty(shallow) | append(shallow) |

Without `-x`, the resolved passage range is mutated directly (line-range operation, not section-bound).

### Gate control

| Flag       | Behavior                                       |
| ---------- | ---------------------------------------------- |
| (default)  | status ∈ {exact, confident} + ≥1 strong signal |
| `--strict` | status must be `exact` (rejects `confident`)   |
| `--force`  | skip safety gate entirely                      |

`-x`, `--strict`, and `--force` error when used with non-MRFI selectors.

## Errors

stderr: `error: <code>\n<message>`

Codes: `file_not_found`, `section_not_found`, `parse_error`, `invalid_id`, `io_error`
