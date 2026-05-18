import { SopSyncService } from '@offisim/core/browser';
import type { SopDefinition } from '@offisim/shared-types';
import { Button, DialogShell, Input, ToastBanner, useToasts } from '@offisim/ui-core';
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
            <Download className="h-4 w-4 text-accent" />
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
            <Link className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <Input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreviewData(null);
                setError(null);
              }}
              placeholder="https://raw.githubusercontent.com/..."
              className="flex-1 rounded-lg border border-border-default bg-surface px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
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
            <p className="rounded border border-error bg-error-muted px-2 py-1 text-caption text-error">
              {error}
            </p>
          )}

          {preview && (
            <div className="space-y-1.5 rounded-lg border border-border-default bg-surface-muted p-3">
              <p className="text-sm font-medium text-text-primary">{preview.name}</p>
              {preview.description && (
                <p className="text-caption text-text-secondary">{preview.description}</p>
              )}
              <p className="text-caption text-text-muted">{preview.stepCount} steps</p>
            </div>
          )}
        </div>
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
