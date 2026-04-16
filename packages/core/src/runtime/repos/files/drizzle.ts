import * as schema from '@offisim/db-local/dist/schema.js';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  FileHistoryRepository,
  FileHistoryRow,
  LibraryDocumentRow,
  NewFileHistory,
  NewLibraryDocument,
  RuntimeRepositories,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface FilesDrizzleRepos {
  fileHistory: FileHistoryRepository;
  libraryDocuments: RuntimeRepositories['libraryDocuments'];
}

export function createFilesDrizzleRepos(db: Db): FilesDrizzleRepos {
  const fileHistory: FileHistoryRepository = {
    async create(entry: NewFileHistory) {
      db.insert(schema.fileHistory).values(entry).run();
      return entry as FileHistoryRow;
    },
    async listByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.fileHistory)
        .where(eq(schema.fileHistory.thread_id, threadId))
        .orderBy(desc(schema.fileHistory.created_at));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return query.all() as FileHistoryRow[];
    },
    async listBySnapshot(snapshotId) {
      return db
        .select()
        .from(schema.fileHistory)
        .where(eq(schema.fileHistory.snapshot_id, snapshotId))
        .orderBy(schema.fileHistory.created_at)
        .all() as FileHistoryRow[];
    },
    async deleteByThread(threadId) {
      db.delete(schema.fileHistory).where(eq(schema.fileHistory.thread_id, threadId)).run();
    },
  };

  const libraryDocuments: RuntimeRepositories['libraryDocuments'] = {
    async create(doc: NewLibraryDocument) {
      const ts = now();
      const row: LibraryDocumentRow = { ...doc, created_at: ts, updated_at: ts };
      db.insert(schema.libraryDocuments).values(row).run();
      return row;
    },
    async findById(docId) {
      const rows = db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.doc_id, docId))
        .all();
      return (rows[0] as LibraryDocumentRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.company_id, companyId))
        .all() as LibraryDocumentRow[];
    },
    async search(companyId, query, opts) {
      const pattern = `%${query}%`;
      const limit = opts?.limit ?? 20;
      return db
        .select()
        .from(schema.libraryDocuments)
        .where(
          and(
            eq(schema.libraryDocuments.company_id, companyId),
            or(
              like(sql`lower(${schema.libraryDocuments.title})`, pattern.toLowerCase()),
              like(sql`lower(${schema.libraryDocuments.content_text})`, pattern.toLowerCase()),
            ),
          ),
        )
        .limit(limit)
        .all() as LibraryDocumentRow[];
    },
    async delete(docId) {
      db.delete(schema.libraryDocuments).where(eq(schema.libraryDocuments.doc_id, docId)).run();
    },
  };

  return { fileHistory, libraryDocuments };
}
