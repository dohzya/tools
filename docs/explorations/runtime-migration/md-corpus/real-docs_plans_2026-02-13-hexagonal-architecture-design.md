# Architecture Hexagonale pour dz-tools

**Date:** 2026-02-13 **Statut:** Approuvé **Objectif:** Refonte complète vers une architecture hexagonale classique en 3 couches

---

## Vue d'ensemble

Refonte de `worklog` et `markdown-surgeon` vers une architecture hexagonale pure avec séparation stricte entre domaine métier et infrastructure.

**Décisions clés:**

- ✅ Refonte complète (réécriture du code)
- ✅ Les deux apps (worklog + markdown-surgeon) en parallèle
- ✅ Tests CLI existants comme filet de sécurité
- ✅ Architecture hexagonale classique 3 couches
- ✅ Entities immutables (approche fonctionnelle)

---

## Architecture en 3 couches

```
┌─────────────────────────────────────────────┐
│           CLI / WIRE                        │  ← Connecte tout (DI)
│                                             │
├─────────────────────────────────────────────┤
│           ADAPTERS                          │  ← Implémentent les ports
│         (Infrastructure)                    │
│                                             │
├─────────────────────────────────────────────┤
│           USE CASES                         │  ← Appellent les ports
│         (Business Logic)                    │
│                                             │
├─────────────────────────────────────────────┤
│           PORTS                             │  ← Interfaces (contracts)
│         (Contracts)                         │
│                                             │
├─────────────────────────────────────────────┤
│           ENTITIES                          │  ← Objets métier purs
│         (Domain Core)                       │
└─────────────────────────────────────────────┘
```

**Règles de dépendance strictes:**

```
Entities   → 0 dépendance
Ports      → Entities uniquement
Use Cases  → Entities + Ports (appelle les interfaces)
Adapters   → Entities + Ports (implémente les interfaces)
CLI/Wire   → Use Cases + Adapters (DI manuelle)
```

**Principe d'inversion de dépendance:**

- Use cases définissent leurs besoins via les ports (interfaces)
- Adapters implémentent ces ports
- Use cases et Adapters ne se connaissent PAS directement
- Le CLI wire les dépendances au démarrage

---

## Structure des fichiers

### Markdown-surgeon (bibliothèque bas-niveau)

```
packages/tools/markdown-surgeon/
├── domain/
│   ├── entities/
│   │   ├── document.ts          # Document, Section (types immutables)
│   │   └── mutation.ts          # MutationResult, SearchMatch
│   ├── use-cases/
│   │   ├── parse-document.ts    # ParseDocumentUseCase
│   │   ├── read-section.ts      # ReadSectionUseCase
│   │   ├── write-section.ts     # WriteSectionUseCase
│   │   ├── append-section.ts    # AppendSectionUseCase
│   │   ├── remove-section.ts    # RemoveSectionUseCase
│   │   ├── search.ts            # SearchUseCase
│   │   └── manage-frontmatter.ts # FrontmatterUseCase
│   └── ports/
│       ├── filesystem.ts        # FileSystem interface
│       ├── hash-service.ts      # HashService interface
│       └── yaml-service.ts      # YamlService interface
├── adapters/
│   ├── filesystem/
│   │   ├── deno-fs.ts           # DenoFileSystem
│   │   └── in-memory-fs.ts      # InMemoryFileSystem (tests)
│   ├── services/
│   │   ├── blake3-hash.ts       # Blake3HashService
│   │   └── yaml-parser.ts       # YamlParserService
│   └── cli/
│       ├── commands.ts          # Cliffy commands
│       └── formatter.ts         # TextFormatter
├── mod.ts                       # API publique (exports)
├── cli.ts                       # CLI executable (wire + main)
└── cli.test.ts                  # Tests CLI existants
```

**Taille:** ~1325 lignes → ~20 fichiers (moyenne 60-70 lignes/fichier)

---

### Worklog (app qui dépend de markdown-surgeon)

