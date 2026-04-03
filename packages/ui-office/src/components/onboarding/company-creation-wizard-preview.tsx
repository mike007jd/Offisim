import type { CompanyTemplate } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID, resolveZoneForRole } from '@offisim/shared-types';
import { useMemo, useState } from 'react';
import {
  ROLE_DOT,
  ZONE_TOOLTIPS,
  getAvatar,
  getTemplatePreviewZones,
} from './company-creation-wizard-data.js';

function PreviewDeskCluster({ x, y }: { x: number; y: number }) {
  const S = 28;
  const half = S / 2;
  const wsOff = 7;
  const chairOff = 14;
  const seats: [number, number, number][] = [
    [-wsOff, -wsOff, -chairOff],
    [wsOff, -wsOff, -chairOff],
    [-wsOff, wsOff, chairOff],
    [wsOff, wsOff, chairOff],
  ];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-half}
        y={-half}
        width={S}
        height={S}
        rx={1.5}
        fill="var(--surface-mid)"
        stroke="var(--surface-mid)"
        strokeWidth={0.3}
      />
      <line
        x1="0"
        y1={-half}
        x2="0"
        y2={half}
        stroke="var(--text-secondary-val)"
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />
      <line
        x1={-half}
        y1="0"
        x2={half}
        y2="0"
        stroke="var(--text-secondary-val)"
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />
      {seats.map(([dx, dz, cdz]) => (
        <g key={`${dx}-${dz}-${cdz}`}>
          <rect x={dx - 2} y={dz - 1} width={4} height={2} rx={0.3} fill="var(--surface-mid)" />
          <rect
            x={dx - 3}
            y={dz < 0 ? dz - 3 : dz + 1}
            width={6}
            height={1.2}
            rx={0.2}
            fill="#0ea5e9"
            opacity={0.5}
          />
          <circle
            cx={dx}
            cy={cdz}
            r={2.2}
            fill="var(--surface-lighter)"
            stroke="var(--surface-mid)"
            strokeWidth={0.2}
          />
        </g>
      ))}
    </g>
  );
}

function PreviewMeetingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-18}
        y={-6}
        width={36}
        height={12}
        rx={3.5}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.3}
      />
      <rect x={-15} y={-4} width={30} height={8} rx={2} fill="var(--surface-light)" />
      {[-11, -4, 4, 11].map((cx) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={-9.5}
            r={2}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.2}
          />
          <circle
            cx={cx}
            cy={9.5}
            r={2}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.2}
          />
        </g>
      ))}
      <rect
        x={-26}
        y={-4}
        width={1.2}
        height={8}
        rx={0.3}
        fill="var(--surface-lighter)"
        stroke="var(--text-secondary-val)"
        strokeWidth={0.15}
      />
    </g>
  );
}

function PreviewBookshelf({ x, y }: { x: number; y: number }) {
  const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-5}
        y={-6}
        width={10}
        height={12}
        rx={0.5}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      {[0, 1, 2].map((shelf) => (
        <g key={shelf}>
          <rect x={-4.5} y={-5 + shelf * 4} width={9} height={0.2} fill="var(--surface-mid)" />
          {[0, 1, 2, 3, 4].map((book) => (
            <rect
              key={book}
              x={-4 + book * 1.6}
              y={-4.5 + shelf * 4}
              width={1.2}
              height={3}
              rx={0.1}
              fill={bookColors[(shelf * 5 + book) % bookColors.length]}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

function PreviewReadingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-10}
        y={-4}
        width={20}
        height={8}
        rx={1}
        fill="#064e3b"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      {[-5, 5].map((cx) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={-6.5}
            r={1.8}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.15}
          />
          <circle
            cx={cx}
            cy={6.5}
            r={1.8}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.15}
          />
        </g>
      ))}
    </g>
  );
}

function PreviewSofa({ x, y, color = '#f59e0b' }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M-9,-3.5 L9,-3.5 L9,1.5 L5,1.5 L5,-1 L-5,-1 L-5,1.5 L-9,1.5 Z" fill={color} />
      <rect x={-10.5} y={-3.5} width={2} height={5} rx={0.8} fill="var(--surface-light)" />
      <rect x={8.5} y={-3.5} width={2} height={5} rx={0.8} fill="var(--surface-light)" />
    </g>
  );
}

function PreviewCoffeeTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="0"
        r={4.5}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      <circle cx="0" cy="0" r={2} fill="var(--surface-light)" />
    </g>
  );
}

function PreviewServerRack({ x, y }: { x: number; y: number }) {
  const rackRows = [-7, -4.5, -2, 0.5, 3, 5.5] as const;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-3.5}
        y={-8}
        width={7}
        height={16}
        rx={0.5}
        fill="var(--surface-light)"
        stroke="var(--surface-lighter)"
        strokeWidth={0.3}
      />
      {rackRows.map((row, index) => (
        <g key={`server-rack-${row}`}>
          <rect x={-2.8} y={row} width={5.6} height={2} rx={0.2} fill="var(--surface)" />
          <circle cx={1.5} cy={row + 1} r={0.4} fill={index % 3 === 0 ? '#fbbf24' : '#22c55e'} />
        </g>
      ))}
    </g>
  );
}

