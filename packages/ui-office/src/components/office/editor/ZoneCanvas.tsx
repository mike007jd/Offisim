// raw-hex-allowed-file: asset renderer palette; non-design-token content colors.
import type { PrefabDefinition, ZonePreset } from '@offisim/shared-types';
import { isRequiredArchetype } from '@offisim/shared-types';
import { ARCHETYPE_ICONS, LOCK_ICON_PATH, getFloorPatternId } from './archetype-visuals.js';
import type { DragState, EditorZone, PlacedItem } from './types.js';
import { SCALE, SVG_H, SVG_W, editorZoneRect, prefabColor, toSVG } from './types.js';

export interface ZoneCanvasProps {
  viewBox: string;
  editorZones: EditorZone[];
  itemsByZone: Map<string, PlacedItem[]>;
  selectedZoneId: string | null;
  drag: DragState | null;
  overlapMap: Map<string, string[]>;
  allPrefabsMap: Map<string, PrefabDefinition>;
  placingPreset: ZonePreset | null;
  ghostPos: { x: number; y: number } | null;
  ghostOverlaps: string[];
  svgRef: React.RefObject<SVGSVGElement | null>;
  onCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onCanvasMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onCanvasPointerUp: () => void;
  onCanvasMouseLeave: () => void;
  onWheel: (e: React.WheelEvent) => void;
  onZonePointerDown: (zoneId: string, e: React.PointerEvent) => void;
}

export function ZoneCanvas({
  viewBox,
  editorZones,
  itemsByZone,
  selectedZoneId,
  drag,
  overlapMap,
  allPrefabsMap,
  placingPreset,
  ghostPos,
  ghostOverlaps,
  svgRef,
  onCanvasPointerDown,
  onCanvasMouseMove,
  onCanvasPointerUp,
  onCanvasMouseLeave,
  onWheel,
  onZonePointerDown,
}: ZoneCanvasProps) {
  return (
    <div
      className="flex-1 flex items-center justify-center overflow-hidden bg-[#020409]"
      style={{ cursor: placingPreset ? 'crosshair' : drag ? 'grabbing' : 'default' }}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="h-full max-h-[calc(100vh-7rem)] w-full max-w-[1200px]"
        onPointerDown={onCanvasPointerDown}
        onMouseMove={onCanvasMouseMove}
        onPointerUp={onCanvasPointerUp}
        onMouseLeave={onCanvasMouseLeave}
        onWheel={onWheel}
      >
        <title>Office editor canvas</title>
        <CanvasDefs />
        <rect width={SVG_W} height={SVG_H} fill="url(#studio-grid)" />

        {editorZones.map((z) => (
          <ZoneBlock
            key={z.id}
            zone={z}
            items={itemsByZone.get(z.id) ?? []}
            isSelected={selectedZoneId === z.id}
            isDragging={drag?.zoneId === z.id}
            hasOverlap={overlapMap.has(z.id)}
            allPrefabsMap={allPrefabsMap}
            placingPreset={placingPreset}
            onPointerDown={onZonePointerDown}
          />
        ))}

        {placingPreset && ghostPos && (
          <GhostPreview preset={placingPreset} ghostPos={ghostPos} overlaps={ghostOverlaps} />
        )}
      </svg>
    </div>
  );
}

function CanvasDefs() {
  return (
    <defs>
      <pattern id="studio-grid" width="18" height="18" patternUnits="userSpaceOnUse">
        <circle cx="0.5" cy="0.5" r="0.4" fill="rgba(255,255,255,0.06)" />
      </pattern>
      <pattern id="floor-workspace" width="8" height="8" patternUnits="userSpaceOnUse">
        <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="0.3" opacity="0.08" />
      </pattern>
      <pattern id="floor-meeting" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="0.5" fill="currentColor" opacity="0.08" />
      </pattern>
      <pattern id="floor-library" width="10" height="4" patternUnits="userSpaceOnUse">
        <line x1="0" y1="2" x2="10" y2="2" stroke="currentColor" strokeWidth="0.4" opacity="0.06" />
      </pattern>
      <pattern id="floor-rest" width="12" height="6" patternUnits="userSpaceOnUse">
        <path
          d="M0 3 Q3 0 6 3 T12 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.3"
          opacity="0.07"
        />
      </pattern>
      <pattern id="floor-server" width="8" height="8" patternUnits="userSpaceOnUse">
        <line x1="4" y1="0" x2="4" y2="8" stroke="currentColor" strokeWidth="0.2" opacity="0.06" />
        <line x1="0" y1="4" x2="8" y2="4" stroke="currentColor" strokeWidth="0.2" opacity="0.06" />
      </pattern>
      <pattern id="floor-default" width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="0.3" fill="currentColor" opacity="0.05" />
      </pattern>
      <pattern
        id="overlap-hatch"
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" strokeWidth="1" opacity="0.3" />
      </pattern>
    </defs>
  );
}

interface ZoneBlockProps {
  zone: EditorZone;
  items: PlacedItem[];
  isSelected: boolean;
  isDragging: boolean;
  hasOverlap: boolean;
  allPrefabsMap: Map<string, PrefabDefinition>;
  placingPreset: ZonePreset | null;
  onPointerDown: (zoneId: string, e: React.PointerEvent) => void;
}

