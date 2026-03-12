import type { EventBus } from '../events/event-bus.js';
import type { LibraryDocumentRepository, LibraryDocumentRow } from '../runtime/repositories.js';

export class LibraryService {
  constructor(
    private readonly libraryRepo: LibraryDocumentRepository,
    _eventBus: EventBus,
  ) {}

  async uploadDocument(
    companyId: string,
    title: string,
    content: string,
    sourceType: string = 'file',
    mimeType?: string,
    fileSize?: number,
  ): Promise<string> {
    const docId = `doc_${crypto.randomUUID()}`;
    await this.libraryRepo.create({
      doc_id: docId,
      company_id: companyId,
      title,
      content_text: content,
      source_type: sourceType,
      mime_type: mimeType ?? null,
      file_size: fileSize ?? null,
    });
    return docId;
  }

  async search(companyId: string, query: string, limit?: number): Promise<LibraryDocumentRow[]> {
    return this.libraryRepo.search(companyId, query, { limit });
  }

  async getDocument(docId: string): Promise<LibraryDocumentRow | null> {
    return this.libraryRepo.findById(docId);
  }

  async listDocuments(companyId: string): Promise<LibraryDocumentRow[]> {
    return this.libraryRepo.findByCompany(companyId);
  }

  async deleteDocument(docId: string): Promise<void> {
    await this.libraryRepo.delete(docId);
  }

  /**
   * Get relevant snippets for a query — used by employee-node for document-augmented responses.
   * Returns concatenated matching document excerpts up to maxChars.
   */
  async getRelevantSnippets(
    companyId: string,
    query: string,
    maxChars: number = 4000,
  ): Promise<string> {
    const docs = await this.libraryRepo.search(companyId, query, { limit: 5 });
    if (docs.length === 0) return '';

    const snippets: string[] = [];
    let totalChars = 0;

    for (const doc of docs) {
      const excerpt = this.extractRelevantExcerpt(doc.content_text, query, 500);
      const snippet = `[${doc.title}]\n${excerpt}`;
      if (totalChars + snippet.length > maxChars) break;
      snippets.push(snippet);
      totalChars += snippet.length;
    }

    return snippets.join('\n\n---\n\n');
  }

  private extractRelevantExcerpt(content: string, query: string, maxLen: number): string {
    const q = query.toLowerCase();
    const idx = content.toLowerCase().indexOf(q);
    if (idx === -1) {
      // No exact match — return beginning
      return content.slice(0, maxLen) + (content.length > maxLen ? '...' : '');
    }
    // Center the excerpt around the match
    const start = Math.max(0, idx - Math.floor(maxLen / 2));
    const end = Math.min(content.length, start + maxLen);
    let excerpt = content.slice(start, end);
    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';
    return excerpt;
  }
}
