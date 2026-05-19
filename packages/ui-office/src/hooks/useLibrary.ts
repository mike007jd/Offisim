import { LibraryService } from '@offisim/core/browser';
import type { LibraryDocumentRow } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';

import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context.js';

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
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const [documents, setDocuments] = useState<LibraryDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const getService = useCallback(() => {
    if (!repos) throw new Error('Runtime not ready');
    return new LibraryService(repos.libraryDocuments, eventBus);
  }, [repos, eventBus]);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const service = getService();
      const docs = searchQuery
        ? await service.search(activeCompanyId, searchQuery)
        : await service.listDocuments(activeCompanyId);
      setDocuments(docs);
    } finally {
      setLoading(false);
    }
  }, [repos, getService, searchQuery, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Debounced search
  const handleSetSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const uploadDocument = useCallback(
    async (title: string, content: string, sourceType = 'file') => {
      const service = getService();
      if (!activeCompanyId) throw new Error('No active company');
      const id = await service.uploadDocument(activeCompanyId, title, content, sourceType);
      await refresh();
      return id;
    },
    [getService, refresh, activeCompanyId],
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
