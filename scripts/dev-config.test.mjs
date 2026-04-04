import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDevAllProcesses,
  getTauriBeforeDevConfig,
} from './dev-config.mjs';

test('desktop before-dev config targets the shared web dev server', () => {
  assert.deepEqual(getTauriBeforeDevConfig('desktop'), {
    app: 'desktop',
    port: 5176,
    skipEnvVar: 'OFFISIM_SKIP_WEB_DEV',
    command: ['pnpm', '--filter', '@offisim/web', 'dev'],
  });
});

test('launcher before-dev config targets the launcher frontend dev server', () => {
  assert.deepEqual(getTauriBeforeDevConfig('launcher'), {
    app: 'launcher',
    port: 4200,
    skipEnvVar: 'OFFISIM_SKIP_LAUNCHER_VITE_DEV',
    command: ['pnpm', 'vite:dev'],
  });
});

test('dev:all starts four processes and reuses the shared web dev server for desktop', () => {
  const processes = createDevAllProcesses();

  assert.equal(processes.length, 4);

  const desktop = processes.find((entry) => entry.name === 'desktop');
  assert.ok(desktop);
  assert.equal(desktop.cwd, '.');
  assert.deepEqual(desktop.command, ['pnpm', '--filter', '@offisim/desktop', 'dev']);
  assert.equal(desktop.env.OFFISIM_SKIP_WEB_DEV, '1');

  const web = processes.find((entry) => entry.name === 'web');
  assert.ok(web);
  assert.deepEqual(web.command, ['pnpm', '--filter', '@offisim/web', 'dev']);
});
