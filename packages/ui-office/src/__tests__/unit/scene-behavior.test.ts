import { describe, expect, it } from 'vitest';
import {
  buildApprovalHoldTarget,
  buildDispatchRoute,
  buildReturnToMeetingRoute,
  buildStalledWorkTarget,
  buildWorkActivityTarget,
  moveThroughPoints,
} from '../../lib/scene-behavior';

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
    ]);
  });

  it('buildWorkActivityTarget nudges search/read/edit/shell into distinct work poses', () => {
    expect(buildWorkActivityTarget([10, 0, 10], 'search')).toEqual([9.35, 0, 10.45]);
    expect(buildWorkActivityTarget([10, 0, 10], 'read')).toEqual([10, 0, 10.5]);
    expect(buildWorkActivityTarget([10, 0, 10], 'edit')).toEqual([10.35, 0, 9.85]);
    expect(buildWorkActivityTarget([10, 0, 10], 'shell')).toEqual([9.7, 0, 9.75]);
  });

  it('buildReturnToMeetingRoute creates a believable aisle return path for reporting', () => {
    const route = buildReturnToMeetingRoute([9, 0, 7], [0, 0, 0], [1, 0, 1.8]);

    expect(route).toEqual([
      [9, 0, 1.6],
      [1, 0, 1.6],
    ]);
  });

  it('buildApprovalHoldTarget creates readable waiting spots in front of the meeting area', () => {
    expect(buildApprovalHoldTarget([0, 0, 0], 0)).toEqual([-0.75, 0, -1.9]);
    expect(buildApprovalHoldTarget([0, 0, 0], 1)).toEqual([0, 0, -1.9]);
    expect(buildApprovalHoldTarget([0, 0, 0], 2)).toEqual([0.75, 0, -1.9]);
  });

  it('buildStalledWorkTarget separates blocked and failed poses around the desk', () => {
    expect(buildStalledWorkTarget([10, 0, 10], 'blocked')).toEqual([9.55, 0, 10.65]);
    expect(buildStalledWorkTarget([10, 0, 10], 'failed')).toEqual([10.45, 0, 10.55]);
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
