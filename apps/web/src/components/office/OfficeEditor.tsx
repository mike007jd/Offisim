import { LAYOUT_PRESETS } from '@aics/renderer';
import { useState } from 'react';

import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';

const presetNames = Object.keys(LAYOUT_PRESETS);

export function OfficeEditor() {
  const { layouts, activeLayout, loading, createLayout, setActive, deleteLayout } =
    useOfficeLayout();
  const [selectedPreset, setSelectedPreset] = useState('2x2');

  if (loading) {
    return <div className="p-3 text-sm text-zinc-400">Loading layouts...</div>;
  }

  const handleCreate = async () => {
    const preset = LAYOUT_PRESETS[selectedPreset];
    if (!preset) return;
    const id = await createLayout(`${selectedPreset} Layout`, JSON.stringify(preset));
    await setActive(id);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold text-zinc-200">Office Layout</h3>

      {/* Create from preset */}
      <div className="flex items-center gap-2">
        <select
          value={selectedPreset}
          onChange={(e) => setSelectedPreset(e.target.value)}
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
        >
          {presetNames.map((name) => (
            <option key={name} value={name}>
              {name} ({LAYOUT_PRESETS[name]!.workstations.length} workstations)
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleCreate}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
        >
          Create
        </button>
      </div>

      {/* Layout list */}
      {layouts.length === 0 ? (
        <p className="text-xs text-zinc-500">No layouts yet. Create one above.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {layouts.map((layout) => {
            const isActive = activeLayout?.layout_id === layout.layout_id;
            let config: { gridCols?: number; gridRows?: number; workstations?: unknown[] } = {};
            try {
              config = JSON.parse(layout.layout_json);
            } catch {
              /* ignore */
            }
            const wsCount = Array.isArray(config.workstations) ? config.workstations.length : 0;

            return (
              <div
                key={layout.layout_id}
                className={`rounded border p-2 ${
                  isActive ? 'border-blue-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-zinc-200">{layout.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {config.gridCols}x{config.gridRows} · {wsCount} workstations
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isActive ? (
                      <span className="text-xs text-blue-400">Active</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActive(layout.layout_id)}
                        className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                      >
                        Activate
                      </button>
                    )}
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => deleteLayout(layout.layout_id)}
                        className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-700"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
