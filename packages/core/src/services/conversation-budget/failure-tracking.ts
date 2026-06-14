import { touchLru } from '../../utils/lru-map.js';

export const MAX_TRACKED_THREADS = 200;

export function setTrackedThread(map: Map<string, number>, threadId: string, value: number): void {
  touchLru(map, threadId, value, MAX_TRACKED_THREADS);
}
