import type { ChatAttachmentRef, RunScope } from '@offisim/shared-types';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { sanitizeForPrompt } from '../utils/sanitize-prompt.js';

export const ATTACHMENT_ONLY_TASK_DESCRIPTION =
  'Inspect the current turn attachments. Call read_attachment for each attachment before replying, then summarize the files the user attached. Do not guess from filenames or old conversation context.';

export function resolveAttachmentAwareTaskDescription(
  rawTaskDescription: string,
  runScope?: RunScope | null,
): string {
  if (rawTaskDescription.trim().length > 0) return rawTaskDescription;
  return (runScope?.pendingAttachments?.length ?? 0) > 0
    ? ATTACHMENT_ONLY_TASK_DESCRIPTION
    : rawTaskDescription;
}

function formatAttachmentLine(ref: ChatAttachmentRef): string {
  const filename = sanitizeForPrompt(ref.filename, 180);
  const mimeType = sanitizeForPrompt(ref.mimeType || 'application/octet-stream', 120);
  const vaultRef = sanitizeForPrompt(ref.vaultRef, 260);
  const kind = sanitizeForPrompt(ref.kind, 40);
  const summary = sanitizeForPrompt(ref.summary ?? 'not parsed', 200);
  return `[attachment ${filename}, ${mimeType}, ${ref.byteLength} bytes, ref=${vaultRef}, kind=${kind}, summary=${summary}]`;
}

function uniqueAttachmentRefs(refs: readonly ChatAttachmentRef[]): ChatAttachmentRef[] {
  const seen = new Set<string>();
  const unique: ChatAttachmentRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.vaultRef)) continue;
    seen.add(ref.vaultRef);
    unique.push(ref);
  }
  return unique;
}

export function buildAttachmentSystemPreface(
  runtimeCtx: RuntimeContext,
  runScope?: RunScope | null,
): string {
  const pendingRefs = uniqueAttachmentRefs(runScope?.pendingAttachments ?? []);
  const pendingVaultRefs = new Set(pendingRefs.map((ref) => ref.vaultRef));
  const historicalRefs = uniqueAttachmentRefs(runScope?.availableAttachments ?? []).filter(
    (ref) => !pendingVaultRefs.has(ref.vaultRef),
  );
  if (pendingRefs.length === 0 && historicalRefs.length === 0) return '';
  if (runtimeCtx.llmToolCallsEnabled === false) return '';

  const sections = ['', ''];
  if (pendingRefs.length > 0) {
    sections.push(
      '## Current turn attachments',
      'The user attached files to this turn. If the user message is empty or asks about the files, call `read_attachment` for every current-turn attachment before replying. Do not guess from filenames or old conversation context.',
      ...pendingRefs.map(formatAttachmentLine),
    );
  }
  if (historicalRefs.length > 0) {
    if (pendingRefs.length > 0) sections.push('');
    sections.push(
      '## Earlier same-thread attachments',
      'These files were attached earlier in this same chat thread. If the user references an earlier PDF, document, spreadsheet, presentation, image, or data file, call `read_attachment` with the matching ref before replying.',
      ...historicalRefs.map(formatAttachmentLine),
    );
  }
  return sections.join('\n');
}
