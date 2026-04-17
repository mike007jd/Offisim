import type {
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { humanizeNodeName } from '../../../lib/agent-display';
import { enteredHeadline } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeGraphMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offEntered = eventBus.on(
    'graph.node.entered',
    (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
      sink.setHeadline(enteredHeadline(event.payload.nodeName));
    },
  );
  const offExited = eventBus.on(
    'graph.node.exited',
    (event: RuntimeEvent<GraphNodeExitedPayload>) => {
      sink.push({
        id: `node-${event.payload.nodeName}-${Date.now()}`,
        kind: 'node',
        tone: 'success',
        label: `${humanizeNodeName(event.payload.nodeName)} finished`,
        timestamp: Date.now(),
      });
    },
  );
  return () => {
    offEntered();
    offExited();
  };
}
