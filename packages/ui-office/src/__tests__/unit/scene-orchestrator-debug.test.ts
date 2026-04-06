import { describe, expect, it } from 'vitest';
import {
  clearCompanyState,
  getMovementDebugInfo,
  registerMovementHandle,
  unregisterMovementHandle,
} from '../../hooks/useSceneOrchestrator';

describe('scene orchestrator debug bridge helpers', () => {
  it('returns live movement positions and moving state for registered employees', () => {
    const companyId = 'debug-co';
    clearCompanyState(companyId);

    registerMovementHandle(companyId, 'emp-1', {
      moveTo() {},
      stop() {},
      isMoving() {
        return true;
      },
      getPosition() {
        return [3, 0, 7];
      },
    });

    expect(getMovementDebugInfo(companyId)).toEqual([
      {
        id: 'emp-1',
        x: 3,
        y: 7,
        isMoving: true,
      },
    ]);

    unregisterMovementHandle(companyId, 'emp-1');
    clearCompanyState(companyId);
  });

  it('skips handles that do not have a current world position', () => {
    const companyId = 'debug-empty';
    clearCompanyState(companyId);

    registerMovementHandle(companyId, 'emp-2', {
      moveTo() {},
      stop() {},
      isMoving() {
        return false;
      },
      getPosition() {
        return null;
      },
    });

    expect(getMovementDebugInfo(companyId)).toEqual([]);

    unregisterMovementHandle(companyId, 'emp-2');
    clearCompanyState(companyId);
  });
});
