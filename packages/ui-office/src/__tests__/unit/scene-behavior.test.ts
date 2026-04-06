import { describe, expect, it } from 'vitest';
import {
  buildApprovalHoldTarget,
  buildClarificationHoldTarget,
  buildDispatchRoute,
  buildHandoffRoute,
  buildManagerPresenceTarget,
  buildReturnToMeetingRoute,
  buildStalledWorkTarget,
  buildTransitRoute,
  buildWorkActivityTarget,
  moveThroughPoints,
} from '../../lib/scene-behavior';

type Vec3 = [number, number, number];
type Footprint = { cx: number; cz: number; halfW: number; halfD: number };

const TEST_OBSTACLE_CLEARANCE = 0.35;

function pointInsideExpandedFootprint(point: Vec3, footprint: Footprint): boolean {
  return (
    Math.abs(point[0] - footprint.cx) < footprint.halfW + TEST_OBSTACLE_CLEARANCE &&
    Math.abs(point[2] - footprint.cz) < footprint.halfD + TEST_OBSTACLE_CLEARANCE
  );
}

function segmentsIntersect2D(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): boolean {
  const orientation = (p: Vec3, q: Vec3, r: Vec3) => {
    const value = (q[2] - p[2]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[2] - q[2]);
    if (Math.abs(value) < 1e-6) return 0;
    return value > 0 ? 1 : 2;
  };
  const onSegment = (p: Vec3, q: Vec3, r: Vec3) =>
    q[0] <= Math.max(p[0], r[0]) + 1e-6 &&
    q[0] + 1e-6 >= Math.min(p[0], r[0]) &&
    q[2] <= Math.max(p[2], r[2]) + 1e-6 &&
    q[2] + 1e-6 >= Math.min(p[2], r[2]);

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function segmentIntersectsExpandedFootprint(start: Vec3, end: Vec3, footprint: Footprint): boolean {
  if (
    pointInsideExpandedFootprint(start, footprint) ||
    pointInsideExpandedFootprint(end, footprint)
  ) {
    return true;
  }

  const left = footprint.cx - footprint.halfW - TEST_OBSTACLE_CLEARANCE;
  const right = footprint.cx + footprint.halfW + TEST_OBSTACLE_CLEARANCE;
  const top = footprint.cz - footprint.halfD - TEST_OBSTACLE_CLEARANCE;
  const bottom = footprint.cz + footprint.halfD + TEST_OBSTACLE_CLEARANCE;
  const epsilon = 0.01;
  const edges: Array<[Vec3, Vec3]> = [
    [
      [left + epsilon, 0, top + epsilon],
      [right - epsilon, 0, top + epsilon],
    ],
    [
      [right - epsilon, 0, top + epsilon],
      [right - epsilon, 0, bottom - epsilon],
    ],
    [
      [right - epsilon, 0, bottom - epsilon],
      [left + epsilon, 0, bottom - epsilon],
    ],
    [
      [left + epsilon, 0, bottom - epsilon],
      [left + epsilon, 0, top + epsilon],
    ],
  ];

  return edges.some(([a, b]) => segmentsIntersect2D(start, end, a, b));
}

function expectRouteToAvoidFootprint(route: Vec3[], footprint: Footprint) {
  for (const point of route) {
    expect(pointInsideExpandedFootprint(point, footprint)).toBe(false);
  }

  for (let i = 1; i < route.length; i += 1) {
    const prev = route[i - 1];
    const current = route[i];
    if (!prev || !current) continue;
    expect(segmentIntersectsExpandedFootprint(prev, current, footprint)).toBe(false);
  }
}

describe('scene-behavior', () => {
  it('buildDispatchRoute creates a believable elbow route from meeting to desk', () => {
    const route = buildDispatchRoute([0, 0, 0], [8, 0, 6], [9, 0, 7]);

    expect(route).toEqual([
      [0, 0, 1.6],
      [8, 0, 1.6],
      [8, 0, 6],
      [9, 0, 7],
    ]);
  });

  it('buildDispatchRoute collapses duplicate points when the path is already mostly straight', () => {
    const route = buildDispatchRoute([0, 0, 0], [0.2, 0, 3], [0.2, 0, 3.2]);

    expect(route).toEqual([
      [0, 0, 1.6],
      [0.2, 0, 3],
      [0.2, 0, 3.2],
    ]);
  });

  it('buildDispatchRoute can route through nav graph waypoints before reaching the target zone', () => {
    const route = buildDispatchRoute([0, 0, 0], [20, 0, 0], [21, 0, 1], {
      zoneWaypoints: [
        [10, 0, 0],
        [16, 0, 0],
      ],
    });

    expect(route).toEqual([
      [0, 0, 1.6],
      [10, 0, 0],
      [16, 0, 0],
      [20, 0, 0],
      [21, 0, 1],
    ]);
  });

  it('buildDispatchRoute inserts a detour when the final approach crosses a furniture footprint', () => {
    const footprint = {
      cx: 10,
      cz: 1.5,
      halfW: 1,
      halfD: 1,
    };
    const route = buildDispatchRoute([0, 0, 0], [10, 0, 0], [10, 0, 3], {
      obstacleFootprints: [footprint],
    });

    expect(route.at(0)).toEqual([0, 0, 1.6]);
    expect(route.at(-1)).toEqual([10, 0, 3]);
    expect(route.length).toBeGreaterThan(3);
    expect(route.some((point) => point[2] !== 1.6 && point[2] !== 3)).toBe(true);
    expectRouteToAvoidFootprint(route, footprint);
  });

  it('buildDispatchRoute can route around a horizontal furniture cluster between meeting and workspace', () => {
    const footprints = [
      {
        cx: -12.5,
        cz: 2,
        halfW: 1.75,
        halfD: 0.55,
      },
      {
        cx: -10,
        cz: 2,
        halfW: 1.75,
        halfD: 0.55,
      },
    ];
    const route = buildDispatchRoute([-10, 0, -8], [-13, 0, 11], [-13, 0, 12.55], {
      zoneWaypoints: [[-10, 0, 2]],
      obstacleFootprints: footprints,
    });

    expect(route.at(-1)).toEqual([-13, 0, 12.55]);
    expect(route.length).toBeGreaterThan(3);
    for (const footprint of footprints) {
      expectRouteToAvoidFootprint(route, footprint);
    }
  });

  it('buildDispatchRoute skips the target zone center when a terminal approach is provided', () => {
    const footprint = {
      cx: -13,
      cz: 11,
      halfW: 1.5,
      halfD: 1.5,
    };
    const route = buildDispatchRoute([-10, 0, -8], [-13, 0, 11], [-13, 0, 12.85], {
      zoneWaypoints: [[-11, 0, 2]],
      obstacleFootprints: [footprint],
      terminalApproach: [-13, 0, 13.2],
    });

    expect(route).toEqual([
      [-10, 0, -6.4],
      [-11, 0, 2],
      [-11, 0, 13.2],
      [-13, 0, 13.2],
      [-13, 0, 12.85],
    ]);
  });

  it('buildWorkActivityTarget nudges search/read/edit/shell into distinct work poses', () => {
    expect(buildWorkActivityTarget([10, 0, 10], 'search')).toEqual([9.35, 0, 10.45]);
    expect(buildWorkActivityTarget([10, 0, 10], 'read')).toEqual([10, 0, 10.5]);
    expect(buildWorkActivityTarget([10, 0, 10], 'edit')).toEqual([10.35, 0, 9.85]);
    expect(buildWorkActivityTarget([10, 0, 10], 'shell')).toEqual([9.7, 0, 9.75]);
  });

  it('buildWorkActivityTarget falls back to the base seat when the pose would enter furniture', () => {
    const base = [10, 0, 10] as const;
    const footprint = { cx: 10.2, cz: 9.9, halfW: 0.4, halfD: 0.4 };
    expect(buildWorkActivityTarget([...base], 'edit', [footprint])).toEqual([10, 0, 10]);
  });

  it('buildReturnToMeetingRoute creates a believable aisle return path for reporting', () => {
    const route = buildReturnToMeetingRoute([9, 0, 7], [0, 0, 0], [1, 0, 1.8]);

    expect(route).toEqual([
      [9, 0, 1.6],
      [1, 0, 1.6],
      [1, 0, 1.8],
    ]);
  });

  it('buildReturnToMeetingRoute can route back through nav graph waypoints', () => {
    const route = buildReturnToMeetingRoute([20, 0, 0], [0, 0, 0], [1, 0, 1.8], {
      zoneWaypoints: [
        [16, 0, 0],
        [10, 0, 0],
      ],
    });

    expect(route).toEqual([
      [20, 0, 1.6],
      [16, 0, 0],
      [10, 0, 0],
      [1, 0, 1.8],
    ]);
  });

  it('buildReturnToMeetingRoute detours around furniture when leaving a workstation', () => {
    const footprint = {
      cx: 10,
      cz: 1.5,
      halfW: 1,
      halfD: 1,
    };
    const route = buildReturnToMeetingRoute([10, 0, 3], [0, 0, 0], [0, 0, 1.8], {
      obstacleFootprints: [footprint],
    });

    expect(route.at(-1)).toEqual([0, 0, 1.8]);
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((point) => point[2] !== 1.8)).toBe(true);
    expectRouteToAvoidFootprint(route, footprint);
  });

  it('buildReturnToMeetingRoute leaves through a departure approach before heading back to meeting', () => {
    const route = buildReturnToMeetingRoute([-13, 0, 12.85], [-10, 0, -8], [-16, 0, -10.5], {
      departureApproach: [-13, 0, 13.2],
    });

    expect(route).toEqual([
      [-13, 0, 13.2],
      [-13, 0, -6.4],
      [-16, 0, -6.4],
      [-16, 0, -10.5],
    ]);
  });

  it('buildApprovalHoldTarget creates readable waiting spots in front of the meeting area', () => {
    expect(buildApprovalHoldTarget([0, 0, 0], 0)).toEqual([-0.75, 0, -1.9]);
    expect(buildApprovalHoldTarget([0, 0, 0], 1)).toEqual([0, 0, -1.9]);
    expect(buildApprovalHoldTarget([0, 0, 0], 2)).toEqual([0.75, 0, -1.9]);
  });

  it('buildClarificationHoldTarget mirrors approval hold positions on the far side of the meeting area', () => {
    expect(buildClarificationHoldTarget([0, 0, 0], 0)).toEqual([-0.75, 0, 2.1]);
    expect(buildClarificationHoldTarget([0, 0, 0], 1)).toEqual([0, 0, 2.1]);
    expect(buildClarificationHoldTarget([0, 0, 0], 2)).toEqual([0.75, 0, 2.1]);
  });

  it('buildHandoffRoute passes through a meeting-edge transfer point before reaching the target', () => {
    const route = buildHandoffRoute([8, 0, 6], [16, 0, 8], [0, 0, 0]);

    expect(route).toEqual([
      [8, 0, 6],
      [8, 0, 1.6],
      [0, 0, 1.6],
      [16, 0, 1.6],
      [16, 0, 8],
    ]);
  });

  it('buildTransitRoute can detour around a footprint on direct reset-to-rest movement', () => {
    const footprint = {
      cx: 10,
      cz: 6,
      halfW: 1,
      halfD: 1,
    };
    const route = buildTransitRoute([8, 0, 6], [12, 0, 6], {
      obstacleFootprints: [footprint],
    });

    expect(route.at(0)).toEqual([8, 0, 6]);
    expect(route.at(-1)).toEqual([12, 0, 6]);
    expect(route.length).toBeGreaterThan(2);
    expect(
      route.some((point, index) => index > 0 && index < route.length - 1 && point[2] !== 6),
    ).toBe(true);
    expectRouteToAvoidFootprint(route, footprint);
  });

  it('buildManagerPresenceTarget returns distinct anchor points for analysis, planning, and reporting', () => {
    expect(buildManagerPresenceTarget([0, 0, 0], 'analyzing')).toEqual([0, 0, -3.1]);
    expect(buildManagerPresenceTarget([0, 0, 0], 'planning')).toEqual([1.4, 0, -2.4]);
    expect(buildManagerPresenceTarget([0, 0, 0], 'reporting')).toEqual([0, 0, -3.1]);
  });

  it('buildStalledWorkTarget separates blocked and failed poses around the desk', () => {
    expect(buildStalledWorkTarget([10, 0, 10], 'blocked')).toEqual([9.55, 0, 10.65]);
    expect(buildStalledWorkTarget([10, 0, 10], 'failed')).toEqual([10.45, 0, 10.55]);
  });

  it('buildStalledWorkTarget falls back to the base seat when the pose would enter furniture', () => {
    const base = [10, 0, 10] as const;
    const footprint = { cx: 9.6, cz: 10.7, halfW: 0.4, halfD: 0.4 };
    expect(buildStalledWorkTarget([...base], 'blocked', [footprint])).toEqual([10, 0, 10]);
  });

  it('moveThroughPoints walks points in order and only fires onComplete once', () => {
    const visited: [number, number, number][] = [];
    let completeCount = 0;

    moveThroughPoints(
      {
        moveTo(dest, _speed, onArrive) {
          visited.push(dest);
          onArrive?.();
        },
      },
      [
        [1, 0, 1],
        [2, 0, 2],
        [3, 0, 3],
      ],
      4,
      () => {
        completeCount += 1;
      },
    );

    expect(visited).toEqual([
      [1, 0, 1],
      [2, 0, 2],
      [3, 0, 3],
    ]);
    expect(completeCount).toBe(1);
  });
});
