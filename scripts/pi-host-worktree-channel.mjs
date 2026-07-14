// Park-and-resume channel for Rust-owned workspace operations (git, files, Bash).
//
// The child supervisor runs inside the Node host, so it owns per-child lease
// decisions. Filesystem/process authority stays Rust-side: requestWorktreeResult
// emits a `worktreeCall` JSONL line, Rust validates/runs the allowed operation, then
// writes a matching `worktreeResult` line back to stdin.

import { worktreeCallLine } from './pi-agent-host-wire.mjs';

const WORKSPACE_FILE_OPERATIONS = new Set([
  'fileRead',
  'fileWrite',
  'fileStat',
  'fileList',
  'fileFind',
  'fileGrep',
]);

export function createWorktreeCallChannel(emit) {
  let seq = 0;
  const pending = new Map();

  return {
    requestWorktreeResult(op, args = {}, options = {}) {
      seq += 1;
      const id = `wt-${seq}`;
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      let abortHandler;
      if ((op === 'executeBash' || WORKSPACE_FILE_OPERATIONS.has(op)) && options.signal) {
        abortHandler = () => {
          seq += 1;
          emit(
            worktreeCallLine({
              id: `wt-cancel-${seq}`,
              op: op === 'executeBash' ? 'cancelBash' : 'cancelWorkspaceFile',
              args: { callId: id },
            }),
          );
        };
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
      pending.set(id, {
        resolve: resolvePromise,
        signal: options.signal,
        abortHandler,
      });
      emit(worktreeCallLine({ id, op, args }));
      if (options.signal?.aborted) abortHandler?.();
      return promise;
    },

    resolveWorktreeResult(result) {
      if (!result || typeof result.id !== 'string') return;
      const record = pending.get(result.id);
      if (record) {
        pending.delete(result.id);
        if (record.abortHandler) {
          record.signal?.removeEventListener('abort', record.abortHandler);
        }
        record.resolve(result);
      }
    },

    rejectAllWorktreeCalls() {
      for (const [id, record] of pending) {
        pending.delete(id);
        if (record.abortHandler) {
          record.signal?.removeEventListener('abort', record.abortHandler);
        }
        record.resolve({ id, ok: false, error: 'host stdin closed' });
      }
    },
  };
}
