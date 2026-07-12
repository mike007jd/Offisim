export type WorkspaceLeaseDecisionAction = 'merge' | 'discard';

interface InFlightDecision<Outcome> {
  action: WorkspaceLeaseDecisionAction;
  promise: Promise<Outcome>;
}

export class WorkspaceLeaseDecisionCoordinator<Outcome> {
  private readonly decisions = new Map<string, InFlightDecision<Outcome>>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  actionFor(leaseId: string): WorkspaceLeaseDecisionAction | null {
    return this.decisions.get(leaseId)?.action ?? null;
  }

  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  run(
    leaseId: string,
    action: WorkspaceLeaseDecisionAction,
    execute: () => Promise<Outcome>,
  ): Promise<Outcome> {
    const active = this.decisions.get(leaseId);
    if (active) return active.promise;

    const tracked = Promise.resolve()
      .then(execute)
      .finally(() => {
        if (this.decisions.get(leaseId)?.promise !== tracked) return;
        this.decisions.delete(leaseId);
        this.emit();
      });
    this.decisions.set(leaseId, { action, promise: tracked });
    this.emit();
    return tracked;
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
