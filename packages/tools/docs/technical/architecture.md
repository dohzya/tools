# Architecture: packages/tools

This document describes the hexagonal (ports and adapters) architecture applied to the two applications in `packages/tools/`: **markdown-surgeon** and **worklog**.

## Overview

Both applications follow hexagonal architecture (also called ports and adapters). The goal is to keep the domain model — business logic, rules, and data structures — completely independent of external concerns such as the filesystem, CLI framework, or any specific runtime.

The architecture has three concentric rings:

```
┌───────────────────────────────────────────────────────┐
│  CLI (entry point, DI wiring)                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Adapters (concrete implementations)            │  │
│  │  ┌───────────────────────────────────────────┐  │  │
│  │  │  Domain                                   │  │  │
│  │  │  ┌──────────┐  ┌───────┐  ┌───────────┐  │  │  │
│  │  │  │ Entities │  │ Ports │  │ Use Cases │  │  │  │
│  │  │  └──────────┘  └───────┘  └───────────┘  │  │  │
│  │  └───────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

Dependencies always point inward. The domain has no knowledge of adapters or the CLI.

---

## Dependency Rules

These rules are enforced by convention. Violations break the architecture.

| Layer     | May import from                                    |
| --------- | -------------------------------------------------- |
| Entities  | Nothing (zero dependencies)                        |
| Ports     | Entities only                                      |
| Use Cases | Entities + Ports                                   |
| Adapters  | Entities + Ports (never other adapters' use cases) |
| CLI       | All layers (DI wiring only)                        |

The CLI layer is the only place where concrete adapter instances are created and injected into use cases. Use cases receive ports (interfaces), never adapters directly.

---

## Application: markdown-surgeon

A library and CLI tool for parsing and manipulating markdown documents by section and frontmatter.

### Directory structure

```
markdown-surgeon/
├── domain/
│   ├── entities/         # Document, Section, MutationResult, SearchMatch, MdError
│   ├── ports/            # FileSystem, HashService, YamlService
│   └── use-cases/        # ParseDocument, ReadSection, WriteSection, AppendSection,
│                         # RemoveSection, Search, ManageFrontmatter
├── adapters/
│   ├── filesystem/       # DenoFileSystem, InMemoryFileSystem
│   ├── services/         # Blake3HashService, YamlParserService
│   └── cli/              # commands.ts (Cliffy wiring), formatter.ts (output)
├── mod.ts                # Public API
└── cli.ts                # DI entry point
```

### Domain layer

**Entities** (`domain/entities/document.ts`) define the core data structures. All properties are `readonly`. The main types are:

- `Document` — a parsed markdown document: an array of `Section` objects, raw `lines`, and optional `frontmatter`.
- `Section` — a heading with its level, title, computed stable `id`, and line range.
- `MutationResult` — a structured summary of a write/append/remove operation.
- `SearchMatch` / `SearchSummary` — results from a section-scoped search.
- `MdError` — a typed error with an `ErrorCode` and optional file/section context.

**Ports** (`domain/ports/`) define the external dependencies the domain needs:

- `FileSystem` — read, write, existence check, glob.
- `HashService` — compute a stable section ID from level, title, and position.
- `YamlService` — parse and stringify YAML, plus nested key access utilities.

No interface uses an `I` prefix. This is a project-wide convention.

**Use cases** (`domain/use-cases/`) implement the business operations. Each use case is a class that accepts its port dependencies through the constructor and exposes a single `execute()` method (or equivalent named methods for query-style cases). Examples: `ParseDocumentUseCase`, `WriteSectionUseCase`, `ManageFrontmatterUseCase`.

### Adapters layer

- `DenoFileSystem` — implements `FileSystem` using Deno's native APIs.
- `InMemoryFileSystem` — implements `FileSystem` against an in-memory map; used in tests.
- `Blake3HashService` — implements `HashService` using SHA-256. The class name is historical.
- `YamlParserService` — implements `YamlService` using a YAML library.
- `adapters/cli/commands.ts` — wires Cliffy commands to use-case calls; receives a dependency bundle through a `createCommands()` factory.
- `adapters/cli/formatter.ts` — formats domain output types for human or JSON consumption.

### Fragment reference resolver

`md resolve` is the first implementation of the shared Markdown Fragment Reference contract documented in [`../../../../docs/functional/markdown-fragment-references.md`](../../../../docs/functional/markdown-fragment-references.md).

The resolver, generator, and format-transform logic live in `markdown-surgeon/domain/use-cases/` (`resolve-reference.ts`, `generate-reference.ts`, `transform-reference.ts`, `refresh-reference.ts`, plus the shared `mrfi-text.ts`/`mrfi-codec.ts`/`mrfi-cbor.ts` support modules), exported from `mod.ts` so other packages — starting with `dz-review` — can depend on them as a library instead of shelling out to the CLI. `markdown-surgeon/adapters/cli/commands.ts` only parses CLI args, instantiates these use cases, and formats their output; its text and JSON result formatting lives in `markdown-surgeon/adapters/cli/formatter.ts`.

The supported first profile is intentionally small:

- `^<anchor>` resolves unique HTML comment anchors such as `<!-- ^install_sdk -->`.
- duplicate anchors produce an `ambiguous` result instead of choosing the first match.
- `outline --mrfi` generates Hangul compact MRFI references for each listed section while preserving the legacy exact section ID in output.
- `outline --mrfi --format debug` and `outline --mrfi --format base62` generate alternate MRFI representations for the same locator profile.
- `outline --mrfi --profile min|default|full` chooses which locator fields are emitted; `default` is the generation default.
- `outline --mrfi --quote` opts into embedded `q=...` quote evidence; generated references omit `q=` by default.
- `outline --mrfi --quote-max <chars>` caps embedded quote evidence, using a default of 80 Unicode scalar values and keeping the beginning, middle, and end when truncating.
- `ref <file> <startLine:startColumn-endLine:endColumn>` generates a Hangul compact MRFI reference for a precise source selection.
- `ref <file> <range> --profile min|default|full` uses the same field profiles as `outline --mrfi`.
- `ref <ref> --format debug|base62|hangul` converts supported MRFI references between representations.
- default generated MRFI references include physical range (`r`), structural path (`p`), nearby anchor (`a`), exact fragment hash (`fh`), fuzzy heading hash (`hh`), and context hashes (`ctx`); the `full` profile also includes offset range (`o`), fuzzy passage hash (`ph`), and document hash (`doc`).
- `~{v0;...}` debug MRFI references, bare base62 compact references, and bare Hangul compact references can resolve by anchor (`a=...`), physical range (`r=startLine:startColumn-endLine:endColumn`), exact fragment hash (`fh=sha256:<prefix>`), context hashes (`ctx=...`), fuzzy heading hash (`hh=smh64:<hash>`), or structural path (`p=...`).
- `q=...` is supported as embedded text evidence, but generated MRFI references omit it by default.
- `~{v0;...}::<witness>` attaches runtime witness text to MRFI resolution in the `md resolve` CLI. `::witness` is a CLI argument convention, not part of MRFI inline syntax. `q=...` and runtime witness text have the same evidence semantics, but runtime witness takes precedence because it may be fresher. Neither value is emitted in JSON.
- text output prints resolved passages as four-space-indented source text, not fenced Markdown.
- unrecognized non-mandatory debug fields (private extension fields, per spec §38) are preserved verbatim instead of dropped; the CBOR compact codec accepts text-string map keys for these fields, so a field keeps its own name (e.g. `_kind`) through `base62`/`hangul` round-trips at a small size cost, with an opaque string value. `md` never interprets these fields — a consumer like `dz-review` can attach its own evidence under its own field name and read it back after resolution.

`RefreshReferenceUseCase` re-points a reference at its current location: it resolves the reference and, when the match is `exact` or `confident`, regenerates a canonical reference for the up-to-date range; otherwise it surfaces the resolve status/diagnostics instead of a reference, so callers can tell "refreshed" from "couldn't".

The compact codec covers all generated profiles: version, anchor, physical range, structural path, exact fragment hash, fuzzy heading hash, context hashes, quote, document hash, offset range, and fuzzy passage hash. It serializes that object with deterministic CBOR in an `MRFI` envelope, then emits either base62 or Hangul base2048. Compact-envelope checksums and `smh64-v0` feature hashes use SHA-256 through the local WebCrypto digest available to Deno.

### CLI entry point (`cli.ts`)

Approximately 57 lines. Instantiates the adapters, calls `createCommands()`, and assembles the Cliffy command tree. This is the only file that imports both domain and adapter layers together.

### Public API (`mod.ts`)

Exports entities, port interfaces, use-case classes, and adapter implementations. Also provides a backward-compatibility functional API (e.g. `parseDocument()`, `parseFrontmatter()`, `stringifyFrontmatter()`) that wraps the use cases with singleton instances. External code that only needs markdown manipulation should import from `mod.ts`.

---

## Application: worklog

A task and time-tracking CLI that stores tasks as structured markdown files. It uses markdown-surgeon internally for all markdown parsing and serialization.

### Directory structure

```
worklog/
├── domain/
│   ├── entities/         # Task, TaskMeta, Entry, Todo, Scope, Checkpoint, WtError, Index
│   ├── ports/            # TaskRepository, IndexRepository, ScopeRepository,
│   │                     # MarkdownService, GitService, FileSystem, ProcessRunner
│   └── use-cases/
│       ├── task/         # init, create-task, show-task, list-tasks,
│       │                 # update-status, update-meta, update-task
│       ├── trace/        # add-trace, list-traces, checkpoint
│       ├── todo/         # add-todo, list-todos, next-todo, update-todo
│       ├── scope/        # add-scope, assign-scope, delete-scope, export-scope,
│       │                 # list-scopes, rename-scope, sync-worktrees
│       ├── import/       # import-tasks, import-scope-to-tag
│       ├── summary.ts
│       ├── run-command.ts
│       └── claude-command.ts
├── adapters/
│   ├── repositories/     # MarkdownTaskRepository, JsonIndexRepository, JsonScopeRepository
│   ├── markdown/         # MarkdownSurgeonAdapter
│   ├── filesystem/       # DenoFileSystem, InMemoryFileSystem
│   ├── git/              # DenoGitService
│   ├── process/          # DenoProcessRunner
│   └── cli/              # formatter.ts, commands/ (task, trace, todo, scope, import, run)
├── mod.ts                # Public API
├── types.ts              # Backward compatibility layer
└── cli.ts                # DI entry point (~200 lines)
```

### Domain layer

**Entities** define the worklog data model. All properties are `readonly`:

- `Task` — the domain representation of a task (camelCase fields: `createdAt`, `startedAt`, etc.).
- `TaskMeta` — the persistence representation of a task, matching YAML frontmatter field names (snake_case: `created_at`, `started_at`, etc.). Conversion between the two forms is done by `taskFromMeta()` and `taskToMeta()` in `domain/entities/task.ts`.
- `Entry` — a timestamped log entry on a task.
- `Checkpoint` — a structured checkpoint on a task with `changes` and `learnings` sections.
- `Todo` — a checklist item with a `TodoStatus` and a stable block-reference ID.
- `Scope` — a named grouping of tasks; scopes map to git worktrees.
- `Index` — a fast-lookup index mapping task IDs to `IndexEntry` records.
- `WtError` — a typed domain error with an error code string.

**Pure helper functions** in `domain/entities/task-helpers.ts` handle domain logic that does not require side effects: status transition validation (`canChangeStatus`), immutable status transitions (`transitionToStatus`), ID generation (`generateTaskIdBase62`), prefix resolution (`resolveIdPrefix`), and tag validation (`validateTag`).

Task IDs are 25-character base36 strings derived from a random UUID. The display prefix (short ID) is the shortest unambiguous prefix of at least 5 characters, plus one character margin.

Task status lifecycle:

```
created --> ready --> started --> done
    \          \         \
     \          \         --> cancelled
      \          --> cancelled
       --> cancelled
