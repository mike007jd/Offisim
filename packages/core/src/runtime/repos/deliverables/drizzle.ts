import * as schema from '@offisim/db-local/dist/schema.js';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  DeliverableRepository,
  DeliverableRow,
  DeliverableSummaryRow,
  NewDeliverable,
} from '../../repositories.js';
import { coerceDeliverableKind } from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_LIST_LIMIT = 100;

export interface DeliverablesDrizzleRepos {
  deliverables: DeliverableRepository;
}

function rowToSummary(row: {
  deliverable_id: string;
  company_id: string;
  thread_id: string | null;
  chat_thread_id?: string | null;
  title: string;
  kind: string | null;
  file_name: string | null;
  mime_type: string | null;
  contributors_json: string;
  created_at: string;
  content_size: number;
  run_id?: string | null;
  content_hash?: string | null;
  version?: number | null;
}): DeliverableSummaryRow {
  return {
    deliverable_id: row.deliverable_id,
    company_id: row.company_id,
    thread_id: row.thread_id,
    chat_thread_id: row.chat_thread_id ?? null,
    title: row.title,
    kind: coerceDeliverableKind(row.kind),
    file_name: row.file_name,
    mime_type: row.mime_type,
    contributors_json: row.contributors_json,
    created_at: row.created_at,
    content_size: row.content_size ?? 0,
    run_id: row.run_id ?? null,
    content_hash: row.content_hash ?? null,
    version: row.version ?? 1,
  };
}

function rowToFull(row: {
  deliverable_id: string;
  company_id: string;
  thread_id: string | null;
  chat_thread_id?: string | null;
  title: string;
  content: string;
  kind: string | null;
  file_name: string | null;
  mime_type: string | null;
  contributors_json: string;
  created_at: string;
  run_id?: string | null;
  content_hash?: string | null;
  version?: number | null;
}): DeliverableRow {
  return {
    deliverable_id: row.deliverable_id,
    company_id: row.company_id,
    thread_id: row.thread_id,
    chat_thread_id: row.chat_thread_id ?? null,
    title: row.title,
    content: row.content,
    kind: coerceDeliverableKind(row.kind),
    file_name: row.file_name,
    mime_type: row.mime_type,
    contributors_json: row.contributors_json,
    created_at: row.created_at,
    run_id: row.run_id ?? null,
    content_hash: row.content_hash ?? null,
    version: row.version ?? 1,
  };
}

export function createDeliverablesDrizzleRepos(db: Db): DeliverablesDrizzleRepos {
  const deliverables: DeliverableRepository = {
    async insert(row: NewDeliverable) {
      db.insert(schema.deliverables)
        .values(row)
        .onConflictDoNothing({ target: schema.deliverables.deliverable_id })
        .run();
    },
    async findById(deliverableId) {
      const rows = db
        .select()
        .from(schema.deliverables)
        .where(eq(schema.deliverables.deliverable_id, deliverableId))
        .all();
      const first = rows[0];
      return first ? rowToFull(first as Parameters<typeof rowToFull>[0]) : null;
    },
    async listByCompany(companyId, opts) {
      const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
      const threadClause = opts?.threadId
        ? or(
            eq(schema.deliverables.thread_id, opts.threadId),
            eq(schema.deliverables.chat_thread_id, opts.threadId),
          )
        : undefined;
      const whereClause = threadClause
        ? and(eq(schema.deliverables.company_id, companyId), threadClause)
        : eq(schema.deliverables.company_id, companyId);
      const rows = db
        .select({
          deliverable_id: schema.deliverables.deliverable_id,
          company_id: schema.deliverables.company_id,
          thread_id: schema.deliverables.thread_id,
          chat_thread_id: schema.deliverables.chat_thread_id,
          title: schema.deliverables.title,
          kind: schema.deliverables.kind,
          file_name: schema.deliverables.file_name,
          mime_type: schema.deliverables.mime_type,
          contributors_json: schema.deliverables.contributors_json,
          created_at: schema.deliverables.created_at,
          run_id: schema.deliverables.run_id,
          content_hash: schema.deliverables.content_hash,
          version: schema.deliverables.version,
          content_size: sql<number>`length(CAST(${schema.deliverables.content} AS BLOB))`.as(
            'content_size',
          ),
        })
        .from(schema.deliverables)
        .where(whereClause)
        .orderBy(desc(schema.deliverables.created_at))
        .limit(limit)
        .all();
      return rows.map((r) => rowToSummary(r as Parameters<typeof rowToSummary>[0]));
    },
    async listByCompanyWithContent(companyId, opts) {
      const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
      const threadClause = opts?.threadId
        ? or(
            eq(schema.deliverables.thread_id, opts.threadId),
            eq(schema.deliverables.chat_thread_id, opts.threadId),
          )
        : undefined;
      const whereClause = threadClause
        ? and(eq(schema.deliverables.company_id, companyId), threadClause)
        : eq(schema.deliverables.company_id, companyId);
      const rows = db
        .select()
        .from(schema.deliverables)
        .where(whereClause)
        .orderBy(desc(schema.deliverables.created_at))
        .limit(limit)
        .all();
      return rows.map((r) => rowToFull(r as Parameters<typeof rowToFull>[0]));
    },
  };

  return { deliverables };
}
