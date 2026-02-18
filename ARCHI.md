# Architecture Rules

Hexagonal architecture (Ports & Adapters). Dependencies point inward only.

---

## Layer rules

```
Entities → Ports → Use Cases → Adapters → CLI
```

| Layer | May import from |
|---|---|
| Entities | Nothing |
| Ports | Entities only |
| Use Cases | Entities + Ports |
| Adapters | Entities + Ports |
| CLI | All layers (DI wiring only) |

- ❌ Use cases must never import from `adapters/`
- ❌ Adapters must never import from other adapters' use cases
- ✅ CLI (`cli.ts`) is the only place where adapters are instantiated and injected

---

## Where to put new things

**New feature** → new use case in `domain/use-cases/`. Never add logic to an existing function or adapter.

**New output format** → `adapters/cli/formatter.ts`

**New data source** → new adapter implementing an existing port. If no port fits, define the port first in `domain/ports/`, then implement the adapter.

**New CLI command** → `adapters/cli/commands/`. Wire the use case. Put zero logic there.

---

## Forbidden patterns

❌ Business logic in `cli.ts` or anywhere in `adapters/`
```typescript
// WRONG — logic in a command handler
if (task.status === "started") { ... }
```

❌ Adapter import inside a use case
```typescript
// WRONG — use case imports an adapter
import { MarkdownSurgeonAdapter } from "../../adapters/markdown/surgeon-adapter.ts";
```

❌ Mutable entity properties
```typescript
// WRONG
interface Task { status: string }

// CORRECT
interface Task { readonly status: string }
```

❌ `I` prefix on interfaces
```typescript
// WRONG
interface IFileSystem { ... }

// CORRECT
interface FileSystem { ... }
```

❌ Cross-adapter imports between worklog and markdown-surgeon
```typescript
// WRONG — worklog use case imports markdown-surgeon adapter directly
import { YamlParserService } from "../../markdown-surgeon/adapters/services/yaml.ts";
```

---

## Cross-module sharing (worklog ↔ markdown-surgeon)

worklog accesses markdown-surgeon exclusively through the `MarkdownService` port.

```
worklog domain
    ↓ uses (via MarkdownService port)
MarkdownSurgeonAdapter   ← only place that imports markdown-surgeon
    ↓ calls
markdown-surgeon use cases
```

Need a new markdown operation in worklog? Add the method to the `MarkdownService` port in `worklog/domain/ports/`, implement it in `MarkdownSurgeonAdapter`. Never import markdown-surgeon adapters from worklog domain or use cases.

---

## Reference

Full architecture: `packages/tools/docs/technical/architecture.md`
