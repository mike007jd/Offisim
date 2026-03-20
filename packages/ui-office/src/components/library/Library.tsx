import { Book, FileText, Trash2, Upload } from 'lucide-react';
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
    <div className="flex flex-col gap-3 p-3 overflow-hidden">
      <h2 className="text-[8px] uppercase tracking-wider text-slate-400">Library</h2>

      {/* Search + Upload */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents..."
          className="flex-1 min-w-0 rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/40"
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
          className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-30 flex-shrink-0"
        >
          <Upload className="w-3 h-3" />
          <span>{uploading ? '...' : 'Upload'}</span>
        </button>
      </div>

      {/* Document list */}
      {loading ? (
        <p className="text-[10px] text-slate-500 py-2">Loading...</p>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
            <Book className="w-5 h-5 text-slate-500" />
          </div>
          <div className="px-2">
            <p className="text-[11px] font-semibold text-slate-400">
              {searchQuery ? 'No matches' : 'No Documents'}
            </p>
            <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
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
              className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 overflow-hidden"
            >
              <FileText className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-slate-200">{doc.title}</div>
                <div className="text-[9px] text-slate-500 truncate">
                  {doc.source_type} · {doc.content_text.length.toLocaleString()} chars
                  {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)}KB` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteDocument(doc.doc_id)}
                className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors p-0.5"
                title="Delete document"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
