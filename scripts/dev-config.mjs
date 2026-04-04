export function getTauriBeforeDevConfig(app) {
  if (app === 'desktop') {
    return {
      app: 'desktop',
      port: 5176,
      skipEnvVar: 'OFFISIM_SKIP_WEB_DEV',
      command: ['pnpm', '--filter', '@offisim/web', 'dev'],
    };
  }

  if (app === 'launcher') {
    return {
      app: 'launcher',
      port: 4200,
      skipEnvVar: 'OFFISIM_SKIP_LAUNCHER_VITE_DEV',
      command: ['pnpm', 'vite:dev'],
    };
  }

  throw new Error(`Unknown Tauri app: ${app}`);
}

export function createDevAllProcesses() {
  return [
    {
      name: 'platform',
      cwd: '.',
      command: ['pnpm', '--filter', '@offisim/platform', 'dev'],
      env: {},
    },
    {
      name: 'web',
      cwd: '.',
      command: ['pnpm', '--filter', '@offisim/web', 'dev'],
      env: {},
    },
    {
      name: 'desktop',
      cwd: '.',
      command: ['pnpm', '--filter', '@offisim/desktop', 'dev'],
      env: {
        OFFISIM_SKIP_WEB_DEV: '1',
      },
    },
    {
      name: 'launcher',
      cwd: '.',
      command: ['pnpm', '--filter', '@offisim/launcher', 'dev'],
      env: {},
    },
  ];
}