function ZoneBlock({
  zone: z,
  items,
  isSelected,
  isDragging,
  hasOverlap,
  allPrefabsMap,
  placingPreset,
  onPointerDown,
}: ZoneBlockProps) {
  const r = editorZoneRect(z);
  const required = isRequiredArchetype(z.archetype);
  const patternId = getFloorPatternId(z.archetype);
  const archIcon = z.archetype ? ARCHETYPE_ICONS[z.archetype] : null;

  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5} fill={`${z.accentColor}0a`} />
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={5}
        fill={`url(#${patternId})`}
        style={{ color: z.accentColor }}
      />
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={5}
        fill="none"
        stroke={isSelected ? z.accentColor : `${z.accentColor}30`}
        strokeWidth={isSelected ? 2 : 1}
        strokeDasharray={isDragging ? '4 2' : undefined}
        style={{ cursor: placingPreset ? 'crosshair' : 'grab' }}
        onPointerDown={(e) => onPointerDown(z.id, e)}
      />
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={3}
        fill={z.accentColor}
        opacity={isSelected ? 0.9 : 0.5}
        rx={5}
        style={{ pointerEvents: 'none' }}
      />
      <g style={{ pointerEvents: 'none' }}>
        {required && (
          <g transform={`translate(${r.x + 6}, ${r.y + 8})`}>
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke={z.accentColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
            >
              <title>Required zone</title>
              <path d={LOCK_ICON_PATH} />
            </svg>
          </g>
        )}
        <text
          x={r.x + (required ? 18 : 6)}
          y={r.y + 14}
          fill={z.accentColor}
          fontSize="8"
          fontFamily="monospace"
          fontWeight="700"
          letterSpacing="0.1em"
          opacity={0.8}
        >
          {z.label.toUpperCase()}
        </text>
      </g>
      {archIcon && (
        <g transform={`translate(${r.x + r.w - 16}, ${r.y + 6})`} style={{ pointerEvents: 'none' }}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={z.accentColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.3"
          >
            <title>Zone archetype</title>
            <path d={archIcon.path} />
          </svg>
        </g>
      )}
      <text
        x={r.x + r.w - 6}
        y={r.y + r.h - 4}
        textAnchor="end"
        fill={`${z.accentColor}30`}
        fontSize="7"
        fontFamily="monospace"
        style={{ pointerEvents: 'none' }}
      >
        {z.w}x{z.d}
      </text>
      {items.map((item) => {
        const def = allPrefabsMap.get(item.prefabId);
        if (!def) return null;
        const { sx, sy } = toSVG(item.x, item.y);
        const color = prefabColor(def.category);
        const halfW = (def.gridSize[0] * SCALE) / 2;
        const halfH = (def.gridSize[1] * SCALE) / 2;
        return (
          <g
            key={item.instanceId}
            transform={`translate(${sx}, ${sy}) rotate(${item.rotation})`}
            style={{ pointerEvents: 'none' }}
          >
            <rect
              x={-halfW}
              y={-halfH}
              width={halfW * 2}
              height={halfH * 2}
              rx={2}
              fill={`${color}18`}
              stroke={`${color}50`}
              strokeWidth={0.8}
            />
            <line
              x1={0}
              y1={-halfH}
              x2={0}
              y2={-halfH - 3}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.4}
            />
            <text
              x={0}
              y={2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={color}
              fontSize="6"
              fontFamily="monospace"
              fontWeight="500"
              opacity={0.7}
            >
              {def.name.split(' ')[0]}
            </text>
          </g>
        );
      })}
      {hasOverlap && (
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={5}
          fill="url(#overlap-hatch)"
          stroke="#ef4444"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {isSelected && (
        <>
          <rect
            x={r.x - 1}
            y={r.y - 1}
            width={r.w + 2}
            height={r.h + 2}
            rx={6}
            fill="none"
            stroke={z.accentColor}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            style={{ pointerEvents: 'none' }}
          />
          {[
            [r.x, r.y],
            [r.x + r.w, r.y],
            [r.x, r.y + r.h],
            [r.x + r.w, r.y + r.h],
          ].map(([cx, cy]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={3}
              fill={z.accentColor}
              opacity={0.6}
              style={{ pointerEvents: 'none' }}
            />
          ))}
        </>
      )}
    </g>
  );
}

interface GhostPreviewProps {
  preset: ZonePreset;
  ghostPos: { x: number; y: number };
  overlaps: string[];
}

function GhostPreview({ preset, ghostPos, overlaps }: GhostPreviewProps) {
  const hasOverlap = overlaps.length > 0;
  const color = hasOverlap ? '#ef4444' : '#22c55e';
  return (
    <g transform={`translate(${ghostPos.x}, ${ghostPos.y})`} style={{ pointerEvents: 'none' }}>
      <rect
        x={-(preset.w * SCALE) / 2}
        y={-(preset.d * SCALE) / 2}
        width={preset.w * SCALE}
        height={preset.d * SCALE}
        rx={5}
        fill={`${color}08`}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
      {hasOverlap && (
        <rect
          x={-(preset.w * SCALE) / 2}
          y={-(preset.d * SCALE) / 2}
          width={preset.w * SCALE}
          height={preset.d * SCALE}
          rx={5}
          fill="url(#overlap-hatch)"
        />
      )}
      <text
        x={0}
        y={-4}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize="9"
        fontFamily="monospace"
        fontWeight="700"
        opacity={0.6}
      >
        {preset.label.toUpperCase()}
      </text>
      <text
        x={0}
        y={8}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize="7"
        fontFamily="monospace"
        opacity={0.4}
      >
        {preset.w}x{preset.d} · {preset.prefabs.length} items
      </text>
      {hasOverlap && (
        <text
          x={0}
          y={20}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ef4444"
          fontSize="7"
          fontFamily="monospace"
          fontWeight="600"
          opacity={0.8}
        >
          Overlaps: {overlaps.join(', ')}
        </text>
      )}
    </g>
  );
}
