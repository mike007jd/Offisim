import { useState } from 'react';

import { useRackSlot } from '../../hooks/useRackSlot.js';

export function ServerRoom() {
  const { racks, loading, createRack, deleteRack, bindRack, unbindRack, addSlot, removeSlot } =
    useRackSlot();
  const [newRackLabel, setNewRackLabel] = useState('');
  const [newSlotInputs, setNewSlotInputs] = useState<Record<string, string>>({});

  if (loading) {
    return <div className="p-3 text-sm text-zinc-400">Loading racks...</div>;
  }

  const handleCreateRack = async () => {
    if (!newRackLabel.trim()) return;
    await createRack(newRackLabel.trim(), 'mcp_server');
    setNewRackLabel('');
  };

  const handleAddSlot = async (rackId: string) => {
    const capName = newSlotInputs[rackId]?.trim();
    if (!capName) return;
    await addSlot(rackId, capName);
    setNewSlotInputs((prev) => ({ ...prev, [rackId]: '' }));
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold text-zinc-200">Server Room</h3>

      {/* Add rack */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newRackLabel}
          onChange={(e) => setNewRackLabel(e.target.value)}
          placeholder="New rack name..."
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 placeholder-zinc-500"
          onKeyDown={(e) => e.key === 'Enter' && handleCreateRack()}
        />
        <button
          type="button"
          onClick={handleCreateRack}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
        >
          Add
        </button>
      </div>

      {/* Rack list */}
      {racks.length === 0 ? (
        <p className="text-xs text-zinc-500">No racks configured. Add one to start managing MCP permissions.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {racks.map((rack) => (
            <div key={rack.rack_id} className="rounded border border-zinc-700 bg-zinc-900 p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{rack.label}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      rack.status === 'bound'
                        ? 'bg-green-900 text-green-300'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {rack.status}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {rack.status === 'unbound' ? (
                    <button
                      type="button"
                      onClick={() => bindRack(rack.rack_id)}
                      className="rounded px-2 py-0.5 text-xs text-green-400 hover:bg-zinc-700"
                    >
                      Bind
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => unbindRack(rack.rack_id)}
                      className="rounded px-2 py-0.5 text-xs text-yellow-400 hover:bg-zinc-700"
                    >
                      Unbind
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteRack(rack.rack_id)}
                    className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-700"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Slots */}
              <div className="mt-2 flex flex-col gap-1">
                {rack.slots.map((slot) => (
                  <div
                    key={slot.slot_id}
                    className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1"
                  >
                    <span className="text-xs text-zinc-300">{slot.capability_name}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-zinc-500">{slot.exposure_scope}</span>
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.slot_id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}

                {/* Add slot */}
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newSlotInputs[rack.rack_id] ?? ''}
                    onChange={(e) =>
                      setNewSlotInputs((prev) => ({ ...prev, [rack.rack_id]: e.target.value }))
                    }
                    placeholder="Capability name..."
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 placeholder-zinc-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSlot(rack.rack_id)}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddSlot(rack.rack_id)}
                    className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-600"
                  >
                    + Slot
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
