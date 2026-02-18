// InitUseCase - Initialize a .worklog directory

import type { StatusOutput } from "../../entities/outputs.ts";
import type { FileSystem } from "../../ports/filesystem.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";

export interface InitInput {
  readonly worklogDir: string;
  readonly tasksDir: string;
}

export class InitUseCase {
  constructor(
    private readonly fs: FileSystem,
    private readonly indexRepo: IndexRepository,
  ) {}

  async execute(input: InitInput): Promise<StatusOutput> {
    if (await this.fs.exists(input.worklogDir)) {
      return { status: "already_initialized" };
    }
    await this.fs.ensureDir(input.tasksDir);
    await this.indexRepo.save({ tasks: {} });
    return { status: "initialized" };
  }
}
