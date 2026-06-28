// Park-and-resume channel for host-side workspace lease git operations (F2).
//
// The child supervisor runs inside the Node host, so it owns per-child lease
// decisions. Git itself stays Rust-side: requestWorktreeResult emits a
// `worktreeCall` JSONL line, Rust validates/runs the allowed git operation, then
// writes a matching `worktreeResult` line back to stdin.

import { worktreeCallLine } from './pi-agent-host-wire.mjs';

export function createWorktreeCallChannel(emit) {
  let seq = 0;
  const pending = new Map();

  return {
    requestWorktreeResult(op, args = {}) {
      seq += 1;
      const id = `wt-${seq}`;
      emit(worktreeCallLine({ id, op, args }));
      return new Promise((resolve) => {
        pending.set(id, resolve);
      });
    },

    resolveWorktreeResult(result) {
      if (!result || typeof result.id !== 'string') return;
      const resolve = pending.get(result.id);
      if (resolve) {
        pending.delete(result.id);
        resolve(result);
      }
    },

    rejectAllWorktreeCalls() {
      for (const [id, resolve] of pending) {
        pending.delete(id);
        resolve({ id, ok: false, error: 'host stdin closed' });
      }
    },
  };
}
