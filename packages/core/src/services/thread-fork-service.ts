import type { OffisimGraphState } from '../graph/state.js';

export interface ThreadForkService {
  forkFromCheckpoint(
    sourceThreadId: string,
    checkpointSeq: number,
    overrides?: Partial<OffisimGraphState>,
  ): Promise<string>;
}

export class ThreadForkServiceStub implements ThreadForkService {
  async forkFromCheckpoint(
    _sourceThreadId: string,
    _checkpointSeq: number,
    _overrides?: Partial<OffisimGraphState>,
  ): Promise<string> {
    throw new Error('ThreadForkService not implemented. Available in Phase 3+.');
  }
}
