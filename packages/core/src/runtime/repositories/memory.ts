export type EmployeeProjectMemoryType =
  | 'pitfall'
  | 'repository_preference'
  | 'convention'
  | 'retrospective';

/** One durable lesson owned by an employee inside a single Project. */
export interface EmployeeProjectMemoryRow {
  memory_id: string;
  company_id: string;
  employee_id: string;
  project_id: string;
  memory_type: EmployeeProjectMemoryType;
  content: string;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  hit_count: number;
  last_hit_at: string | null;
}

export type NewEmployeeProjectMemory = Omit<
  EmployeeProjectMemoryRow,
  'source_run_id' | 'pinned' | 'hit_count' | 'last_hit_at'
> & {
  source_run_id?: string | null;
  pinned?: boolean;
  hit_count?: number;
  last_hit_at?: string | null;
};

export type EmployeeProjectMemoryPatch = Partial<
  Pick<
    EmployeeProjectMemoryRow,
    'memory_type' | 'content' | 'source_run_id' | 'pinned' | 'updated_at'
  >
>;

export interface EmployeeProjectMemoryRepository {
  create(row: NewEmployeeProjectMemory): Promise<EmployeeProjectMemoryRow>;
  findById(memoryId: string): Promise<EmployeeProjectMemoryRow | null>;
  /** Personnel view: every project, newest semantic update first. */
  listByEmployee(employeeId: string): Promise<EmployeeProjectMemoryRow[]>;
  /** Injection view: pinned → hit count → semantic recency. */
  listByProject(employeeId: string, projectId: string): Promise<EmployeeProjectMemoryRow[]>;
  /** One Project's rows for all employees, used to build the acting prompt and opaque Pi roster in one read. */
  listByProjectScope(companyId: string, projectId: string): Promise<EmployeeProjectMemoryRow[]>;
  update(memoryId: string, patch: EmployeeProjectMemoryPatch): Promise<void>;
  delete(memoryId: string): Promise<void>;
  incrementHits(memoryIds: readonly string[], hitAt: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory system
// ---------------------------------------------------------------------------

export interface MemoryEntryRow {
  memory_id: string;
  company_id: string;
  scope: 'employee' | 'team' | 'company';
  owner_id: string;
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  content: string;
  importance: number;
  confidence: number;
  dedupe_key: string;
  reinforcement_count: number;
  last_reinforced_at: string;
  metadata_json: string | null;
  source_thread_id: string | null;
  created_at: string;
  accessed_at: string;
  access_count: number;
}

export interface MemoryEntryCreate {
  memory_id: string;
  company_id: string;
  scope: 'employee' | 'team' | 'company';
  owner_id: string;
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  content: string;
  importance: number;
  confidence?: number;
  dedupe_key?: string;
  reinforcement_count?: number;
  last_reinforced_at?: string | null;
  metadata_json?: string | null;
  source_thread_id?: string | null;
}

export interface MemoryDedupeLookup {
  companyId: string;
  scope: 'employee' | 'team' | 'company';
  ownerId: string;
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  dedupeKey: string;
}

export interface MemoryReinforcementPatch {
  content?: string;
  importance?: number;
  confidence?: number;
  metadataJson?: string | null;
  sourceThreadId?: string | null;
}

/**
 * Direct field overwrite for human edits (Personnel memory tab). Unlike
 * `reinforce`, this does not gate content by length, does not max-merge
 * importance, and does not bump the reinforcement count — it writes exactly
 * what the caller passes. `reinforce` stays reserved for runtime reinforcement.
 */
export interface MemoryUpdatePatch {
  content?: string;
  importance?: number;
}

export interface MemoryRepository {
  create(entry: MemoryEntryCreate): Promise<MemoryEntryRow>;
  findById(memoryId: string): Promise<MemoryEntryRow | null>;
  findByDedupeKey(lookup: MemoryDedupeLookup): Promise<MemoryEntryRow | null>;
  search(
    query: string,
    opts: { scope?: string; ownerId?: string; companyId: string; limit?: number },
  ): Promise<MemoryEntryRow[]>;
  delete(memoryId: string): Promise<void>;
  findByOwner(
    ownerId: string,
    opts?: { category?: string; companyId?: string; scope?: string; limit?: number | null },
  ): Promise<MemoryEntryRow[]>;
  reinforce(memoryId: string, patch: MemoryReinforcementPatch): Promise<MemoryEntryRow | null>;
  update(memoryId: string, patch: MemoryUpdatePatch): Promise<MemoryEntryRow | null>;
  touchAccess(memoryId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Node summaries
// ---------------------------------------------------------------------------

export interface NodeSummaryRow {
  summary_id: string;
  thread_id: string;
  company_id: string;
  node_name: string;
  employee_id: string | null;
  step_index: number | null;
  summary_text: string;
  decisions_json: string;
  files_touched_json: string;
  tools_used_json: string;
  input_token_count: number;
  output_token_count: number;
  message_count: number;
  duration_ms: number;
  created_at: string;
}

/** Full-row insert: caller supplies summary_id + created_at (backend does not stamp). */
export type NewNodeSummary = Omit<NodeSummaryRow, never>;

export interface NodeSummaryRepository {
  create(summary: NewNodeSummary): Promise<NodeSummaryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<NodeSummaryRow[]>;
  countByThread(threadId: string): Promise<number>;
  deleteByThread(threadId: string): Promise<void>;
  trimByThread(threadId: string, keepLatest: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Compact summaries
// ---------------------------------------------------------------------------

export interface CompactSummaryRow {
  compact_id: string;
  thread_id: string;
  company_id: string;
  compact_kind: string;
  summary_source: string;
  summary_text: string;
  pre_compact_message_count: number;
  pre_compact_token_count: number;
  messages_compacted: number;
  failure_streak: number;
  created_at: string;
}

/** Full-row insert: caller supplies compact_id + created_at (backend does not stamp). */
export type NewCompactSummary = Omit<CompactSummaryRow, never>;

export interface CompactSummaryRepository {
  create(summary: NewCompactSummary): Promise<CompactSummaryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<CompactSummaryRow[]>;
  deleteByThread(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Library documents
// ---------------------------------------------------------------------------

export interface LibraryDocumentRow {
  doc_id: string;
  company_id: string;
  title: string;
  content_text: string;
  source_type: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  updated_at: string;
}

export type NewLibraryDocument = Omit<LibraryDocumentRow, 'created_at' | 'updated_at'>;

export interface LibraryDocumentRepository {
  create(doc: NewLibraryDocument): Promise<LibraryDocumentRow>;
  findById(docId: string): Promise<LibraryDocumentRow | null>;
  findByCompany(companyId: string): Promise<LibraryDocumentRow[]>;
  search(
    companyId: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<LibraryDocumentRow[]>;
  delete(docId: string): Promise<void>;
}
