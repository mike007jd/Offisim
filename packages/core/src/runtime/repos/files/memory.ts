import type {
  FileHistoryRepository,
  FileHistoryRow,
  LibraryDocumentRepository,
  LibraryDocumentRow,
  NewLibraryDocument,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemoryFileHistoryRepository implements FileHistoryRepository {
  private readonly rows: FileHistoryRow[] = [];

  constructor(initialRows?: Iterable<FileHistoryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(entry: FileHistoryRow): Promise<FileHistoryRow> {
    this.rows.push(entry);
    return entry;
  }

  async listByThread(threadId: string, opts?: { limit?: number }): Promise<FileHistoryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }

  async listBySnapshot(snapshotId: string): Promise<FileHistoryRow[]> {
    return this.rows
      .filter((row) => row.snapshot_id === snapshotId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async deleteByThread(threadId: string): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index]?.thread_id === threadId) {
        this.rows.splice(index, 1);
      }
    }
  }

  snapshot(): FileHistoryRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryLibraryDocumentRepository implements LibraryDocumentRepository {
  private readonly store = new Map<string, LibraryDocumentRow>();

  constructor(initialRows?: Iterable<LibraryDocumentRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.doc_id, { ...row });
    }
  }

  async create(doc: NewLibraryDocument): Promise<LibraryDocumentRow> {
    const row: LibraryDocumentRow = {
      ...doc,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.doc_id, row);
    return row;
  }

  async findById(docId: string): Promise<LibraryDocumentRow | null> {
    return this.store.get(docId) ?? null;
  }

  async findByCompany(companyId: string): Promise<LibraryDocumentRow[]> {
    return [...this.store.values()]
      .filter((d) => d.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async search(
    companyId: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<LibraryDocumentRow[]> {
    const q = query.toLowerCase();
    let results = [...this.store.values()].filter(
      (d) =>
        d.company_id === companyId &&
        (d.title.toLowerCase().includes(q) || d.content_text.toLowerCase().includes(q)),
    );
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async delete(docId: string): Promise<void> {
    this.store.delete(docId);
  }

  snapshot(): LibraryDocumentRow[] {
    return cloneRows(this.store.values());
  }
}

export interface FilesMemoryRepos {
  fileHistory: MemoryFileHistoryRepository;
  libraryDocuments: MemoryLibraryDocumentRepository;
}

export function createFilesMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): FilesMemoryRepos {
  const fileHistory = new MemoryFileHistoryRepository(snapshot?.fileHistory);
  const libraryDocuments = new MemoryLibraryDocumentRepository(snapshot?.libraryDocuments);
  return { fileHistory, libraryDocuments };
}
