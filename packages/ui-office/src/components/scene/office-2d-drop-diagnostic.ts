/**
 * In-memory ring buffer for 2D canvas employee→zone drop diagnostics.
 *
 * Owned by `useCanvasInteraction`; consumed by Settings → Runtime "Export 2D
 * drop diagnostic" button. Contract: `scene-2d-employee-drop` capability spec.
 *
 * - Cap 10 attempts; oldest evicted on overflow.
 * - All recorder calls are wrapped in try/catch — instrumentation can never
 *   break the drop pipeline.
 * - Snapshot omits employee `name` / `persona` / `appearance` (PII redaction);
 *   only `employeeId` is captured.
 */
import type { HitResult } from './office-2d-hitmap';

export type DropAttemptOutcome =
  | 'pending'
  | 'click'
  | 'drop-emitted'
  | 'drop-suppressed-source-zone'
  | 'drop-suppressed-not-droppable'
  | 'drop-suppressed-empty'
  | 'cancel-leave'
  | 'cancel-escape'
  | 'cancel-lost-capture';

export type CancellationReason = 'leave' | 'escape' | 'lost-capture';

interface PointerEventSummary {
  timestamp: number;
  pointerId: number;
  screenX: number;
  screenY: number;
  canvasX: number | null;
  canvasY: number | null;
}

export interface DropAttemptDiagnostic {
  attemptId: string;
  startedAt: number;
  endedAt: number | null;
  employeeId: string;
  sourceZoneId: string;
  dropTargetZoneIdsAtDown: ReadonlyArray<string>;
  dropTargetZoneIdsAtUp: ReadonlyArray<string> | null;
  down: PointerEventSummary;
  move: PointerEventSummary | null;
  up: PointerEventSummary | null;
  hitResult: HitResult | null;
  outcome: DropAttemptOutcome;
  emittedDropEvent: boolean;
  cancellationReason: CancellationReason | null;
}

const RING_BUFFER_CAP = 10;
const ringBuffer: DropAttemptDiagnostic[] = [];

function pushAttempt(entry: DropAttemptDiagnostic): void {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_CAP) {
    ringBuffer.splice(0, ringBuffer.length - RING_BUFFER_CAP);
  }
}

function findAttempt(attemptId: string): DropAttemptDiagnostic | undefined {
  for (let i = ringBuffer.length - 1; i >= 0; i--) {
    const entry = ringBuffer[i];
    if (entry?.attemptId === attemptId) return entry;
  }
  return undefined;
}

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
}

function summarize(
  event: PointerLike,
  canvasX: number | null,
  canvasY: number | null,
): PointerEventSummary {
  return {
    timestamp: Date.now(),
    pointerId: event.pointerId,
    screenX: event.clientX,
    screenY: event.clientY,
    canvasX,
    canvasY,
  };
}

export function recordPointerDown(
  attemptId: string,
  event: PointerLike,
  canvasX: number | null,
  canvasY: number | null,
  employeeId: string,
  sourceZoneId: string,
  dropTargetZoneIds: ReadonlyArray<string>,
): void {
  try {
    const entry: DropAttemptDiagnostic = {
      attemptId,
      startedAt: Date.now(),
      endedAt: null,
      employeeId,
      sourceZoneId,
      dropTargetZoneIdsAtDown: [...dropTargetZoneIds],
      dropTargetZoneIdsAtUp: null,
      down: summarize(event, canvasX, canvasY),
      move: null,
      up: null,
      hitResult: null,
      outcome: 'pending',
      emittedDropEvent: false,
      cancellationReason: null,
    };
    pushAttempt(entry);
  } catch {
    /* swallow */
  }
}

export function recordPointerMoveActive(
  attemptId: string,
  event: PointerLike,
  canvasX: number | null,
  canvasY: number | null,
): void {
  try {
    const entry = findAttempt(attemptId);
    if (!entry) return;
    entry.move = summarize(event, canvasX, canvasY);
  } catch {
    /* swallow */
  }
}

export function recordPointerUp(
  attemptId: string,
  event: PointerLike,
  canvasX: number | null,
  canvasY: number | null,
  hitResult: HitResult | null,
  dropTargetZoneIdsAtUp: ReadonlyArray<string>,
  outcome: DropAttemptOutcome,
  emittedDropEvent: boolean,
): void {
  try {
    const entry = findAttempt(attemptId);
    if (!entry) return;
    entry.up = summarize(event, canvasX, canvasY);
    entry.hitResult = hitResult;
    entry.dropTargetZoneIdsAtUp = [...dropTargetZoneIdsAtUp];
    entry.outcome = outcome;
    entry.emittedDropEvent = emittedDropEvent;
    entry.endedAt = Date.now();
  } catch {
    /* swallow */
  }
}

export function recordCancellation(attemptId: string, reason: CancellationReason): void {
  try {
    const entry = findAttempt(attemptId);
    if (!entry) return;
    entry.cancellationReason = reason;
    entry.outcome =
      reason === 'leave'
        ? 'cancel-leave'
        : reason === 'escape'
          ? 'cancel-escape'
          : 'cancel-lost-capture';
    entry.endedAt = Date.now();
  } catch {
    /* swallow */
  }
}

export function exportLatest(): string {
  const payload = {
    version: 1 as const,
    capturedAt: Date.now(),
    attempts: ringBuffer.map((entry) => ({ ...entry })),
  };
  return JSON.stringify(payload, null, 2);
}

/** Test / debug only — drains the ring buffer in place. */
export function __resetDiagnosticBufferForTests(): void {
  ringBuffer.length = 0;
}
