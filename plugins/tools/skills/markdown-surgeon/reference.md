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

## Errors

stderr: `error: <code>\n<message>`

Codes: `file_not_found`, `section_not_found`, `parse_error`, `invalid_id`,
`io_error`
