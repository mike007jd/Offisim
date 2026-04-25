/**
 * PlotZoneBreadcrumb -- Three-segment breadcrumb (Plot / Zone / Asset) overlaying
 * the top of the Studio canvas. Active segment is opaque + accent underline;
 * inactive segments are muted and clickable to collapse the stack to that level.
 */

import { getBuiltinPrefab } from '@offisim/renderer';
import { useMemo } from 'react';
import { useStudioHierarchyLevel, useStudioStore } from './StudioState.js';
import { FONT, LAYOUT, SP, STUDIO_COLORS } from './studio-tokens.js';

const SEPARATOR_CHAR = '›'; // ›

const CONTAINER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: LAYOUT.toolbarHeight,
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
  zIndex: 25,
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
    borderBottom: active
      ? `2px solid ${STUDIO_COLORS.accent}`
      : '2px solid transparent',
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
    <button type="button" onClick={onClick} style={baseStyle} aria-label={`Go to ${label}`}>
      {label}
    </button>
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
  const selectedInstanceId = useStudioStore((s) => s.selectedInstanceId);
  const isEditingZone = useStudioStore((s) => s.isEditingZone);
  const zones = useStudioStore((s) => s.zones);
  const instances = useStudioStore((s) => s.instances);
  const exitEditZone = useStudioStore((s) => s.exitEditZone);
  const selectInstance = useStudioStore((s) => s.selectInstance);
  const clearSelection = useStudioStore((s) => s.clearSelection);

  const zoneLabel = useMemo(() => {
    if (selectedZoneId) {
      return zones.find((z) => z.zoneId === selectedZoneId)?.label ?? null;
    }
    // Asset-via-instance fallback: derive zone from the selected instance's zoneId.
    if (selectedInstanceId) {
      const inst = instances.find((i) => i.id === selectedInstanceId);
      if (inst) return zones.find((z) => z.zoneId === inst.zoneId)?.label ?? null;
    }
    return null;
  }, [zones, selectedZoneId, selectedInstanceId, instances]);

  const assetLabel = useMemo(() => {
    if (selectedInstanceId) {
      const inst = instances.find((i) => i.id === selectedInstanceId);
      const def = inst ? getBuiltinPrefab(inst.prefabId) : undefined;
      return def?.name ?? 'Asset';
    }
    if (isEditingZone && zoneLabel) return `${zoneLabel} · editing`;
    return null;
  }, [selectedInstanceId, instances, isEditingZone, zoneLabel]);

  const handleClickZone = () => {
    selectInstance(null);
    if (isEditingZone) exitEditZone();
  };

  return (
    <div style={CONTAINER_STYLE}>
      <Segment
        label={`Plot · ${plotSize.name}`}
        active={level === 'plot'}
        onClick={level === 'plot' ? undefined : clearSelection}
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
