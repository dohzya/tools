// Index repository port - persistence interface for the worklog index

import type { Index, IndexEntry } from "../entities/index.ts";

/**
 * Repository for persisting and retrieving the worklog index.
 */
export interface IndexRepository {
  /** Load the index. Throws if not initialized. */
  load(): Promise<Index>;

  /** Save the complete index. */
  save(index: Index): Promise<void>;

  /** Add a new entry to the index. */
  addEntry(taskId: string, entry: IndexEntry): Promise<void>;

  /** Update fields of an existing index entry. */
  updateEntry(taskId: string, updates: Partial<IndexEntry>): Promise<void>;

  /** Remove an entry from the index. */
  removeEntry(taskId: string): Promise<void>;

  /** Check if the index exists (worklog is initialized). */
  exists(): Promise<boolean>;
}
