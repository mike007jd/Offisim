import {
  type TaskWorkspaceBindingClaim,
  parseWorkspaceBoundProvenance,
} from '@/lib/tauri-commands.js';
import type {
  WorkspaceBoundProvenance,
  WorkspaceProvenance,
  WorkspaceUnavailableProvenance,
} from '@offisim/shared-types';
import type { WorkspaceUnavailableEvent } from './pi-runtime-driver.js';

export type WorkspaceRequirement = WorkspaceUnavailableProvenance['requirement'];

export function notableWorkspaceProvenanceForBinding(
  binding: TaskWorkspaceBindingClaim,
): WorkspaceBoundProvenance | null {
  const provenance = parseWorkspaceBoundProvenance(
    binding.source,
    binding.reasonCode,
    binding.displayPath,
  );
  if (
    provenance?.source === 'project_catalog' &&
    provenance.reasonCode === 'current_project_folder'
  ) {
    return null;
  }
  return provenance;
}

export function workspaceProvenanceForUnavailable(
  event: WorkspaceUnavailableEvent,
  requirement: WorkspaceRequirement,
): WorkspaceUnavailableProvenance {
  return {
    availability: 'unavailable',
    source: event.source,
    reasonCode: event.reasonCode,
    requirement,
  };
}

export function parseWorkspaceProvenance(value: unknown): WorkspaceProvenance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.availability === 'bound') {
    return parseWorkspaceBoundProvenance(record.source, record.reasonCode, record.displayPath);
  }
  if (
    record.availability === 'unavailable' &&
    record.source === 'workspace_recovery' &&
    (record.reasonCode === 'none' || record.reasonCode === 'ambiguous') &&
    (record.requirement === 'optional' || record.requirement === 'required')
  ) {
    return {
      availability: record.availability,
      source: record.source,
      reasonCode: record.reasonCode,
      requirement: record.requirement,
    };
  }
  return null;
}
