export type CompanyStartupSource = 'template' | 'custom' | 'replay' | 'system';

export interface CompanyStartupBasePayload {
  readonly startupId: string;
  readonly companyId: string;
  readonly source: CompanyStartupSource;
  readonly providerReady: boolean;
  readonly isReplay: boolean;
  readonly requestedAt: number;
  readonly templateId?: string | null;
  readonly templateLabel?: string | null;
}

export interface CompanyStartupRequestedPayload extends CompanyStartupBasePayload {
  readonly status: 'requested';
}

export interface CompanyStartupStartedPayload extends CompanyStartupBasePayload {
  readonly status: 'started';
  readonly startedAt: number;
}

export interface CompanyStartupCompletedPayload extends CompanyStartupBasePayload {
  readonly status: 'completed';
  readonly completedAt: number;
}

export interface CompanyStartupSkippedPayload extends CompanyStartupBasePayload {
  readonly status: 'skipped';
  readonly skippedAt: number;
  readonly reason?: string;
}

export interface CompanyStartupFailedPayload extends CompanyStartupBasePayload {
  readonly status: 'failed';
  readonly failedAt: number;
  readonly error: string;
}

export type CompanyStartupPayload =
  | CompanyStartupRequestedPayload
  | CompanyStartupStartedPayload
  | CompanyStartupCompletedPayload
  | CompanyStartupSkippedPayload
  | CompanyStartupFailedPayload;
