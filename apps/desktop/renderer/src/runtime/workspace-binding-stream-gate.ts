export type WorkspaceBindingStreamGate<TClaim> =
  | { status: 'pending'; claim: null }
  | { status: 'bound'; claim: TClaim }
  | { status: 'rejected'; claim: null };

export type WorkspaceStreamConsumptionPolicy = 'bound-required' | 'terminal-reconcile';

export function createWorkspaceBindingGate<TClaim>(): WorkspaceBindingStreamGate<TClaim> {
  return { status: 'pending', claim: null };
}

/**
 * Advance a stream's binding state exactly once. Any mismatched claim poisons
 * the stream permanently; a later matching replay cannot make earlier events
 * trustworthy again.
 */
export function acceptWorkspaceBinding<TClaim>(
  gate: WorkspaceBindingStreamGate<TClaim>,
  claim: TClaim,
  matchesExpectedTurn: boolean,
  matchesBoundClaim: boolean,
): WorkspaceBindingStreamGate<TClaim> {
  if (gate.status === 'rejected') return gate;
  if (!matchesExpectedTurn || !matchesBoundClaim) {
    return { status: 'rejected', claim: null };
  }
  if (gate.status === 'bound') return gate;
  return { status: 'bound', claim };
}

export function rejectWorkspaceBinding<TClaim>(
  gate: WorkspaceBindingStreamGate<TClaim>,
): WorkspaceBindingStreamGate<TClaim> {
  if (gate.status === 'rejected') return gate;
  return { status: 'rejected', claim: null };
}

/**
 * Live/new/resumed streams require a verified claim before any runtime fact is
 * consumed. A snapshot that was already terminal is the sole exception: when
 * no claim was replayed at all, its result/error may reconcile durable history.
 */
export function canConsumeWorkspaceEvent<TClaim>(
  gate: WorkspaceBindingStreamGate<TClaim>,
  eventKind: string,
  policy: WorkspaceStreamConsumptionPolicy,
): boolean {
  if (gate.status === 'rejected') return false;
  if (gate.status === 'bound') return true;
  return policy === 'terminal-reconcile' && (eventKind === 'result' || eventKind === 'error');
}