```
packages/tools/worklog/
├── domain/
│   ├── entities/
│   │   ├── task.ts              # Task (type immutable)
│   │   ├── checkpoint.ts        # Checkpoint
│   │   ├── todo.ts              # Todo
│   │   ├── entry.ts             # Entry (trace)
│   │   ├── index.ts             # Index aggregate
│   │   └── scope.ts             # Scope
│   ├── use-cases/
│   │   ├── task/
│   │   │   ├── create-task.ts   # CreateTaskUseCase
│   │   │   ├── show-task.ts     # ShowTaskUseCase
│   │   │   ├── list-tasks.ts    # ListTasksUseCase
│   │   │   ├── update-status.ts # UpdateTaskStatusUseCase
│   │   │   └── update-meta.ts   # UpdateTaskMetaUseCase
│   │   ├── trace/
│   │   │   ├── add-trace.ts     # AddTraceUseCase
│   │   │   ├── list-traces.ts   # ListTracesUseCase
│   │   │   └── checkpoint.ts    # CreateCheckpointUseCase
│   │   ├── todo/
│   │   │   ├── add-todo.ts      # AddTodoUseCase
│   │   │   ├── list-todos.ts    # ListTodosUseCase
│   │   │   ├── update-todo.ts   # UpdateTodoUseCase
│   │   │   └── next-todo.ts     # GetNextTodoUseCase
│   │   ├── scope/
│   │   │   ├── list-scopes.ts   # ListScopesUseCase
│   │   │   ├── add-scope.ts     # AddScopeUseCase
│   │   │   └── sync-worktrees.ts # SyncWorktreesUseCase
│   │   ├── import/
│   │   │   ├── import-tasks.ts  # ImportTasksUseCase
│   │   │   └── import-scope.ts  # ImportScopeUseCase
│   │   └── summary.ts           # GenerateSummaryUseCase
│   └── ports/
│       ├── task-repository.ts   # TaskRepository interface
│       ├── index-repository.ts  # IndexRepository interface
│       ├── scope-repository.ts  # ScopeRepository interface
│       ├── markdown-service.ts  # MarkdownService interface
│       ├── git-service.ts       # GitService interface
│       └── filesystem.ts        # FileSystem interface
├── adapters/
│   ├── repositories/
│   │   ├── markdown-task-repo.ts     # MarkdownTaskRepository
│   │   ├── json-index-repo.ts        # JsonIndexRepository
│   │   └── json-scope-repo.ts        # JsonScopeRepository
│   ├── markdown/
│   │   └── surgeon-adapter.ts        # MarkdownSurgeonAdapter
│   ├── git/
│   │   └── deno-git.ts               # DenoGitService
│   ├── filesystem/
│   │   ├── deno-fs.ts                # DenoFileSystem
│   │   └── in-memory-fs.ts           # InMemoryFileSystem
│   └── cli/
│       ├── commands/
│       │   ├── task-commands.ts      # add, show, list, etc.
│       │   ├── trace-commands.ts     # trace, traces, checkpoint
│       │   ├── todo-commands.ts      # todo commands
│       │   ├── scope-commands.ts     # scopes commands
│       │   ├── import-commands.ts    # import commands
│       │   └── run-command.ts        # run, claude
│       └── formatter.ts              # TextFormatter
├── mod.ts                       # API publique
├── cli.ts                       # CLI executable (wire + DI)
├── cli.test.ts                  # Tests CLI existants
└── types.ts                     # Re-exports (backward compat)
```

**Taille:** ~6603 lignes → ~50 fichiers (moyenne 130 lignes/fichier)

---

## Ports (Interfaces)

**Convention TypeScript:** Pas de préfixe `I` (idiomatique Deno/TypeScript moderne)

### Markdown-surgeon

```typescript
// domain/ports/filesystem.ts
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// domain/ports/hash-service.ts
export interface HashService {
  hash(content: string): string;
}

// domain/ports/yaml-service.ts
export interface YamlService {
  parse(yaml: string): unknown;
  stringify(data: unknown): string;
}
```

### Worklog

```typescript
// domain/ports/task-repository.ts
export interface TaskRepository {
  findById(taskId: string): Promise<Task | null>;
  save(task: Task): Promise<void>;
  delete(taskId: string): Promise<void>;
  findByStatus(status: TaskStatus): Promise<Task[]>;
  findByTag(tagPattern: string): Promise<Task[]>;
}

// domain/ports/index-repository.ts
export interface IndexRepository {
  load(): Promise<Index>;
  addEntry(task: Task): Promise<void>;
  updateEntry(taskId: string, updates: Partial<IndexEntry>): Promise<void>;
  removeEntry(taskId: string): Promise<void>;
}

// domain/ports/markdown-service.ts
export interface MarkdownService {
  parseTaskFile(content: string): Promise<ParsedTaskData>;
  serializeTask(
    task: Task,
    traces: Entry[],
    checkpoints: Checkpoint[],
  ): Promise<string>;
}

// domain/ports/git-service.ts
export interface GitService {
  getRoot(): Promise<string | null>;
  listWorktrees(): Promise<Worktree[]>;
  isInRepo(): Promise<boolean>;
}
```

