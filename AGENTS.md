# Guidelines for AI Agents

## Workflow

```bash
wl task create "Description"           # 1. Create worktask
wl trace <id> "Action with cause"      # 2. Trace actions
deno -A packages/tools/.../cli.ts ...  # 3. Test LOCAL (not wl/md)
task validate                          # 4. Validate (MANDATORY)
wl done <id> "Changes" "Learnings"     # 5. Complete

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
```

**Writing tests:** Use `Deno.makeTempDir()` and `createTempFile()`, never `/tmp/test-vault`.

### TDD (MANDATORY for bugs/features)

1. Write test → 2. Verify failure → 3. Implement → 4. Verify success → 5. Refactor → 6. Verify success

**Avoids false positives, documents behavior.**

### Comments

**Rule: Provide info NOT obvious from code.**

❌ Paraphrase: `// Check if external`
✓ Explain: `// Workaround git bug < 2.35: missing 'bare' field`

**When to comment:** Workarounds, non-obvious decisions, TODOs/FIXMEs, complex algorithms, trade-offs.

---

## TypeScript

**NEVER `as unknown as T`.**

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
