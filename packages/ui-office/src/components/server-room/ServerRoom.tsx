import { Badge, Button, Input, ScrollArea } from '@offisim/ui-core';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Circle,
  Clock,
  Plus,
  Server,
  Trash2,
  Unplug,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { RackWithSlots } from '@offisim/core/browser';
import type { ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import { useRackSlot } from '../../hooks/useRackSlot.js';
import { useToolTelemetry } from '../../hooks/useToolTelemetry.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context.js';

// ─── Status helpers ─────────────────────────────────────────────────────────

type RackStatus = 'bound' | 'unbound' | 'error' | 'disabled' | string;
type SlotStatus = 'available' | 'occupied' | 'error' | string;

const RACK_BADGE_VARIANT: Record<RackStatus, 'success' | 'secondary' | 'error' | 'outline'> = {
  bound: 'success',
  unbound: 'secondary',
  error: 'error',
  disabled: 'outline',
};

const SLOT_DOT: Record<SlotStatus, string> = {
  available: 'bg-ok',
  occupied: 'bg-accent',
  error: 'bg-danger',
};

function rackBadgeVariant(status: RackStatus) {
  return RACK_BADGE_VARIANT[status] ?? 'outline';
}

function slotDotColor(status: SlotStatus) {
  return SLOT_DOT[status] ?? 'bg-ink-4';
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface SlotListProps {
  rack: RackWithSlots;
  newSlotInput: string;
  onSlotInputChange: (value: string) => void;
  onAddSlot: () => void;
  onRemoveSlot: (slotId: string) => void;
}

function SlotList({
  rack,
  newSlotInput,
  onSlotInputChange,
  onAddSlot,
  onRemoveSlot,
}: SlotListProps) {
  return (
    <div className="mt-sp-2 flex flex-col gap-sp-1 border-l border-line-soft pl-sp-1">
      {rack.slots.length === 0 && (
        <p className="py-sp-1 pl-sp-1 text-fs-micro text-ink-3">
          No slots — add a capability below
        </p>
      )}

      {rack.slots.map((slot) => (
        <div
          key={slot.slot_id}
          className="flex items-center justify-between gap-sp-1 rounded-r-sm bg-surface-2 px-sp-2 py-sp-1"
        >
          <div className="flex min-w-0 flex-1 items-center gap-sp-1">
            <Circle
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${slotDotColor(slot.status)}`}
              fill="currentColor"
              strokeWidth={0}
            />
            <span className="truncate font-mono text-fs-micro text-ink-1">
              {slot.capability_name}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-sp-1">
            <span className="font-mono text-fs-micro text-ink-3">{slot.exposure_scope}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemoveSlot(slot.slot_id)}
              className="h-5 w-5 text-ink-3 hover:text-danger"
              title="Remove slot"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>
      ))}

      {/* Add slot inline input */}
      <div className="mt-sp-1 flex items-center gap-sp-1">
        <Input
          type="text"
          value={newSlotInput}
          onChange={(e) => onSlotInputChange(e.target.value)}
          placeholder="Capability name"
          className="h-7 min-w-0 flex-1 border-line-soft bg-surface-1 px-sp-2 py-sp-1 text-fs-micro"
          onKeyDown={(e) => e.key === 'Enter' && onAddSlot()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddSlot}
          className="h-7 flex-shrink-0 gap-sp-1 px-sp-2 text-fs-micro"
        >
          <Plus className="h-2.5 w-2.5" />
        </Button>
      </div>
    </div>
  );
}

interface RackCardProps {
  rack: RackWithSlots;
  newSlotInput: string;
  onSlotInputChange: (rackId: string, value: string) => void;
  onAddSlot: (rackId: string) => void;
  onRemoveSlot: (slotId: string) => void;
  onBind: (rackId: string) => void;
  onUnbind: (rackId: string) => void;
  onDelete: (rackId: string) => void;
}

function RackCard({
  rack,
  newSlotInput,
  onSlotInputChange,
  onAddSlot,
  onRemoveSlot,
  onBind,
  onUnbind,
  onDelete,
}: RackCardProps) {
  const isBound = rack.status === 'bound';

  return (
    <div className="flex flex-col gap-sp-2 overflow-hidden rounded-r-md border border-line-soft bg-surface-2 p-sp-3">
      {/* Rack header */}
      <div className="flex min-w-0 items-start justify-between gap-sp-2">
        <div className="flex min-w-0 flex-1 items-center gap-sp-2">
          <Server className="h-3 w-3 flex-shrink-0 text-ink-2" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-fs-sm font-semibold leading-tight text-ink-1">
              {rack.label}
            </p>
            <p className="truncate font-mono text-fs-micro text-ink-3">{rack.provider_type}</p>
          </div>
        </div>
        <Badge
          variant={rackBadgeVariant(rack.status)}
          size="xs"
          className="flex-shrink-0 px-1.5 py-0"
        >
          {rack.status}
        </Badge>
      </div>

      {/* Slot count summary */}
      <div className="flex items-center gap-sp-3 text-fs-micro text-ink-3">
        <span>
          {rack.slots.length} slot{rack.slots.length !== 1 ? 's' : ''}
        </span>
        <span className="text-ok">
          {rack.slots.filter((s) => s.status === 'available').length} available
        </span>
      </div>

      {/* Slot list */}
      <SlotList
        rack={rack}
        newSlotInput={newSlotInput}
        onSlotInputChange={(v) => onSlotInputChange(rack.rack_id, v)}
        onAddSlot={() => onAddSlot(rack.rack_id)}
        onRemoveSlot={onRemoveSlot}
      />

      {/* Rack actions */}
      <div className="flex items-center gap-sp-1 border-t border-line-soft pt-sp-1">
        {isBound ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onUnbind(rack.rack_id)}
            className="h-6 gap-sp-1 px-sp-2 text-fs-micro text-warn hover:text-warn"
          >
            <Unplug className="h-2.5 w-2.5" />
            Unbind
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onBind(rack.rack_id)}
            className="h-6 gap-sp-1 px-sp-2 text-fs-micro text-ok hover:text-ok"
          >
            <Wifi className="h-2.5 w-2.5" />
            Bind
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(rack.rack_id)}
          className="ml-auto h-6 w-6 text-ink-3 hover:text-danger"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyRacks() {
  return (
    <div className="flex flex-col items-center justify-center gap-sp-3 py-sp-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-r-md border border-line-soft bg-surface-2">
        <Server className="h-5 w-5 text-ink-3" />
      </div>
      <div className="px-sp-2">
        <p className="text-fs-sm font-semibold text-ink-2">No MCP Racks</p>
        <p className="mt-sp-1 text-fs-micro leading-relaxed text-ink-3">
          Racks are groups of MCP server capabilities that your AI employees can access. Create a
          rack, add capability slots, then bind it to make tools available to agents.
        </p>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_ICON: Record<
  ToolExecutionTelemetryPayload['status'],
  { Icon: typeof CheckCircle; iconClassName: string }
> = {
  started: { Icon: Clock, iconClassName: 'text-ink-2' },
  completed: { Icon: CheckCircle, iconClassName: 'text-ok' },
  error: { Icon: AlertCircle, iconClassName: 'text-danger' },
  denied: { Icon: AlertCircle, iconClassName: 'text-warn' },
};

interface ServerRoomProps {
  activeThreadId: string | null;
}

export function ServerRoom({ activeThreadId }: ServerRoomProps) {
  const { eventBus } = useOffisimRuntimeServices();
  const {
    racks,
    loading,
    createRack,
    deleteRack,
    bindRack,
    unbindRack,
    addSlot,
    removeSlot,
    refresh,
  } = useRackSlot();

  const [newRackLabel, setNewRackLabel] = useState('');
  const [newSlotInputs, setNewSlotInputs] = useState<Record<string, string>>({});

  // Subscribe to rack/slot events for live updates
  useEffect(() => {
    if (!eventBus) return;
    const unsubs = [
      eventBus.on('rack.', () => {
        void refresh();
      }),
      eventBus.on('slot.', () => {
        void refresh();
      }),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [eventBus, refresh]);

  const handleCreateRack = useCallback(async () => {
    const label = newRackLabel.trim();
    if (!label) return;
    await createRack(label, 'mcp_server');
    setNewRackLabel('');
  }, [newRackLabel, createRack]);

  const handleSlotInputChange = useCallback((rackId: string, value: string) => {
    setNewSlotInputs((prev) => ({ ...prev, [rackId]: value }));
  }, []);

  const handleAddSlot = useCallback(
    async (rackId: string) => {
      const capName = newSlotInputs[rackId]?.trim();
      if (!capName) return;
      await addSlot(rackId, capName);
      setNewSlotInputs((prev) => ({ ...prev, [rackId]: '' }));
    },
    [newSlotInputs, addSlot],
  );

  return (
    <div className="flex flex-col gap-sp-3 overflow-hidden">
      {/* Section header */}
      <h2 className="text-fs-micro uppercase tracking-ls-caps text-ink-2">Server Room</h2>

      {/* Rack list */}
      {loading ? (
        <div className="py-sp-2 text-fs-micro text-ink-3">Loading racks...</div>
      ) : racks.length === 0 ? (
        <EmptyRacks />
      ) : (
        <div className="flex flex-col gap-sp-2">
          {racks.map((rack: RackWithSlots) => (
            <RackCard
              key={rack.rack_id}
              rack={rack}
              newSlotInput={newSlotInputs[rack.rack_id] ?? ''}
              onSlotInputChange={handleSlotInputChange}
              onAddSlot={handleAddSlot}
              onRemoveSlot={removeSlot}
              onBind={bindRack}
              onUnbind={unbindRack}
              onDelete={deleteRack}
            />
          ))}
        </div>
      )}

      {/* Add rack — below content */}
      <div className="flex flex-col gap-sp-1 border-t border-line-soft pt-sp-2">
        <label htmlFor="server-room-new-rack" className="text-fs-micro font-medium text-ink-3">
          Add New Rack
        </label>
        <div className="flex items-center gap-sp-1">
          <Input
            id="server-room-new-rack"
            type="text"
            value={newRackLabel}
            onChange={(e) => setNewRackLabel(e.target.value)}
            placeholder="Rack name"
            className="h-8 min-w-0 flex-1 border-line-soft bg-surface-1 px-sp-2 py-sp-1 text-fs-micro"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateRack()}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCreateRack}
            disabled={!newRackLabel.trim()}
            className="h-8 flex-shrink-0 gap-sp-1 px-sp-2 text-fs-micro"
          >
            <Plus className="h-3 w-3" />
            <span>Add</span>
          </Button>
        </div>
      </div>

      <ToolActivitySection activeThreadId={activeThreadId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Activity — collapsible section showing recent tool executions
// ---------------------------------------------------------------------------

function ToolActivitySection({ activeThreadId }: { activeThreadId: string | null }) {
  const { entries, stats } = useToolTelemetry(activeThreadId);
  const [expanded, setExpanded] = useState(true);

  if (!activeThreadId) return null;

  return (
    <div className="mt-sp-3 border-t border-line-soft pt-sp-2">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        className="mb-sp-1 h-auto w-full justify-start gap-sp-1 p-0 text-left hover:bg-transparent"
      >
        <Activity className="h-3 w-3 text-accent" />
        <span className="text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-2">
          Tool Activity
        </span>
        {stats.total > 0 && (
          <span className="ml-auto text-fs-micro text-ink-3">
            {stats.total} calls &middot; {Math.round(stats.successRate * 100)}% ok &middot; avg{' '}
            {formatMs(stats.avgDurationMs)}
          </span>
        )}
      </Button>

      {expanded &&
        (entries.length === 0 ? (
          <p className="px-sp-1 text-fs-micro italic text-ink-3">No tool calls yet</p>
        ) : (
          <ScrollArea className="max-h-40">
            {entries.slice(-20).map((e) => {
              const { Icon, iconClassName } = STATUS_ICON[e.status];
              return (
                <div
                  key={`${e.toolCallId}-${e.startedAt}`}
                  className="flex items-center gap-sp-1 px-sp-1 py-sp-1 text-fs-micro transition-colors hover:bg-surface-sunken"
                >
                  <Icon className={`h-2.5 w-2.5 shrink-0 ${iconClassName}`} />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{e.toolName}</span>
                  {e.durationMs != null && (
                    <span className="shrink-0 text-ink-3">{formatMs(e.durationMs)}</span>
                  )}
                </div>
              );
            })}
          </ScrollArea>
        ))}
    </div>
  );
}
