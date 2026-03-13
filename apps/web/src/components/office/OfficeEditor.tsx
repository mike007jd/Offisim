import { RD_COMPANY_ZONES } from '@aics/renderer';

import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';

/** Display the zone-based office layout configuration. */
export function OfficeEditor() {
  const { layouts, activeLayout, loading, createLayout, setActive, deleteLayout } =
    useOfficeLayout();

  if (loading) {
    return <div className="p-3 text-sm text-zinc-400">Loading layouts...</div>;
  }

  const handleCreate = async () => {
    // Create a zone-based R&D office layout
    const config = {
      type: 'zone-layout',
      zones: RD_COMPANY_ZONES.map((z) => ({
        zoneId: z.zoneId,
        type: z.type,
        label: z.label,
        labelEn: z.labelEn,
        minSlots: z.minSlots,
      })),
    };
    const id = await createLayout('R&D Office', JSON.stringify(config));
    await setActive(id);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold text-zinc-200">Office Layout</h3>

      {/* Create zone layout */}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-zinc-400">
          R&D Office ({RD_COMPANY_ZONES.length} zones: DEV, PROD, ART, LIB, REST, MTG)
        </span>
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
            let config: { type?: string; zones?: unknown[] } = {};
            try {
              config = JSON.parse(layout.layout_json);
            } catch {
              /* ignore */
            }
            const zoneCount = Array.isArray(config.zones) ? config.zones.length : 0;

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
                      {zoneCount} zones
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
