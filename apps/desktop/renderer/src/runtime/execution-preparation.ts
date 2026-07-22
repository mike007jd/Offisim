import {
  type TurnExecutionProvenance,
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
} from './execution-provenance.js';
import type { PiAgentHostEvent } from './pi-runtime-driver.js';

export type ExecutionPreparedEvent = Extract<PiAgentHostEvent, { kind: 'executionPrepared' }>;

export interface ExecutionPreparationRecord {
  readonly targetDigest: string;
  readonly identity: TurnExecutionProvenance;
  readonly promise: Promise<void>;
}

export function parsePreparedExecutionIdentity(
  event: ExecutionPreparedEvent,
): TurnExecutionProvenance {
  const identity = requireTurnExecutionProvenance(event.identity, event.runId);
  if (
    !identity.adapter ||
    identity.adapter.id !== event.adapter.id ||
    identity.adapter.version !== event.adapter.version
  ) {
    throw new Error('Agent runtime adapter identity changed during execution preparation.');
  }
  return identity;
}

export function requirePreparedExecutionIdentity(
  preparations: ReadonlyMap<string, ExecutionPreparationRecord>,
  runId: string,
): TurnExecutionProvenance {
  const matching = [...preparations.values()].filter((entry) => entry.identity.runId === runId);
  const expected = matching[0]?.identity;
  if (!expected?.adapter) {
    throw new Error('Agent runtime returned a result without a prepared adapter identity.');
  }
  for (const entry of matching.slice(1)) {
    assertSameExecutionAccount(expected, entry.identity);
  }
  return expected;
}

export function requireRootResultProvenance(
  value: unknown,
  rootRunId: string,
  preparations: ReadonlyMap<string, ExecutionPreparationRecord>,
  orchestrationShell: boolean,
): TurnExecutionProvenance {
  const actual = requireTurnExecutionProvenance(value, orchestrationShell ? undefined : rootRunId);
  assertSameExecutionAccount(requirePreparedExecutionIdentity(preparations, actual.runId), actual);
  return orchestrationShell ? { ...actual, runId: rootRunId } : actual;
}
