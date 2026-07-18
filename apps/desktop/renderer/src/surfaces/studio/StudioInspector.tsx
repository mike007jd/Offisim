import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  ZONE_PRESET_GROUPS,
  type ZoneRow,
  findOverlaps,
  prefabBoundsToRect,
  prefabFitsWithinZone,
  prefabPlacementBounds,
} from '@offisim/shared-types';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Focus,
  MousePointerClick,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StudioPrefabVM } from './StudioScene3D.js';
import { useStudioStore } from './studio-store.js';

const ZONE_MIN = 3;
const ZONE_MAX = 30;

function roomPurposeLabel(archetype: ZoneRow['archetype']): string {
  return ZONE_PRESET_GROUPS.find((group) => group.archetype === archetype)?.label ?? 'Custom room';
}

export interface ZonePatch {
  readonly label?: string;
  readonly cx?: number;
  readonly cz?: number;
  readonly w?: number;
  readonly d?: number;
}

/** Two-step destructive button: first click arms, second runs. */
function ConfirmDeleteButton({
  label,
  busy,
  onConfirm,
}: {
  label: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <>
      <Button
        variant={armed ? 'destructive' : 'outline'}
        size="sm"
        disabled={busy}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          onConfirm();
        }}
      >
        <Icon icon={Trash2} size="sm" />
        {armed ? 'Confirm delete' : label}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={armed ? 'off-studio-delete-cancel' : 'off-studio-delete-cancel is-placeholder'}
        disabled={!armed}
        aria-hidden={!armed}
        tabIndex={armed ? 0 : -1}
        onClick={() => setArmed(false)}
      >
        Cancel
      </Button>
    </>
  );
}

function ZoneInspector({
  zone,
  zones,
  zonePrefabs,
  busy,
  onPatch,
  onShift,
  onDelete,
  onEnterFocus,
  onExitFocus,
}: {
  zone: ZoneRow;
  zones: readonly ZoneRow[];
  zonePrefabs: readonly StudioPrefabVM[];
  busy: boolean;
  onPatch: (patch: ZonePatch) => void;
  onShift: (dx: number, dz: number) => void;
  onDelete: () => void;
  onEnterFocus: () => void;
  onExitFocus: () => void;
}) {
  const focusZoneId = useStudioStore((s) => s.focusZoneId);
  const focused = focusZoneId === zone.zone_id;
  const [labelDraft, setLabelDraft] = useState(zone.label);
  useEffect(() => setLabelDraft(zone.label), [zone.label]);

  const commitLabel = () => {
    const next = labelDraft.trim();
    if (next && next !== zone.label) onPatch({ label: next });
    else setLabelDraft(zone.label);
  };

  const resizeVerdict = (dw: number, dd: number): { ok: boolean; title?: string } => {
    const w = zone.w + dw;
    const d = zone.d + dd;
    if (w < ZONE_MIN || d < ZONE_MIN || w > ZONE_MAX || d > ZONE_MAX) {
      return {
        ok: false,
        title: `Footprint must stay between ${ZONE_MIN} × ${ZONE_MIN} and ${ZONE_MAX} × ${ZONE_MAX}`,
      };
    }
    const overlaps = findOverlaps(
      { id: zone.zone_id, cx: zone.cx, cz: zone.cz, w, d },
      zones.map((candidate) => ({
        id: candidate.zone_id,
        label: candidate.label,
        cx: candidate.cx,
        cz: candidate.cz,
        w: candidate.w,
        d: candidate.d,
      })),
    );
    if (overlaps.length > 0) {
      return {
        ok: false,
        title: `Would overlap ${overlaps.map((other) => other.label ?? other.id).join(', ')}`,
      };
    }
    if (dw >= 0 && dd >= 0) return { ok: true };
    const objectsFit = zonePrefabs.every((vm) =>
      prefabFitsWithinZone(
        {
          prefabId: vm.definition.prefabId,
          x: vm.instance.position_x,
          z: vm.instance.position_y,
          rotation: vm.instance.rotation,
          gridSize: vm.definition.gridSize,
        },
        { cx: zone.cx, cz: zone.cz, w, d },
      ),
    );
    return objectsFit
      ? { ok: true }
      : { ok: false, title: 'Furniture would no longer fit inside the smaller room' };
  };
  const growVerdict = resizeVerdict(1, 1);
  const shrinkVerdict = resizeVerdict(-1, -1);

  return (
    <div className="off-studio-props">
      <CapsLabel>Room</CapsLabel>
      <div className="off-studio-size-actions">
        {focused ? (
          <Button variant="outline" size="sm" onClick={onExitFocus}>
            <Icon icon={X} size="sm" />
            Back to floor plan
          </Button>
        ) : (
          <Button
            variant="accentSoft"
            size="sm"
            title="Open this room and arrange its furniture (F)"
            onClick={onEnterFocus}
          >
            <Icon icon={Focus} size="sm" />
            Arrange room
          </Button>
        )}
      </div>
      <div className="off-studio-field">
        <span className="off-studio-field-label">Label</span>
        <Input
          value={labelDraft}
          disabled={busy}
          aria-label="Room name"
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="off-about-row">
        <span>Purpose</span>
        <span>{roomPurposeLabel(zone.archetype)}</span>
      </div>
      <div className="off-about-row">
        <span>Furniture</span>
        <span>{zonePrefabs.length}</span>
      </div>
      <div className="off-studio-nudge-grid">
        <span />
        <IconButton
          icon={ArrowUp}
          label="Move room up"
          size="iconSm"
          variant="outline"
          disabled={busy}
          onClick={() => onShift(0, -1)}
        />
        <span />
        <IconButton
          icon={ArrowLeft}
          label="Move room left"
          size="iconSm"
          variant="outline"
          disabled={busy}
          onClick={() => onShift(-1, 0)}
        />
        <div className="off-studio-pos">
          {zone.w} × {zone.d}
        </div>
        <IconButton
          icon={ArrowRight}
          label="Move room right"
          size="iconSm"
          variant="outline"
          disabled={busy}
          onClick={() => onShift(1, 0)}
        />
        <span />
        <IconButton
          icon={ArrowDown}
          label="Move room down"
          size="iconSm"
          variant="outline"
          disabled={busy}
          onClick={() => onShift(0, 1)}
        />
        <span />
      </div>
      <div className="off-studio-size-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !growVerdict.ok}
          title={growVerdict.title}
          onClick={() => onPatch({ w: zone.w + 1, d: zone.d + 1 })}
        >
          Grow
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !shrinkVerdict.ok}
          title={shrinkVerdict.title}
          onClick={() => onPatch({ w: zone.w - 1, d: zone.d - 1 })}
        >
          Shrink
        </Button>
      </div>
      <div className="off-studio-danger">
        <ConfirmDeleteButton label="Delete room" busy={busy} onConfirm={onDelete} />
      </div>
    </div>
  );
}

