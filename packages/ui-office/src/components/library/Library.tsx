import { Book, FileText, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button, Input } from '@offisim/ui-core';
import { useLibrary } from '../../hooks/useLibrary.js';

export function Library() {
  const { documents, loading, searchQuery, setSearchQuery, uploadDocument, deleteDocument } =
    useLibrary();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const content = await file.text();
      await uploadDocument(file.name, content, 'file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-3 overflow-hidden p-3">
      <h2 className="text-fs-micro uppercase tracking-wider text-ink-3">Library</h2>

      {/* Search + Upload */}
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents..."
          className="h-7 min-w-0 flex-1 px-2 py-1 text-fs-micro"
        />
        <Input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.csv,.json"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-7 flex-shrink-0 gap-1 px-2 text-fs-micro"
        >
          <Upload className="size-3" aria-hidden="true" />
          <span>{uploading ? '...' : 'Upload'}</span>
        </Button>
      </div>

      {/* Document list */}
      {loading ? (
        <p className="py-2 text-fs-micro text-ink-3">Loading...</p>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-r-md border border-line-soft bg-surface-2">
            <Book className="size-5 text-ink-3" aria-hidden="true" />
          </div>
          <div className="px-2">
            <p className="text-fs-micro font-semibold text-ink-2">
              {searchQuery ? 'No matches' : 'No Documents'}
            </p>
            <p className="mt-1.5 text-fs-micro leading-relaxed text-ink-3">
              {searchQuery
                ? 'No documents match your search. Try different keywords.'
                : 'Upload text, markdown, CSV or JSON files to make them available as reference material for your AI employees.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {documents.map((doc) => (
            <div
              key={doc.doc_id}
              className="flex items-center gap-2 overflow-hidden rounded-r-md border border-line-soft bg-surface-2 px-2 py-1.5"
            >
              <FileText className="size-3 flex-shrink-0 text-ink-3" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-fs-micro text-ink-1">{doc.title}</div>
                <div className="truncate text-fs-micro text-ink-3">
                  {doc.source_type} · {doc.content_text.length.toLocaleString()} chars
                  {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)}KB` : ''}
                </div>
              </div>
              {confirmDeleteId === doc.doc_id ? (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deleteDocument(doc.doc_id);
                      setConfirmDeleteId(null);
                    }}
                    className="h-6 px-1.5 py-0.5 text-fs-micro"
                  >
                    Delete
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteId(null)}
                    className="h-6 px-1 py-0.5 text-fs-micro"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmDeleteId(doc.doc_id)}
                  className="size-6 flex-shrink-0 p-0.5 text-ink-3 hover:text-danger"
                  title="Delete document"
                  aria-label={`Delete ${doc.title}`}
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
