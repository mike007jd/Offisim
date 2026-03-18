import {
  type ExportFormat,
  type ExportableDocument,
  exportDocument,
} from '@aics/doc-engine';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@aics/ui-core';
import { useCallback, useState } from 'react';
import { type Deliverable, useDeliverables } from '../../hooks/useDeliverables';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'docx', label: 'DOCX' },
  { value: 'pdf', label: 'PDF' },
  { value: 'pptx', label: 'PPTX' },
  { value: 'csv', label: 'CSV' },
  { value: 'html', label: 'HTML' },
  { value: 'txt', label: 'TXT' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// DeliverableCard
// ---------------------------------------------------------------------------

function DeliverableCard({ item }: { item: Deliverable }) {
  const [copied, setCopied] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [exporting, setExporting] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API may fail in non-secure contexts — silent fallback
    }
  }, [item.content]);

  const handleDownload = useCallback(async () => {
    setExporting(true);
    try {
      const doc: ExportableDocument = {
        title: item.title,
        content: item.content,
        contributors: item.contributingEmployees.map((e) => ({
          name: e.employeeName,
        })),
        createdAt: item.createdAt,
      };
      const result = await exportDocument(doc, selectedFormat);
      triggerDownload(result.blob, result.filename);
    } catch (err) {
      console.error('[PitchHall] Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [item, selectedFormat]);

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-ocean-deep/50 border-ocean-light">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-xs text-pearl leading-snug">{item.title}</CardTitle>
          <span className="shrink-0 text-[10px] text-shell/60">{timeAgo(item.createdAt)}</span>
        </div>
        {item.contributingEmployees.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.contributingEmployees.map((emp) => (
              <Badge key={emp.employeeId} variant="info" className="text-[10px] px-1.5 py-0">
                {emp.employeeName}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="font-pixel-mono text-[11px] text-shell/80 leading-relaxed whitespace-pre-wrap break-words">
          {truncate(item.content, 200)}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-shell/70 hover:text-pearl"
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Select
            value={selectedFormat}
            onValueChange={(v: string) => setSelectedFormat(v as ExportFormat)}
          >
            <SelectTrigger className="h-6 w-[72px] text-[10px] text-shell/70 border-shell/20 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-[10px]">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-shell/70 hover:text-pearl"
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Download'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-shell/70 hover:text-emerald-400"
            onClick={() => {
              const event = new CustomEvent('sop.save-from-output', {
                detail: { title: item.title, outputId: item.id },
              });
              window.dispatchEvent(event);
            }}
            title="Save the task path that produced this output as a reusable SOP template"
          >
            Save as SOP
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PitchHall
// ---------------------------------------------------------------------------

export function PitchHall() {
  const deliverables = useDeliverables();

  if (deliverables.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-shell">
        No deliverables yet. Outputs will appear here after tasks complete.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-pearl">Deliverables</h3>
        <span className="text-[10px] text-shell">{deliverables.length} total</span>
      </div>
      {deliverables.map((item) => (
        <DeliverableCard key={item.id} item={item} />
      ))}
    </div>
  );
}
