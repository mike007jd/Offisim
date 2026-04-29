/**
 * Shared helper for emitting `task.assignment.rerouted` events.
 *
 * Both manager-node and pm-planner/sanitize-rebind override an LLM-chosen
 * assignment in the same shape: emit the structured event on the bus +
 * log an info-level mirror so headless / CI runs surface the rebind.
 * Centralising the call keeps the two sites from drifting on the
 * payload shape or log key naming.
 */

import type {
  TaskAssignmentRerouteReason,
  TaskAssignmentRerouteSource,
} from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { taskAssignmentRerouted } from '../events/event-factories.js';
import { Logger } from '../services/logger.js';

const loggerByName = new Map<string, Logger>();

function loggerFor(source: TaskAssignmentRerouteSource): Logger {
  const name = source === 'manager' ? 'manager' : 'pm-planner';
  let logger = loggerByName.get(name);
  if (!logger) {
    logger = new Logger(name);
    loggerByName.set(name, logger);
  }
  return logger;
}

export interface EmitAssignmentReroutedInput {
  readonly companyId: string;
  readonly threadId: string;
  readonly taskRunId: string;
  readonly requestedEmployeeId: string;
  readonly resolvedEmployeeId: string;
  readonly reason: TaskAssignmentRerouteReason;
  readonly source: TaskAssignmentRerouteSource;
  readonly eventBus: EventBus;
}

/**
 * Emit a `task.assignment.rerouted` event + matching `logger.info` mirror.
 * Object-param signature so call sites can't accidentally swap the two
 * adjacent employee-id strings.
 */
export function emitAssignmentRerouted(input: EmitAssignmentReroutedInput): void {
  const {
    companyId,
    threadId,
    taskRunId,
    requestedEmployeeId,
    resolvedEmployeeId,
    reason,
    source,
    eventBus,
  } = input;
  eventBus.emit(
    taskAssignmentRerouted(
      companyId,
      taskRunId,
      requestedEmployeeId,
      resolvedEmployeeId,
      reason,
      threadId,
      source,
    ),
  );
  loggerFor(source).info(`${source}.assignment.rerouted`, {
    taskRunId,
    requestedEmployeeId,
    resolvedEmployeeId,
    reason,
    threadId,
    companyId,
  });
}
