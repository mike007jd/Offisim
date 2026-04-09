import type { Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  type Zone3DLayout,
  buildDispatchFlowLine,
  buildEmployeeToMeetingFlowLine,
  buildReportingFlowLines,
  getFlowLineColor,
  getFlowLineVariantLabel,
  resolveEmployeeSceneZoneId,
} from '../../components/scene/office3d-shared';

const zones: readonly Zone[] = [
  {
    zoneId: 'meeting',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'meeting',
    label: 'Meeting',
    accentColor: '#a855f7',
    floorColor: 0,
    cx: 0,
    cz: 0,
    w: 6,
    d: 6,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['meet'],
    deskSlots: 0,
    sortOrder: 1,
  },
  {
    zoneId: 'library',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'library',
    label: 'Library',
    accentColor: '#38bdf8',
    floorColor: 0,
    cx: 6,
    cz: 4,
    w: 6,
    d: 6,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['learn'],
    deskSlots: 0,
    sortOrder: 2,
  },
  {
    zoneId: 'dev',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'workspace',
    label: 'Dev',
    accentColor: '#60a5fa',
    floorColor: 0,
    cx: 12,
    cz: 8,
    w: 8,
    d: 8,
    targetRoles: ['developer'],
    allowedCategories: [],
    activityTypes: ['work'],
    deskSlots: 4,
    sortOrder: 3,
  },
  {
    zoneId: 'rest',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'rest',
    label: 'Rest',
    accentColor: '#34d399',
    floorColor: 0,
    cx: 20,
    cz: 4,
    w: 8,
    d: 8,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['rest'],
    deskSlots: 0,
    sortOrder: 4,
  },
];

const layoutMap: Readonly<Record<string, Zone3DLayout>> = {
  meeting: { position: [0, 0, 0], size: [6, 6] },
  library: { position: [6, 0, 4], size: [6, 6] },
  dev: { position: [12, 0, 8], size: [8, 8] },
  rest: { position: [20, 0, 4], size: [8, 8] },
};

describe('office3d flow helpers', () => {
  it('builds an approval flow from the employee zone to the meeting area', () => {
    const agents = new Map([['emp-1', { role: 'developer', workstationId: 'dev' }]]);

    expect(buildEmployeeToMeetingFlowLine('emp-1', agents, zones, layoutMap, 'approval')).toEqual(
      expect.objectContaining({
        from: [12, 0.5, 8],
        to: [0, 0.5, 0],
        points: [
          [12, 0.5, 8],
          [0, 0.5, 0],
        ],
        variant: 'approval',
      }),
    );
  });

  it('can build a dispatch flow line that follows intermediate waypoint centers', () => {
    expect(
      buildDispatchFlowLine(layoutMap.meeting, layoutMap.dev, [
        [6, 0.5, 0],
        [10, 0.5, 4],
      ]),
    ).toEqual(
      expect.objectContaining({
        from: [0, 0.5, 0],
        to: [12, 0.5, 8],
        points: [
          [0, 0.5, 0],
          [6, 0.5, 0],
          [10, 0.5, 4],
          [12, 0.5, 8],
        ],
        variant: 'normal',
      }),
    );
  });

  it('builds reporting lines only for active employees outside meeting/rest zones', () => {
    const agents = new Map([
      ['emp-1', { role: 'developer', workstationId: 'dev', state: 'executing' }],
      ['emp-2', { role: 'developer', workstationId: 'rest', state: 'idle' }],
      ['emp-3', { role: 'developer', workstationId: 'dev', state: 'blocked' }],
    ]);

    const lines = buildReportingFlowLines(agents, zones, layoutMap);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.variant === 'report')).toBe(true);
    expect(lines.map((line) => line.from)).toEqual([
      [12, 0.5, 8],
      [12, 0.5, 8],
    ]);
    expect(lines.map((line) => line.to)).toEqual([
      [0, 0.5, 0],
      [0, 0.5, 0],
    ]);
    expect(lines[0]?.points).toEqual([
      [12, 0.5, 8],
      [6, 0.5, 4],
      [0, 0.5, 0],
    ]);
  });

  it('maps flow variants to distinct scene colors', () => {
    expect(getFlowLineColor('normal')).toBe('#60a5fa');
    expect(getFlowLineColor('approval')).toBe('#fbbf24');
    expect(getFlowLineColor('report')).toBe('#22d3ee');
    expect(getFlowLineColor('blocked')).toBe('#f87171');
  });

  it('maps non-normal flow variants to compact midpoint labels', () => {
    expect(getFlowLineVariantLabel('normal')).toBeNull();
    expect(getFlowLineVariantLabel('approval')).toBe('Pending approval');
    expect(getFlowLineVariantLabel('report')).toBe('Reporting');
    expect(getFlowLineVariantLabel('blocked')).toBe('Blocked');
  });

  it('falls back active employees without a matching workstation zone to the first workspace zone for scene rendering', () => {
    expect(resolveEmployeeSceneZoneId({ role: 'designer', workstationId: null }, zones)).toBe(
      'dev',
    );
  });
});
