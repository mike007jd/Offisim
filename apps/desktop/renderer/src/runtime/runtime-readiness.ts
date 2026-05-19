export interface RuntimeInteractionState {
  orch: unknown | null;
}

export function isRuntimeReadyForInteraction(
  runtime: RuntimeInteractionState | null | undefined,
): boolean {
  return runtime?.orch != null;
}
