import { type ExportFormat, type ExportableDocument, exportDocument } from '@offisim/doc-engine';
import type { DeliverableCreatedPayload, RoleSlug, RuntimeEvent, SopDefinition } from '@offisim/shared-types';
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
} from '@offisim/ui-core';
import { FileOutput } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Deliverable, useDeliverables } from '../../hooks/useDeliverables';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';

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
  return `${text.slice(0, max)}...`;
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

interface DeliverableCardProps {
  item: Deliverable;
  onSaveAsSop: (item: Deliverable) => Promise<void>;
  /** When true, briefly flash a highlight ring then fade */
  isNew?: boolean;
}

function DeliverableCard({ item, onSaveAsSop, isNew }: DeliverableCardProps) {
  const [copied, setCopied] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [exporting, setExporting] = useState(false);
  const [savingSop, setSavingSop] = useState(false);
  const [sopSaved, setSopSaved] = useState(false);

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

  const handleSaveAsSop = useCallback(async () => {
    if (savingSop || sopSaved) return;
    setSavingSop(true);
    try {
      await onSaveAsSop(item);
      setSopSaved(true);
      setTimeout(() => setSopSaved(false), 2000);
    } catch (err) {
      console.error('[PitchHall] Save as SOP failed:', err);
    } finally {
      setSavingSop(false);
    }
  }, [item, onSaveAsSop, savingSop, sopSaved]);

  return (
    <Card
      className={`animate-in fade-in slide-in-from-bottom-2 duration-300 bg-slate-900/50 overflow-hidden transition-all ${isNew ? 'border-emerald-500/60 shadow-[0_0_8px_rgba(52,211,153,0.25)]' : 'border-slate-700'}`}
    >
      <CardHeader className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <CardTitle className="text-xs text-pearl leading-snug truncate">{item.title}</CardTitle>
          <span className="shrink-0 text-[10px] text-slate-400/60">{timeAgo(item.createdAt)}</span>
        </div>
        {item.contributingEmployees.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.contributingEmployees.map((emp) => (
              <Badge
                key={emp.employeeId}
                variant="info"
                className="text-[10px] px-1.5 py-0 truncate max-w-[120px]"
              >
                {emp.employeeName}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="font-mono text-[11px] text-slate-400/80 leading-relaxed whitespace-pre-wrap break-words">
          {truncate(item.content, 200)}
        </p>
        {/* Actions — wrap-friendly for 280px */}
        <div className="flex flex-wrap items-center gap-1 mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Select
            value={selectedFormat}
            onValueChange={(v: string) => setSelectedFormat(v as ExportFormat)}
          >
            <SelectTrigger className="h-6 w-[64px] text-[10px] text-slate-400/70 border-shell/20 bg-transparent">
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
            className="h-6 px-2 text-[10px] text-slate-400/70 hover:text-pearl"
            onClick={handleDownload}
            disabled={exporting}
          >
            {exporting ? '...' : 'Export'}
          </Button>
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
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PitchHall
// ---------------------------------------------------------------------------

export function PitchHall({ activeThreadId }: { activeThreadId?: string | null }) {
  const allDeliverables = useDeliverables();
  const deliverables = useMemo(
    () =>
      activeThreadId
        ? allDeliverables.filter((d) => d.threadId === activeThreadId)
        : allDeliverables,
    [allDeliverables, activeThreadId],
  );
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const listBottomRef = useRef<HTMLDivElement>(null);

  // Track newest deliverable id for brief highlight, clear after 3s
  const [newestId, setNewestId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const id = e.payload.deliverableId;
      if (!id) return;
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setNewestId(id);
      // Scroll to bottom so the new card is visible
      setTimeout(() => {
        listBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      highlightTimerRef.current = setTimeout(() => setNewestId(null), 3000);
    });
    return () => {
      off();
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [eventBus]);

  const handleSaveAsSop = useCallback(
    async (item: Deliverable) => {
      if (!repos) throw new Error('Runtime not ready');
      if (!activeCompanyId) throw new Error('No active company');

      // Build a minimal SopDefinition from contributing employees.
      // Each contributing employee becomes one sequential step.
      // If no contributors, create a single generic step.
      const employees = item.contributingEmployees;
      const sopId = `sop_draft_${item.id}`;
      const now = new Date().toISOString();

      const steps: SopDefinition['steps'] =
        employees.length > 0
          ? employees.map((emp, i) => ({
              step_id: `step_${i + 1}`,
              label: `${emp.employeeName} contribution`,
              role_slug: emp.roleSlug,
              instruction: `Replicate the work performed by ${emp.employeeName} to produce "${item.title}".`,
              dependencies: i === 0 ? [] : [`step_${i}`],
              output_key: `output_step_${i + 1}`,
            }))
          : [
              {
                step_id: 'step_1',
                label: 'Execute task',
                role_slug: 'developer' as RoleSlug,
                instruction: `Produce output similar to: "${item.title}".`,
                dependencies: [],
                output_key: 'output_step_1',
              },
            ];

      const definition: SopDefinition = {
        sop_id: sopId,
        name: item.title,
        description: `SOP derived from output "${item.title}" (thread: ${item.threadId})`,
        steps,
        created_at: now,
      };

      const sopTemplateId = `sop_${crypto.randomUUID()}`;
      await repos.sopTemplates.create({
        sop_template_id: sopTemplateId,
        company_id: activeCompanyId,
        name: item.title,
        description: definition.description,
        definition_json: JSON.stringify(definition),
        source_thread_id: item.threadId,
        source_url: null,
        version: null,
        last_synced_at: null,
      });

      // Notify subscribers — useSops auto-refreshes on any sop.* event
      eventBus.emit({
        type: 'sop.template.created',
        entityId: sopTemplateId,
        entityType: 'plan',
        companyId: activeCompanyId,
        threadId: item.threadId,
        timestamp: Date.now(),
        payload: { sopTemplateId, name: item.title },
      });
    },
    [activeCompanyId, repos, eventBus],
  );

  if (deliverables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center p-3">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          <FileOutput className="w-5 h-5 text-slate-500" />
        </div>
        <div className="px-2">
          <p className="text-[11px] font-semibold text-slate-400">No Outputs Yet</p>
          <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
            Deliverables will appear here as your AI employees complete tasks. You can copy, export,
            or save them as SOPs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-[8px] uppercase tracking-wider text-slate-400">Outputs</h2>
        <span className="text-[10px] text-slate-500">{deliverables.length}</span>
      </div>
      {deliverables.map((item) => (
        <DeliverableCard
          key={item.id}
          item={item}
          onSaveAsSop={handleSaveAsSop}
          isNew={item.id === newestId}
        />
      ))}
      <div ref={listBottomRef} />
    </div>
  );
}