function ObjectInspector({
  vm,
  zoneLabel,
  busy,
  onRotate,
  onDelete,
}: {
  vm: StudioPrefabVM;
  zoneLabel: string;
  busy: boolean;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const rect = prefabBoundsToRect(
    prefabPlacementBounds({
      prefabId: vm.definition.prefabId,
      x: vm.instance.position_x,
      z: vm.instance.position_y,
      rotation: vm.instance.rotation,
      gridSize: vm.definition.gridSize,
    }),
  );
  return (
    <div className="off-studio-props">
      <CapsLabel>Furniture</CapsLabel>
      <div className="off-about-row">
        <span>Name</span>
        <span>{vm.definition.name}</span>
      </div>
      <div className="off-about-row">
        <span>Room</span>
        <span>{zoneLabel}</span>
      </div>
      <div className="off-about-row">
        <span>Facing</span>
        <span>{vm.instance.rotation}°</span>
      </div>
      <div className="off-about-row">
        <span>Footprint</span>
        <span>
          {rect.w.toFixed(1)} × {rect.d.toFixed(1)}
        </span>
      </div>
      <div className="off-studio-size-actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={onRotate}>
          <Icon icon={RotateCw} size="sm" />
          Rotate
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onDelete}>
          <Icon icon={Trash2} size="sm" />
          Delete
        </Button>
      </div>
    </div>
  );
}

export function StudioInspector({
  zones,
  prefabs,
  busy,
  onZonePatch,
  onZoneShift,
  onZoneDelete,
  onEnterFocus,
  onExitFocus,
  onObjectRotate,
  onObjectDelete,
}: {
  zones: readonly ZoneRow[];
  prefabs: readonly StudioPrefabVM[];
  busy: boolean;
  onZonePatch: (zoneId: string, patch: ZonePatch) => void;
  onZoneShift: (zoneId: string, dx: number, dz: number) => void;
  onZoneDelete: (zoneId: string) => void;
  onEnterFocus: (zoneId: string) => void;
  onExitFocus: () => void;
  onObjectRotate: (instanceId: string) => void;
  onObjectDelete: (instanceId: string) => void;
}) {
  const selection = useStudioStore((s) => s.selection);

  if (selection?.kind === 'object') {
    const vm = prefabs.find((candidate) => candidate.instance.instance_id === selection.id);
    if (vm) {
      const zone = zones.find((candidate) => candidate.zone_id === vm.instance.zone_id);
      return (
        <ObjectInspector
          vm={vm}
          zoneLabel={zone?.label ?? 'Unknown room'}
          busy={busy}
          onRotate={() => onObjectRotate(vm.instance.instance_id)}
          onDelete={() => onObjectDelete(vm.instance.instance_id)}
        />
      );
    }
  }
  if (selection?.kind === 'zone') {
    const zone = zones.find((candidate) => candidate.zone_id === selection.id);
    if (zone) {
      return (
        <ZoneInspector
          zone={zone}
          zones={zones}
          zonePrefabs={prefabs.filter((vm) => vm.instance.zone_id === zone.zone_id)}
          busy={busy}
          onPatch={(patch) => onZonePatch(zone.zone_id, patch)}
          onShift={(dx, dz) => onZoneShift(zone.zone_id, dx, dz)}
          onDelete={() => onZoneDelete(zone.zone_id)}
          onEnterFocus={() => onEnterFocus(zone.zone_id)}
          onExitFocus={onExitFocus}
        />
      );
    }
  }
  return (
    <div className="off-studio-props">
      <EmptyState
        icon={MousePointerClick}
        title="No selection"
        description="Choose a room or furniture item from the floor plan or the Rooms list."
      />
    </div>
  );
}
