import type { CompanyTemplate } from '@offisim/core/browser';
import { useMemo, useState } from 'react';
import {
  ROLE_DOT,
  ZONE_TOOLTIPS,
  getAvatar,
  resolvePreviewZone,
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

function computeTemplateZones(employees: CompanyTemplate['employees']) {
  const departmentCounts = new Map<string, number>();
  for (const employee of employees) {
    const department = resolvePreviewZone(employee.role_slug);
    departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + 1);
  }
  const activeDepartments = [...departmentCounts.keys()];
  const totalEmployees = employees.length;

  const hasServer = totalEmployees >= 5;
  const hasMeeting = totalEmployees >= 3;
  const hasLibrary = totalEmployees >= 4;
  const hasRest = totalEmployees >= 3;

  const zones: Array<{
    id: string;
    label: string;
    accent: string;
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    deptId?: string;
    empCount?: number;
  }> = [];

  const PAD = 10;
  const W = 640;
  const H = 440;

  const infraZones: typeof zones = [];
  if (hasMeeting) {
    infraZones.push({
      id: 'mtg',
      label: 'MEETING ROOM',
      accent: '#94a3b8',
      type: 'infra',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }
  if (hasServer) {
    infraZones.push({
      id: 'srv',
      label: 'SERVER ROOM',
      accent: '#06b6d4',
      type: 'infra',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }

  const infraW =
    infraZones.length > 0 ? (W - PAD * 2 - (infraZones.length - 1) * PAD) / infraZones.length : 0;
  const infraH = 100;
  infraZones.forEach((zone, index) => {
    zone.x = PAD + index * (infraW + PAD);
    zone.y = PAD;
    zone.w = infraW;
    zone.h = infraH;
  });
  zones.push(...infraZones);

  const supportZones: typeof zones = [];
  if (hasLibrary) {
    supportZones.push({
      id: 'lib',
      label: 'LIBRARY',
      accent: '#10b981',
      type: 'support',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }
  if (hasRest) {
    supportZones.push({
      id: 'rest',
      label: 'REST AREA',
      accent: '#f59e0b',
      type: 'support',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  }

  const row2Y = infraZones.length > 0 ? PAD + infraH + PAD : PAD;
  const supportW =
    supportZones.length > 0
      ? (W - PAD * 2 - (supportZones.length - 1) * PAD) / supportZones.length
      : 0;
  const supportH = 120;
  supportZones.forEach((zone, index) => {
    zone.x = PAD + index * (supportW + PAD);
    zone.y = row2Y;
    zone.w = supportW;
    zone.h = supportH;
  });
  zones.push(...supportZones);

  const row3Y = row2Y + (supportZones.length > 0 ? supportH + PAD : 0);
  const deptW =
    activeDepartments.length > 0
      ? (W - PAD * 2 - (activeDepartments.length - 1) * PAD) / activeDepartments.length
      : 0;
  const deptH = H - row3Y - PAD;

  const departmentMeta: Record<string, { label: string; accent: string }> = {
    dev: { label: 'DEVELOPMENT', accent: '#3b82f6' },
    prod: { label: 'PRODUCT', accent: '#a855f7' },
    art: { label: 'ART & DESIGN', accent: '#f97316' },
  };

  activeDepartments.forEach((departmentId, index) => {
    const department = departmentMeta[departmentId] ?? {
      label: departmentId.toUpperCase(),
      accent: '#64748b',
    };
    zones.push({
      id: departmentId,
      label: department.label,
      accent: department.accent,
      type: 'dept',
      x: PAD + index * (deptW + PAD),
      y: row3Y,
      w: deptW,
      h: deptH,
      deptId: departmentId,
      empCount: departmentCounts.get(departmentId) ?? 0,
    });
  });

  return zones;
}

export function Office2DPreview({ employees }: { employees: CompanyTemplate['employees'] }) {
  const W = 640;
  const H = 440;
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  const zones = useMemo(() => computeTemplateZones(employees), [employees]);
  const employeesByZone = useMemo(() => {
    const map = new Map<string, typeof employees>();
    for (const employee of employees) {
      const zoneId = resolvePreviewZone(employee.role_slug);
      const list = map.get(zoneId) ?? [];
      list.push(employee);
      map.set(zoneId, list);
    }
    return map;
  }, [employees]);

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
              fill={zone.accent}
              fillOpacity={isHovered ? 0.08 : 0.04}
              stroke={zone.accent}
              strokeWidth={isHovered ? 1 : 0.6}
              strokeOpacity={isHovered ? 0.5 : 0.2}
              strokeDasharray={zone.type === 'infra' ? '3 1.5' : 'none'}
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
              {zone.id === 'dev' || zone.id === 'prod' || zone.id === 'art' ? (
                <PreviewDeskCluster x={0} y={0} />
              ) : zone.id === 'mtg' ? (
                <PreviewMeetingTable x={0} y={0} />
              ) : zone.id === 'srv' ? (
                <PreviewServerRack x={0} y={0} />
              ) : zone.id === 'lib' ? (
                <>
                  <PreviewBookshelf x={-7} y={0} />
                  <PreviewBookshelf x={7} y={0} />
                  <PreviewReadingTable x={0} y={12} />
                </>
              ) : zone.id === 'rest' ? (
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
                <text
                  x="0"
                  y="2.5"
                  fill="var(--text-primary-val)"
                  fontSize={7}
                  textAnchor="middle"
                >
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
