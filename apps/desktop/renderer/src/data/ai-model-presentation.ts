import type { AiBillingMode, AiModelSource } from '@offisim/shared-types';

export function aiAccountLaneKey(
  engineId: string,
  accountId: string,
  billingMode: AiBillingMode,
): string {
  return `${engineId}\0${accountId}\0${billingMode}`;
}

function sourceHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./u, '');
  } catch {
    return 'service source';
  }
}

function compactCheckedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

export function aiModelSourceLabel(source: AiModelSource): string {
  if (source.kind === 'native') return 'Native engine identity';
  return `Official API · ${sourceHost(source.sourceUrl)} · checked ${compactCheckedAt(source.checkedAt)}`;
}
