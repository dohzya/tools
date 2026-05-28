# Guidelines for AI Agents

## Development Workflow

Use a subagent for code changes when the agent environment supports it and the change is substantial enough to benefit from delegation. All application-code changes MUST follow the TDD loop below. Scripts, Taskfile tasks, docs, and configuration files do not require TDD.

### Main agent

1a. Create a worktask if none exists:

```bash
wl create "short name"
```

OR 1b. update an existing task:

```bash
wl update <id> "More context..."
```

Then launch a subagent when available and appropriate. For application code, steps 2–6 run inside that subagent; otherwise follow the same TDD loop in the current session.

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

Create a worktask at the start. Trace every action taken, problem hit, idea, lead explored, finding, and learning. Complete after commit.

**Good traces = causes + next steps:**

- ✅ `"Tried X - failed (cause: Y), next: Z"`
- ❌ `"Tried X"` / `"Doesn't work"`

**Commands:**

```bash
wl create "..."            # Create
wl trace <id> "..."        # Trace
wl show <id>               # Context since checkpoint
wl traces <id>             # All traces
wl done <id> "..." "..."   # Complete (after commit)
```

**Spawning a new agent CLI session?** Use `wl agent <taskid>` to auto-detect the current agent, or `wl claude <taskid>` / `wl codex <taskid>` explicitly. These commands set `WORKLOG_TASK_ID` and inject task context (recent traces, TODOs, description) into the system prompt. The built-in Agent tool ("subagent") doesn't need this — it stays in-process and inherits the environment.

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

**CLI test environment:**

- Unset `NO_COLOR` when tests assert ANSI-colored output.
- Unset `WORKLOG_TASK_ID` when running worklog tests so agent context does not change CLI defaults.

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

## Skills

**Skills source code lives in `./plugins/tools/skills/`.** Never modify installed copies under `~/.claude/`, `~/.codex/`, or other agent home directories — those are managed by plugin systems.

---

## Architecture

→ See [ARCHI.md](ARCHI.md) for architecture rules (hexagonal, layer dependencies, forbidden patterns).

---

## Releases & CHANGELOG

→ See [RELEASE.md](RELEASE.md)
