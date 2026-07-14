export type WorkspaceBindingStreamGate<TClaim, TUnavailable = never> =
  | { status: 'pending'; claim: null; unavailable: null }
  | { status: 'bound'; claim: TClaim; unavailable: null }
  | { status: 'unavailable'; claim: null; unavailable: TUnavailable }
  | { status: 'rejected'; claim: null; unavailable: null };

export type WorkspaceStreamConsumptionPolicy =
  | 'bound-required'
  | 'workspace-optional'
  | 'terminal-reconcile';

export interface WorkspaceGatedEvent {
  kind: string;
  toolName?: string;
}

export function createWorkspaceBindingGate<
  TClaim,
  TUnavailable = never,
>(): WorkspaceBindingStreamGate<TClaim, TUnavailable> {
  return { status: 'pending', claim: null, unavailable: null };
}

/**
 * Advance a stream's binding state exactly once. Any mismatched claim poisons
 * the stream permanently; a later matching replay cannot make earlier events
 * trustworthy again.
 */
export function acceptWorkspaceBinding<TClaim, TUnavailable>(
  gate: WorkspaceBindingStreamGate<TClaim, TUnavailable>,
  claim: TClaim,
  matchesExpectedTurn: boolean,
  matchesBoundClaim: boolean,
): WorkspaceBindingStreamGate<TClaim, TUnavailable> {
  if (gate.status === 'rejected') return gate;
  if (!matchesExpectedTurn || !matchesBoundClaim) {
    return { status: 'rejected', claim: null, unavailable: null };
  }
  if (gate.status === 'bound') return gate;
  if (gate.status === 'unavailable') {
    return { status: 'rejected', claim: null, unavailable: null };
  }
  return { status: 'bound', claim, unavailable: null };
}

/**
 * Declare that this stream is intentionally running without project-file
 * authority. Like a binding, the declaration is immutable: a later binding or
 * a different unavailable explanation poisons the stream.
 */
export function acceptWorkspaceUnavailable<TClaim, TUnavailable>(
  gate: WorkspaceBindingStreamGate<TClaim, TUnavailable>,
  unavailable: TUnavailable,
  matchesExpectedTurn: boolean,
  matchesUnavailable: boolean,
): WorkspaceBindingStreamGate<TClaim, TUnavailable> {
  if (gate.status === 'rejected') return gate;
  if (!matchesExpectedTurn || !matchesUnavailable || gate.status === 'bound') {
    return { status: 'rejected', claim: null, unavailable: null };
  }
  if (gate.status === 'unavailable') return gate;
  return { status: 'unavailable', claim: null, unavailable };
}

export function rejectWorkspaceBinding<TClaim, TUnavailable>(
  gate: WorkspaceBindingStreamGate<TClaim, TUnavailable>,
): WorkspaceBindingStreamGate<TClaim, TUnavailable> {
  if (gate.status === 'rejected') return gate;
  return { status: 'rejected', claim: null, unavailable: null };
}

/**
 * Live/new/resumed streams require a verified claim before any runtime fact is
 * consumed. A snapshot that was already terminal is the sole exception: when
 * no claim was replayed at all, its result/error may reconcile durable history.
 */
export function canConsumeWorkspaceEvent<TClaim, TUnavailable>(
  gate: WorkspaceBindingStreamGate<TClaim, TUnavailable>,
  event: string | WorkspaceGatedEvent,
  policy: WorkspaceStreamConsumptionPolicy,
): boolean {
  const eventKind = typeof event === 'string' ? event : event.kind;
  if (gate.status === 'rejected') return false;
  if (gate.status === 'bound') return true;
  if (gate.status === 'unavailable') {
    if (policy === 'bound-required') return eventKind === 'error';
    if (eventKind === 'tool') {
      return typeof event !== 'string' && event.toolName === 'project_workspace_required';
    }
    return (
      eventKind === 'started' ||
      eventKind === 'messageDelta' ||
      eventKind === 'messageEnd' ||
      eventKind === 'result' ||
      eventKind === 'error'
    );
  }
  return policy === 'terminal-reconcile' && (eventKind === 'result' || eventKind === 'error');
}