---

## Entities (Immutables)

**Approche fonctionnelle:** Entities = structures de données immutables sans méthodes métier

```typescript
// domain/entities/task.ts
export type TaskStatus = "created" | "ready" | "started" | "done" | "cancelled";

export type Task = {
  readonly id: string;
  readonly uid: string;
  readonly name: string;
  readonly desc: string;
  readonly status: TaskStatus;
  readonly createdAt: Date;
  readonly readyAt: Date | null;
  readonly startedAt: Date | null;
  readonly doneAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
};

// Factory helper
export function createTask(input: {
  id: string;
  uid: string;
  desc: string;
  name?: string;
}): Task {
  return {
    id: input.id,
    uid: input.uid,
    name: input.name ?? input.desc.slice(0, 50),
    desc: input.desc,
    status: "created",
    createdAt: new Date(),
    readyAt: null,
    startedAt: null,
    doneAt: null,
    cancelledAt: null,
    tags: [],
    metadata: {},
  };
}
```

**Helpers métier (fonctions pures):**

```typescript
// domain/entities/task-helpers.ts
export function canChangeStatus(task: Task, newStatus: TaskStatus): boolean {
  if (task.status === "done" || task.status === "cancelled") {
    return false;
  }
  return true;
}

export function transitionToStatus(task: Task, newStatus: TaskStatus): Task {
  return {
    ...task,
    status: newStatus,
    readyAt: newStatus === "ready" ? new Date() : task.readyAt,
    startedAt: newStatus === "started" ? new Date() : task.startedAt,
    doneAt: newStatus === "done" ? new Date() : task.doneAt,
    cancelledAt: newStatus === "cancelled" ? new Date() : task.cancelledAt,
  };
}
```

---

## Use Cases (Business Logic)

**Pattern:** 1 use case = 1 action métier = 1 fichier

```typescript
// domain/use-cases/task/create-task.ts
export type CreateTaskInput = {
  desc: string;
  name?: string;
};

export class CreateTaskUseCase {
  constructor(
    private taskRepo: TaskRepository,
    private indexRepo: IndexRepository,
  ) {}

  async execute(input: CreateTaskInput): Promise<Task> {
    // Validation
    if (!input.desc.trim()) {
      throw new WtError("invalid_args", "Description cannot be empty");
    }

    // Génération des IDs
    const uid = crypto.randomUUID();
    const id = generateTaskIdBase62(uid);

    // Création de l'entity immutable
    const task = createTask({
      id,
      uid,
      desc: input.desc,
      name: input.name,
    });

    // Persistence via les ports
    await this.taskRepo.save(task);
    await this.indexRepo.addEntry(task);

    return task;
  }
}
```

**Business rules dans les use cases:**

```typescript
// domain/use-cases/task/update-status.ts
export class UpdateTaskStatusUseCase {
  constructor(
    private taskRepo: TaskRepository,
    private indexRepo: IndexRepository,
  ) {}

  async execute(taskId: string, newStatus: TaskStatus): Promise<Task> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new WtError("task_not_found", `Task ${taskId} not found`);
    }

    // ✅ Business rule validée dans le use case
    if (!canChangeStatus(task, newStatus)) {
      throw new WtError(
        "invalid_state",
        "Cannot change status of completed task",
      );
    }

    // ✅ Transformation immutable
    const updatedTask = transitionToStatus(task, newStatus);

    await this.taskRepo.save(updatedTask);
    await this.indexRepo.updateEntry(taskId, {
      status: newStatus,
      status_updated_at: new Date().toISOString(),
    });

    return updatedTask;
  }
}
```

---

## Data Flow

Flux typique pour `wl add "Feature X"`:

```
CLI (adapters/cli/commands.ts)
  ↓ CreateTaskInput { desc, name? }
Use Case (domain/use-cases/task/create-task.ts)
  ↓ Task (entity immutable)
Repository (adapters/repositories/markdown-task-repo.ts)
  ↓ appelle MarkdownService + FileSystem
MarkdownService (adapters/markdown/surgeon-adapter.ts)
  ↓ utilise markdown-surgeon use cases
FileSystem (adapters/filesystem/deno-fs.ts)
  ↓ Deno.writeTextFile()
```