done --> started  (reopen)
```

**Ports** define the external dependencies:

- `TaskRepository` — load, save, delete, and check existence of task markdown files.
- `IndexRepository` — read and write the JSON task index.
- `ScopeRepository` — read and write the JSON scope configuration.
- `MarkdownService` — parse a task file, serialize a task, append entries/checkpoints, update frontmatter. This port abstracts away all markdown manipulation.
- `GitService` — git operations (current branch, worktree list, etc.).
- `FileSystem` — read, write, exists, glob.
- `ProcessRunner` — spawn and observe external processes.

### Adapters layer

**Repositories:**

- `MarkdownTaskRepository` — implements `TaskRepository` by delegating file I/O to `FileSystem` and markdown parsing to `MarkdownService`. It does not know about markdown-surgeon directly.
- `JsonIndexRepository` — implements `IndexRepository` with a JSON file.
- `JsonScopeRepository` — implements `ScopeRepository` with a JSON file.

**MarkdownSurgeonAdapter** (`adapters/markdown/surgeon-adapter.ts`) — implements `MarkdownService` by calling markdown-surgeon use cases directly (`ParseDocumentUseCase`, `ReadSectionUseCase`, `ManageFrontmatterUseCase`). This is the only component in worklog that imports from markdown-surgeon's domain layer. It is the integration seam between the two applications.

**Other adapters:**

- `DenoFileSystem` / `InMemoryFileSystem` — `FileSystem` implementations.
- `DenoGitService` — `GitService` using `Deno.Command`.
- `DenoProcessRunner` — `ProcessRunner` using `Deno.Command`.
- `adapters/cli/` — Cliffy command wiring and output formatting.

### CLI entry point (`cli.ts`)

Approximately 200 lines of DI wiring. It instantiates all adapters (including `MarkdownSurgeonAdapter` with the markdown-surgeon service implementations), constructs all use-case instances with their dependencies, and mounts them into the Cliffy command tree.

---

## Cross-module sharing

worklog reuses markdown-surgeon's parsing capability without duplicating logic. The relationship is:

```
worklog domain
    |
    | uses (via port)
    v
