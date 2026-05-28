/**
 * CLI output formatters for worklog commands.
 *
 * All formatX() functions transform command output objects into human-readable strings.
 * These are pure functions with no side effects.
 */

import type {
  AddOutput,
  AssignOutput,
  ImportOutput,
  ListOutput,
  ScopeDetailOutput,
  ScopesOutput,
  ShowOutput,
  StatusOutput,
  SummaryOutput,
  Todo,
  TodoAddOutput,
  TodoListOutput,
  TodoStatus,
  TraceOutput,
  TracesOutput,
  WtError,
} from "../../types.ts";

// ============================================================================
// ID helpers (needed by formatters)
// ============================================================================

/**
 * Get shortest unambiguous prefix for display.
 */
export function getShortId(id: string, allIds: string[]): string {
  const minLen = 5;
  let len = minLen;

  while (len < id.length) {
    const prefix = id.slice(0, len);
    const conflicts = allIds.filter((other) =>
      other !== id && other.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (conflicts.length === 0) {
      // Add 1 char margin, but don't exceed id length
      return id.slice(0, Math.min(len + 1, id.length));
    }
    len++;
  }

  return id;
}

// ============================================================================
// Formatters
// ============================================================================

export function formatAdd(output: AddOutput): string {
  return output.id;
}

export function formatTodoList(output: TodoListOutput): string {
  if (output.todos.length === 0) {
    return "No todos";
  }

  const statusChars: Record<TodoStatus, string> = {
    "todo": " ",
    "wip": "/",
    "blocked": ">",
    "cancelled": "-",
    "done": "x",
  };

  // Calculate short IDs for all todos and tasks
  const allTodoIds = output.todos.map((t) => t.id);
  const allTaskIds = Array.from(
    new Set(
      output.todos.map((t) => t.metadata.taskId).filter(Boolean),
    ),
  );

  // Group todos by task if taskId is present in metadata
  const byTask = new Map<string, { desc: string; todos: Todo[] }>();
  const ungrouped: Todo[] = [];

  for (const todo of output.todos) {
    const taskId = todo.metadata.taskId;
    const taskDesc = todo.metadata.taskDesc;

    if (taskId && taskDesc) {
      if (!byTask.has(taskId)) {
        byTask.set(taskId, { desc: taskDesc, todos: [] });
      }
      byTask.get(taskId)!.todos.push(todo);
    } else {
      ungrouped.push(todo);
    }
  }

  const lines: string[] = [];

  // Format grouped todos
  if (byTask.size > 0) {
    for (const [taskId, { desc, todos }] of byTask) {
      const shortTaskId = getShortId(taskId, allTaskIds);
      lines.push(`\n${shortTaskId}: ${desc}`);
      for (const todo of todos) {
        const statusChar = statusChars[todo.status];
        const shortTodoId = getShortId(todo.id, allTodoIds);
        let line = `  ${shortTodoId} [${statusChar}] ${todo.text}`;

        // Add metadata (excluding taskId and taskDesc which are already shown)
        const metadata = Object.entries(todo.metadata)
          .filter(([k]) => k !== "taskId" && k !== "taskDesc")
          .map(([k, v]) => `[${k}:: ${v}]`)
          .join(" ");

        if (metadata) {
          line += `  ${metadata}`;
        }

        lines.push(line);
      }
    }
  }

  // Format ungrouped todos
  for (const todo of ungrouped) {
    const statusChar = statusChars[todo.status];
    const shortTodoId = getShortId(todo.id, allTodoIds);
    let line = `${shortTodoId} [${statusChar}] ${todo.text}`;

    const metadata = Object.entries(todo.metadata)
      .map(([k, v]) => `[${k}:: ${v}]`)
      .join(" ");

    if (metadata) {
      line += `  ${metadata}`;
    }

    lines.push(line);
  }

  return lines.join("\n").trim();
}

export function formatTodoAdd(output: TodoAddOutput): string {
  return output.id;
}

export function formatTodoNext(todo: Todo | null): string {
  if (!todo) {
    return "No available todo";
  }

  const statusChars: Record<TodoStatus, string> = {
    "todo": " ",
    "wip": "/",
    "blocked": ">",
    "cancelled": "-",
    "done": "x",
  };

  const statusChar = statusChars[todo.status];
  let line = `${todo.id} [${statusChar}] ${todo.text}`;

  const metadata = Object.entries(todo.metadata)
    .map(([k, v]) => `[${k}:: ${v}]`)
    .join(" ");

  if (metadata) {
    line += `  ${metadata}`;
  }

  return line;
}

export function formatTrace(output: TraceOutput): string {
  if (output.status === "checkpoint_recommended") {
    return `checkpoint recommended (${output.entries_since_checkpoint} entries)`;
  }
  return "ok";
}

export function formatStatus(output: StatusOutput): string {
  return output.status.replace(/_/g, " ");
}

export function formatMeta(
  output: { metadata: Record<string, string> },
): string {
  if (Object.keys(output.metadata).length === 0) {
    return "(no metadata)";
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(output.metadata)) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

export function formatShow(output: ShowOutput): string {
  const lines: string[] = [];

  // Header
  lines.push(`id: ${output.task}`);
  lines.push(`full id: ${output.fullId}`);
  lines.push(`name: ${output.name}`);
  lines.push(`status: ${output.status}`);
  if (output.tags && output.tags.length > 0) {
    lines.push(`tags: ${output.tags.map((t) => `#${t}`).join(" ")}`);
  }

  // History
  lines.push("history:");
  lines.push(`  created: ${output.created}`);
  if (output.ready) {
    lines.push(`  ready: ${output.ready}`);
  }
  if (output.started) {
    lines.push(`  started: ${output.started}`);
  }

  // Description (multiline with 2-space indent)
  lines.push("");
  lines.push("desc:");
  for (const line of output.desc.split("\n")) {
    lines.push(`  ${line}`);
  }

  // Last checkpoint
  if (output.last_checkpoint) {
    lines.push("");
    lines.push(`last checkpoint: ${output.last_checkpoint.ts}`);
    lines.push("  CHANGES");
    for (const line of output.last_checkpoint.changes.split("\n")) {
      lines.push(`    ${line}`);
    }
    lines.push("  LEARNINGS");
    for (const line of output.last_checkpoint.learnings.split("\n")) {
      lines.push(`    ${line}`);
    }
  }

  // Entries since checkpoint
  if (output.entries_since_checkpoint.length > 0) {
    lines.push("");
    lines.push(
      `entries since checkpoint: ${output.entries_since_checkpoint.length}`,
    );
    for (const entry of output.entries_since_checkpoint) {
      lines.push(`  ${entry.ts}`);
      for (const line of entry.msg.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }

  // Todos
  if (output.todos.length > 0) {
    lines.push("");
    lines.push(`todos: ${output.todos.length}`);

    const statusChars: Record<TodoStatus, string> = {
      "todo": " ",
      "wip": "/",
      "blocked": ">",
      "cancelled": "-",
      "done": "x",
    };

    const allTodoIds = output.todos.map((t) => t.id);

    for (const todo of output.todos) {
      const statusChar = statusChars[todo.status];
      const shortTodoId = getShortId(todo.id, allTodoIds);
      let line = `  ${shortTodoId} [${statusChar}] ${todo.text}`;

      // Add metadata
      const metadata = Object.entries(todo.metadata)
        .map(([k, v]) => `[${k}:: ${v}]`)
        .join(" ");

      if (metadata) {
        line += `  ${metadata}`;
      }

      lines.push(line);
    }
  }

  return lines.join("\n");
}

export function formatTraces(output: TracesOutput): string {
  const lines: string[] = [];
  lines.push(`task: ${output.task}`);
  lines.push(`desc: ${output.desc}`);

  if (output.entries.length === 0) {
    lines.push("");
    lines.push("no traces");
  } else {
    lines.push("");
    lines.push(`traces: ${output.entries.length}`);
    for (const entry of output.entries) {
      lines.push(`  ${entry.ts}: ${entry.msg}`);
    }
  }

  return lines.join("\n");
}

export function formatList(output: ListOutput, showAll = false): string {
  if (output.tasks.length === 0) {
    return showAll ? "no tasks" : "no active tasks";
  }

  // Sort tasks by creation date (newest first)
  const sortedTasks = [...output.tasks].sort((a, b) =>
    new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  // Calculate short IDs
  const allIds = sortedTasks.map((t) => t.id);

  return sortedTasks
    .map((t) => {
      const shortId = getShortId(t.id, allIds);

      // Filter scope prefix if it matches the filter pattern
      let prefix = "";
      if (
        t.scopePrefix && (!t.filterPattern || t.scopePrefix !== t.filterPattern)
      ) {
        prefix = `[${t.scopePrefix}]  `;
      }

      // Filter tags - exclude the exact match of filterPattern, but keep children
      let tagsToShow = t.tags || [];
      if (t.filterPattern && t.tags) {
        tagsToShow = t.tags.filter((tag) => {
          // Exclude exact match
          if (tag === t.filterPattern) return false;
          // Exclude if filterPattern is a child of this tag (shouldn't happen but be safe)
          if (t.filterPattern!.startsWith(tag + "/")) return false;
          // Include everything else (including children of filterPattern like foo/bar when filtering by foo)
          return true;
        });
      }

      const tagsStr = tagsToShow.length > 0
        ? tagsToShow.map((tag) => `#${tag}`).join(" ") + "  "
        : "";

      return `${prefix}${tagsStr}${shortId}  ${t.status}  "${t.name}"  ${t.created}`;
    })
    .join("\n");
}

export function formatScopes(output: ScopesOutput): string {
  if (output.scopes.length === 0) {
    return "no scopes found";
  }

  const lines: string[] = ["Scopes:"];

  for (const scope of output.scopes) {
    const active = scope.isActive ? "  [active]" : "";
    const id = scope.id.padEnd(15);
    lines.push(`  ${id} ${scope.path}${active}`);
  }

  return lines.join("\n");
}

export function formatScopeDetail(output: ScopeDetailOutput): string {
  return `Scope: ${output.id}
Path: ${output.path}
Tasks: ${output.taskCount}`;
}

export function formatAssign(output: AssignOutput): string {
  const lines: string[] = [];
  lines.push(`Assigned: ${output.assigned}`);
  lines.push(`Merged: ${output.merged}`);

  if (output.errors.length > 0) {
    lines.push("\nErrors:");
    for (const err of output.errors) {
      lines.push(`  ${err.taskId}: ${err.error}`);
    }
  }

  return lines.join("\n");
}

export function formatSummary(output: SummaryOutput): string {
  if (output.tasks.length === 0) {
    return "no tasks";
  }

  const parts: string[] = [];

  for (const task of output.tasks) {
    const lines: string[] = [];
    lines.push(`# ${task.id}: ${task.desc} (${task.status})`);

    if (task.checkpoints.length > 0) {
      lines.push("");
      lines.push("## Checkpoints");
      for (const cp of task.checkpoints) {
        lines.push(`### ${cp.ts}`);
        lines.push("Changes:");
        for (const line of cp.changes.split("\n")) {
          lines.push(`  ${line}`);
        }
        lines.push("Learnings:");
        for (const line of cp.learnings.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    }

    if (task.entries.length > 0) {
      lines.push("");
      lines.push("## Entries");
      for (const entry of task.entries) {
        lines.push(`${entry.ts}: ${entry.msg}`);
      }
    }

    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n---\n\n");
}

export function formatImport(output: ImportOutput): string {
  const lines: string[] = [];
  lines.push(`imported: ${output.imported}`);
  lines.push(`merged: ${output.merged}`);
  lines.push(`skipped: ${output.skipped}`);

  if (output.tasks.length > 0) {
    lines.push("");
    for (const task of output.tasks) {
      let line = `${task.id}: ${task.status}`;
      if (task.warnings && task.warnings.length > 0) {
        line += ` (${task.warnings.join(", ")})`;
      }
      lines.push(line);
    }
  }

  return lines.join("\n");
}

export function formatError(error: WtError): string {
  return `error: ${error.code}\n${error.message}`;
}
