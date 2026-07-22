import * as schema from '@offisim/db-local/dist/schema.js';
import { and, eq, like, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  LibraryDocumentRow,
  NewLibraryDocument,
  RuntimeRepositories,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface FilesDrizzleRepos {
  libraryDocuments: RuntimeRepositories['libraryDocuments'];
}

export function createFilesDrizzleRepos(db: Db): FilesDrizzleRepos {
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

  return { libraryDocuments };
}
