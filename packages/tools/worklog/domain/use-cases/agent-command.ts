// AgentCommandUseCase - Run an AI agent with task context

import type { AgentConfig } from "../entities/agent-config.ts";
import type { RunOutput, ShowOutput } from "../entities/outputs.ts";
import { WtError } from "../entities/errors.ts";
import type { IndexRepository } from "../ports/index-repository.ts";
import type { ProcessRunner } from "../ports/process-runner.ts";

export interface AgentCommandInput {
  readonly taskId?: string;
  readonly agentArgs?: readonly string[];
  readonly envTaskId?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly synthesisPrompt?: string;
}

export interface AgentCommandDeps {
  readonly indexRepo: IndexRepository;
  readonly processRunner: ProcessRunner;
  readonly showTaskFn: (taskId: string) => Promise<ShowOutput>;
}

export class AgentCommandUseCase {
  constructor(
    private readonly deps: AgentCommandDeps,
    private readonly agentConfig: AgentConfig,
  ) {}

  async execute(input: AgentCommandInput): Promise<RunOutput> {
    const id = input.taskId ?? input.envTaskId;
    if (!id) {
      throw new WtError(
        "invalid_args",
        "taskId argument is required (or set WORKLOG_TASK_ID environment variable)",
      );
    }

    const resolvedTaskId = await this.resolveTaskId(id);

    const taskInfo = await this.deps.showTaskFn(resolvedTaskId);

    const systemPrompt = this.buildSystemPrompt(taskInfo, resolvedTaskId);

    const cmd = input.synthesisPrompt
      ? this.agentConfig.buildSynthesisCmd(systemPrompt, input.synthesisPrompt)
      : this.agentConfig.buildInteractiveCmd(
        systemPrompt,
        input.agentArgs ?? [],
      );

    const result = await this.deps.processRunner.run(cmd, {
      env: {
        ...(input.env ?? {}),
        WORKLOG_TASK_ID: resolvedTaskId,
      },
    });

    return {
      taskId: resolvedTaskId,
      exitCode: result.exitCode,
      created: false,
    };
  }

  private buildSystemPrompt(
    taskInfo: ShowOutput,
    resolvedTaskId: string,
  ): string {
    const agentType = this.agentConfig.type;

    const recentTraces = taskInfo.entries_since_checkpoint
      .slice(-5)
      .map((e) => `  - [${e.ts}] ${e.msg}`)
      .join("\n");

    const todos = taskInfo.todos
      .filter((t) => t.status === "todo")
      .map((t) => `  - [ ] ${t.text}`)
      .join("\n");

    return `
# Current Worktask Context

You are working on the following task:

**Task ID**: ${taskInfo.fullId} (short: ${taskInfo.task})
**Name**: ${taskInfo.name}
**Status**: ${taskInfo.status}
**Created**: ${taskInfo.created}
${taskInfo.started ? `**Started**: ${taskInfo.started}` : ""}

## Description
${taskInfo.desc || "(no description)"}

${recentTraces ? `## Recent Traces\n${recentTraces}` : ""}

${todos ? `## TODO\n${todos}` : ""}

---

## Tracing

Trace every event: action taken / problem hit / idea / lead explored / finding / insight.
Include causes (why failed) and pistes (what next) for context.

## WORKLOG_TASK_ID

The environment variable is set to: ${resolvedTaskId}

**All commands work without taskId** — the env var is used automatically:
  wl trace "msg", wl checkpoint "changes" "insights", wl done "changes" "insights",
  wl show, wl start, wl ready, wl traces, wl update, wl cancel, wl meta, wl todo next

To trace in a **different** task (e.g. a subtask), pass its ID as first argument:
  wl trace <other-id> "msg"

**Never** prefix a command with \`WORKLOG_TASK_ID=... wl ...\` — the variable is already set.

## Checkpoints

When it's time to consolidate traces, prefer **\`wl checkpoint --${agentType}\`** — it feeds all your traces to a fresh ${this.agentConfig.name} instance with quality guidelines, so you don't have to write the synthesis yourself. It preserves your context window.

## Subtasks

To delegate sub-work to another agent, create a subtask linked to this task:
  wl create --parent ${resolvedTaskId} --started "Sub-task name"

Then launch the sub-agent with its own context:
  wl ${agentType} <subtask-id>

Check subtask progress:
  wl show ${resolvedTaskId}   # shows subtasks-since-checkpoint section
  wl list --parent ${resolvedTaskId}   # only children of this task
`.trim();
  }

  private async resolveTaskId(prefix: string): Promise<string> {
    const index = await this.deps.indexRepo.load();
    const allIds = Object.keys(index.tasks);
    const matches = allIds.filter((id) =>
      id.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (matches.length === 0) {
      throw new WtError(
        "task_not_found",
        `No task found matching prefix: ${prefix}`,
      );
    }

    if (matches.length > 1) {
      throw new WtError(
        "invalid_args",
        `Ambiguous task ID prefix '${prefix}' matches ${matches.length} tasks`,
      );
    }

    return matches[0];
  }
}
