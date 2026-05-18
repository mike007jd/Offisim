/**
 * PlotZoneBreadcrumb -- Three-segment breadcrumb (Plot / Zone / Asset) overlaying
 * the top of the Studio canvas. Active segment is opaque + accent underline;
 * inactive segments are muted and clickable to collapse the stack to that level.
 */

import { getBuiltinPrefab } from '@offisim/renderer';
import { Button } from '@offisim/ui-core';
import { useMemo } from 'react';
import { STUDIO_IDENTITY_HEIGHT } from './StudioCompanyIdentity.js';
import { useStudioHierarchyLevel, useStudioStore } from './StudioState.js';
import { FONT, LAYOUT, SP, STUDIO_COLORS, STUDIO_Z_INDEX } from './studio-style-helpers.js';

const SEPARATOR_CHAR = '›';

const CONTAINER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: LAYOUT.toolbarHeight + STUDIO_IDENTITY_HEIGHT,
  left: LAYOUT.paletteWidth,
  right: LAYOUT.propertiesWidth,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  gap: SP.xs,
  padding: `0 ${SP.md}px`,
  background: STUDIO_COLORS.surface0,
  borderBottom: `1px solid ${STUDIO_COLORS.border}`,
  fontFamily: FONT.family,
  fontSize: FONT.base,
  zIndex: STUDIO_Z_INDEX.sticky,
  pointerEvents: 'auto',
};

interface SegmentProps {
  label: string;
  active: boolean;
  onClick?: () => void;
}

function Segment({ label, active, onClick }: SegmentProps) {
  const baseStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: `${SP.xs}px ${SP.sm}px`,
    cursor: active ? 'default' : 'pointer',
    fontSize: FONT.base,
    fontWeight: active ? FONT.semibold : FONT.medium,
    fontFamily: FONT.family,
    color: active ? STUDIO_COLORS.textPrimary : STUDIO_COLORS.textTertiary,
    opacity: active ? 1 : 0.7,
    borderBottom: active ? `2px solid ${STUDIO_COLORS.accent}` : '2px solid transparent',
    lineHeight: 1.4,
  };

  if (active || !onClick) {
    return (
      <span style={baseStyle} aria-current={active ? 'true' : undefined}>
        {label}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      style={baseStyle}
      aria-label={`Go to ${label}`}
    >
      {label}
    </Button>
  );
}

function Separator() {
  return (
    <span
      aria-hidden="true"
      style={{ color: STUDIO_COLORS.textDisabled, fontSize: FONT.md, lineHeight: 1 }}
    >
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
    <div style={CONTAINER_STYLE}>
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
