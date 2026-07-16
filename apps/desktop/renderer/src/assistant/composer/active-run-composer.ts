export function advanceComposerEditRevision(revision: { current: number }): void {
  revision.current += 1;
}

export function shouldClearAcceptedComposerText(
  current: { text: string; revision: number },
  submitted: { text: string; revision: number },
  accepted: boolean,
): boolean {
  return accepted && current.revision === submitted.revision && current.text === submitted.text;
}
