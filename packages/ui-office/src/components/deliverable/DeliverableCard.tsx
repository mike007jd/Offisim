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
import { truncate } from '../../lib/format-time';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'docx', label: 'DOCX' },
  { value: 'pdf', label: 'PDF' },
  { value: 'pptx', label: 'PPTX' },
  { value: 'csv', label: 'CSV' },
  { value: 'html', label: 'HTML' },
  { value: 'txt', label: 'TXT' },
];

const ACTION_CLASS = 'h-6 px-2 text-[10px] text-text-secondary hover:text-text-primary';
const SOP_DEFAULT_CLASS =
  'h-6 px-2 text-[10px] text-text-secondary hover:text-success disabled:opacity-50';
const SOP_PROMOTED_CLASS =
  'h-6 px-2 text-[10px] bg-success text-text-inverse hover:bg-success animate-pulse';

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

interface CopyButtonProps {
  content: string;
  className: string;
}

function CopyButton({ content, className }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setState('copied');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('failed');
      setTimeout(() => setState('idle'), 2000);
    }
  }, [content]);
  const label = state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : 'Copy';
  return (
    <Button variant="ghost" size="sm" className={className} onClick={onClick}>
      {label}
    </Button>
  );
}

interface ContributorStackProps {
  contributors: Deliverable['contributingEmployees'];
  size?: number;
}

