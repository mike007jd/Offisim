import type {
  FileHistoryRepository,
  FileHistoryRow,
  LibraryDocumentRow,
  NewFileHistory,
  NewLibraryDocument,
  RuntimeRepositories,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface FilesTauriRepos {
  fileHistory: FileHistoryRepository;
  libraryDocuments: RuntimeRepositories['libraryDocuments'];
}

export function createFilesTauriRepos(db: TauriDrizzleDb): FilesTauriRepos {
  const fileHistory: FileHistoryRepository = {
    async create(entry: NewFileHistory) {
      await db.insert(schema.fileHistory).values(entry);
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
      return (await query) as FileHistoryRow[];
    },
    async listBySnapshot(snapshotId) {
      return (await db
        .select()
        .from(schema.fileHistory)
        .where(eq(schema.fileHistory.snapshot_id, snapshotId))
        .orderBy(schema.fileHistory.created_at)) as FileHistoryRow[];
    },
    async deleteByThread(threadId) {
      await db.delete(schema.fileHistory).where(eq(schema.fileHistory.thread_id, threadId));
    },
  };

  const libraryDocuments: RuntimeRepositories['libraryDocuments'] = {
    async create(doc: NewLibraryDocument) {
      const ts = now();
      const row: LibraryDocumentRow = { ...doc, created_at: ts, updated_at: ts };
      await db.insert(schema.libraryDocuments).values(row);
      return row;
    },
    async findById(docId) {
      const rows = await db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.doc_id, docId));
      return (rows[0] as LibraryDocumentRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.libraryDocuments)
        .where(eq(schema.libraryDocuments.company_id, companyId))) as LibraryDocumentRow[];
    },
    async search(companyId, query, opts) {
      const pattern = `%${query}%`;
      const limit = opts?.limit ?? 20;
      return (await db
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
        .limit(limit)) as LibraryDocumentRow[];
    },
    async delete(docId) {
      await db.delete(schema.libraryDocuments).where(eq(schema.libraryDocuments.doc_id, docId));
    },
  };

  return { fileHistory, libraryDocuments };
}
