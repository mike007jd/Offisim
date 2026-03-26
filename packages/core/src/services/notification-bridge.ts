import type {
  EmployeeStatePayload,
  ErrorOccurredPayload,
  HrAssessmentCompletedPayload,
  InstallStatePayload,
  PlanCompletedPayload,
  RuntimeEvent,
} from '@aics/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { notificationCreated } from '../events/event-factories.js';
import { generateId } from '../utils/generate-id.js';

/**
 * NotificationBridge subscribes to runtime events and converts them into
 * user-facing notification events (notification.created).
 *
 * This bridges the gap between low-level runtime events and the
 * NotificationCenter UI that listens for `notification.*` events.
 */
export class NotificationBridge {
  private unsubscribers: (() => void)[] = [];
  private companyId: string;

  constructor(
    private eventBus: EventBus,
    companyId: string,
  ) {
    this.companyId = companyId;
  }

  activate(): void {
    // Guard against double activation
    if (this.unsubscribers.length > 0) return;

    // employee.state.changed → blocked / failed
    this.unsubscribers.push(
      this.eventBus.on('employee.state.changed', (event: RuntimeEvent<EmployeeStatePayload>) => {
        const { next, employeeId } = event.payload;
        if (next === 'blocked') {
          this.emitNotification(
            'warning',
            `Employee ${employeeId} is blocked`,
            `Employee ${employeeId} has been blocked and cannot continue working.`,
            'runtime',
            { employeeId },
          );
        } else if (next === 'failed') {
          this.emitNotification(
            'error',
            `Employee ${employeeId} failed`,
            `Employee ${employeeId} encountered a failure.`,
            'runtime',
            { employeeId },
          );
        }
      }),
    );

    // install.state.changed → installed / failed
    this.unsubscribers.push(
      this.eventBus.on('install.state.changed', (event: RuntimeEvent<InstallStatePayload>) => {
        const { next, errorCode } = event.payload;
        if (next === 'installed') {
          this.emitNotification(
            'success',
            'Asset installed successfully',
            'The asset has been installed and is ready to use.',
            'install',
          );
        } else if (next === 'failed') {
          const reason = errorCode ?? 'unknown error';
          this.emitNotification(
            'error',
            'Installation failed',
            `Installation failed: ${reason}`,
            'install',
          );
        }
      }),
    );

    // plan.completed
    this.unsubscribers.push(
      this.eventBus.on('plan.completed', (_event: RuntimeEvent<PlanCompletedPayload>) => {
        this.emitNotification(
          'success',
          'Task plan completed',
          'All steps in the task plan have been completed.',
          'runtime',
        );
      }),
    );

    // error.occurred (high severity — non-recoverable errors)
    this.unsubscribers.push(
      this.eventBus.on('error.occurred', (event: RuntimeEvent<ErrorOccurredPayload>) => {
        const { message, recoverable } = event.payload;
        if (!recoverable) {
          this.emitNotification('error', 'Runtime error', `Runtime error: ${message}`, 'runtime');
        }
      }),
    );

    // hr.assessment.completed
    this.unsubscribers.push(
      this.eventBus.on(
        'hr.assessment.completed',
        (_event: RuntimeEvent<HrAssessmentCompletedPayload>) => {
          this.emitNotification(
            'info',
            'HR assessment ready',
            'The HR assessment has been completed and is ready for review.',
            'hr',
          );
        },
      ),
    );
  }

  deactivate(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private emitNotification(
    level: 'info' | 'success' | 'warning' | 'error',
    title: string,
    message: string,
    source: 'runtime' | 'market' | 'install' | 'hr',
    opts?: { employeeId?: string },
  ): void {
    const notifId = generateId('notif');
    this.eventBus.emit(
      notificationCreated(this.companyId, notifId, level, title, message, source, {
        employeeId: opts?.employeeId,
      }),
    );
  }
}
