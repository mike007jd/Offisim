export const WORKSPACE_DIAGNOSTICS_UPDATED_EVENT = 'workspace.diagnostics.updated' as const;

export type WorkspaceDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface WorkspaceDiagnosticPosition {
  line: number;
  column: number;
}

export interface WorkspaceDiagnostic {
  severity: WorkspaceDiagnosticSeverity;
  message: string;
  code?: string;
  source?: string;
  range: {
    start: WorkspaceDiagnosticPosition;
    end: WorkspaceDiagnosticPosition;
  };
}

export interface WorkspaceDiagnosticsUpdatedPayload {
  requestId: string;
  runId: string;
  childRunId?: string;
  path: string;
  languageId: string;
  serverId: string;
  source: 'lsp';
  version: number;
  diagnostics: WorkspaceDiagnostic[];
  counts: Record<WorkspaceDiagnosticSeverity, number>;
  message: string;
  capturedAt: string;
}
