import { describe, expect, it } from 'vitest';
import { exportDocument } from '../export';
import type { ExportableDocument, ExportFormat } from '../types';

const sampleDoc: ExportableDocument = {
  title: 'Q4 Strategy Report',
  content: [
    '# Executive Summary',
    'Our Q4 results exceeded expectations across all departments.',
    '',
    '## Revenue',
    'Revenue grew by 25% quarter-over-quarter.',
    '',
    '## Product Updates',
    'We shipped 3 major features and resolved 42 bugs.',
    '',
    '### Mobile App',
    'The mobile app reached 100k downloads.',
  ].join('\n'),
  contributors: [{ name: 'Alice' }, { name: 'Bob' }],
  createdAt: new Date('2026-01-15T10:00:00Z').getTime(),
};

const emptyDoc: ExportableDocument = {
  title: 'Empty Document',
  content: '',
  contributors: [],
  createdAt: Date.now(),
};

describe('exportDocument', () => {
  const formats: ExportFormat[] = ['docx', 'pdf', 'pptx', 'csv', 'html', 'txt'];

  for (const format of formats) {
    describe(`${format} exporter`, () => {
      it('produces a non-empty blob with correct filename extension', async () => {
        const result = await exportDocument(sampleDoc, format);
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.size).toBeGreaterThan(0);
        expect(result.filename).toMatch(new RegExp(`\\.${format}$`));
      });

      it('includes document title in filename', async () => {
        const result = await exportDocument(sampleDoc, format);
        expect(result.filename).toContain('Q4_Strategy_Report');
      });

      it('returns a valid MIME type', async () => {
        const result = await exportDocument(sampleDoc, format);
        expect(result.mimeType).toBeTruthy();
        expect(result.mimeType).toContain('/');
      });

      it('handles empty content', async () => {
        const result = await exportDocument(emptyDoc, format);
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.size).toBeGreaterThan(0);
      });
    });
  }

  it('throws on unsupported format', async () => {
    await expect(
      exportDocument(sampleDoc, 'xyz' as ExportFormat),
    ).rejects.toThrow('Unsupported export format');
  });
});

describe('html exporter content', () => {
  it('includes title and contributor names in output', async () => {
    const result = await exportDocument(sampleDoc, 'html');
    const html = await result.blob.text();
    expect(html).toContain('Q4 Strategy Report');
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
  });

  it('escapes HTML entities', async () => {
    const doc: ExportableDocument = {
      title: 'Test <script>alert(1)</script>',
      content: 'Some & "content"',
      contributors: [],
      createdAt: Date.now(),
    };
    const result = await exportDocument(doc, 'html');
    const html = await result.blob.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('txt exporter content', () => {
  it('includes title, date, and content', async () => {
    const result = await exportDocument(sampleDoc, 'txt');
    const text = await result.blob.text();
    expect(text).toContain('Q4 Strategy Report');
    expect(text).toContain('Alice, Bob');
    expect(text).toContain('Revenue grew by 25%');
  });
});

describe('csv exporter content', () => {
  it('includes structured sections', async () => {
    const result = await exportDocument(sampleDoc, 'csv');
    const csv = await result.blob.text();
    expect(csv).toContain('Document');
    expect(csv).toContain('Q4 Strategy Report');
    expect(csv).toContain('Revenue');
  });
});
