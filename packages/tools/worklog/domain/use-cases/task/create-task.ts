// CreateTaskUseCase - Create a new task

import { stringify as stringifyYaml } from "@std/yaml";
import type { AddOutput } from "../../entities/outputs.ts";
import type { TaskStatus } from "../../entities/task.ts";
import type { IndexRepository } from "../../ports/index-repository.ts";
import type { TaskRepository } from "../../ports/task-repository.ts";
import type { MarkdownService } from "../../ports/markdown-service.ts";
import { WtError } from "../../entities/errors.ts";
import {
  generateTaskIdBase62,
  generateTodoId,
  getShortId,
  validateTag,
} from "../../entities/task-helpers.ts";

export interface CreateTaskInput {
  readonly name: string;
  readonly desc?: string;
  readonly initialStatus?: TaskStatus;
  readonly todos?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
  readonly timestamp?: string;
  readonly parent?: string; // Full parent task ID (already resolved)
}

export interface CreateTaskDeps {
  readonly indexRepo: IndexRepository;
  readonly taskRepo: TaskRepository;
  readonly markdownService: MarkdownService;
  readonly generateId?: () => string;
  readonly generateUid?: () => string;
  readonly getTimestamp?: () => string;
}

export class CreateTaskUseCase {
  constructor(private readonly deps: CreateTaskDeps) {}

  async execute(input: CreateTaskInput): Promise<AddOutput> {
    // Validate tags
    if (input.tags && input.tags.length > 0) {
      for (const tag of input.tags) {
        const error = validateTag(tag);
        if (error) {
          throw new WtError("invalid_args", `Invalid tag '${tag}': ${error}`);
        }
      }
    }

    const generateId = this.deps.generateId ?? generateTaskIdBase62;
    const generateUid = this.deps.generateUid ?? (() => crypto.randomUUID());
    const getTimestamp = this.deps.getTimestamp ?? (() => {
      const now = new Date();
      const tzOffset = -now.getTimezoneOffset();
      const sign = tzOffset >= 0 ? "+" : "-";
      const hours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(
        2,
        "0",
      );
      const minutes = String(Math.abs(tzOffset) % 60).padStart(2, "0");
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hour = String(now.getHours()).padStart(2, "0");
      const minute = String(now.getMinutes()).padStart(2, "0");
      const second = String(now.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hours}:${minutes}`;
    });

    const id = generateId();
    const uid = generateUid();
    const now = input.timestamp ?? getTimestamp();
    const taskDesc = input.desc ?? "";
    const status = input.initialStatus ?? "created";

    // Build TODO items
    const todoItems: Array<{ id: string; text: string }> = [];
    if (input.todos && input.todos.length > 0) {
      for (const todoText of input.todos) {
        todoItems.push({ id: generateTodoId(), text: todoText });
      }
    }

    // Set timestamps based on initial status
    let readyAt: string | null = null;
    let startedAt: string | null = null;
    if (status === "ready") {
      readyAt = now;
    } else if (status === "started") {
      startedAt = now;
    }

    // Build frontmatter object — key insertion order = YAML field order
    const frontmatter: Record<string, unknown> = {
      id,
      uid,
      name: input.name,
      desc: taskDesc,
      status,
      created_at: now,
      ready_at: readyAt,
      started_at: startedAt,
      done_at: null,
      last_checkpoint: null,
      has_uncheckpointed_entries: false,
    };

    if (input.metadata && Object.keys(input.metadata).length > 0) {
      frontmatter.metadata = input.metadata;
    }

    if (input.tags && input.tags.length > 0) {
      frontmatter.tags = [...input.tags];
    }

    if (input.parent) {
      frontmatter.parent = input.parent;
    }

    const yaml = stringifyYaml(frontmatter, { lineWidth: -1 }).trim();

    // Build TODO section
    let todoSection = "";
    if (todoItems.length > 0) {
      todoSection = "\n# TODO\n\n";
      for (const todo of todoItems) {
        todoSection += `- [ ] ${todo.text}  [id:: ${todo.id}] ^${todo.id}\n`;
      }
    }

    const content =
      `---\n${yaml}\n---\n\n# Entries\n\n# Checkpoints${todoSection}\n`;

    await this.deps.taskRepo.saveContent(id, content);

    // Update index
    await this.deps.indexRepo.addEntry(id, {
      name: input.name,
      desc: taskDesc,
      status,
      created: now,
      status_updated_at: now,
      done_at: null,
      ...(input.tags && input.tags.length > 0 && { tags: input.tags }),
      ...(input.parent && { parent: input.parent }),
    });

    // Calculate short ID for display
    const index = await this.deps.indexRepo.load();
    const shortId = getShortId(index, id);

    return { id: shortId };
  }
}
