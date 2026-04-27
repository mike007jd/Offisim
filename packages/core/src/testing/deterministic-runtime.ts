import type { RuntimeDeterminism } from '../runtime/runtime-context.js';

export function createDeterminism(seed = 'offisim-harness'): RuntimeDeterminism {
  let idCounter = 0;
  let uuidCounter = 0;
  let now = Date.UTC(2026, 0, 1, 0, 0, 0);

  return {
    nowMs() {
      const current = now;
      now += 1;
      return current;
    },
    nowIso() {
      return new Date(this.nowMs()).toISOString();
    },
    id(prefix: string) {
      idCounter += 1;
      return `${prefix}-${seed}-${String(idCounter).padStart(4, '0')}`;
    },
    uuid() {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
    },
  };
}
