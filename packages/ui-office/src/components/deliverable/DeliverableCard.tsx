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
  className?: string;
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
    <Button
      variant="ghost"
      size="sm"
      className={className ?? 'deliverable-action'}
      onClick={onClick}
    >
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
  const overflowStyle = { height: size, minHeight: size };
  return (
    <div className="deliverable-contributors">
      {shown.map((emp) => (
        <span key={emp.employeeId} className="deliverable-contributor" title={emp.employeeName}>
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
          className="deliverable-contributor-overflow"
          // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
          style={overflowStyle}
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
    <div className="deliverable-head">
      <Icon data-icon="artifact" aria-hidden="true" />
      <div className="deliverable-head-copy">
        <div>
          <span data-slot="title">{item.title}</span>
          <span data-slot="meta">
            {formatDeliverableBytes(item.contentSize)} · {formatTimeAgo(item.createdAt)}
          </span>
        </div>
        {item.contributingEmployees.length > 0 && (
          <div className="deliverable-head-contributors">
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
  activeProjectId?: string | null;
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
      activeProjectId={props.activeProjectId ?? null}
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
  const fileName = item.artifact.fileName;
  const artifactLabel = fileName ?? item.title;
  const { content, mimeType } = item.artifact;

  return (
    <div className="deliverable-compact-card">
      <DeliverableHeader item={item} />
      <div className="deliverable-artifact-row">
        <span data-slot="artifact-label">{artifactLabel}</span>
        {mimeType && <span>{mimeType}</span>}
        {employeeLabel && <span data-slot="employee">· {employeeLabel}</span>}
      </div>
      <div className="deliverable-actions">
        <CopyButton content={item.content} />
        {canPreview && (
          <Button
            variant="ghost"
            size="sm"
            className="deliverable-action"
            onClick={() => previewInNewTab(content, mimeType)}
          >
            Open
          </Button>
        )}
        {fileName && (
          <Button
            variant="ghost"
            size="sm"
            className="deliverable-action"
            onClick={() => downloadArtifactContent(content, fileName, mimeType)}
          >
            Download
          </Button>
        )}
      </div>
    </div>
  );
}

interface FullCardProps {
  item: Deliverable;
  desktopVaultRoot: string | null;
  activeProjectId: string | null;
  onSaveAsSop?: (item: Deliverable) => Promise<void>;
  isNew?: boolean;
}

function FullCard({ item, desktopVaultRoot, activeProjectId, onSaveAsSop, isNew }: FullCardProps) {
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
    if (!desktopMode || !activeProjectId || !fileName) return;
    setSavingLocal(true);
    try {
      const path = await saveDesktopDeliverable(activeProjectId, fileName, content);
      setLocalPath(path);
    } catch (err) {
      console.error('[DeliverableCard] Save locally failed:', err);
    } finally {
      setSavingLocal(false);
    }
  }, [desktopMode, activeProjectId, fileName, content]);

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
    <Card className="deliverable-full-card" data-new={isNew ? 'true' : 'false'}>
      <CardHeader className="deliverable-full-head">
        <DeliverableHeader item={item} />
      </CardHeader>
      <CardContent className="deliverable-full-content">
        <p className="deliverable-preview-text">{truncate(content, 200)}</p>
        <div className="deliverable-actions">
          <CopyButton content={content} />
          {!isFileArtifact && (
            <Select
              value={selectedFormat}
              onValueChange={(v: string) => setSelectedFormat(v as ExportFormat)}
            >
              <SelectTrigger className="deliverable-export-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_FORMATS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
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
              className="deliverable-action"
              onClick={() => previewInNewTab(content, mimeType)}
            >
              Preview
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="deliverable-action"
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? '...' : isFileArtifact ? 'Download' : 'Export'}
          </Button>
          {desktopMode && isFileArtifact && (
            <Button
              variant="ghost"
              size="sm"
              className="deliverable-action"
              onClick={() =>
                localPath && activeProjectId
                  ? void openDesktopLocalPath(activeProjectId, localPath)
                  : void handleSaveLocal()
              }
              disabled={savingLocal || !activeProjectId}
            >
              {savingLocal ? '...' : localPath ? 'Open file' : 'Save locally'}
            </Button>
          )}
          {desktopMode && desktopVaultRoot && activeProjectId && (
            <Button
              variant="ghost"
              size="sm"
              className="deliverable-action"
              onClick={() => void openDesktopLocalPath(activeProjectId, 'deliverables')}
            >
              Open folder
            </Button>
          )}
          {onSaveAsSop && (
            <Button
              variant={isSopPromoted ? 'default' : 'ghost'}
              size="sm"
              className="deliverable-sop-action"
              data-promoted={isSopPromoted && !savingSop ? 'true' : 'false'}
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
