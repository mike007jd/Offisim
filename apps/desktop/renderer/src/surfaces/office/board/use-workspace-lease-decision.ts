import { useSyncExternalStore } from 'react';
import {
  subscribeWorkspaceLeaseDecisions,
  workspaceLeaseDecisionAction,
  workspaceLeaseDecisionVersion,
} from './workspace-lease-actions.js';
import type { WorkspaceLeaseDecisionAction } from './workspace-lease-decision-coordinator.js';

export function useWorkspaceLeaseDecision(
  leaseId: string | null,
): WorkspaceLeaseDecisionAction | null {
  useSyncExternalStore(
    subscribeWorkspaceLeaseDecisions,
    workspaceLeaseDecisionVersion,
    workspaceLeaseDecisionVersion,
  );
  return leaseId ? workspaceLeaseDecisionAction(leaseId) : null;
}

export function useWorkspaceLeaseDecisionVersion(): void {
  useSyncExternalStore(
    subscribeWorkspaceLeaseDecisions,
    workspaceLeaseDecisionVersion,
    workspaceLeaseDecisionVersion,
  );
}
