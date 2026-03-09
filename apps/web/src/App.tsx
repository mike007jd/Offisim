import { useEffect, useState } from 'react';
import {
  buildAicsGraph,
  createMemoryRepositories,
  InMemoryEventBus,
  createMemoryCheckpointSaver,
} from '@aics/core';

export function App() {
  const [status, setStatus] = useState('Testing core browser compatibility...');

  useEffect(() => {
    try {
      const eventBus = new InMemoryEventBus();
      const repos = createMemoryRepositories();
      const checkpointer = createMemoryCheckpointSaver();
      const graph = buildAicsGraph({ checkpointer });

      console.log('✅ InMemoryEventBus created:', eventBus);
      console.log('✅ Memory repositories created:', repos);
      console.log('✅ MemoryCheckpointSaver created:', checkpointer);
      console.log('✅ Graph compiled:', graph);

      setStatus('✅ All core imports work in browser!');
    } catch (err) {
      console.error('❌ Core browser compatibility failed:', err);
      setStatus(`❌ Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>AI Company Simulator — Runtime Shell</h1>
      <p>{status}</p>
    </div>
  );
}
