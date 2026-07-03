let ready = false;
let mount: HTMLElement | null = null;

declare global {
  interface Window {
    __OFFISIM_BOOTGUARD_READY?: () => void;
  }
}

function ensureMount() {
  if (ready) return null;
  if (mount?.isConnected) return mount;
  const existing = document.getElementById('offisim-static-boot');
  if (existing instanceof HTMLElement) {
    mount = existing;
    return mount;
  }
  mount = document.createElement('div');
  mount.id = 'offisim-static-boot';
  mount.setAttribute('role', 'alert');
  mount.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:var(--off-z-emergency)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:var(--off-bg)',
    'color:var(--off-ink-1)',
    'font:var(--off-fs-md)/1.5 var(--off-font-sans)',
    'padding:32px',
    'box-sizing:border-box',
  ].join(';');
  const panel = document.createElement('div');
  panel.style.cssText = [
    'max-width:640px',
    'border:1px solid var(--off-line-strong)',
    'background:var(--off-surface-1)',
    'border-radius:var(--off-r-sm)',
    'padding:18px 20px',
    'box-shadow:var(--off-elev-3)',
  ].join(';');
  const title = document.createElement('div');
  title.id = 'offisim-bootguard-title';
  title.style.cssText = 'font-weight:650;margin-bottom:6px';
  title.textContent = 'Loading Offisim';
  const body = document.createElement('div');
  body.id = 'offisim-bootguard-body';
  body.style.cssText = 'white-space:pre-wrap;color:var(--off-ink-2)';
  body.textContent = 'Opening the local company workspace.';
  panel.appendChild(title);
  panel.appendChild(body);
  mount.appendChild(panel);
  document.body.appendChild(mount);
  return mount;
}

function show(kind: string, value: unknown) {
  const node = ensureMount();
  if (!node) return;
  const title = document.getElementById('offisim-bootguard-title');
  const body = document.getElementById('offisim-bootguard-body');
  if (title) title.textContent = 'Offisim renderer failed to start';
  if (body) {
    const error = value as { stack?: unknown; message?: unknown } | null | undefined;
    const message =
      typeof error?.stack === 'string'
        ? error.stack
        : typeof error?.message === 'string'
          ? error.message
          : String(value || 'Unknown startup error');
    body.textContent = `${kind}: ${message}`;
  }
}

window.__OFFISIM_BOOTGUARD_READY = () => {
  ready = true;
  const node = mount ?? document.getElementById('offisim-static-boot');
  node?.parentNode?.removeChild(node);
  mount = null;
};

window.addEventListener('error', (event) => {
  show('error', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  show('unhandledrejection', event.reason);
});

ensureMount();

export {};
