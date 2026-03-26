import { useState } from 'react';

export interface ZoneConfig {
  id: string;
  name: string;
  color: string;
  employeeCount: number;
}

const ZONE_PALETTE = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#92400e', // brown
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#14b8a6', // teal
  '#6b7280', // gray
];

interface ZoneEditorProps {
  zones: ZoneConfig[];
  onChange: (zones: ZoneConfig[]) => void;
}

function generateId() {
  return `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ZoneEditor({ zones, onChange }: ZoneEditorProps) {
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  function handleNameChange(id: string, name: string) {
    onChange(zones.map((z) => (z.id === id ? { ...z, name } : z)));
  }

  function handleColorChange(id: string, color: string) {
    onChange(zones.map((z) => (z.id === id ? { ...z, color } : z)));
  }

  function handleAddZone() {
    const usedColors = new Set(zones.map((z) => z.color));
    const nextColor = ZONE_PALETTE.find((c) => !usedColors.has(c)) ?? ZONE_PALETTE[0];
    if (!nextColor) return;
    const newZone: ZoneConfig = {
      id: generateId(),
      name: `Department ${zones.length + 1}`,
      color: nextColor,
      employeeCount: 0,
    };
    onChange([...zones, newZone]);
  }

  function handleConfirmRemove(id: string) {
    onChange(zones.filter((z) => z.id !== id));
    setPendingRemoveId(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {zones.length === 0 && (
        <p className="text-sm text-gray-400 italic">No zones configured. Add a department below.</p>
      )}

      {zones.map((zone) => (
        <div
          key={zone.id}
          className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-800 p-3"
        >
          {/* Color indicator / picker */}
          <div className="relative flex-shrink-0">
            <div
              className="h-8 w-8 rounded-md border border-gray-600 cursor-pointer"
              style={{ backgroundColor: zone.color }}
              title="Click to change color"
            />
            <select
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              value={zone.color}
              onChange={(e) => handleColorChange(zone.id, e.target.value)}
              aria-label={`Color for ${zone.name}`}
            >
              {ZONE_PALETTE.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Name input */}
          <div className="flex-1">
            <input
              type="text"
              value={zone.name}
              onChange={(e) => handleNameChange(zone.id, e.target.value)}
              className="w-full rounded bg-gray-900 border border-gray-600 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="Department name"
              aria-label="Department name"
            />
          </div>

          {/* Employee count badge */}
          <div className="flex-shrink-0 text-xs text-gray-400 min-w-[4rem] text-right">
            {zone.employeeCount} {zone.employeeCount === 1 ? 'employee' : 'employees'}
          </div>

          {/* Remove button / confirmation */}
          <div className="flex-shrink-0">
            {pendingRemoveId === zone.id ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-yellow-400">
                  {zone.employeeCount > 0
                    ? `${zone.employeeCount} employee(s) will lose their zone.`
                    : 'Remove zone?'}
                </span>
                <button
                  type="button"
                  onClick={() => handleConfirmRemove(zone.id)}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemoveId(null)}
                  className="rounded bg-gray-600 px-2 py-1 text-xs text-white hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPendingRemoveId(zone.id)}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-red-700 hover:text-white"
                aria-label={`Remove ${zone.name}`}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={handleAddZone}
        className="mt-1 rounded-md border border-dashed border-gray-600 px-4 py-2 text-sm text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors"
      >
        + Add Department
      </button>
    </div>
  );
}
