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
- `Blake3HashService` — implements `HashService` using the BLAKE3 algorithm.
- `YamlParserService` — implements `YamlService` using a YAML library.
- `adapters/cli/commands.ts` — wires Cliffy commands to use-case calls; receives a dependency bundle through a `createCommands()` factory.
- `adapters/cli/formatter.ts` — formats domain output types for human or JSON consumption.

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
