import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireLocalRuntimeAccess, requireScope } from '../apps/platform/src/middleware/auth.js';

type FakeResponse = { status: number; body: unknown };

function makeContext(input: {
  authKind?: string;
  scopes?: readonly string[];
  userId?: string;
  localRuntimeToken?: string;
}) {
  const values = new Map<string, unknown>();
  if (input.authKind) values.set('authKind', input.authKind);
  if (input.scopes) values.set('apiTokenScopes', [...input.scopes]);
  if (input.userId) values.set('userId', input.userId);
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === 'x-offisim-local-runtime-token'
          ? input.localRuntimeToken
          : undefined,
    },
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
    json: (body: unknown, status: number): FakeResponse => ({ body, status }),
  };
}

async function runMiddleware(
  middleware: (c: never, next: () => Promise<void>) => Promise<unknown>,
  context: ReturnType<typeof makeContext>,
) {
  let nextCalled = false;
  const response = await middleware(context as never, async () => {
    nextCalled = true;
  });
  return { nextCalled, response: response as FakeResponse | undefined };
}

async function expectScopeDenied() {
  const { nextCalled, response } = await runMiddleware(
    requireScope('publish:write') as never,
    makeContext({ authKind: 'api-token', scopes: ['reviews:write'] }),
  );
  if (nextCalled || response?.status !== 403) {
    throw new Error('API token without required scope was not denied');
  }
}

async function expectScopeAllowed() {
  const { nextCalled, response } = await runMiddleware(
    requireScope('publish:write') as never,
    makeContext({ authKind: 'api-token', scopes: ['publish:write'] }),
  );
  if (!nextCalled || response) throw new Error('API token with required scope was not allowed');
}

async function expectLocalRouteSessionAllowed() {
  const { nextCalled, response } = await runMiddleware(
    requireLocalRuntimeAccess as never,
    makeContext({ userId: 'user-1' }),
  );
  if (!nextCalled || response) throw new Error('authenticated session was not allowed');
}

async function expectLoopbackWithoutTokenRejected() {
  process.env.OFFISIM_LOCAL_RUNTIME_TOKEN = 'local-secret';
  const { nextCalled, response } = await runMiddleware(
    requireLocalRuntimeAccess as never,
    makeContext({}),
  );
  if (nextCalled || response?.status !== 401) {
    throw new Error('local runtime route allowed unauthenticated request without token');
  }
}

async function expectLocalTokenAllowed() {
  process.env.OFFISIM_LOCAL_RUNTIME_TOKEN = 'local-secret';
  const { nextCalled, response } = await runMiddleware(
    requireLocalRuntimeAccess as never,
    makeContext({ localRuntimeToken: 'local-secret' }),
  );
  if (!nextCalled || response) throw new Error('local runtime token was not allowed');
}

function expectMigrationDriftFailure() {
  const dir = mkdtempSync(join(tmpdir(), 'offisim-platform-drift-'));
  const migrations = join(dir, 'migrations');
  try {
    writeFileSync(
      join(dir, 'schema.ts'),
      "export const table = pgTable('x', {}, (table) => [unique('missing_unique').on(table.x)]);",
    );
    writeFileSync(join(dir, 'placeholder'), '');
    execFileSync('mkdir', ['-p', migrations]);
    writeFileSync(join(migrations, '0001.sql'), '-- intentionally missing constraint\n');
    try {
      execFileSync('node', ['scripts/check-platform-migration-drift.mjs'], {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          OFFISIM_PLATFORM_SCHEMA_PATH: join(dir, 'schema.ts'),
          OFFISIM_PLATFORM_MIGRATIONS_DIR: migrations,
        },
        stdio: 'pipe',
      });
    } catch {
      return;
    }
    throw new Error('migration drift check did not fail on missing constraint');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await expectScopeDenied();
await expectScopeAllowed();
await expectLocalRouteSessionAllowed();
await expectLoopbackWithoutTokenRejected();
await expectLocalTokenAllowed();
expectMigrationDriftFailure();

console.log('Platform auth boundary harness passed.');
