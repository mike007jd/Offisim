import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import {
  LibraryService,
  scoreDocument,
  extractRelevantSnippet,
} from '../services/library-service.js';
import { InMemoryEventBus } from '../events/event-bus.js';
import type { LibraryDocumentRow } from '../runtime/repositories.js';

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

  it('getRelevantSnippets returns empty for short keywords', async () => {
    const { service } = setup();
    await service.uploadDocument('c-1', 'A', 'a b c', 'file');

    const result = await service.getRelevantSnippets('c-1', 'a');
    expect(result).toBe('');
  });

  it('getRelevantSnippets ranks title matches higher than content matches', async () => {
    const { service } = setup();
    // Doc with "auth" in title
    await service.uploadDocument('c-1', 'Auth Guide', 'This guide covers login flows.', 'file');
    // Doc with "auth" only in content (mentioned once)
    await service.uploadDocument('c-1', 'Overview', 'The auth system handles sessions.', 'file');

    const snippets = await service.getRelevantSnippets('c-1', 'auth');
    // Auth Guide should appear first (title match = 3 points > content match = 1 point)
    const authGuidePos = snippets.indexOf('[Auth Guide]');
    const overviewPos = snippets.indexOf('[Overview]');
    expect(authGuidePos).toBeGreaterThanOrEqual(0);
    expect(overviewPos).toBeGreaterThan(authGuidePos);
  });

  it('getRelevantSnippets ranks multi-keyword matches higher', async () => {
    const { service } = setup();
    // Matches both "react" and "hooks"
    await service.uploadDocument('c-1', 'React Hooks Guide', 'Using react hooks effectively with useEffect and useState.', 'file');
    // Matches only "react"
    await service.uploadDocument('c-1', 'React Basics', 'Introduction to components and JSX.', 'file');

    const snippets = await service.getRelevantSnippets('c-1', 'react hooks');
    const hooksGuidePos = snippets.indexOf('[React Hooks Guide]');
    const basicsPos = snippets.indexOf('[React Basics]');
    expect(hooksGuidePos).toBeGreaterThanOrEqual(0);
    expect(basicsPos).toBeGreaterThan(hooksGuidePos);
  });
});

describe('scoreDocument', () => {
  const makeDoc = (title: string, content: string): LibraryDocumentRow => ({
    doc_id: 'test',
    company_id: 'c-1',
    title,
    content_text: content,
    source_type: 'file',
    mime_type: null,
    file_size: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  it('scores title match at 3x weight', () => {
    const doc = makeDoc('Authentication', 'No keywords here');
    const score = scoreDocument(doc, ['authentication']);
    expect(score).toBe(3);
  });

  it('scores each content occurrence at 1x', () => {
    const doc = makeDoc('Other', 'auth auth auth');
    const score = scoreDocument(doc, ['auth']);
    expect(score).toBe(3); // 3 occurrences in content
  });

  it('combines title and content scores', () => {
    const doc = makeDoc('Auth Guide', 'The auth system uses auth tokens');
    const score = scoreDocument(doc, ['auth']);
    // title: 3, content: 2 occurrences = 2 → total 5
    expect(score).toBe(5);
  });

  it('scores multiple keywords independently', () => {
    const doc = makeDoc('React Hooks', 'Using hooks in react');
    const score = scoreDocument(doc, ['react', 'hooks']);
    // title: react(3) + hooks(3) = 6, content: hooks(1) + react(1) = 2 → total 8
    expect(score).toBe(8);
  });

  it('returns 0 for no matches', () => {
    const doc = makeDoc('Unrelated', 'Nothing matches here');
    const score = scoreDocument(doc, ['python']);
    expect(score).toBe(0);
  });
});

describe('extractRelevantSnippet', () => {
  it('centers snippet around first keyword match', () => {
    const content = 'A'.repeat(300) + 'KEYWORD' + 'B'.repeat(300);
    const snippet = extractRelevantSnippet(content, ['keyword'], 100);
    expect(snippet).toContain('KEYWORD');
    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
  });

  it('returns beginning when no keyword found', () => {
    const content = 'Hello world this is content';
    const snippet = extractRelevantSnippet(content, ['nonexistent'], 500);
    expect(snippet).toBe(content);
  });

  it('does not add ellipsis when snippet covers full content', () => {
    const content = 'Short text with keyword here';
    const snippet = extractRelevantSnippet(content, ['keyword'], 500);
    expect(snippet).toBe(content);
    expect(snippet.startsWith('...')).toBe(false);
    expect(snippet.endsWith('...')).toBe(false);
  });

  it('uses first matching keyword for centering', () => {
    const content = 'Start ' + 'X'.repeat(400) + 'alpha' + 'Y'.repeat(400) + ' beta end';
    const snippet = extractRelevantSnippet(content, ['alpha', 'beta'], 100);
    expect(snippet).toContain('alpha');
  });
});
