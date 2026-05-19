export function getTauriBeforeDevConfig(app) {
  if (app === 'desktop') {
    return {
      app: 'desktop',
      port: 5176,
      skipEnvVar: 'OFFISIM_SKIP_RENDERER_DEV',
      command: ['pnpm', '--filter', '@offisim/desktop-renderer', 'dev'],
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
      name: 'desktop',
      cwd: '.',
      command: ['pnpm', '--filter', '@offisim/desktop', 'dev'],
      env: {},
    },
  ];
}
