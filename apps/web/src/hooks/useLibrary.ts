import { LibraryService } from '@aics/core';
import type { LibraryDocumentRow } from '@aics/core';
import { useCallback, useEffect, useState } from 'react';

import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

const COMPANY_ID = 'company-default';

export interface UseLibraryReturn {
  documents: LibraryDocumentRow[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  uploadDocument: (title: string, content: string, sourceType?: string) => Promise<string>;
  deleteDocument: (docId: string) => Promise<void>;
  refresh: () => void;
}

export function useLibrary(): UseLibraryReturn {
  const { repos, eventBus } = useAicsRuntime();
  const [documents, setDocuments] = useState<LibraryDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const getService = useCallback(() => {
    if (!repos) throw new Error('Runtime not ready');
    return new LibraryService(repos.libraryDocuments, eventBus);
  }, [repos, eventBus]);

  const refresh = useCallback(async () => {
    if (!repos) return;
    setLoading(true);
    try {
      const service = getService();
      const docs = searchQuery
        ? await service.search(COMPANY_ID, searchQuery)
        : await service.listDocuments(COMPANY_ID);
      setDocuments(docs);
    } finally {
      setLoading(false);
    }
  }, [repos, getService, searchQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Debounced search
  const handleSetSearchQuery = useCallback(
    (query: string) => {
      setSearchQuery(query);
    },
    [],
  );

  const uploadDocument = useCallback(
    async (title: string, content: string, sourceType: string = 'file') => {
      const service = getService();
      const id = await service.uploadDocument(COMPANY_ID, title, content, sourceType);
      await refresh();
      return id;
    },
    [getService, refresh],
  );

  const deleteDocument = useCallback(
    async (docId: string) => {
      const service = getService();
      await service.deleteDocument(docId);
      await refresh();
    },
    [getService, refresh],
  );

  return {
    documents,
    loading,
    searchQuery,
    setSearchQuery: handleSetSearchQuery,
    uploadDocument,
    deleteDocument,
    refresh,
  };
}
