import type { EventBus } from '../events/event-bus.js';
import type { LibraryDocumentRepository, LibraryDocumentRow } from '../runtime/repositories.js';

/** A structured citation entry returned alongside formatted snippets. */
export interface CitationEntry {
  /** 1-based index matching [N] in the prompt text. */
  index: number;
  docTitle: string;
  docId: string;
  snippet: string;
}

/** Score a document's relevance to a multi-keyword query */
export function scoreDocument(doc: LibraryDocumentRow, keywords: string[]): number {
  let score = 0;
  const titleLower = doc.title.toLowerCase();
  const contentLower = doc.content_text.toLowerCase();
  for (const kw of keywords) {
    if (titleLower.includes(kw)) score += 3; // title match worth 3x
    // Count occurrences in content
    let idx = 0;
    while ((idx = contentLower.indexOf(kw, idx)) !== -1) {
      score += 1;
      idx += kw.length;
    }
  }
  return score;
}

/** Extract a snippet around the first keyword match in content */
export function extractRelevantSnippet(
  content: string,
  keywords: string[],
  maxLen: number = 500,
): string {
  const contentLower = content.toLowerCase();
  // Find position of first keyword match
  let bestPos = 0;
  for (const kw of keywords) {
    const pos = contentLower.indexOf(kw);
    if (pos >= 0) {
      bestPos = pos;
      break;
    }
  }
  // Center snippet around match
  const start = Math.max(0, bestPos - Math.floor(maxLen / 2));
  const end = Math.min(content.length, start + maxLen);
  const snippet = content.slice(start, end);
  return (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : '');
}

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

  /** Shared: fetch, deduplicate, score, and rank documents for a query. */
  private async fetchAndRankDocuments(
    companyId: string,
    query: string,
  ): Promise<Array<{ doc: LibraryDocumentRow; score: number; snippet: string }>> {
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length >= 2);
    if (keywords.length === 0) return [];

    const seen = new Set<string>();
    const docs: LibraryDocumentRow[] = [];
    for (const kw of keywords) {
      const results = await this.libraryRepo.search(companyId, kw, { limit: 20 });
      for (const doc of results) {
        if (!seen.has(doc.doc_id)) {
          seen.add(doc.doc_id);
          docs.push(doc);
        }
      }
    }
    if (docs.length === 0) return [];

    return docs
      .map((doc) => ({
        doc,
        score: scoreDocument(doc, keywords),
        snippet: extractRelevantSnippet(doc.content_text, keywords),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  /**
   * Get relevant snippets for a query — simple text format with document titles.
   */
  async getRelevantSnippets(
    companyId: string,
    query: string,
    maxChars: number = 4000,
  ): Promise<string> {
    const ranked = await this.fetchAndRankDocuments(companyId, query);
    if (ranked.length === 0) return '';

    let result = '';
    for (const { doc, snippet } of ranked) {
      const entry = `[${doc.title}]\n${snippet}\n\n---\n\n`;
      if (result.length + entry.length > maxChars) break;
      result += entry;
    }
    return result.trim();
  }

  /**
   * Like getRelevantSnippets but returns structured citation metadata alongside the formatted text.
   * The text uses numbered [N] markers: `[1] Title (doc_id)\nsnippet\n\n[2] ...`
   */
  async getRelevantSnippetsWithCitations(
    companyId: string,
    query: string,
    maxChars: number = 4000,
  ): Promise<{ text: string; citations: CitationEntry[] }> {
    const ranked = await this.fetchAndRankDocuments(companyId, query);
    if (ranked.length === 0) return { text: '', citations: [] };

    let result = '';
    const citations: CitationEntry[] = [];
    let idx = 1;
    for (const { doc, snippet } of ranked) {
      const entry = `[${idx}] ${doc.title} (${doc.doc_id})\n${snippet}\n\n`;
      if (result.length + entry.length > maxChars) break;
      result += entry;
      citations.push({ index: idx, docTitle: doc.title, docId: doc.doc_id, snippet });
      idx++;
    }
    return { text: result.trim(), citations };
  }
}
