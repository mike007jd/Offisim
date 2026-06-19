const PI_MODEL_OVERRIDE_STORAGE_KEY = 'offisim:pi-agent:model-override';

export function readPiModelOverride(): string {
  try {
    return globalThis.localStorage?.getItem(PI_MODEL_OVERRIDE_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function writePiModelOverride(value: string): void {
  const next = value.trim();
  try {
    if (next) {
      globalThis.localStorage?.setItem(PI_MODEL_OVERRIDE_STORAGE_KEY, next);
    } else {
      globalThis.localStorage?.removeItem(PI_MODEL_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in previews; runtime will fall back to Pi defaults.
  }
}
