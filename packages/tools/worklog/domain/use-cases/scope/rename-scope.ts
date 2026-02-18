// RenameScopeUseCase - Rename scope

import type { StatusOutput } from "../../entities/outputs.ts";
import type { ScopeEntry } from "../../entities/scope.ts";
import { WtError } from "../../entities/errors.ts";
import type { ScopeRepository } from "../../ports/scope-repository.ts";
import type { GitService } from "../../ports/git-service.ts";

export interface RenameScopeInput {
  readonly scopeId: string;
  readonly newId: string;
  readonly cwd: string;
  readonly worklogDir: string;
}

export class RenameScopeUseCase {
  constructor(
    private readonly scopeRepo: ScopeRepository,
    private readonly gitService: GitService,
  ) {}

  async execute(input: RenameScopeInput): Promise<StatusOutput> {
    const gitRoot = await this.gitService.getRoot(input.cwd);
    if (!gitRoot) {
      throw new WtError(
        "not_in_git_repo",
        "Not in a git repository. Scopes require git.",
      );
    }

    const rootWorklogPath = `${gitRoot}/${input.worklogDir}`;
    const rootConfig = await this.scopeRepo.loadConfig(rootWorklogPath);

    if (!rootConfig || !("children" in rootConfig)) {
      throw new WtError(
        "scope_not_found",
        "Root configuration corrupted or no child scopes found.",
      );
    }

    const child = rootConfig.children.find(
      (c) => c.id === input.scopeId || c.path === input.scopeId,
    );

    if (!child) {
      throw new WtError(
        "scope_not_found",
        `Scope not found: ${input.scopeId}`,
      );
    }

    // Update the ID
    const updatedChildren: ScopeEntry[] = rootConfig.children.map((c) =>
      c === child ? { ...c, id: input.newId } : c
    );

    await this.scopeRepo.saveConfig(rootWorklogPath, {
      children: updatedChildren,
    });

    return { status: "scope_renamed" };
  }
}