function PreviewVendingMachine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-3}
        y={-5.5}
        width={6}
        height={11}
        rx={0.7}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      <rect x={-2.2} y={-4.5} width={4.4} height={4.5} rx={0.3} fill="#0ea5e9" opacity={0.4} />
      <rect x={-1.8} y={1} width={3.6} height={1.5} rx={0.3} fill="var(--surface-light)" />
    </g>
  );
}

function PreviewPlant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="1"
        r={2.2}
        fill="var(--surface-mid)"
        stroke="var(--text-muted-val)"
        strokeWidth={0.15}
      />
      {[0, 72, 144, 216, 288].map((angle) => (
        <path
          key={angle}
          d="M0,0 C-2,-3.5 2,-3.5 0,0"
          fill="#10b981"
          transform={`rotate(${angle})`}
        />
      ))}
    </g>
  );
}

function PreviewEmployeeAvatar({
  x,
  y,
  name,
  role,
}: {
  x: number;
  y: number;
  name: string;
  role: string;
}) {
  const avatarUri = useMemo(() => getAvatar(name, 32), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);

  return (
    <g transform={`translate(${x}, ${y})`}>
      <g style={{ animation: `wiz-idle-bob 3s ease-in-out ${Math.random() * 2}s infinite` }}>
        <circle cx="0" cy="0" r={5} fill={dotColor} opacity={0.12} />
        <circle
          cx="0"
          cy="0"
          r={4}
          fill="var(--surface-lighter)"
          stroke={dotColor}
          strokeWidth={0.5}
        />
        <image
          href={avatarUri}
          x={-3.2}
          y={-3.2}
          width={6.4}
          height={6.4}
          clipPath={'circle(3.2px at 3.2px 3.2px)'}
        />
        <text
          x="0"
          y="1.5"
          textAnchor="middle"
          fontSize={3}
          fill="var(--text-primary-val)"
          fontFamily="system-ui"
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {initials}
        </text>
        <g transform="translate(0, 6.5)">
          <rect
            x={-8}
            y={-2}
            width={16}
            height={4}
            rx={2}
            fill="var(--surface-light)"
            opacity={0.8}
          />
          <text
            x="0"
            y="0.8"
            fill="var(--text-primary-val)"
            fontSize={2.2}
            fontWeight={600}
            textAnchor="middle"
            fontFamily="system-ui"
          >
            {name.split(' ')[0]}
          </text>
        </g>
      </g>
    </g>
  );
}

