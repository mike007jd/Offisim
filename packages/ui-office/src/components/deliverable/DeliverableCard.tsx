import { type ExportFormat, type ExportableDocument, exportDocument } from '@offisim/doc-engine';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@offisim/ui-core';
import { useCallback, useState } from 'react';
import type { Deliverable } from '../../hooks/useDeliverables';
import { canPreviewDeliverable } from '../../lib/deliverable-artifacts';
import {
  formatDeliverableBytes,
  formatTimeAgo,
  mimeTypeToIcon,
} from '../../lib/deliverable-presentation';
import { openDesktopLocalPath, saveDesktopDeliverable } from '../../lib/desktop-local-paths';
import { isTauri } from '../../lib/env';
import { DicebearAvatar } from '../shared/DicebearAvatar';

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'docx', label: 'DOCX' },
  { value: 'pdf', label: 'PDF' },
  { value: 'pptx', label: 'PPTX' },
  { value: 'csv', label: 'CSV' },
  { value: 'html', label: 'HTML' },
  { value: 'txt', label: 'TXT' },
];

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadArtifactContent(content: string, fileName: string, mimeType: string | null): void {
  triggerBlobDownload(
    new Blob([content], { type: `${mimeType ?? 'text/plain'};charset=utf-8` }),
    fileName,
  );
}

