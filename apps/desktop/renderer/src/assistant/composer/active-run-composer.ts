export interface ComposerEditSnapshot {
  readonly text: string;
  readonly revision: number;
}

export function advanceComposerEditRevision(revision: { current: number }): void {
  revision.current += 1;
}

/** Keep every edit made while a steer/follow-up waits for its host acknowledgement. */
export function shouldClearAcceptedComposerText(
  current: ComposerEditSnapshot,
  submitted: ComposerEditSnapshot,
  accepted: boolean,
): boolean {
  return accepted && current.text === submitted.text && current.revision === submitted.revision;
}
