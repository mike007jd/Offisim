import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import { LibraryService } from '../services/library-service.js';
import { InMemoryEventBus } from '../events/event-bus.js';

describe('LibraryService', () => {
  function setup() {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();
    const service = new LibraryService(repos.libraryDocuments, eventBus);
    return { repos, eventBus, service };
  }

  it('uploads and retrieves document', async () => {
    const { service } = setup();
    const id = await service.uploadDocument('c-1', 'Test Doc', 'Hello world content', 'file', 'text/plain', 100);
    expect(id).toBeTruthy();

    const doc = await service.getDocument(id);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('Test Doc');
    expect(doc!.content_text).toBe('Hello world content');
  });

  it('lists documents by company', async () => {
    const { service } = setup();
    await service.uploadDocument('c-1', 'Doc A', 'Content A', 'file');
    await service.uploadDocument('c-1', 'Doc B', 'Content B', 'file');
    await service.uploadDocument('c-2', 'Doc C', 'Content C', 'file');

    const docs = await service.listDocuments('c-1');
    expect(docs).toHaveLength(2);
  });

  it('searches documents by keyword in title', async () => {
    const { service } = setup();
    await service.uploadDocument('c-1', 'API Documentation', 'REST endpoints', 'file');
    await service.uploadDocument('c-1', 'User Guide', 'How to use the app', 'file');

    const results = await service.search('c-1', 'API');
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('API Documentation');
  });

  it('searches documents by keyword in content', async () => {
    const { service } = setup();
    await service.uploadDocument('c-1', 'Notes', 'The authentication system uses JWT tokens', 'file');
    await service.uploadDocument('c-1', 'Other', 'Unrelated content here', 'file');

    const results = await service.search('c-1', 'JWT');
    expect(results).toHaveLength(1);
  });

  it('search is case-insensitive', async () => {
    const { service } = setup();
    await service.uploadDocument('c-1', 'Guide', 'React Components', 'file');

    expect(await service.search('c-1', 'react')).toHaveLength(1);
    expect(await service.search('c-1', 'REACT')).toHaveLength(1);
  });

  it('deletes document', async () => {
    const { service } = setup();
    const id = await service.uploadDocument('c-1', 'To Delete', 'content', 'file');
    await service.deleteDocument(id);

    expect(await service.getDocument(id)).toBeNull();
    expect(await service.listDocuments('c-1')).toHaveLength(0);
  });

  it('getRelevantSnippets returns formatted excerpts', async () => {
    const { service } = setup();
    await service.uploadDocument('c-1', 'Auth Guide', 'The auth system uses OAuth2 for authentication. Tokens expire after 1 hour.', 'file');
    await service.uploadDocument('c-1', 'Deploy Guide', 'Deploy using Docker. The container runs on port 8080.', 'file');

    const snippets = await service.getRelevantSnippets('c-1', 'auth');
    expect(snippets).toContain('[Auth Guide]');
    expect(snippets).toContain('OAuth2');
  });

  it('getRelevantSnippets returns empty string when no matches', async () => {
    const { service } = setup();
    const result = await service.getRelevantSnippets('c-1', 'nonexistent');
    expect(result).toBe('');
  });

  it('getRelevantSnippets respects maxChars', async () => {
    const { service } = setup();
    const longContent = 'keyword '.repeat(1000);
    await service.uploadDocument('c-1', 'Long Doc', longContent, 'file');

    const snippets = await service.getRelevantSnippets('c-1', 'keyword', 200);
    expect(snippets.length).toBeLessThanOrEqual(250); // some overhead from title
  });
});
