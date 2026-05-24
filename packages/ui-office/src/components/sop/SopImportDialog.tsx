import { SopSyncService } from '@offisim/core/browser';
import type { SopDefinition } from '@offisim/shared-types';
import { Button, DialogShell, Input, ToastBanner, useToasts } from '@offisim/ui-core';
import { Download, Link } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';

interface SopImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function SopImportDialog({ open, onOpenChange, onImported }: SopImportDialogProps) {
  const { repos } = useOffisimRuntimeServices();
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
            <Download className="size-4 text-accent" />
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
        <div className="flex flex-col gap-sp-4 pt-sp-2">
          <div className="flex items-center gap-2">
            <Link className="size-3.5 shrink-0 text-ink-4" />
            <Input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreviewData(null);
                setError(null);
              }}
              placeholder="https://raw.githubusercontent.com/..."
              className="h-9 flex-1 rounded-r-sm border-line bg-surface-1 px-2.5 py-1.5 text-fs-sm text-ink-1 placeholder:text-ink-4 focus:border-accent"
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
              className="w-full rounded-r-sm text-fs-sm"
            >
              {loading ? 'Fetching...' : 'Preview'}
            </Button>
          )}

          {error && (
            <p className="rounded-r-sm border border-danger/40 bg-danger-surface px-2.5 py-2 text-fs-meta text-danger">
              {error}
            </p>
          )}

          {preview && (
            <div className="flex flex-col gap-sp-2 rounded-r-md border border-line bg-surface-2 p-sp-4">
              <p className="text-fs-sm font-semibold text-ink-1">{preview.name}</p>
              {preview.description && (
                <p className="text-fs-sm text-ink-3">{preview.description}</p>
              )}
              <p className="text-fs-meta text-ink-4">{preview.stepCount} steps</p>
            </div>
          )}
        </div>
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
