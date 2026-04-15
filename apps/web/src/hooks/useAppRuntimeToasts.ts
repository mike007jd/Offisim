import type { EventBus } from '@offisim/core/browser';
import type { ToastIntent } from '@offisim/ui-core';
import type { DeliverableCreatedPayload, RuntimeEvent, VaultSyncFailedPayload } from '@offisim/shared-types';
import { useEffect } from 'react';
import { markCompany } from '../lib/onboarding-store';

const DELIVERABLE_FILE_NAME_RE = /\.(html|js|ts|json|md|css|txt|csv|ya?ml|xml)$/i;

function stripLegacySpeakerPrefix(text: string): string {
  return text.replace(/^\[([^\]]*[a-zA-Z][^\]]*)\]:?\s?/, '');
}

function formatDeliverableToastTitle(
  payload: Pick<DeliverableCreatedPayload, 'title' | 'kind' | 'fileName'>,
): string {
  if (payload.kind === 'file' && payload.fileName?.trim()) {
    return `${payload.fileName.trim()} ready`;
  }

  const cleaned = stripLegacySpeakerPrefix(payload.title)
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (DELIVERABLE_FILE_NAME_RE.test(cleaned)) {
    return `${cleaned} ready`;
  }
  if (cleaned.startsWith('```') || /^<!doctype html/i.test(cleaned) || /^<html[\s>]/i.test(cleaned)) {
    return 'Deliverable ready';
  }
  if (!cleaned) return 'Deliverable ready';
  if (cleaned.length <= 36) return `${cleaned} ready`;
  return 'Deliverable ready';
}

function formatVaultFailureToast(payload: VaultSyncFailedPayload): string {
  let verb = 'write';
  switch (payload.target) {
    case 'import':
      verb = 'read';
      break;
    case 'delete':
      verb = 'delete';
      break;
    case 'activate':
      verb = 'activation';
      break;
  }
  return `Vault ${verb} failed: ${payload.reason}`;
}

export function useAppRuntimeToasts(opts: {
  eventBus: EventBus;
  addToast: (
    message: string,
    intent?: ToastIntent,
    options?: {
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    },
  ) => void;
  onOpenTasks: () => void;
}): void {
  const { eventBus, addToast, onOpenTasks } = opts;

  useEffect(() => {
    return eventBus.on('deliverable.created', (event: RuntimeEvent<DeliverableCreatedPayload>) => {
      addToast(formatDeliverableToastTitle(event.payload), 'success', {
        actionLabel: 'Open Tasks',
        onAction: onOpenTasks,
        durationMs: 10_000,
      });
      if (event.companyId) {
        markCompany(event.companyId, 'first_deliverable_seen');
      }
    });
  }, [addToast, eventBus, onOpenTasks]);

  useEffect(() => {
    return eventBus.on('vault.sync.failed', (event: RuntimeEvent<VaultSyncFailedPayload>) => {
      addToast(formatVaultFailureToast(event.payload), 'error', { durationMs: 8_000 });
    });
  }, [addToast, eventBus]);
}
