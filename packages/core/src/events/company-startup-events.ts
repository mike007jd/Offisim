import type {
  CompanyStartupBasePayload,
  CompanyStartupCompletedPayload,
  CompanyStartupFailedPayload,
  CompanyStartupRequestedPayload,
  CompanyStartupSkippedPayload,
  CompanyStartupSource,
  CompanyStartupStartedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';

interface CompanyStartupEventOptions {
  readonly startupId: string;
  readonly source: CompanyStartupSource;
  readonly providerReady: boolean;
  readonly replay?: boolean;
  readonly requestedAt?: number;
  readonly templateId?: string | null;
  readonly templateLabel?: string | null;
}

function basePayload(
  companyId: string,
  options: CompanyStartupEventOptions,
): CompanyStartupBasePayload {
  return {
    startupId: options.startupId,
    companyId,
    source: options.source,
    providerReady: options.providerReady,
    isReplay: options.replay ?? false,
    requestedAt: options.requestedAt ?? Date.now(),
    templateId: options.templateId ?? null,
    templateLabel: options.templateLabel ?? null,
  };
}

function startupEvent<P extends CompanyStartupBasePayload>(
  companyId: string,
  startupId: string,
  type: RuntimeEvent<P>['type'],
  payload: P,
): RuntimeEvent<P> {
  return {
    type,
    entityId: startupId,
    entityType: 'company',
    companyId,
    timestamp: Date.now(),
    payload,
  };
}

export function companyStartupRequested(
  companyId: string,
  options: CompanyStartupEventOptions,
): RuntimeEvent<CompanyStartupRequestedPayload> {
  const payload = { ...basePayload(companyId, options), status: 'requested' as const };
  return startupEvent(companyId, options.startupId, 'company.startup.requested', payload);
}

export function companyStartupStarted(
  companyId: string,
  options: CompanyStartupEventOptions & { readonly startedAt?: number },
): RuntimeEvent<CompanyStartupStartedPayload> {
  const payload = {
    ...basePayload(companyId, options),
    status: 'started' as const,
    startedAt: options.startedAt ?? Date.now(),
  };
  return startupEvent(companyId, options.startupId, 'company.startup.started', payload);
}

export function companyStartupCompleted(
  companyId: string,
  options: CompanyStartupEventOptions & { readonly completedAt?: number },
): RuntimeEvent<CompanyStartupCompletedPayload> {
  const payload = {
    ...basePayload(companyId, options),
    status: 'completed' as const,
    completedAt: options.completedAt ?? Date.now(),
  };
  return startupEvent(companyId, options.startupId, 'company.startup.completed', payload);
}

export function companyStartupSkipped(
  companyId: string,
  options: CompanyStartupEventOptions & { readonly skippedAt?: number; readonly reason?: string },
): RuntimeEvent<CompanyStartupSkippedPayload> {
  const payload = {
    ...basePayload(companyId, options),
    status: 'skipped' as const,
    skippedAt: options.skippedAt ?? Date.now(),
    ...(options.reason ? { reason: options.reason } : {}),
  };
  return startupEvent(companyId, options.startupId, 'company.startup.skipped', payload);
}

export function companyStartupFailed(
  companyId: string,
  options: CompanyStartupEventOptions & { readonly failedAt?: number; readonly error: string },
): RuntimeEvent<CompanyStartupFailedPayload> {
  const payload = {
    ...basePayload(companyId, options),
    status: 'failed' as const,
    failedAt: options.failedAt ?? Date.now(),
    error: options.error,
  };
  return startupEvent(companyId, options.startupId, 'company.startup.failed', payload);
}
