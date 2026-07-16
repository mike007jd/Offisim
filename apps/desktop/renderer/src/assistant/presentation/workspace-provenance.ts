import type { WorkspaceProvenance } from '@offisim/shared-types';

function assertNever(value: never): never {
  throw new Error(`Unhandled workspace provenance: ${JSON.stringify(value)}`);
}

function boundReason(provenance: Extract<WorkspaceProvenance, { availability: 'bound' }>): string {
  switch (provenance.reasonCode) {
    case 'current_project_folder':
      return 'the current Project folder is available';
    case 'recent_successful_workspace':
      return 'the last successful Conversation workspace still matches';
    case 'renamed_same_filesystem_object':
      return 'the Project folder moved or was renamed, and its filesystem identity still matches';
    case 'unique_name_repo_identity_match':
      return 'a unique Project folder with the same name and repository identity was recovered';
    case 'resume_history_identity_match':
      return 'the interrupted run workspace identity was revalidated';
    default:
      return assertNever(provenance);
  }
}

function unavailableReason(
  provenance: Extract<WorkspaceProvenance, { availability: 'unavailable' }>,
): string {
  switch (provenance.reasonCode) {
    case 'none':
      return 'no matching Project folder was found';
    case 'ambiguous':
      return 'the Project folder could not be uniquely confirmed';
    default:
      return assertNever(provenance.reasonCode);
  }
}

/** The only workspace-provenance-to-product-copy boundary. */
export function formatWorkspaceProvenance(provenance: WorkspaceProvenance): string | null {
  switch (provenance.availability) {
    case 'bound':
      if (
        provenance.source === 'project_catalog' &&
        provenance.reasonCode === 'current_project_folder'
      ) {
        return null;
      }
      return `Selected Project folder: ${provenance.displayPath} — ${boundReason(provenance)}. File access is available for this Turn.`;
    case 'unavailable': {
      const consequence =
        provenance.requirement === 'optional'
          ? 'Conversation continues without file access.'
          : 'Restore or reselect the Project folder to continue.';
      return `Project files unavailable — ${unavailableReason(provenance)}. ${consequence}`;
    }
    default:
      return assertNever(provenance);
  }
}
