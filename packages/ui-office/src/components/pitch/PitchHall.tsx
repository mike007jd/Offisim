import type {
  DeliverableCreatedPayload,
  RoleSlug,
  RuntimeEvent,
  SopDefinition,
} from '@offisim/shared-types';
import { FileOutput } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Deliverable, useDeliverables } from '../../hooks/useDeliverables';
import {
  useOffisimRuntimeDesktopHost,
  useOffisimRuntimeServices,
} from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';
import { DeliverableCard } from '../deliverable/DeliverableCard';

export function PitchHall({
  activeThreadId,
  activeProjectId,
  deliverables: deliverablesProp,
}: {
  activeThreadId?: string | null;
  activeProjectId?: string | null;
  deliverables?: Deliverable[];
}) {
  // `activeThreadId` is the product-layer chat_threads.thread_id (RunScope.threadId).
  // Pass it as the `useDeliverables` filter so the right-rail Outputs panel scopes
  // to the active thread; pass null in cross-thread surfaces to see everything.
  const hookedDeliverables = useDeliverables(activeThreadId ?? null);
  const deliverables = deliverablesProp ?? hookedDeliverables;
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { desktopVaultRoot } = useOffisimRuntimeDesktopHost();
  const { activeCompanyId } = useCompany();
  const listBottomRef = useRef<HTMLDivElement>(null);

  const [newestId, setNewestId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const id = e.payload.deliverableId;
      if (!id) return;
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setNewestId(id);
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
        <div className="w-10 h-10 rounded-xl bg-surface-muted border border-border-subtle flex items-center justify-center">
          <FileOutput className="w-5 h-5 text-text-muted" />
        </div>
        <div className="px-2">
          <p className="text-caption font-semibold text-text-secondary">No Outputs Yet</p>
          <p className="text-caption text-text-muted mt-1.5 leading-relaxed">
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
        <h2 className="text-caption uppercase tracking-wider text-text-muted">Outputs</h2>
        <span className="text-caption text-text-muted">{deliverables.length}</span>
      </div>
      {deliverables.map((item) => (
        <DeliverableCard
          key={item.id}
          item={item}
          variant="full"
          desktopVaultRoot={desktopVaultRoot ?? null}
          activeProjectId={activeProjectId ?? null}
          onSaveAsSop={handleSaveAsSop}
          isNew={item.id === newestId}
        />
      ))}
      <div ref={listBottomRef} />
    </div>
  );
}
