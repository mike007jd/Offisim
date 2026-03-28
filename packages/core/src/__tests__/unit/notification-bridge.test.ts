import type { RuntimeEvent } from '@offisim/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import {
  employeeStateChanged,
  errorOccurred,
  hrAssessmentCompleted,
  installStateChanged,
  planCompleted,
} from '../../events/event-factories.js';
import { NotificationBridge } from '../../services/notification-bridge.js';

const COMPANY_ID = 'company-test';

type NotificationPayload = {
  level: 'warning' | 'error' | 'success' | 'info';
  title?: string;
  source?: string;
  employeeId?: string;
  message?: string;
};

describe('NotificationBridge', () => {
  let eventBus: InMemoryEventBus;
  let bridge: NotificationBridge;
  let notifications: RuntimeEvent<NotificationPayload>[];

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    bridge = new NotificationBridge(eventBus, COMPANY_ID);
    notifications = [];

    // Collect emitted notifications
    eventBus.on('notification.created', (event) => {
      notifications.push(event);
    });

    bridge.activate();
  });

  describe('employee.state.changed → notification', () => {
    it('emits warning notification when employee becomes blocked', () => {
      eventBus.emit(employeeStateChanged(COMPANY_ID, 'emp-1', 'executing', 'blocked', 'thread-1'));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('warning');
      expect(notifications[0]?.payload.title).toContain('emp-1');
      expect(notifications[0]?.payload.title).toContain('blocked');
      expect(notifications[0]?.payload.source).toBe('runtime');
      expect(notifications[0]?.payload.employeeId).toBe('emp-1');
    });

    it('emits error notification when employee fails', () => {
      eventBus.emit(employeeStateChanged(COMPANY_ID, 'emp-2', 'executing', 'failed', 'thread-1'));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('error');
      expect(notifications[0]?.payload.title).toContain('emp-2');
      expect(notifications[0]?.payload.title).toContain('failed');
    });

    it('does NOT emit notification for normal state transitions', () => {
      eventBus.emit(employeeStateChanged(COMPANY_ID, 'emp-3', 'idle', 'executing', 'thread-1'));

      expect(notifications).toHaveLength(0);
    });
  });

  describe('install.state.changed → notification', () => {
    it('emits success notification when install completes', () => {
      eventBus.emit(
        installStateChanged(COMPANY_ID, 'txn-1', 'materializing', 'installed', 'thread-1', 'pkg-1'),
      );

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('success');
      expect(notifications[0]?.payload.title).toContain('installed');
      expect(notifications[0]?.payload.source).toBe('install');
    });

    it('emits error notification when install fails', () => {
      eventBus.emit(
        installStateChanged(
          COMPANY_ID,
          'txn-1',
          'materializing',
          'failed',
          'thread-1',
          'pkg-1',
          'COMPAT_ERROR',
        ),
      );

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('error');
      expect(notifications[0]?.payload.message).toContain('COMPAT_ERROR');
    });
  });

  describe('plan.completed → notification', () => {
    it('emits success notification when plan completes', () => {
      eventBus.emit(planCompleted(COMPANY_ID, 'plan-1', 3, 'thread-1'));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('success');
      expect(notifications[0]?.payload.title).toContain('plan completed');
    });
  });

  describe('error.occurred → notification', () => {
    it('emits error notification for non-recoverable errors', () => {
      eventBus.emit(errorOccurred(COMPANY_ID, 'LLM_TIMEOUT', 'Model timed out', false, 'employee'));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('error');
      expect(notifications[0]?.payload.message).toContain('Model timed out');
    });

    it('does NOT emit notification for recoverable errors', () => {
      eventBus.emit(errorOccurred(COMPANY_ID, 'LLM_RETRY', 'Retrying...', true, 'employee'));

      expect(notifications).toHaveLength(0);
    });
  });

  describe('hr.assessment.completed → notification', () => {
    it('emits info notification when HR assessment completes', () => {
      eventBus.emit(
        hrAssessmentCompleted(COMPANY_ID, 'assess_team', 'Team looks solid', 'thread-1'),
      );

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload.level).toBe('info');
      expect(notifications[0]?.payload.title).toContain('HR assessment');
      expect(notifications[0]?.payload.source).toBe('hr');
    });
  });

  describe('lifecycle', () => {
    it('does not emit notifications after deactivate', () => {
      bridge.deactivate();

      eventBus.emit(planCompleted(COMPANY_ID, 'plan-1', 3, 'thread-1'));
      expect(notifications).toHaveLength(0);
    });

    it('guards against double activation', () => {
      // Activate again — should not double-subscribe
      bridge.activate();

      eventBus.emit(planCompleted(COMPANY_ID, 'plan-1', 3, 'thread-1'));
      // Should be 1, not 2
      expect(notifications).toHaveLength(1);
    });

    it('can reactivate after deactivate', () => {
      bridge.deactivate();
      bridge.activate();

      eventBus.emit(planCompleted(COMPANY_ID, 'plan-1', 3, 'thread-1'));
      expect(notifications).toHaveLength(1);
    });
  });
});
