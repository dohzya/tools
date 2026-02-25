# Guidelines for AI Agents

## Development Workflow

**Every code change MUST be performed in a subagent (to preserve conversation context) and MUST follow the TDD loop below — except for scripts, Taskfile tasks, and configuration files which don't require TDD.**

### Main agent

1a. Create a worktask if none exists:

```bash
wl task create "short name"
```

OR 1b. update an existing task:

```bash
wl update <id> "More context..."
```

Then **launch a subagent** for each code change (steps 2–6 run inside the subagent).

### Subagent — TDD loop (MANDATORY for application code)

**Scope:** `packages/tools/` source code. Does NOT apply to scripts, `Taskfile.yml`, docs, or config files — those can be edited directly without TDD.

```bash
wl trace <id> "Writing test for X"              # 2. Trace BEFORE writing test
# → Write failing test
wl trace <id> "Test fails as expected: Y"       # 3. Trace confirmed failure
# → Implement minimum code to make it pass
wl trace <id> "Implemented X — tests green"     # 4. Trace after green
task validate                                   # 5. Validate (MANDATORY)
```

**Steps in detail:**

1. `wl trace` — before touching any code, describe what you're about to test
2. **Write failing test** — add test; run and confirm it fails for the right reason
3. `wl trace` — record the observed failure message
4. **Implement** — minimum code to make the test pass
5. **Verify** — run `task validate`; confirm green
6. `wl trace` — record that tests pass
7. **Refactor if needed** — re-run `task validate` after

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
