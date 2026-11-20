# TypeScript Rules

## No type assertions — use ExplicitCast

**Never use `value as Type` or `<Type>value`.** All casts go through `ExplicitCast` from `packages/tools/explicit-cast.ts`. This keeps casts visible, auditable, and grep-able.

**Exception: `as const` is allowed** — it is a const assertion, not a type assertion.

**Exception: `explicit-cast.ts` itself** — the only file allowed to contain `as` (it is the implementation).

---

### API

```typescript
import { ExplicitCast } from "../explicit-cast.ts";
```

#### `fromAny(...).dangerousCast<T>()` — for `any` sources

Use when the input is typed `any` (e.g. `JSON.parse`, external APIs).

```typescript
// Before:
const data = JSON.parse(raw) as MyType;

// After:
const data = ExplicitCast.fromAny(JSON.parse(raw)).dangerousCast<MyType>();
```

#### `from<TParam>(...).downcast<TResult>()` — safe downcast

Use when `TResult extends TParam`. Compile-time error if the constraint is violated.

```typescript
// Before:
const circle = shape as Circle;

// After:
const circle = ExplicitCast.from<Shape>(shape).downcast<Circle>();
```

#### `from<TParam>(...).dangerousCast<TResult>()` — unsafe cast, made explicit

Use when `downcast` is not possible (no subtype relationship). Prefer Zod validation over this.

```typescript
const result = ExplicitCast.from<unknown>(value).dangerousCast<MyType>();
```

---

### Decision tree

1. Input is `any` (JSON.parse, untyped API) → `fromAny(...).dangerousCast<T>()`
2. Narrowing within a type hierarchy → `from<Parent>(...).downcast<Child>()`
3. External data that needs validation → use Zod (see AGENTS.md)
4. None of the above → `from<unknown>(...).dangerousCast<T>()`, add a comment explaining why validation is not feasible
