# Guidelines for AI Agents

## Workflow

```bash
# Main agent:
wl task create "Description"          # 1a. Create worktask (if none exists)
wl update "More context..."           # 1b. OR update existing task description
# → Launch subagent for each code change (steps 2–5 run inside subagent)

# Subagent (TDD loop — MANDATORY for every code change):
wl trace <id> "Writing test for X"              # 2. Trace BEFORE writing test
# → Write failing test
wl trace <id> "Test fails as expected (Y)"      # 3. Trace confirmed failure
# → Implement
wl trace <id> "Implemented X — tests green"     # 4. Trace after green
task validate                                   # 5. Validate (MANDATORY)

# Release → RELEASE.md
```

**CRITICAL:** NEVER say "done" without running `task validate`.

---

## Worklog (MANDATORY)

Create a worktask at the start, trace each significant action, complete after commit.

**Good traces = causes + next steps:**

- ✅ `"Tried X - failed (cause: Y), next: Z"`
- ❌ `"Tried X"` / `"Doesn't work"`

**Commands:**

```bash
wl task create "..."       # Create
wl trace <id> "..."        # Trace
wl show <id>               # Context since checkpoint
wl traces <id>             # All traces
wl done <id> "..." "..."   # Complete (after commit)
```

`.worklog/` is local, never committed.

---

## Development

### Testing locally

**⚠️ CRITICAL: `wl` and `md` use JSR, NOT your local code!**

```bash
# DO THIS, NOT 'wl'/'md'
deno -A packages/tools/worklog/cli.ts <command>
deno -A packages/tools/markdown-surgeon/cli.ts <command>
```

### Tests

```bash
task test:md    # Tests markdown-surgeon
task test:wl    # Tests worklog
task test       # All tests
task validate   # fmt + check + lint + test

# After editing any .md file:
deno fmt        # MANDATORY — CI checks markdown formatting too
```

**Writing tests:** Use `Deno.makeTempDir()` and `createTempFile()`, never `/tmp/test-vault`.

### TDD (MANDATORY for all code changes)

1. Write test → 2. Verify failure → 3. Implement → 4. Verify success → 5. Refactor → 6. Verify success

`wl trace` at each step (see Workflow above). **Avoids false positives, documents behavior.**

### Comments

**Rule: Provide info NOT obvious from code.**

❌ Paraphrase: `// Check if external` ✓ Explain: `// Workaround git bug < 2.35: missing 'bare' field`

**When to comment:** Workarounds, non-obvious decisions, TODOs/FIXMEs, complex algorithms, trade-offs.

---

## TypeScript

→ See [packages/tools/TYPESCRIPT.md](packages/tools/TYPESCRIPT.md) for TypeScript coding rules (no type assertions — use ExplicitCast instead).

**NEVER `as Type` or `<Type>value`.** Use `ExplicitCast` (see above). `as const` is allowed.

**Use Zod 4 Mini:**

```typescript
import { z } from "zod/mini";
const schema = z.object({ id: z.string(), status: z.enum(["active", "done"]) });
const validated = schema.parse(data);
```

For external data (files, APIs, user input). Let validation errors bubble up.

---

## Architecture

→ See [ARCHI.md](ARCHI.md) for architecture rules (hexagonal, layer dependencies, forbidden patterns).

---

## Releases & CHANGELOG

→ See [RELEASE.md](RELEASE.md)
