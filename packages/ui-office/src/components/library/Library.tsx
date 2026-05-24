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
    <div className="library-panel">
      <h2>Library</h2>

      {/* Search + Upload */}
      <div className="library-panel-tools">
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents..."
          className="library-panel-search"
        />
        <Input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.csv,.json"
          onChange={handleFileUpload}
          className="library-panel-file"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="library-panel-upload"
        >
          <Upload data-icon="inline-start" aria-hidden="true" />
          <span>{uploading ? '...' : 'Upload'}</span>
        </Button>
      </div>

      {/* Document list */}
      {loading ? (
        <p className="library-panel-state">Loading...</p>
      ) : documents.length === 0 ? (
        <div className="library-panel-empty">
          <div data-slot="icon-frame">
            <Book data-icon="empty" aria-hidden="true" />
          </div>
          <div>
            <p>{searchQuery ? 'No matches' : 'No Documents'}</p>
            <p data-slot="hint">
              {searchQuery
                ? 'No documents match your search. Try different keywords.'
                : 'Upload text, markdown, CSV or JSON files to make them available as reference material for your AI employees.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="library-panel-list">
          {documents.map((doc) => (
            <div key={doc.doc_id} className="library-panel-row">
              <FileText data-icon="document" aria-hidden="true" />
              <div className="library-panel-row-copy">
                <div>{doc.title}</div>
                <div data-slot="meta">
                  {doc.source_type} · {doc.content_text.length.toLocaleString()} chars
                  {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)}KB` : ''}
                </div>
              </div>
              {confirmDeleteId === doc.doc_id ? (
                <div className="library-panel-confirm">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deleteDocument(doc.doc_id);
                      setConfirmDeleteId(null);
                    }}
                    className="library-panel-confirm-delete"
                  >
                    Delete
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteId(null)}
                    className="library-panel-confirm-cancel"
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
                  className="library-panel-delete"
                  title="Delete document"
                  aria-label={`Delete ${doc.title}`}
                >
                  <Trash2 data-icon="button" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
