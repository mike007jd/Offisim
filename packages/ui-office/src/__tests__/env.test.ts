import { afterEach, describe, expect, it } from 'vitest';
import { isTauri } from '../lib/env';

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI__');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('isTauri', () => {
  it('returns true when Tauri 2 internals are injected', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });

    expect(isTauri()).toBe(true);
  });

  it('returns true when legacy __TAURI__ global exists', () => {
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {},
    });

    expect(isTauri()).toBe(true);
  });

  it('returns false in a plain browser window', () => {
    expect(isTauri()).toBe(false);
  });
});