MarkdownService (port, in worklog/domain/ports/)
    ^
    | implements
    |
MarkdownSurgeonAdapter (in worklog/adapters/markdown/)
    |
    | calls directly
    v
markdown-surgeon use cases
(ParseDocumentUseCase, ReadSectionUseCase, ManageFrontmatterUseCase)
```

The worklog domain has no import from markdown-surgeon. `MarkdownService` is a worklog port; `MarkdownSurgeonAdapter` is a worklog adapter. The adapter lives in worklog's adapter layer, which is permitted to import from any layer of any package.

The worklog CLI also re-uses `Blake3HashService` and `YamlParserService` from markdown-surgeon's adapter layer to instantiate `MarkdownSurgeonAdapter`. This is done in `cli.ts` (the DI root), which is the appropriate place for cross-package wiring.

`dz-review` is the first consumer of the MRFI fragment-reference use-cases described above, following the same shape as worklog's integration: a small port owned by the consumer package (`dz-review/domain/ports/reference-locator.ts`, `ReferenceLocatorService`) implemented by an adapter that calls markdown-surgeon's use-cases directly (`dz-review/adapters/markdown/mrfi-adapter.ts`, `MrfiAdapter`, wrapping `GenerateReferenceUseCase`/`ResolveReferenceUseCase`/`RefreshReferenceUseCase`). Unlike `MarkdownSurgeonAdapter`, `MrfiAdapter` needs no constructor dependencies, because MRFI's own hashing runs through `crypto.subtle` rather than an injected `HashService`. See [`dz-review-architecture.md`](./dz-review-architecture.md) for the port's shape and its one current caller, the persistent review-item-id mechanism.

---

## Key conventions

### Naming

- No `I` prefix on interfaces. `FileSystem`, not `IFileSystem`.
- `mod.ts` is the public API surface (Deno convention). Import from `mod.ts` when consuming a package as a library.
- `cli.ts` is the executable entry point. It exports a `main(args: string[])` function.
- Use-case classes are named `<Action>UseCase` and expose an `execute()` method.
- Adapter classes are named after both what they do and what they use: `MarkdownTaskRepository`, `DenoFileSystem`, `Blake3HashService`.

### Immutability

All domain entity types use `readonly` on every property. Collections are typed as `readonly T[]`. Mutations (e.g. status transitions) return new objects rather than modifying existing ones.

### Dual representation (Task / TaskMeta)

`Task` uses camelCase and is the in-memory domain object. `TaskMeta` uses snake_case and matches the YAML frontmatter stored in task files. The conversion functions `taskFromMeta()` and `taskToMeta()` are colocated with the entity definitions.

### Testing

The `InMemoryFileSystem` adapter exists in both applications specifically to enable unit testing of use cases without touching the real filesystem. Use cases are tested by injecting in-memory implementations of all ports.

### Backward compatibility

`markdown-surgeon/mod.ts` contains a functional compatibility layer (free functions wrapping use cases with singleton instances) to support callers that predate the hexagonal refactor. New code should use the use-case classes directly.

`worklog/types.ts` serves a similar purpose for worklog consumers.
