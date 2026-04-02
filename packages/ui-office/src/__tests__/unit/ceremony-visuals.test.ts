import { describe, expect, it } from 'vitest';
import type { WaitingRelationship } from '../../hooks/useSceneOrchestrator';
import {
  addWaitingRelationship,
  describeWaitingRelationship,
  getInteractionKindLabel,
  removeWaitingRelationship,
} from '../../lib/ceremony-visuals';

describe('ceremony-visuals', () => {
  it('maps interaction kinds and handoff to readable labels', () => {
    expect(getInteractionKindLabel('permission_request')).toBe('等待审批');
    expect(getInteractionKindLabel('plan_review')).toBe('等待审阅');
    expect(getInteractionKindLabel('agent_question')).toBe('等待澄清');
    expect(getInteractionKindLabel('handoff')).toBe('等待交接');
  });

  it('formats waiting relationships for bubble display', () => {
    const reviewRel: WaitingRelationship = {
      waiterId: 'emp-1',
      waiterName: 'Ava',
      waitingFor: 'user',
      kind: 'plan_review',
    };
    const handoffRel = {
      waiterId: 'emp-2',
      waiterName: 'Ben',
      waitingFor: 'emp-1',
      kind: 'handoff',
      waitingForName: 'Ava',
    } as WaitingRelationship & { waitingForName: string };

    expect(describeWaitingRelationship(reviewRel, new Map())).toBe('Ava → 等待审阅');
    expect(describeWaitingRelationship(handoffRel, new Map())).toBe('Ben → 等待 Ava');
  });

  it('adds and removes waiting relationships without duplicating waiter entries', () => {
    const first: WaitingRelationship = {
      waiterId: 'emp-1',
      waiterName: 'Ava',
      waitingFor: 'user',
      kind: 'permission_request',
    };
    const replacement: WaitingRelationship = {
      waiterId: 'emp-1',
      waiterName: 'Ava',
      waitingFor: 'user',
      kind: 'agent_question',
    };

    const withFirst = addWaitingRelationship([], first);
    const withReplacement = addWaitingRelationship(withFirst, replacement);

    expect(withReplacement).toEqual([replacement]);
    expect(removeWaitingRelationship(withReplacement, 'emp-1')).toEqual([]);
  });
});
