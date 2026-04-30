import { SopSyncService } from '@offisim/core/browser';
import type { SopDefinition } from '@offisim/shared-types';
import { Button, DialogShell, ToastBanner, useToasts } from '@offisim/ui-core';
import { Download, Link } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';

interface SopImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function SopImportDialog({ open, onOpenChange, onImported }: SopImportDialogProps) {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const { toasts, addToast, dismissToast } = useToasts();
  const previewDebounceRef = useRef<number | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<SopDefinition | null>(null);

  const preview = previewData
    ? {
        name: previewData.name,
        description: previewData.description,
        stepCount: previewData.steps.length,
      }
    : null;

  useEffect(
    () => () => {
      if (previewDebounceRef.current) window.clearTimeout(previewDebounceRef.current);
    },
    [],
  );

  const resetDraft = useCallback(() => {
    setUrl('');
    setError(null);
    setPreviewData(null);
  }, []);

  const isDirty = useMemo(() => url.trim().length > 0 || previewData !== null, [previewData, url]);

  const discardAndClose = useCallback(() => {
    resetDraft();
    onOpenChange(false);
  }, [onOpenChange, resetDraft]);

  const requestClose = useCallback(() => {
    if (!isDirty) {
      onOpenChange(false);
      return;
    }
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
  }, [addToast, discardAndClose, isDirty, onOpenChange]);

  const handleRequestClose = useCallback(() => {
    if (!isDirty) return undefined;
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
    return false;
  }, [addToast, discardAndClose, isDirty]);

  const handlePreview = useCallback(async () => {
    if (!repos?.sopTemplates || !url.trim()) return;
    setLoading(true);
    setError(null);
    setPreviewData(null);
    try {
      const svc = new SopSyncService(repos.sopTemplates);
      const remote = await svc.fetchRemoteSop(url.trim());
      setPreviewData(remote);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch SOP');
    } finally {
      setLoading(false);
    }
  }, [repos?.sopTemplates, url]);

  const handlePreviewEnter = useCallback(() => {
    if (previewDebounceRef.current) window.clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = window.setTimeout(() => {
      void handlePreview();
    }, 300);
  }, [handlePreview]);

  const handleImport = useCallback(async () => {
    if (!repos?.sopTemplates || !activeCompanyId || !previewData) return;
    setLoading(true);
    setError(null);
    try {
      const svc = new SopSyncService(repos.sopTemplates);
      await svc.importFromDefinition(previewData, url.trim(), activeCompanyId);
      resetDraft();
      onOpenChange(false);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }, [
    activeCompanyId,
    onImported,
    onOpenChange,
    previewData,
    repos?.sopTemplates,
    resetDraft,
    url,
  ]);

  return (
    <>
      <DialogShell
        open={open}
        onOpenChange={onOpenChange}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-400" />
            Import SOP from URL
          </span>
        }
        description="Paste a URL to a JSON SOP definition (e.g. GitHub raw file)."
        onRequestClose={handleRequestClose}
        footer={
          preview ? (
            <>
              <Button variant="outline" size="sm" onClick={requestClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleImport} disabled={loading}>
                {loading ? 'Importing...' : 'Import SOP'}
              </Button>
            </>
          ) : null
        }
      >
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Link className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreviewData(null);
                setError(null);
              }}
              placeholder="https://raw.githubusercontent.com/..."
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handlePreviewEnter();
                }
              }}
            />
          </div>

          {!preview && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreview}
              disabled={loading || !url.trim()}
              className="w-full text-xs"
            >
              {loading ? 'Fetching...' : 'Preview'}
            </Button>
          )}

          {error && (
            <p className="text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded px-2 py-1">
              {error}
            </p>
          )}

          {preview && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-1.5">
              <p className="text-sm font-medium text-white">{preview.name}</p>
              {preview.description && (
                <p className="text-[11px] text-slate-400">{preview.description}</p>
              )}
              <p className="text-[10px] text-slate-500">{preview.stepCount} steps</p>
            </div>
          )}
        </div>
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