function computeTemplateZones(template: CompanyTemplate) {
  const W = 640;
  const H = 440;
  const PAD = 16;
  const layoutZones = getTemplatePreviewZones(template);
  if (layoutZones.length === 0) return [];

  const employeeCounts = new Map<string, number>();
  for (const employee of template.employees) {
    const matched = resolveZoneForRole(employee.role_slug as RoleSlug, layoutZones);
    const zoneId = matched?.zoneId ?? UNASSIGNED_ZONE_ID;
    employeeCounts.set(zoneId, (employeeCounts.get(zoneId) ?? 0) + 1);
  }

  const minX = Math.min(...layoutZones.map((zone) => zone.cx - zone.w / 2));
  const maxX = Math.max(...layoutZones.map((zone) => zone.cx + zone.w / 2));
  const minZ = Math.min(...layoutZones.map((zone) => zone.cz - zone.d / 2));
  const maxZ = Math.max(...layoutZones.map((zone) => zone.cz + zone.d / 2));
  const scale = Math.min((W - PAD * 2) / (maxX - minX || 1), (H - PAD * 2) / (maxZ - minZ || 1));

  return layoutZones
    .map((zone, index) => ({
      id: zone.zoneId,
      label: zone.label,
      accent: zone.accentColor,
      archetype: zone.archetype,
      x: PAD + (zone.cx - zone.w / 2 - minX) * scale,
      y: PAD + (zone.cz - zone.d / 2 - minZ) * scale,
      w: zone.w * scale,
      h: zone.d * scale,
      empCount: employeeCounts.get(zone.zoneId) ?? 0,
      sortOrder: zone.sortOrder ?? index,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function Office2DPreview({
  template,
  highlightZones,
  accentHex,
}: {
  template: CompanyTemplate;
  /** Zone IDs to emphasize for the selected template. */
  highlightZones?: string[];
  /** Template accent color for highlight glow. */
  accentHex?: string;
}) {
  const W = 640;
  const H = 440;
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const highlightSet = useMemo(() => new Set(highlightZones ?? []), [highlightZones]);

  const zones = useMemo(() => computeTemplateZones(template), [template]);
  const employeesByZone = useMemo(() => {
    const previewZones = getTemplatePreviewZones(template);
    const map = new Map<string, typeof template.employees>();
    for (const employee of template.employees) {
      const matched = resolveZoneForRole(employee.role_slug as RoleSlug, previewZones);
      const zoneId = matched?.zoneId ?? UNASSIGNED_ZONE_ID;
      const list = map.get(zoneId) ?? [];
      list.push(employee);
      map.set(zoneId, list);
    }
    return map;
  }, [template]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      aria-label="Company office preview"
    >
      <title>Company office preview</title>
      <rect width={W} height={H} fill="var(--surface)" rx={6} />
      <defs>
        <pattern id="wiz-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.25" fill="var(--surface-lighter)" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#wiz-grid)" rx={6} />

      {zones.map((zone) => {
        const mx = zone.x + zone.w / 2;
        const my = zone.y + zone.h / 2;
        const sc = Math.min(zone.w, zone.h) / 55;
        const isHovered = hoveredZone === zone.id;
        const tooltip = ZONE_TOOLTIPS[zone.id];
        const isHighlighted = highlightSet.size > 0 && highlightSet.has(zone.id);
        const isDimmed = highlightSet.size > 0 && !isHighlighted;

        return (
          <g
            key={zone.id}
            onMouseEnter={() => setHoveredZone(zone.id)}
            onMouseLeave={() => setHoveredZone(null)}
          >
            <rect
              x={zone.x}
              y={zone.y}
              width={zone.w}
              height={zone.h}
              rx={3}
              fill={isHighlighted ? (accentHex ?? zone.accent) : zone.accent}
              fillOpacity={isHighlighted ? 0.22 : isDimmed ? 0.02 : isHovered ? 0.08 : 0.04}
              stroke={isHighlighted ? (accentHex ?? zone.accent) : zone.accent}
              strokeWidth={isHighlighted ? 2 : isHovered ? 1 : 0.6}
              strokeOpacity={isHighlighted ? 0.7 : isDimmed ? 0.1 : isHovered ? 0.5 : 0.2}
              strokeDasharray={zone.archetype === 'meeting' || zone.archetype === 'server' ? '3 1.5' : 'none'}
              style={{
                transition: 'fill-opacity 0.3s, stroke-width 0.3s, stroke-opacity 0.3s',
              }}
            />

            <rect
              x={zone.x}
              y={zone.y}
              width={zone.w}
              height={zone.h}
              rx={3}
              fill="none"
              stroke={zone.accent}
              strokeWidth={1.2}
              strokeOpacity={0.12}
              style={{ animation: 'wiz-glow-pulse 3.2s ease-in-out infinite' }}
            />

            <text x={zone.x + 10} y={zone.y + 18} fill={zone.accent} fontSize={9} fontWeight={700}>
              {zone.label}
            </text>

            {zone.empCount ? (
              <text
                x={zone.x + zone.w - 10}
                y={zone.y + 18}
                fill="var(--text-secondary-val)"
                fontSize={8}
                textAnchor="end"
              >
                {zone.empCount} STAFF
              </text>
            ) : null}

            <g transform={`translate(${mx}, ${my}) scale(${sc})`}>
              {zone.archetype === 'workspace' ? (
                <PreviewDeskCluster x={0} y={0} />
              ) : zone.archetype === 'meeting' ? (
                <PreviewMeetingTable x={0} y={0} />
              ) : zone.archetype === 'server' ? (
                <PreviewServerRack x={0} y={0} />
              ) : zone.archetype === 'library' ? (
                <>
                  <PreviewBookshelf x={-7} y={0} />
                  <PreviewBookshelf x={7} y={0} />
                  <PreviewReadingTable x={0} y={12} />
                </>
              ) : zone.archetype === 'rest' ? (
                <>
                  <PreviewSofa x={-8} y={0} />
                  <PreviewSofa x={8} y={0} color="#0ea5e9" />
                  <PreviewCoffeeTable x={0} y={0} />
                  <PreviewPlant x={-18} y={-10} />
                  <PreviewPlant x={18} y={10} />
                  <PreviewVendingMachine x={18} y={-6} />
                </>
              ) : null}
            </g>

            {(employeesByZone.get(zone.id) ?? []).slice(0, 4).map((employee, index, list) => {
              const employeeX = zone.x + zone.w / 2 + (index - (list.length - 1) / 2) * 26;
              const employeeY = zone.y + zone.h - 32;
              return (
                <PreviewEmployeeAvatar
                  key={employee.name}
                  x={employeeX}
                  y={employeeY}
                  name={employee.name}
                  role={employee.role_slug}
                />
              );
            })}

            {tooltip && isHovered ? (
              <g transform={`translate(${zone.x + zone.w / 2}, ${zone.y + zone.h + 18})`}>
                <rect
                  x={-62}
                  y={-9}
                  width={124}
                  height={18}
                  rx={9}
                  fill="var(--surface-light)"
                  opacity={0.96}
                />
                <text x="0" y="2.5" fill="var(--text-primary-val)" fontSize={7} textAnchor="middle">
                  {tooltip}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
