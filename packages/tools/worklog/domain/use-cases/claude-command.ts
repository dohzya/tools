// ClaudeCommandUseCase - Run claude with task context

import type { RunOutput, ShowOutput } from "../entities/outputs.ts";
import { WtError } from "../entities/errors.ts";
import type { IndexRepository } from "../ports/index-repository.ts";
import type { ProcessRunner } from "../ports/process-runner.ts";

export interface ClaudeCommandInput {
  readonly taskId?: string;
  readonly claudeArgs?: readonly string[];
  readonly envTaskId?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ClaudeCommandDeps {
  readonly indexRepo: IndexRepository;
  readonly processRunner: ProcessRunner;
  readonly showTaskFn: (taskId: string) => Promise<ShowOutput>;
}

export class ClaudeCommandUseCase {
  constructor(private readonly deps: ClaudeCommandDeps) {}

  async execute(input: ClaudeCommandInput): Promise<RunOutput> {
    const id = input.taskId ?? input.envTaskId;
    if (!id) {
      throw new WtError(
        "invalid_args",
        "taskId argument is required (or set WORKLOG_TASK_ID environment variable)",
      );
    }

    const resolvedTaskId = await this.resolveTaskId(id);

    // Load task details
    const taskInfo = await this.deps.showTaskFn(resolvedTaskId);

    // Build system prompt with task context
    const recentTraces = taskInfo.entries_since_checkpoint
      .slice(-5)
      .map((e) => `  - [${e.ts}] ${e.msg}`)
      .join("\n");

    const todos = taskInfo.todos
      .filter((t) => t.status === "todo")
      .map((t) => `  - [ ] ${t.text}`)
      .join("\n");

    const systemPrompt = `
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

## WORKLOG_TASK_ID

The environment variable is set to: ${resolvedTaskId}

Commands that work **without taskId** (uses WORKLOG_TASK_ID automatically):
  wl show, wl start, wl ready, wl traces, wl update, wl cancel, wl meta, wl todo next

Commands that still **require taskId as first argument** (ambiguous with other args):
  wl trace <id> "msg", wl checkpoint <id> ..., wl done <id> ...
`.trim();

    // Launch Claude with appended system prompt
    const claudeArgs = input.claudeArgs ?? [];
    const result = await this.deps.processRunner.run(
      ["claude", "--append-system-prompt", systemPrompt, ...claudeArgs],
      {
        env: {
          ...(input.env ?? {}),
          WORKLOG_TASK_ID: resolvedTaskId,
        },
      },
    );

    return {
      taskId: resolvedTaskId,
      exitCode: result.exitCode,
      created: false,
    };
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