**Principes:**

- DTOs aux frontières CLI ↔ Use Case
- Entities circulent entre Use Case ↔ Repository
- Pas de leak d'infra dans le domaine
- Transformations explicites à chaque couche

---

## Dépendance inter-apps

**Worklog utilise le domaine de markdown-surgeon:**

```typescript
// worklog/adapters/markdown/surgeon-adapter.ts
import {
  ParseDocumentUseCase,
  ReadSectionUseCase,
  WriteSectionUseCase,
} from "../../../markdown-surgeon/mod.ts";
import type { MarkdownService } from "../../domain/ports/markdown-service.ts";

export class MarkdownSurgeonAdapter implements MarkdownService {
  constructor(
    private parseDoc: ParseDocumentUseCase,
    private readSection: ReadSectionUseCase,
    private writeSection: WriteSectionUseCase,
  ) {}

  async parseTaskFile(content: string): Promise<ParsedTaskData> {
    const doc = await this.parseDoc.execute(content);
    const frontmatter = await this.readSection.execute(doc.id, "frontmatter");
    const traces = await this.readSection.execute(doc.id, "## Traces");

    return {
      meta: this.parseFrontmatter(frontmatter),
      traces: this.parseTraces(traces),
      checkpoints: this.parseCheckpoints(doc),
    };
  }

  async serializeTask(
    task: Task,
    traces: Entry[],
    checkpoints: Checkpoint[],
  ): Promise<string> {
    // Utilise markdown-surgeon pour construire le fichier
    // ...
  }
}
```

**Structure de dépendance:**

```
markdown-surgeon (app standalone)
    ↑
    │ (utilise le domaine via mod.ts)
    │
worklog (app qui dépend de markdown-surgeon)
```

---

## Points d'entrée

### mod.ts (API publique)

```typescript
// Exports pour réutilisation par d'autres packages
export * from "./domain/entities/task.ts";
export * from "./domain/entities/checkpoint.ts";
export * from "./domain/use-cases/create-task.ts";
export * from "./domain/use-cases/list-tasks.ts";
// ... tous les exports publics

// Factory si besoin
export { createWorklogApp } from "./app-factory.ts";
```

### cli.ts (Exécutable)

```typescript
// Wire + DI manuelle + main()
import { Command } from "@cliffy/command";
import { CreateTaskUseCase } from "./domain/use-cases/task/create-task.ts";
import { MarkdownTaskRepository } from "./adapters/repositories/markdown-task-repo.ts";
// ...

// DI manuelle
const fs = new DenoFileSystem();
const markdownService = new MarkdownSurgeonAdapter(/* ... */);
const taskRepo = new MarkdownTaskRepository(markdownService, fs);
const indexRepo = new JsonIndexRepository(fs);
const createTaskUseCase = new CreateTaskUseCase(taskRepo, indexRepo);

// Commandes Cliffy
const addCommand = new Command()
  .description("Create a new task")
  .arguments("<desc:string>")
  .option("-n, --name <name:string>", "Short name")
  .action(async (options, desc) => {
    const task = await createTaskUseCase.execute({
      desc,
      name: options.name,
    });
    console.log(formatter.formatAdd({ id: task.id }));
  });

// Entry point
if (import.meta.main) {
  await new Command()
    .name("wl")
    .command("add", addCommand)
    // ... autres commandes
    .parse(Deno.args);
}

export { main }; // Pour les tests
```

---

## Stratégie de testing

### Pyramide de tests

```
    ┌──────────────────────┐
    │   E2E / CLI Tests    │  ← cli.test.ts (existants)
    └──────────────────────┘
              ▲
   ┌──────────────────────────┐
   │   Adapter Tests          │  ← Repositories, Services
   └──────────────────────────┘
              ▲
┌────────────────────────────────┐
│     Use Case Tests             │  ← Business logic pure
└────────────────────────────────┘
              ▲
   ┌──────────────────────────┐
   │    Entity Tests          │  ← Helpers, factories
   └──────────────────────────┘
```

### 1. Entity Tests (ultra-rapides)

