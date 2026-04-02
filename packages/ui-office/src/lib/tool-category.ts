import type { ToolExecutionTelemetryPayload } from '@offisim/shared-types';

export type ToolCategory = 'search' | 'read' | 'edit' | 'shell' | 'other';

export function categorizeTool(
  payload: Pick<ToolExecutionTelemetryPayload, 'toolName' | 'serverName'>,
): ToolCategory {
  const haystack = `${payload.serverName ?? ''}/${payload.toolName}`.toLowerCase();
  if (
    haystack.includes('search') ||
    haystack.includes('grep') ||
    haystack.includes('glob') ||
    haystack.includes('find') ||
    haystack.includes('query')
  ) {
    return 'search';
  }
  if (
    haystack.includes('read') ||
    haystack.includes('fetch') ||
    haystack.includes('open') ||
    haystack.includes('view') ||
    haystack.includes('cat')
  ) {
    return 'read';
  }
  if (
    haystack.includes('write') ||
    haystack.includes('edit') ||
    haystack.includes('replace') ||
    haystack.includes('patch') ||
    haystack.includes('create') ||
    haystack.includes('delete')
  ) {
    return 'edit';
  }
  if (
    haystack.includes('bash') ||
    haystack.includes('shell') ||
    haystack.includes('exec') ||
    haystack.includes('command') ||
    haystack.includes('terminal') ||
    haystack.includes('run')
  ) {
    return 'shell';
  }
  return 'other';
}
