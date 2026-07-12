// Company-channel composer Enhance button (PR-05 × PR-06).
//
// The Connect entry point into the shared Prompt Enhance platform. Unlike the
// Office button (which reads assistant-ui's composer runtime), Connect's composer
// is a plain controlled textarea, so this button takes the current `value` + an
// `onApply` callback. It uses the `collaboration_message` profile — clarity, tone
// and brevity ONLY, never task steps / acceptance criteria / tool permissions —
// and preserves @mentions via the shared protected-span extractor.
//
// It NEVER auto-triggers and NEVER replaces text without the preview. Apply swaps
// the text and offers a single Undo (Sonner) that restores the original.

import { toMentionRoster } from '@/assistant/composer/composer-triggers.js';
import { PromptEnhanceReview } from '@/assistant/enhance/PromptEnhanceReview.js';
import { extractProtectedSpans } from '@/assistant/enhance/protected-spans.js';
import { buildEnhanceRequest } from '@/assistant/enhance/service.js';
import { createTauriEnhanceTransport } from '@/assistant/enhance/tauri-enhance-transport.js';
import { useEnhance } from '@/assistant/enhance/useEnhance.js';
import type { Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

export function ConnectEnhanceButton({
  threadId,
  value,
  threadTitle,
  scope,
  employees,
  onApply,
}: {
  /** Active thread id (cosmetic: lets enhance honor the thread's model override). */
  threadId: string | null;
  /** Current composer text. */
  value: string;
  /** Thread title (group name / employee name) — opaque context only. */
  threadTitle: string;
  scope: 'direct' | 'group';
  /** Roster for @mention protected-span extraction. */
  employees: readonly Employee[];
  /** Replace the composer text with the enhanced version. */
  onApply: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const transport = useMemo(
    () => createTauriEnhanceTransport(threadId ? { threadId } : {}),
    [threadId],
  );
  const enhance = useEnhance(transport);

  const roster = useMemo(
    () => toMentionRoster(employees.map((e) => ({ id: e.id, name: e.name, role: e.role }))),
    [employees],
  );

  const trimmed = value.trim();
  const disabled = trimmed.length === 0 || enhance.state.phase === 'loading';

  function openAndRun() {
    if (!trimmed) return;
    const spans = extractProtectedSpans(value, roster);
    const request = buildEnhanceRequest({
      profile: 'collaboration_message',
      text: value,
      protectedSpans: spans,
      context: { surface: 'connect', threadTitle, scope },
    });
    setOpen(true);
    enhance.start(request);
  }

  function applyEnhanced() {
    const result = enhance.state.result;
    if (!result) return;
    const original = value;
    onApply(result.enhanced);
    setOpen(false);
    enhance.reset();
    toast.success('Message enhanced', {
      description: 'Applied the enhanced version.',
      action: { label: 'Undo', onClick: () => onApply(original) },
    });
  }

  function keepOriginal() {
    setOpen(false);
    enhance.reset();
  }

  function close() {
    if (enhance.state.phase === 'loading') enhance.cancel();
    setOpen(false);
    enhance.reset();
  }

  return (
    <>
      <button
        type="button"
        className="off-enhance-overlay off-focusable"
        aria-label="Enhance message"
        title="Enhance message"
        disabled={disabled}
        onClick={openAndRun}
      >
        <Icon icon={Sparkles} size="sm" />
      </button>
      <PromptEnhanceReview
        open={open}
        state={enhance.state}
        onApply={applyEnhanced}
        onKeepOriginal={keepOriginal}
        onRegenerate={() => enhance.regenerate()}
        onCancel={() => enhance.cancel()}
        onClose={close}
      />
    </>
  );
}
