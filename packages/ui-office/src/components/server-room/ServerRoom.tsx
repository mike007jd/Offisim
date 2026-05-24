import { Badge, Button, Input, ScrollArea } from '@offisim/ui-core';
import {
  Activity,
  AlertCircle,
  CheckCircle,
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

function rackBadgeVariant(status: RackStatus) {
  return RACK_BADGE_VARIANT[status] ?? 'outline';
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
    <div className="server-room-slots">
      {rack.slots.length === 0 && (
        <p className="server-room-slot-empty">No slots — add a capability below</p>
      )}

      {rack.slots.map((slot) => (
        <div key={slot.slot_id} className="server-room-slot-row">
          <div>
            <span className="server-room-slot-dot" data-status={slot.status as SlotStatus} />
            <span>{slot.capability_name}</span>
          </div>
          <div>
            <span>{slot.exposure_scope}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemoveSlot(slot.slot_id)}
              className="server-room-slot-remove"
              title="Remove slot"
            >
              <Trash2 data-icon="remove-slot" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}

      {/* Add slot inline input */}
      <div className="server-room-slot-add">
        <Input
          type="text"
          value={newSlotInput}
          onChange={(e) => onSlotInputChange(e.target.value)}
          placeholder="Capability name"
          className="server-room-slot-input"
          onKeyDown={(e) => e.key === 'Enter' && onAddSlot()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddSlot}
          className="server-room-slot-add-button"
        >
          <Plus data-icon="add-slot" aria-hidden="true" />
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
    <div className="server-room-rack-card">
      {/* Rack header */}
      <div className="server-room-rack-head">
        <div>
          <Server data-icon="rack" aria-hidden="true" />
          <div>
            <p>{rack.label}</p>
            <p>{rack.provider_type}</p>
          </div>
        </div>
        <Badge variant={rackBadgeVariant(rack.status)} size="xs" className="server-room-rack-badge">
          {rack.status}
        </Badge>
      </div>

      {/* Slot count summary */}
      <div className="server-room-rack-summary">
        <span>
          {rack.slots.length} slot{rack.slots.length !== 1 ? 's' : ''}
        </span>
        <span>{rack.slots.filter((s) => s.status === 'available').length} available</span>
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
      <div className="server-room-rack-actions">
        {isBound ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onUnbind(rack.rack_id)}
            className="server-room-rack-action"
            data-tone="warn"
          >
            <Unplug data-icon="unbind" aria-hidden="true" />
            Unbind
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onBind(rack.rack_id)}
            className="server-room-rack-action"
            data-tone="ok"
          >
            <Wifi data-icon="bind" aria-hidden="true" />
            Bind
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(rack.rack_id)}
          className="server-room-rack-delete"
        >
          <Trash2 data-icon="delete-rack" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyRacks() {
  return (
    <div className="server-room-empty">
      <div>
        <Server data-icon="empty-racks" aria-hidden="true" />
      </div>
      <div>
        <p>No MCP Racks</p>
        <p>
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

const STATUS_ICON: Record<ToolExecutionTelemetryPayload['status'], { Icon: typeof CheckCircle }> = {
  started: { Icon: Clock },
  completed: { Icon: CheckCircle },
  error: { Icon: AlertCircle },
  denied: { Icon: AlertCircle },
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
    <div className="server-room-root">
      {/* Section header */}
      <h2>Server Room</h2>

      {/* Rack list */}
      {loading ? (
        <div className="server-room-loading">Loading racks...</div>
      ) : racks.length === 0 ? (
        <EmptyRacks />
      ) : (
        <div className="server-room-rack-list">
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
      <div className="server-room-add-rack">
        <label htmlFor="server-room-new-rack">Add New Rack</label>
        <div>
          <Input
            id="server-room-new-rack"
            type="text"
            value={newRackLabel}
            onChange={(e) => setNewRackLabel(e.target.value)}
            placeholder="Rack name"
            className="server-room-rack-input"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateRack()}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCreateRack}
            disabled={!newRackLabel.trim()}
            className="server-room-add-rack-button"
          >
            <Plus data-icon="add-rack" aria-hidden="true" />
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
    <div className="server-room-activity">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        className="server-room-activity-toggle"
      >
        <Activity data-icon="activity" aria-hidden="true" />
        <span>Tool Activity</span>
        {stats.total > 0 && (
          <span>
            {stats.total} calls &middot; {Math.round(stats.successRate * 100)}% ok &middot; avg{' '}
            {formatMs(stats.avgDurationMs)}
          </span>
        )}
      </Button>

      {expanded &&
        (entries.length === 0 ? (
          <p className="server-room-activity-empty">No tool calls yet</p>
        ) : (
          <ScrollArea className="server-room-activity-scroll">
            {entries.slice(-20).map((e) => {
              const { Icon } = STATUS_ICON[e.status];
              return (
                <div
                  key={`${e.toolCallId}-${e.startedAt}`}
                  className="server-room-activity-row"
                  data-status={e.status}
                >
                  <Icon data-icon="activity-status" aria-hidden="true" />
                  <span>{e.toolName}</span>
                  {e.durationMs != null && <span>{formatMs(e.durationMs)}</span>}
                </div>
              );
            })}
          </ScrollArea>
        ))}
    </div>
  );
}
