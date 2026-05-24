/**
 * PlotZoneBreadcrumb -- Three-segment breadcrumb (Plot / Zone / Asset) overlaying
 * the top of the Studio canvas. Active segment is opaque + accent underline;
 * inactive segments are muted and clickable to collapse the stack to that level.
 */

import { getBuiltinPrefab } from '@offisim/renderer';
import { Button } from '@offisim/ui-core';
import { useMemo } from 'react';
import { useStudioHierarchyLevel, useStudioStore } from './StudioState.js';

const SEPARATOR_CHAR = '›';

interface SegmentProps {
  label: string;
  active: boolean;
  onClick?: () => void;
}

function Segment({ label, active, onClick }: SegmentProps) {
  const className = `border-b-2 border-transparent bg-transparent px-sp-2 py-sp-1 text-fs-sm leading-snug ${
    active
      ? 'cursor-default border-accent font-semibold text-ink-1 opacity-100'
      : 'cursor-pointer font-medium text-ink-3 opacity-70 hover:text-ink-1'
  }`;

  if (active || !onClick) {
    return (
      <span className={className} aria-current={active ? 'true' : undefined}>
        {label}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={className}
      aria-label={`Go to ${label}`}
    >
      {label}
    </Button>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-fs-sm leading-none text-ink-4">
      {SEPARATOR_CHAR}
    </span>
  );
}

export function PlotZoneBreadcrumb() {
  const level = useStudioHierarchyLevel();
  const plotSize = useStudioStore((s) => s.plotSize);
  const selectedZoneId = useStudioStore((s) => s.selectedZoneId);
  const isEditingZone = useStudioStore((s) => s.isEditingZone);
  // Resolve instance via store-side selector so re-renders only trigger when
  // the selected instance itself changes — not on every drag-frame `instances`
  // array swap from updatePosition.
  const instance = useStudioStore((s) =>
    s.selectedInstanceId ? (s.instances.find((i) => i.id === s.selectedInstanceId) ?? null) : null,
  );
  const zones = useStudioStore((s) => s.zones);
  const exitEditZone = useStudioStore((s) => s.exitEditZone);
  const selectInstance = useStudioStore((s) => s.selectInstance);
  const unfocusZone = useStudioStore((s) => s.unfocusZone);

  const zoneLabel = useMemo(() => {
    const zoneId = selectedZoneId ?? instance?.zoneId ?? null;
    if (!zoneId) return null;
    return zones.find((z) => z.zoneId === zoneId)?.label ?? null;
  }, [zones, selectedZoneId, instance]);

  const assetLabel = useMemo(() => {
    if (instance) return getBuiltinPrefab(instance.prefabId)?.name ?? 'Asset';
    if (isEditingZone && zoneLabel) return `${zoneLabel} · editing`;
    return null;
  }, [instance, isEditingZone, zoneLabel]);

  const handleClickZone = () => {
    selectInstance(null);
    if (isEditingZone) exitEditZone();
  };

  return (
    <div className="pointer-events-auto absolute left-60 right-60 top-25 z-sticky flex h-8 items-center gap-sp-1 border-b border-line bg-surface-1 px-sp-3 text-fs-sm">
      <Segment
        label={`Plot · ${plotSize.name}`}
        active={level === 'plot'}
        onClick={level === 'plot' ? undefined : unfocusZone}
      />
      {zoneLabel && (
        <>
          <Separator />
          <Segment
            label={`Zone · ${zoneLabel}`}
            active={level === 'zone'}
            onClick={level === 'zone' ? undefined : handleClickZone}
          />
        </>
      )}
      {assetLabel && (
        <>
          <Separator />
          <Segment label={`Asset · ${assetLabel}`} active={level === 'asset'} />
        </>
      )}
    </div>
  );
}
