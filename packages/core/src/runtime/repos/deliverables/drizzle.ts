import * as schema from '@offisim/db-local/dist/schema.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  DeliverableKind,
  DeliverableRepository,
  DeliverableRow,
  DeliverableSummaryRow,
  NewDeliverable,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_LIST_LIMIT = 100;

export interface DeliverablesDrizzleRepos {
  deliverables: DeliverableRepository;
}

function rowToSummary(row: {
  deliverable_id: string;
  company_id: string;
  thread_id: string | null;
  title: string;
  kind: string | null;
  file_name: string | null;
  mime_type: string | null;
  contributors_json: string;
  created_at: string;
  content_size: number;
}): DeliverableSummaryRow {
  return {
    deliverable_id: row.deliverable_id,
    company_id: row.company_id,
    thread_id: row.thread_id,
    title: row.title,
    kind: (row.kind as DeliverableKind | null) ?? null,
    file_name: row.file_name,
    mime_type: row.mime_type,
    contributors_json: row.contributors_json,
    created_at: row.created_at,
    content_size: row.content_size ?? 0,
  };
}

function rowToFull(row: {
  deliverable_id: string;
  company_id: string;
  thread_id: string | null;
  title: string;
  content: string;
  kind: string | null;
  file_name: string | null;
  mime_type: string | null;
  contributors_json: string;
  created_at: string;
}): DeliverableRow {
  return {
    deliverable_id: row.deliverable_id,
    company_id: row.company_id,
    thread_id: row.thread_id,
    title: row.title,
    content: row.content,
    kind: (row.kind as DeliverableKind | null) ?? null,
    file_name: row.file_name,
    mime_type: row.mime_type,
    contributors_json: row.contributors_json,
    created_at: row.created_at,
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
      const whereClause = opts?.threadId
        ? and(
            eq(schema.deliverables.company_id, companyId),
            eq(schema.deliverables.thread_id, opts.threadId),
          )
        : eq(schema.deliverables.company_id, companyId);
      const rows = db
        .select({
          deliverable_id: schema.deliverables.deliverable_id,
          company_id: schema.deliverables.company_id,
          thread_id: schema.deliverables.thread_id,
          title: schema.deliverables.title,
          kind: schema.deliverables.kind,
          file_name: schema.deliverables.file_name,
          mime_type: schema.deliverables.mime_type,
          contributors_json: schema.deliverables.contributors_json,
          created_at: schema.deliverables.created_at,
          content_size: sql<number>`length(${schema.deliverables.content})`.as('content_size'),
        })
        .from(schema.deliverables)
        .where(whereClause)
        .orderBy(desc(schema.deliverables.created_at))
        .limit(limit)
        .all();
      return rows.map((r) => rowToSummary(r as Parameters<typeof rowToSummary>[0]));
    },
  };

  return { deliverables };
}
