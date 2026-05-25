import { useUiState } from '@/app/ui-state.js';
import { useSopStages, useSops } from '@/data/queries.js';
import type { Sop, SopStage } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { RunStatePill } from '@/design-system/grammar/RunStatePill.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Play, Plus, Workflow } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';

const STATUS_TONE: Record<Sop['status'], 'accent' | 'ok' | 'muted'> = {
  active: 'ok',
  draft: 'muted',
  archived: 'muted',
};

function StageNode({ stage, index }: { stage: SopStage; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('off-dag-node off-focusable', `is-${stage.state}`, isDragging && 'is-dragging')}
      {...attributes}
      {...listeners}
    >
      <span className="off-dag-stage">
        Stage {index + 1}
        <Icon icon={GripVertical} size="sm" className="off-dag-grip" />
      </span>
      <span className="off-dag-name">{stage.name}</span>
      <span className="off-dag-role">{stage.role}</span>
    </button>
  );
}

function SopCanvas({ sopId }: { sopId: string }) {
  const stages = useSopStages(sopId);
  const [order, setOrder] = useState<SopStage[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (stages.data) setOrder(stages.data);
  }, [stages.data]);

  if (stages.isLoading) return <SkeletonRows rows={4} />;
  if (!order.length) {
    return (
      <EmptyState
        icon={Workflow}
        title="No stages"
        description="Add stages to define this SOP's flow."
      />
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.findIndex((s) => s.id === active.id);
      const to = prev.findIndex((s) => s.id === over.id);
      return from === -1 || to === -1 ? prev : arrayMove(prev, from, to);
    });
  }

  return (
    <div className="off-sops-canvas">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="off-dag">
            {order.map((stage, index) => (
              <Fragment key={stage.id}>
                {index > 0 ? <span className="off-dag-edge" aria-hidden /> : null}
                <StageNode stage={stage} index={index} />
              </Fragment>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export function SopsSurface() {
  const sops = useSops();
  const selectedSopId = useUiState((s) => s.selectedSopId);
  const selectSop = useUiState((s) => s.selectSop);
  const selected = sops.data?.find((s) => s.id === selectedSopId) ?? null;

  return (
    <div className="off-sops">
      <aside className="off-sops-rail">
        <div className="off-sops-rail-head">
          <span className="off-sops-rail-title">SOPs</span>
          <span className="ml-auto">
            <IconButton icon={Plus} label="New SOP" variant="subtle" size="iconSm" />
          </span>
        </div>
        {sops.isLoading ? (
          <SkeletonRows rows={4} />
        ) : sops.data?.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No SOPs"
            description="Author a standard operating procedure to orchestrate your team."
          />
        ) : (
          <div className="off-sops-list">
            {sops.data?.map((sop) => (
              <button
                type="button"
                key={sop.id}
                className={cn('off-sop-card off-focusable', sop.id === selectedSopId && 'is-sel')}
                onClick={() => selectSop(sop.id)}
              >
                <div className="off-sop-card-top">
                  <span className="off-sop-card-name">{sop.name}</span>
                  <span className="ml-auto">
                    <StatusPill tone={STATUS_TONE[sop.status]}>{sop.status}</StatusPill>
                  </span>
                </div>
                <span className="off-sop-card-summary">{sop.summary}</span>
                <span className="off-sop-card-meta">
                  <span>{sop.stageCount} stages</span>
                  <span>·</span>
                  <span>{sop.roleCount} roles</span>
                  <span>·</span>
                  <span>{sop.lastRunLabel}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="off-sops-main">
        {selected ? (
          <>
            <header className="off-sops-main-head">
              <span className="off-sops-main-title">{selected.name}</span>
              <RunStatePill state={selected.runState} />
              <span className="ml-auto">
                <Button size="md">
                  <Icon icon={Play} size="sm" />
                  Run SOP
                </Button>
              </span>
            </header>
            <SopCanvas sopId={selected.id} />
          </>
        ) : (
          <EmptyState
            icon={Workflow}
            title="Select a SOP"
            description="Choose a procedure to view its stage flow."
          />
        )}
      </section>

      <aside className="off-sops-insp">
        {selected ? (
          <div className="off-insp-pad">
            <section className="off-insp-sec">
              <CapsLabel>Summary</CapsLabel>
              <p className="off-sop-card-summary">{selected.summary}</p>
            </section>
            <section className="off-insp-sec">
              <CapsLabel>Details</CapsLabel>
              <div className="off-insp-row">
                <span>Status</span>
                <span>{selected.status}</span>
              </div>
              <div className="off-insp-row">
                <span>Stages</span>
                <span>{selected.stageCount}</span>
              </div>
              <div className="off-insp-row">
                <span>Roles</span>
                <span>{selected.roleCount}</span>
              </div>
              <div className="off-insp-row">
                <span>Last run</span>
                <span>{selected.lastRunLabel}</span>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
