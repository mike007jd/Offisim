import { useRef, useState } from 'react';

import { useLibrary } from '../../hooks/useLibrary.js';

export function Library() {
  const {
    documents,
    loading,
    searchQuery,
    setSearchQuery,
    uploadDocument,
    deleteDocument,
  } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold text-zinc-200">Library</h3>

      {/* Upload + Search */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents..."
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 placeholder-zinc-500"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.csv,.json"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {uploading ? '...' : 'Upload'}
        </button>
      </div>

      {/* Document list */}
      {loading ? (
        <p className="text-xs text-zinc-500">Loading...</p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-zinc-500">
          {searchQuery ? 'No documents match your search.' : 'No documents yet. Upload a file to get started.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {documents.map((doc) => (
            <div
              key={doc.doc_id}
              className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-200">{doc.title}</div>
                <div className="text-xs text-zinc-500">
                  {doc.source_type} · {doc.content_text.length.toLocaleString()} chars
                  {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteDocument(doc.doc_id)}
                className="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-700"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
