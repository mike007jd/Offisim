export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}
