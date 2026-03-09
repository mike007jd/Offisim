import { describe, expect, it } from 'vitest';
import {
  installStateChanged,
  bindingStateChanged,
} from '../../events/event-factories.js';

describe('install event factories', () => {
  it('installStateChanged produces correct event shape', () => {
    const event = installStateChanged(
      'c-1', 'txn-1', 'created', 'manifest_loaded', 't-1', 'pkg-1', undefined,
    );
    expect(event.type).toBe('install.state.changed');
    expect(event.entityType).toBe('install');
    expect(event.entityId).toBe('txn-1');
    expect(event.companyId).toBe('c-1');
    expect(event.threadId).toBe('t-1');
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.payload.installTxnId).toBe('txn-1');
    expect(event.payload.prev).toBe('created');
    expect(event.payload.next).toBe('manifest_loaded');
    expect(event.payload.packageId).toBe('pkg-1');
    expect(event.payload.errorCode).toBeUndefined();
  });

  it('installStateChanged includes errorCode on failure', () => {
    const event = installStateChanged(
      'c-1', 'txn-2', 'integrity_checked', 'failed', undefined, 'pkg-2', 'integrity_mismatch',
    );
    expect(event.type).toBe('install.state.changed');
    expect(event.payload.prev).toBe('integrity_checked');
    expect(event.payload.next).toBe('failed');
    expect(event.payload.errorCode).toBe('integrity_mismatch');
    expect(event.threadId).toBeUndefined();
  });

  it('bindingStateChanged produces correct event shape', () => {
    const event = bindingStateChanged(
      'c-1', 'bind-1', 'txn-1', 'model_profile', 'default_model', 'pending', 'satisfied', 't-1',
    );
    expect(event.type).toBe('binding.state.changed');
    expect(event.entityType).toBe('install');
    expect(event.entityId).toBe('bind-1');
    expect(event.companyId).toBe('c-1');
    expect(event.threadId).toBe('t-1');
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.payload.bindingId).toBe('bind-1');
    expect(event.payload.installTxnId).toBe('txn-1');
    expect(event.payload.bindingType).toBe('model_profile');
    expect(event.payload.bindingKey).toBe('default_model');
    expect(event.payload.prev).toBe('pending');
    expect(event.payload.next).toBe('satisfied');
  });

  it('bindingStateChanged without threadId', () => {
    const event = bindingStateChanged(
      'c-2', 'bind-2', 'txn-2', 'mcp_slot', 'mcp_github', 'pending', 'error',
    );
    expect(event.type).toBe('binding.state.changed');
    expect(event.threadId).toBeUndefined();
    expect(event.payload.bindingType).toBe('mcp_slot');
    expect(event.payload.next).toBe('error');
  });
});