function ContributorStack({ contributors, size = 20 }: ContributorStackProps) {
  if (contributors.length === 0) return null;
  const shown = contributors.slice(0, 3);
  const overflow = contributors.slice(3);
  const overflowLabel = overflow.map((c) => c.employeeName).join(', ');
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((emp) => (
        <span
          key={emp.employeeId}
          className="inline-block rounded-full ring-1 ring-border-default"
          title={emp.employeeName}
        >
          <EmployeeAvatar
            agent={{
              isExternal: emp.isExternal,
              brandKey: emp.brandKey,
              name: emp.employeeName,
              avatarSeed: emp.employeeName,
              appearance: null,
            }}
            size={size}
          />
        </span>
      ))}
      {overflow.length > 0 && (
        <span
          title={overflowLabel}
          className="flex min-w-5 items-center justify-center rounded-full bg-surface-muted px-1 text-[9px] text-text-secondary ring-1 ring-border-default"
          style={{ height: size, minHeight: size }}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}

interface DeliverableHeaderProps {
  item: Deliverable;
}

function DeliverableHeader({ item }: DeliverableHeaderProps) {
  const Icon = mimeTypeToIcon(item.artifact.mimeType);
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="h-4 w-4 shrink-0 text-text-muted mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium text-text-primary">{item.title}</span>
          <span className="shrink-0 text-[10px] text-text-muted tabular-nums">
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
}

interface DeliverableCardProps {
  item: Deliverable;
  variant: 'compact' | 'full';
  employeeLabel?: string | null;
  desktopVaultRoot?: string | null;
  onSaveAsSop?: (item: Deliverable) => Promise<void>;
  isNew?: boolean;
}

export function DeliverableCard(props: DeliverableCardProps) {
  return props.variant === 'compact' ? (
    <CompactCard item={props.item} employeeLabel={props.employeeLabel} />
  ) : (
    <FullCard
      item={props.item}
      desktopVaultRoot={props.desktopVaultRoot ?? null}
      onSaveAsSop={props.onSaveAsSop}
      isNew={props.isNew}
    />
  );
}

interface CompactCardProps {
  item: Deliverable;
  employeeLabel?: string | null;
}

function CompactCard({ item, employeeLabel }: CompactCardProps) {
  const canPreview = canPreviewDeliverable(item.artifact);
  const fileName = item.artifact.fileName ?? 'deliverable.txt';
  const { content, mimeType } = item.artifact;

  return (
    <div className="mt-2 max-w-[94%] rounded-xl border border-success bg-success-muted px-3 py-2">
      <DeliverableHeader item={item} />
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="inline-flex items-center rounded border border-success bg-surface px-1.5 py-px font-medium text-success">
          {fileName}
        </span>
        {mimeType && <span className="text-text-secondary">{mimeType}</span>}
        {employeeLabel && <span className="text-text-muted">· {employeeLabel}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <CopyButton content={item.content} className={ACTION_CLASS} />
        {canPreview && (
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_CLASS}
            onClick={() => previewInNewTab(content, mimeType)}
          >
            Open
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={ACTION_CLASS}
          onClick={() => downloadArtifactContent(content, fileName, mimeType)}
        >
          Download
        </Button>
      </div>
    </div>
  );
}

interface FullCardProps {
  item: Deliverable;
  desktopVaultRoot: string | null;
  onSaveAsSop?: (item: Deliverable) => Promise<void>;
  isNew?: boolean;
}

function FullCard({ item, desktopVaultRoot, onSaveAsSop, isNew }: FullCardProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [exporting, setExporting] = useState(false);
  const [savingSop, setSavingSop] = useState(false);
  const [sopSaved, setSopSaved] = useState(false);
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [savingLocal, setSavingLocal] = useState(false);
  const desktopMode = isTauri();
  const canPreview = canPreviewDeliverable(item.artifact);
  const isFileArtifact = item.artifact.kind === 'file' && !!item.artifact.fileName;
  const isSopPromoted = item.contributingEmployees.length >= 2 && !sopSaved;

  const { content, fileName, mimeType } = item.artifact;

  const handleDownload = useCallback(async () => {
    if (isFileArtifact && fileName) {
      downloadArtifactContent(content, fileName, mimeType);
      return;
    }
    setExporting(true);
    try {
      const doc: ExportableDocument = {
        title: item.title,
        content,
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
  }, [
    content,
    fileName,
    mimeType,
    isFileArtifact,
    item.title,
    item.contributingEmployees,
    item.createdAt,
    selectedFormat,
  ]);

  const handleSaveLocal = useCallback(async () => {
    if (!desktopMode || !desktopVaultRoot || !fileName) return;
    setSavingLocal(true);
    try {
      const path = await saveDesktopDeliverable(desktopVaultRoot, fileName, content);
      setLocalPath(path);
    } catch (err) {
      console.error('[DeliverableCard] Save locally failed:', err);
    } finally {
      setSavingLocal(false);
    }
  }, [desktopMode, desktopVaultRoot, fileName, content]);

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
        'animate-in fade-in slide-in-from-bottom-2 duration-300 overflow-hidden bg-surface-muted transition-all',
        isNew ? 'border-success shadow-glow-success' : 'border-border-subtle',
      )}
    >
      <CardHeader className="p-3 pb-1">
        <DeliverableHeader item={item} />
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">
          {truncate(content, 200)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <CopyButton content={content} className={ACTION_CLASS} />
          {!isFileArtifact && (
            <Select
              value={selectedFormat}
              onValueChange={(v: string) => setSelectedFormat(v as ExportFormat)}
            >
              <SelectTrigger className="h-6 w-[64px] border-border-subtle bg-surface text-[10px] text-text-secondary">
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
              className={ACTION_CLASS}
              onClick={() => previewInNewTab(content, mimeType)}
            >
              Preview
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={ACTION_CLASS}
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? '...' : isFileArtifact ? 'Download' : 'Export'}
          </Button>
          {desktopMode && isFileArtifact && (
            <Button
              variant="ghost"
              size="sm"
              className={ACTION_CLASS}
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
              className={ACTION_CLASS}
              onClick={() => void openDesktopLocalPath(`${desktopVaultRoot}/deliverables`)}
            >
              Open folder
            </Button>
          )}
          {onSaveAsSop && (
            <Button
              variant={isSopPromoted ? 'default' : 'ghost'}
              size="sm"
              className={isSopPromoted && !savingSop ? SOP_PROMOTED_CLASS : SOP_DEFAULT_CLASS}
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
