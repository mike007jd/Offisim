import type {
  GitAutoCommittedPayload,
  KnowledgeIndexCompletedPayload,
  RuntimeEvent,
  WorkspaceStalenessDetectedPayload,
} from '@offisim/shared-types';
import { formatStalenessReason, truncate } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeWorkspaceMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offStaleness = eventBus.on(
    'workspace.staleness.detected',
    (event: RuntimeEvent<WorkspaceStalenessDetectedPayload>) => {
      sink.setHeadline(
        event.payload.status === 'block'
          ? 'Resume blocked by workspace changes'
          : 'Workspace changed since the last checkpoint',
      );
      sink.push({
        id: `workspace-${event.timestamp}`,
        kind: 'system',
        tone: event.payload.status === 'block' ? 'error' : 'warning',
        label: formatStalenessReason(event.payload),
        timestamp: event.timestamp,
      });
    },
  );

  const offGit = eventBus.on(
    'git.auto.committed',
    (event: RuntimeEvent<GitAutoCommittedPayload>) => {
      const p = event.payload;
      sink.push({
        id: `git-commit-${event.timestamp}`,
        kind: 'system',
        tone: 'success',
        label: `Committed: ${truncate(p.commitMessage, 50)} (${p.fileCount} file${p.fileCount === 1 ? '' : 's'})`,
        timestamp: event.timestamp,
      });
    },
  );

  const offKnowledge = eventBus.on(
    'knowledge.index.completed',
    (event: RuntimeEvent<KnowledgeIndexCompletedPayload>) => {
      sink.push({
        id: `knowledge-idx-${event.timestamp}`,
        kind: 'system',
        tone: 'success',
        label: `Indexed ${event.payload.indexedCount} document${event.payload.indexedCount === 1 ? '' : 's'}`,
        timestamp: event.timestamp,
      });
    },
  );

  return () => {
    offStaleness();
    offGit();
    offKnowledge();
  };
}