```typescript
// domain/entities/task.test.ts
Deno.test("createTask - generates default name from desc", () => {
  const task = createTask({
    id: "abc123",
    uid: "550e8400-e29b-41d4-a716-446655440000",
    desc: "Very long description that should be truncated for name",
  });

  assertEquals(task.name, "Very long description that should be truncated f");
  assertEquals(task.status, "created");
});
```

**Caractéristiques:** Pur TypeScript, 0 dépendance, instantané

---

### 2. Use Case Tests (rapides avec mocks)

```typescript
// domain/use-cases/task/create-task.test.ts
Deno.test("CreateTaskUseCase - saves task and updates index", async () => {
  // Mock repositories (objets JS simples)
  let savedTask: Task | null = null;
  const mockTaskRepo: TaskRepository = {
    save: async (task) => {
      savedTask = task;
    },
    // ...
  };

  const useCase = new CreateTaskUseCase(mockTaskRepo, mockIndexRepo);
  const task = await useCase.execute({ desc: "Test task" });

  assertEquals(task.desc, "Test task");
  assertEquals(savedTask, task);
});
```

**Caractéristiques:** Business logic pure, mocks simples, pas d'I/O

---

### 3. Adapter Tests (avec InMemoryFileSystem)

```typescript
// adapters/repositories/markdown-task-repo.test.ts
Deno.test("MarkdownTaskRepository - save writes markdown file", async () => {
  const fs = new InMemoryFileSystem();
  const repo = new MarkdownTaskRepository(markdownService, fs);

  const task = createTask({/* ... */});
  await repo.save(task);

  const content = await fs.readFile(".worklog/tasks/test123.md");
  assert(content.includes("id: test123"));
});
```

**Caractéristiques:** Adapters testés avec InMemory, pas de vrai disque

---

### 4. CLI Tests (intégration - INCHANGÉS)

```typescript
// cli.test.ts (GARDÉS TELS QUELS)
Deno.test("wl add - creates task and returns short ID", async () => {
  const tempDir = await Deno.makeTempDir();
  Deno.chdir(tempDir);

  await main(["init"]);
  const output = captureOutput(() => main(["add", "Test task"]));

  assert(output.match(/^[a-z0-9]{6}$/));
});
```

**Caractéristiques:** End-to-end, temp dirs, validation contrat utilisateur

---

### InMemoryFileSystem

```typescript
// adapters/filesystem/in-memory-fs.ts
export class InMemoryFileSystem implements FileSystem {
  private files = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  clear(): void {
    this.files.clear();
  }
}
```

---

## Résumé des bénéfices

### Testabilité

- ✅ Use cases testables sans I/O (rapide)
- ✅ InMemoryFileSystem évite les effets de bord
- ✅ CLI tests valident le contrat utilisateur
- ✅ Chaque couche testable indépendamment

### Maintenabilité

- ✅ Logique métier isolée et lisible (domain/)
- ✅ Fichiers de 50-150 lignes (vs 6603 lignes monolithique)
- ✅ Navigation facile par fonctionnalité
- ✅ Business rules explicites dans les use cases

### Évolutivité

- ✅ Ajouter un adapter (ex: DB) sans toucher au domaine
- ✅ Changer de CLI framework sans toucher à la logique
- ✅ Réutiliser le domaine dans d'autres contextes
- ✅ Markdown-surgeon utilisable indépendamment

### Portabilité

- ✅ Domaine = 0 dépendance externe
- ✅ Peut tourner sur autre runtime (Node, Bun) en changeant les adapters
- ✅ API publique via mod.ts pour réutilisation

---

## Migration

**Stratégie:** Réécriture complète avec tests CLI comme filet de sécurité

1. **Phase 1: Markdown-surgeon** (plus simple, 1325 lignes)
   - Créer structure domain/ports/adapters/
   - Extraire entities
   - Créer use cases
   - Implémenter adapters
   - Rewriter cli.ts
   - ✅ Valider avec cli.test.ts

2. **Phase 2: Worklog** (6603 lignes)
   - Même process
   - Utiliser markdown-surgeon via MarkdownSurgeonAdapter
   - ✅ Valider avec cli.test.ts

**Critère de succès:** Tous les tests CLI existants passent sans modification

---

## Prochaines étapes

1. Invoquer `writing-plans` skill pour créer le plan d'implémentation détaillé
2. Créer une branche git pour la refonte
3. Commencer par markdown-surgeon (plus petit)
4. Implémenter worklog ensuite
5. Valider avec `task validate` à chaque étape
