// Park-and-resume channel for project verification commands. Rust services each
// request through the existing sandboxed bash_execute builtin and replies on stdin.

import { verifyCallLine } from './pi-agent-host-wire.mjs';

export function createVerifyCallChannel(emit) {
  let seq = 0;
  const pending = new Map();

  return {
    requestVerifyResult({ command, cwd, projectId }) {
      seq += 1;
      const id = `verify-${seq}`;
      emit(verifyCallLine({ id, command, cwd, projectId }));
      return new Promise((resolve) => pending.set(id, resolve));
    },

    resolveVerifyResult(result) {
      if (!result || typeof result.id !== 'string') return;
      const resolve = pending.get(result.id);
      if (resolve) {
        pending.delete(result.id);
        resolve(result);
      }
    },

    rejectAllVerifyCalls() {
      for (const [id, resolve] of pending) {
        pending.delete(id);
        resolve({ id, ok: false, error: 'host stdin closed' });
      }
    },
  };
}