function previewInNewTab(content: string, mimeType: string | null): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${mimeType ?? 'text/plain'};charset=utf-8` }),
  );
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

interface ContributorStackProps {
  contributors: Deliverable['contributingEmployees'];
  size?: number;
}

function ContributorStack({ contributors, size = 20 }: ContributorStackProps) {
  if (contributors.length === 0) return null;
  const shown = contributors.slice(0, 3);
  const overflow = contributors.slice(3);
  const overflowLabel = overflow
    .map((c) => `${c.employeeName}${c.sourceKind === 'department' ? ' (external)' : ''}`)
    .join(', ');
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((emp) => (
        <span
          key={emp.employeeId}
          className="inline-block rounded-full ring-1 ring-slate-900"
          title={`${emp.employeeName}${emp.sourceKind === 'department' ? ' (external)' : ''}`}
        >
          <DicebearAvatar seed={emp.employeeName} size={size} />
        </span>
      ))}
      {overflow.length > 0 && (
        <span
          title={overflowLabel}
          className="flex min-w-5 items-center justify-center rounded-full bg-slate-700 px-1 text-[9px] text-slate-300 ring-1 ring-slate-900"
          style={{ height: size, minHeight: size }}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}

interface DeliverableCardProps {
  item: Deliverable;
  variant: 'compact' | 'full';
  employeeLabel?: string | null;
  desktopVaultRoot?: string | null;
  onSaveAsSop?: (item: Deliverable) => Promise<void>;
  isNew?: boolean;
}

export function DeliverableCard({
  item,
  variant,
  employeeLabel,
  desktopVaultRoot,
  onSaveAsSop,
  isNew,
}: DeliverableCardProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const canPreview = canPreviewDeliverable(item.artifact);
  const fileName = item.artifact.fileName ?? 'deliverable.txt';
  const Icon = mimeTypeToIcon(item.artifact.mimeType);

  const handleCopy = useCallback(async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  }, [item.content]);

  const copyLabel = copyFailed ? 'Copy failed' : copied ? 'Copied!' : 'Copy';

  const header = (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="h-4 w-4 shrink-0 text-slate-400 mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium text-pearl">{item.title}</span>
          <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">
            {formatDeliverableBytes(item.contentSize)} · {formatTimeAgo(item.createdAt)}
          </span>
        </div>
        {item.contributingEmployees.length > 0 && (
          <div className="mt-1">
            <ContributorStack contributors={item.contributingEmployees} />
          </div>
        )}
      </div>
    </div>
  );

  if (variant === 'compact') {
    return (
      <div className="mt-2 max-w-[94%] rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2">
        {header}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-px font-medium text-emerald-200">
            {fileName}
          </span>
          {item.artifact.mimeType && (
            <span className="text-slate-400">{item.artifact.mimeType}</span>
          )}
          {employeeLabel && <span className="text-slate-500">· {employeeLabel}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-slate-300 hover:text-pearl"
            onClick={handleCopy}
          >
            {copyLabel}
          </Button>
          {canPreview && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-slate-300 hover:text-pearl"
              onClick={() => previewInNewTab(item.artifact.content, item.artifact.mimeType)}
            >
              Open
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-slate-300 hover:text-pearl"
            onClick={() => downloadArtifactContent(item.artifact.content, fileName, item.artifact.mimeType)}
          >
            Download
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FullVariant
      item={item}
      header={header}
      canPreview={canPreview}
      desktopVaultRoot={desktopVaultRoot ?? null}
      onSaveAsSop={onSaveAsSop}
      isNew={isNew}
      copyLabel={copyLabel}
      onCopy={handleCopy}
    />
  );
}

interface FullVariantProps {
  item: Deliverable;
  header: React.ReactNode;
  canPreview: boolean;
  desktopVaultRoot: string | null;
  onSaveAsSop?: (item: Deliverable) => Promise<void>;
  isNew?: boolean;
  copyLabel: string;
  onCopy: () => Promise<void>;
}

function FullVariant({
  item,
  header,
  canPreview,
  desktopVaultRoot,
  onSaveAsSop,
  isNew,
  copyLabel,
  onCopy,
}: FullVariantProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [exporting, setExporting] = useState(false);
  const [savingSop, setSavingSop] = useState(false);
  const [sopSaved, setSopSaved] = useState(false);
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [savingLocal, setSavingLocal] = useState(false);
  const desktopMode = isTauri();
  const isFileArtifact = item.artifact.kind === 'file' && !!item.artifact.fileName;

  const handleDownload = useCallback(async () => {
    if (isFileArtifact && item.artifact.fileName) {
      downloadArtifactContent(item.artifact.content, item.artifact.fileName, item.artifact.mimeType);
      return;
    }
    setExporting(true);
    try {
      const doc: ExportableDocument = {
        title: item.title,
        content: item.artifact.content,
        contributors: item.contributingEmployees.map((e) => ({ name: e.employeeName })),
        createdAt: item.createdAt,
      };
      const result = await exportDocument(doc, selectedFormat);
      triggerBlobDownload(result.blob, result.filename);
    } catch (err) {
      console.error('[DeliverableCard] Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [isFileArtifact, item, selectedFormat]);

  const handleSaveLocal = useCallback(async () => {
    if (!desktopMode || !desktopVaultRoot || !item.artifact.fileName) return;
    setSavingLocal(true);
    try {
      const path = await saveDesktopDeliverable(
        desktopVaultRoot,
        item.artifact.fileName,
        item.artifact.content,
      );
      setLocalPath(path);
    } catch (err) {
      console.error('[DeliverableCard] Save locally failed:', err);
    } finally {
      setSavingLocal(false);
    }
  }, [desktopMode, desktopVaultRoot, item.artifact.content, item.artifact.fileName]);

  const handleSaveAsSop = useCallback(async () => {
    if (!onSaveAsSop || savingSop || sopSaved) return;
    setSavingSop(true);
    try {
      await onSaveAsSop(item);
      setSopSaved(true);
      setTimeout(() => setSopSaved(false), 2000);
    } catch (err) {
      console.error('[DeliverableCard] Save as SOP failed:', err);
    } finally {
      setSavingSop(false);
    }
  }, [item, onSaveAsSop, savingSop, sopSaved]);

  return (
    <Card
      className={cn(
        'animate-in fade-in slide-in-from-bottom-2 duration-300 overflow-hidden bg-slate-900/50 transition-all',
        isNew ? 'border-emerald-500/60 shadow-[0_0_8px_rgba(52,211,153,0.25)]' : 'border-slate-700',
      )}
    >
      <CardHeader className="p-3 pb-1">{header}</CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="font-mono text-[11px] leading-relaxed text-slate-400/80 whitespace-pre-wrap break-words">
          {truncate(item.artifact.content, 200)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
            onClick={onCopy}
          >
            {copyLabel}
          </Button>
          {!isFileArtifact && (
            <Select
              value={selectedFormat}
              onValueChange={(v: string) => setSelectedFormat(v as ExportFormat)}
            >
              <SelectTrigger className="h-6 w-[64px] text-[10px] text-slate-400/70 border-shell/20 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_FORMATS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-[10px]">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canPreview && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
              onClick={() => previewInNewTab(item.artifact.content, item.artifact.mimeType)}
            >
              Preview
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? '...' : isFileArtifact ? 'Download' : 'Export'}
          </Button>
          {desktopMode && isFileArtifact && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
              onClick={() =>
                localPath ? void openDesktopLocalPath(localPath) : void handleSaveLocal()
              }
              disabled={savingLocal || !desktopVaultRoot}
            >
              {savingLocal ? '...' : localPath ? 'Open file' : 'Save locally'}
            </Button>
          )}
          {desktopMode && desktopVaultRoot && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
              onClick={() => void openDesktopLocalPath(`${desktopVaultRoot}/deliverables`)}
            >
              Open folder
            </Button>
          )}
          {onSaveAsSop && (
            <Button
              variant={item.contributingEmployees.length >= 2 && !sopSaved ? 'default' : 'ghost'}
              size="sm"
              className={
                item.contributingEmployees.length >= 2 && !sopSaved && !savingSop
                  ? 'h-6 px-2 text-[10px] bg-emerald-600/80 hover:bg-emerald-500 text-white animate-pulse'
                  : 'h-6 px-2 text-[10px] text-slate-400/70 hover:text-emerald-400 disabled:opacity-50'
              }
              onClick={() => void handleSaveAsSop()}
              disabled={savingSop || sopSaved}
              title="Save the task path that produced this output as a reusable SOP template"
            >
              {sopSaved ? 'Saved!' : savingSop ? '...' : 'Save as SOP'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
