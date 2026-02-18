// RunCommandUseCase - Run command with task context

import type { RunOutput } from "../entities/outputs.ts";
import { WtError } from "../entities/errors.ts";
import type { IndexRepository } from "../ports/index-repository.ts";
import type { TaskRepository } from "../ports/task-repository.ts";
import type { ProcessRunner } from "../ports/process-runner.ts";

export interface RunCommandInput {
  readonly cmd: readonly string[];
  readonly taskId?: string;
  readonly createName?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RunCommandDeps {
  readonly indexRepo: IndexRepository;
  readonly taskRepo: TaskRepository;
  readonly processRunner: ProcessRunner;
  readonly createTaskFn?: (name: string) => Promise<{ id: string }>;
  readonly resolveTaskFn?: (prefix: string) => Promise<string>;
}

export class RunCommandUseCase {
  constructor(private readonly deps: RunCommandDeps) {}

  async execute(input: RunCommandInput): Promise<RunOutput> {
    let resolvedTaskId: string;
    let wasCreated = false;

    if (input.createName) {
      if (!this.deps.createTaskFn) {
        throw new WtError(
          "invalid_args",
          "Create task function not available",
        );
      }
      const createOutput = await this.deps.createTaskFn(input.createName);
      resolvedTaskId = await this.resolveTaskId(createOutput.id);
      wasCreated = true;
    } else if (input.taskId) {
      resolvedTaskId = await this.resolveTaskId(input.taskId);
    } else {
      throw new WtError(
        "invalid_args",
        "Either taskId or --create must be provided",
      );
    }

    // Verify task exists
    const exists = await this.deps.taskRepo.exists(resolvedTaskId);
    if (!exists) {
      throw new WtError(
        "task_not_found",
        `Task not found: ${resolvedTaskId}`,
      );
    }

    // Execute command with WORKLOG_TASK_ID set
    const result = await this.deps.processRunner.run(input.cmd, {
      env: {
        ...(input.env ?? {}),
        WORKLOG_TASK_ID: resolvedTaskId,
      },
    });

    return {
      taskId: resolvedTaskId,
      exitCode: result.exitCode,
      created: wasCreated,
    };
  }

  private async resolveTaskId(prefix: string): Promise<string> {
    if (this.deps.resolveTaskFn) {
      return await this.deps.resolveTaskFn(prefix);
    }

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
