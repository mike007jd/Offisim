import type { Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  type Zone3DLayout,
  buildEmployeeToMeetingFlowLine,
  buildReportingFlowLines,
  getFlowLineColor,
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
    sortOrder: 2,
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
    sortOrder: 3,
  },
];

const layoutMap: Readonly<Record<string, Zone3DLayout>> = {
  meeting: { position: [0, 0, 0], size: [6, 6] },
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
        variant: 'approval',
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
  });

  it('maps flow variants to distinct scene colors', () => {
    expect(getFlowLineColor('normal')).toBe('#60a5fa');
    expect(getFlowLineColor('approval')).toBe('#fbbf24');
    expect(getFlowLineColor('report')).toBe('#22d3ee');
    expect(getFlowLineColor('blocked')).toBe('#f87171');
  });
});
