import { useUiState } from '@/app/ui-state.js';
import { Button } from '@/design-system/primitives/button.js';
import { type DeepLinkInstallPayload, invokeCommand } from '@/lib/tauri-commands.js';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';

interface DeepLinkInstallIntent extends DeepLinkInstallPayload {
  intentId: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

let intents: DeepLinkInstallIntent[] = [];
let nextIntentId = 1;
let initialization: Promise<void> | null = null;
const subscribers = new Set<() => void>();
const MAX_PENDING_INTENTS = 16;

function parseDeepLinkInstallPayload(value: unknown): DeepLinkInstallPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.listing_id !== 'string' ||
    !UUID.test(payload.listing_id) ||
    typeof payload.version !== 'string' ||
    payload.version.length > 64 ||
    !SEMVER.test(payload.version)
  ) {
    return null;
  }
  return { listing_id: payload.listing_id, version: payload.version };
}

function enqueueDeepLinkInstall(value: unknown) {
  const payload = parseDeepLinkInstallPayload(value);
  if (!payload) {
    console.error('[deep-link] Ignoring invalid install payload');
    return;
  }
  if (
    intents.some(
      (intent) => intent.listing_id === payload.listing_id && intent.version === payload.version,
    ) ||
    intents.length >= MAX_PENDING_INTENTS
  ) {
    return;
  }
  intents = [...intents, { ...payload, intentId: nextIntentId++ }];
  for (const subscriber of subscribers) subscriber();
}

export function initializeDeepLinkInstallBridge(): Promise<void> {
  initialization ??= (async () => {
    await listen<unknown>('deep-link-install', (event) => enqueueDeepLinkInstall(event.payload));
    const pending = await invokeCommand('deep_link_mark_renderer_ready');
    for (const payload of pending) enqueueDeepLinkInstall(payload);
  })().catch((error) => {
    initialization = null;
    console.error('[deep-link] Failed to initialize install bridge', error);
  });
  return initialization;
}

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function getNextIntent() {
  return intents[0] ?? null;
}

export function consumeDeepLinkInstallIntent(intentId: number) {
  const next = intents.filter((intent) => intent.intentId !== intentId);
  if (next.length === intents.length) return;
  intents = next;
  for (const subscriber of subscribers) subscriber();
}

export function useDeepLinkInstallIntent() {
  return useSyncExternalStore(subscribe, getNextIntent, getNextIntent);
}

/** Navigates only after a company exists. MarketSurface owns exact-version
 * resolution and the permission review; a deep link never installs directly. */
export function DeepLinkInstallNavigator() {
  const intent = useDeepLinkInstallIntent();
  const companyId = useUiState((state) => state.companyId);
  const surface = useUiState((state) => state.surface);
  const setSurface = useUiState((state) => state.setSurface);

  if (!intent) return null;
  const canOpen = Boolean(companyId && surface !== 'lifecycle');

  return (
    <aside className="off-deep-link-notice off-icard" role="status" aria-live="polite">
      <div className="off-deep-link-notice__title">Install link received</div>
      <p className="off-deep-link-notice__description">
        {canOpen
          ? 'Open Market to review the exact item and version. Nothing will install until you choose Install.'
          : 'Finish company setup first. The install request will remain pending.'}
      </p>
      {canOpen ? (
        <Button size="sm" onClick={() => setSurface('market')}>
          Open Market
        </Button>
      ) : null}
    </aside>
  );
}
