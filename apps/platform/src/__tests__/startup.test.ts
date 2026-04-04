import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import {
  DEV_AUTH_SECRET,
  DEV_DEFAULT_ORIGINS,
  resolveAuthSecret,
  resolveCorsOrigins,
} from '../startup.js';

describe('startup config', () => {
  it('uses development defaults without emitting startup warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(resolveAuthSecret({ nodeEnv: 'development' })).toBe(DEV_AUTH_SECRET);
    expect(resolveCorsOrigins({ nodeEnv: 'development' })).toEqual(DEV_DEFAULT_ORIGINS);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('rejects missing production auth secret', () => {
    expect(() => resolveAuthSecret({ nodeEnv: 'production' })).toThrow(
      'BETTER_AUTH_SECRET is not set in production.',
    );
  });

  it('rejects missing production cors origins', () => {
    expect(() => resolveCorsOrigins({ nodeEnv: 'production' })).toThrow(
      'CORS_ORIGINS is not set in production.',
    );
  });
});

describe('app startup', () => {
  it('does not probe the database while creating the app', () => {
    const mockDb = {
      execute: vi.fn(),
    };

    createApp(mockDb as never);

    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});
