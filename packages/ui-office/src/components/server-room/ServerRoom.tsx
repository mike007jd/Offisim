import { Badge } from '@offisim/ui-core';
import { Circle, Plus, Server, Trash2, Unplug, Wifi } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { RackWithSlots } from '@offisim/core/browser';
import { useRackSlot } from '../../hooks/useRackSlot.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';

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
  available: 'bg-emerald-500',
  occupied: 'bg-blue-500',
  error: 'bg-red-500',
};

function rackBadgeVariant(status: RackStatus) {
  return RACK_BADGE_VARIANT[status] ?? 'outline';
}

function slotDotColor(status: SlotStatus) {
  return SLOT_DOT[status] ?? 'bg-slate-500';
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
    <div className="mt-2 flex flex-col gap-1 pl-1 border-l border-white/5">
      {rack.slots.length === 0 && (
        <p className="text-[10px] text-slate-500 py-1 pl-1">No slots — add a capability below</p>
      )}

      {rack.slots.map((slot) => (
        <div
          key={slot.slot_id}
          className="flex items-center justify-between rounded bg-white/5 px-2 py-1 gap-1"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Circle
              className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${slotDotColor(slot.status)}`}
              fill="currentColor"
              strokeWidth={0}
            />
            <span className="text-[10px] text-slate-200 font-mono truncate">
              {slot.capability_name}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[9px] text-slate-500 font-mono">{slot.exposure_scope}</span>
            <button
              type="button"
              onClick={() => onRemoveSlot(slot.slot_id)}
              className="text-slate-600 hover:text-red-400 transition-colors"
              title="Remove slot"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      ))}

      {/* Add slot inline input */}
      <div className="flex items-center gap-1 mt-0.5">
        <input
          type="text"
          value={newSlotInput}
          onChange={(e) => onSlotInputChange(e.target.value)}
          placeholder="Capability name"
          className="flex-1 min-w-0 rounded border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/40"
          onKeyDown={(e) => e.key === 'Enter' && onAddSlot()}
        />
        <button
          type="button"
          onClick={onAddSlot}
          className="flex items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all flex-shrink-0"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
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
    <div className="rounded-lg border border-white/10 bg-black/40 p-3 flex flex-col gap-2 overflow-hidden">
      {/* Rack header */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Server className="w-3 h-3 text-slate-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
              {rack.label}
            </p>
            <p className="text-[9px] text-slate-500 font-mono truncate">{rack.provider_type}</p>
          </div>
        </div>
        <Badge
          variant={rackBadgeVariant(rack.status)}
          className="text-[9px] px-1.5 py-0 flex-shrink-0"
        >
          {rack.status}
        </Badge>
      </div>

      {/* Slot count summary */}
      <div className="flex items-center gap-3 text-[9px] text-slate-500">
        <span>
          {rack.slots.length} slot{rack.slots.length !== 1 ? 's' : ''}
        </span>
        <span className="text-emerald-500/70">
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
      <div className="flex items-center gap-1 pt-1 border-t border-white/5">
        {isBound ? (
          <button
            type="button"
            onClick={() => onUnbind(rack.rack_id)}
            className="flex items-center gap-1 text-[9px] text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 rounded px-1.5 py-0.5 transition-all"
          >
            <Unplug className="w-2.5 h-2.5" />
            Unbind
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onBind(rack.rack_id)}
            className="flex items-center gap-1 text-[9px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 rounded px-1.5 py-0.5 transition-all"
          >
            <Wifi className="w-2.5 h-2.5" />
            Bind
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(rack.rack_id)}
          className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded px-1.5 py-0.5 transition-all ml-auto"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyRacks() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
        <Server className="w-5 h-5 text-slate-500" />
      </div>
      <div className="px-2">
        <p className="text-[11px] font-semibold text-slate-400">No MCP Racks</p>
        <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
          Racks are groups of MCP server capabilities that your AI employees can access. Create a
          rack, add capability slots, then bind it to make tools available to agents.
        </p>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ServerRoom() {
  const { eventBus } = useOffisimRuntime();
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
    <div className="flex flex-col gap-3 overflow-hidden">
      {/* Section header */}
      <h2 className="text-[8px] uppercase tracking-wider text-slate-400">Server Room</h2>

      {/* Rack list */}
      {loading ? (
        <div className="text-[10px] text-slate-500 py-2">Loading racks...</div>
      ) : racks.length === 0 ? (
        <EmptyRacks />
      ) : (
        <div className="flex flex-col gap-2">
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
      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
        <label htmlFor="server-room-new-rack" className="text-[10px] text-slate-500 font-medium">
          Add New Rack
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="server-room-new-rack"
            type="text"
            value={newRackLabel}
            onChange={(e) => setNewRackLabel(e.target.value)}
            placeholder="Rack name"
            className="flex-1 min-w-0 rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/40"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateRack()}
          />
          <button
            type="button"
            onClick={handleCreateRack}
            disabled={!newRackLabel.trim()}
            className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        </div>
      </div>
    </div>
  );
}
