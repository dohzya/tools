# Agent Integration: Claude / Codex / Auto-detect

The worklog CLI supports launching AI agents with task context injected. Three agents are supported: **Claude Code** (Anthropic), **Codex** (OpenAI), and an **auto-detect** mode that picks the right one at runtime.

---

## Environment detection

Each agent sets distinctive environment variables when spawning subprocesses:

| Agent       | Environment variable  | Value                     |
| ----------- | --------------------- | ------------------------- |
| Claude Code | `CLAUDECODE`          | `1`                       |
| Claude Code | `AI_AGENT`            | `claude-code_<ver>_agent` |
| Codex       | `AGENT`               | `codex`                   |
| Terminal    | _(none of the above)_ | —                         |

Detection logic (in `domain/entities/agent-config.ts`):

```
CLAUDECODE truthy  → "claude"
AGENT = "codex"    → "codex"
otherwise          → null (plain terminal)
```

`CLAUDECODE` is checked first, so if both are somehow set, Claude wins.

---

## CLI surface

### Interactive commands

Launch an interactive agent session with task context:

```bash
wl claude [taskId] [args...]    # Always use Claude Code
wl codex  [taskId] [args...]    # Always use Codex
wl agent  [taskId] [args...]    # Auto-detect from env (error if plain terminal)
```

### Flags on create / checkpoint / done

```bash
wl create --claude "task name"   # Create task, then launch Claude
wl create --codex  "task name"   # Create task, then launch Codex
wl create --agent  "task name"   # Create task, then auto-detect

wl checkpoint --claude           # Claude synthesizes checkpoint
wl checkpoint --codex            # Codex synthesizes checkpoint
wl checkpoint --agent            # Auto-detect synthesizes checkpoint

wl done --claude                 # Claude synthesizes final checkpoint
wl done --codex                  # Codex synthesizes final checkpoint
wl done --agent                  # Auto-detect synthesizes final checkpoint
```

Flags are mutually exclusive — only one of `--claude`, `--codex`, `--agent` can be specified per command.

---

## How each agent is invoked

The `AgentConfig` interface defines two methods per agent:

### Interactive mode

| Agent  | Command built                                        |
| ------ | ---------------------------------------------------- |
| Claude | `claude --append-system-prompt <ctx> [...extraArgs]` |
| Codex  | `codex [...extraArgs] <ctx>`                         |

- **Claude** supports `--append-system-prompt` for injecting context as a system prompt (invisible to the user, shapes agent behavior).
- **Codex** has no system prompt flag. Context is passed as the initial `[PROMPT]` positional argument — it becomes the first user message.

### Synthesis mode (one-shot, used by `--agent` on checkpoint/done)

| Agent  | Command built                                              |
| ------ | ---------------------------------------------------------- |
| Claude | `claude --append-system-prompt <ctx> -p <synthesisPrompt>` |
| Codex  | `codex exec <synthesisPrompt>`                             |

- **Claude** gets both system context and the synthesis prompt (`-p`).
- **Codex** uses `codex exec` (non-interactive mode). The synthesis prompt already contains all needed context (task name, traces, guidelines), so the system prompt is not injected.

Both modes set `WORKLOG_TASK_ID` in the child process environment.

---

## Architecture

```
domain/entities/agent-config.ts     AgentType, AgentConfig, detection
domain/use-cases/agent-command.ts   AgentCommandUseCase (builds system prompt + launches)
checkpoint-prompt.ts                buildCheckpointPrompt (agent-agnostic synthesis prompt)
cli.ts                              cmdClaude, cmdCodex, cmdAgent, resolveAgentFlag
```

`AgentConfig` is a pure entity (no I/O). `detectAgentType` takes an `env` parameter for testability — callers pass `Deno.env`.

`AgentCommandUseCase` is parameterized by `AgentConfig` at construction. Two instances are created in `cli.ts` (one per agent), sharing the same deps.

---

## Adding a new agent

1. Add a value to `AgentType` in `agent-config.ts`
2. Create a new `AgentConfig` object with `buildInteractiveCmd` and `buildSynthesisCmd`
3. Add the agent's env detection to `detectAgentType`
4. Register it in the `agentConfigs` record
5. In `cli.ts`: create a new `AgentCommandUseCase` instance, add a `wl <name>` command, add `--<name>` flags to create/checkpoint/done
