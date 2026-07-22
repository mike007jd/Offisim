import type {
  LibraryDocumentRepository,
  LibraryDocumentRow,
  NewLibraryDocument,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows } from '../memory-utils.js';

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
  libraryDocuments: MemoryLibraryDocumentRepository;
}

export function createFilesMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): FilesMemoryRepos {
  const libraryDocuments = new MemoryLibraryDocumentRepository(snapshot?.libraryDocuments);
  return { libraryDocuments };
}
