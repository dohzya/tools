// Command output types - immutable result types for all worklog commands

import type { Checkpoint } from "./checkpoint.ts";
import type { Entry } from "./entry.ts";
import type { TaskStatus } from "./task.ts";
import type { Todo } from "./todo.ts";

export type AddOutput = {
  readonly id: string;
};

export type TraceOutput = {
  readonly status: "ok" | "checkpoint_recommended";
  readonly entries_since_checkpoint?: number;
};

export type TracesOutput = {
  readonly task: string;
  readonly desc: string;
  readonly entries: readonly Entry[];
};

export type ShowOutput = {
  readonly task: string; // short ID
  readonly fullId: string; // full ID
  readonly name: string; // short name
  readonly desc: string;
  readonly status: TaskStatus;
  readonly created: string; // formatted date (from created_at)
  readonly ready: string | null; // formatted date (from ready_at)
  readonly started: string | null; // formatted date (from started_at)
  readonly last_checkpoint: Checkpoint | null;
  readonly entries_since_checkpoint: readonly Entry[];
  readonly todos: readonly Todo[];
  readonly tags?: readonly string[];
};

export type ListTaskItem = {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly status: TaskStatus;
  readonly created: string;
  readonly scopePrefix?: string;
  readonly tags?: readonly string[];
  readonly filterPattern?: string; // Pattern used for filtering (to hide from display)
};

export type ListOutput = {
  readonly tasks: readonly ListTaskItem[];
};

export type SummaryTaskItem = {
  readonly id: string;
  readonly desc: string;
  readonly status: TaskStatus;
  readonly checkpoints: readonly Checkpoint[];
  readonly entries: readonly Entry[];
};

export type SummaryOutput = {
  readonly tasks: readonly SummaryTaskItem[];
};

export type StatusOutput = {
  readonly status: string;
};

export type ImportTaskResult = {
  readonly id: string;
  readonly status: "imported" | "merged" | "skipped";
  readonly warnings?: readonly string[];
};

export type ImportOutput = {
  readonly imported: number;
  readonly merged: number;
  readonly skipped: number;
  readonly tasks: readonly ImportTaskResult[];
};

export type ScopesOutput = {
  readonly scopes: ReadonlyArray<{
    readonly id: string;
    readonly path: string;
    readonly isActive: boolean;
  }>;
};

export type MoveOutput = {
  readonly moved: number;
  readonly target: string;
};

export type ScopeDetailOutput = {
  readonly id: string;
  readonly path: string;
  readonly taskCount: number;
};

export type AssignOutput = {
  readonly assigned: number;
  readonly merged: number;
  readonly errors: ReadonlyArray<{
    readonly taskId: string;
    readonly error: string;
  }>;
};

export type TodoListOutput = {
  readonly todos: readonly Todo[];
};

export type TodoAddOutput = {
  readonly id: string;
  readonly taskId: string;
};

export type RunOutput = {
  readonly taskId: string;
  readonly exitCode: number;
  readonly created?: boolean; // true if task was created with --create
};
