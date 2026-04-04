import { SopSyncService } from '@offisim/core/browser';
import type { SopDefinition } from '@offisim/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@offisim/ui-core';
import { Download, Link } from 'lucide-react';
import { useState } from 'react';
import { useCompany } from '../company/CompanyContext.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';

interface SopImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function SopImportDialog({ open, onOpenChange, onImported }: SopImportDialogProps) {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<SopDefinition | null>(null);

  const preview = previewData
    ? { name: previewData.name, description: previewData.description, stepCount: previewData.steps.length }
    : null;

  const handlePreview = async () => {
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
  };

  const handleImport = async () => {
    if (!repos?.sopTemplates || !activeCompanyId || !previewData) return;
    setLoading(true);
    setError(null);
    try {
      const svc = new SopSyncService(repos.sopTemplates);
      await svc.importFromDefinition(previewData, url.trim(), activeCompanyId);
      setUrl('');
      setPreviewData(null);
      onOpenChange(false);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-400" />
            Import SOP from URL
          </DialogTitle>
          <DialogDescription>
            Paste a URL to a JSON SOP definition (e.g. GitHub raw file).
          </DialogDescription>
        </DialogHeader>

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
                if (e.key === 'Enter') void handlePreview();
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

          {preview && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleImport} disabled={loading}>
                {loading ? 'Importing...' : 'Import SOP'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
